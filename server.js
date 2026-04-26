import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import multer from 'multer';
import fs from 'fs';

import { JWT_SECRET, getPosts, registerUser, loginUser, getDriveLink, addPost, subscribeNewsletter, updatePost, deletePost, sendNotification, findUserByEmail, updatePassword, getSettings, updateSettings } from './src/services/backendService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resetTokens = new Map();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());
  app.set('trust proxy', 1);

  // Multer setup for PDF uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = 'uploads';
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir);
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  });

  const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
      if (file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are allowed'), false);
      }
    }
  });

  // Serve uploaded files
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // --- Static Admin Serving ---
  app.use('/admin-gui', express.static(path.join(__dirname, 'public/admin')));

  // --- API Routes ---

  // User Auth Middleware
  const authenticate = (req, res, next) => {
    const token = req.cookies.auth_token;
    
    if (!token) {
      console.warn(`[Auth] Missing auth_token for ${req.path}. Origin: ${req.get('origin') || 'none'}. UA: ${req.get('user-agent')}`);
      return res.status(401).json({ message: 'Unauthorized - Login required' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      console.warn(`[Auth] Invalid token for ${req.path}:`, err.message);
      res.status(401).json({ message: 'Invalid token - Please login again' });
    }
  };

  // Dedicated Admin Auth Middleware
  const authenticateAdmin = (req, res, next) => {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ message: 'Admin access required' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role !== 'admin') throw new Error('Not admin');
      req.admin = decoded;
      next();
    } catch (err) {
      res.status(401).json({ message: 'Invalid admin session' });
    }
  };

  // Admin Login
  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const adminPass = process.env.ADMIN_PASSWORD || 'T9#vQ2!mZ7@Lp4$X';
    
    if (password === adminPass) {
      const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
      res.cookie('admin_token', token, { 
        httpOnly: true, 
        maxAge: 7200000,
        path: '/',
        sameSite: 'none',
        secure: true,
        partitioned: true
      }); // 2 hours
      return res.json({ message: 'Admin login successful' });
    }
    res.status(401).json({ error: 'Invalid admin credentials' });
  });

  app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('admin_token', {
      httpOnly: true,
      path: '/',
      sameSite: 'none',
      secure: true,
      partitioned: true
    });
    res.json({ message: 'Admin logged out' });
  });

  // Check Admin Status
  app.get('/api/admin/me', (req, res) => {
    const token = req.cookies.admin_token;
    if (!token) return res.json({ isAdmin: false });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json({ isAdmin: decoded.role === 'admin' });
    } catch (err) {
      res.json({ isAdmin: false });
    }
  });

  // Get all posts (public & admin)
  app.get('/api/posts', async (req, res) => {
    try {
      const posts = await getPosts();
      res.json(posts);
    } catch (error) {
      console.error('Error fetching posts:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch posts' });
    }
  });

  // Register
  app.post('/api/register', async (req, res) => {
    const { email, password, name } = req.body;
    try {
      await registerUser(email, password, name);
      res.json({ message: 'Registration successful' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Login
  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
      const { token, user } = await loginUser(email, password);
      console.log(`[Login] Setting cookie for ${email}`);
      res.cookie('auth_token', token, { 
        httpOnly: true, 
        maxAge: 86400000, 
        path: '/',
        sameSite: 'none',
        secure: true,
        partitioned: true
      });
      res.json({ message: 'Login successful', user });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  });

  // Logout
  app.post('/api/logout', (req, res) => {
    res.clearCookie('auth_token', {
      httpOnly: true,
      path: '/',
      sameSite: 'none',
      secure: true,
      partitioned: true
    });
    res.json({ message: 'Logged out' });
  });

  // Forgot Password
  app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
      const user = await findUserByEmail(email);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const token = Math.floor(100000 + Math.random() * 900000).toString();
      resetTokens.set(email, { token, expiry: Date.now() + 3600000 });

      const smtpUser = 'aponalom2005@gmail.com';
      const smtpPass = 'hdiyizbccalgbbdy';

      if (!smtpUser || !smtpPass) {
        console.warn(`SMTP credentials missing.`);
        return res.json({ 
          message: 'SMTP credentials missing.',
          simulated: true,
          token: token 
        });
      }

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { 
          user: smtpUser, 
          pass: smtpPass 
        },
      });

      console.log(`Sending password reset email to ${email} via ${smtpUser}...`);
      await transporter.sendMail({
        from: `"NoteMind Support" <${smtpUser}>`,
        to: email,
        subject: 'Password Reset Token - NoteMind',
        text: `Your password reset token is: ${token}. It will expire in 1 hour.`,
        html: `<div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 12px;">
          <h2 style="color: #2563eb;">Password Reset</h2>
          <p>You requested a password reset for your NoteMind account.</p>
          <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px; margin: 20px 0;">
            ${token}
          </div>
          <p style="color: #6b7280; font-size: 14px;">This token will expire in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        </div>`
      });
      console.log('Password reset email sent!');

      res.json({ message: 'Reset token sent to email' });
    } catch (error) {
      console.error('forgot-password error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Reset Password
  app.post('/api/auth/reset-password', async (req, res) => {
    const { email, token, newPassword } = req.body;
    try {
      const resetInfo = resetTokens.get(email);
      if (!resetInfo || resetInfo.token !== token || Date.now() > resetInfo.expiry) {
        return res.status(400).json({ error: 'Invalid or expired token' });
      }

      await updatePassword(email, newPassword);
      resetTokens.delete(email);

      res.json({ message: 'Password reset successful' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Check Auth Status
  app.get('/api/me', (req, res) => {
    const token = req.cookies.auth_token;
    if (!token) return res.json({ user: null });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json({ user: decoded });
    } catch (err) {
      res.json({ user: null });
    }
  });

  // Protected download
  app.get('/api/download/:postId', authenticate, async (req, res) => {
    const { postId } = req.params;
    try {
      const driveLink = await getDriveLink(postId);
      console.log(`[Download] Serving link for post ${postId}: ${driveLink}`);
      res.json({ driveLink });
    } catch (error) {
      console.error(`[Download Error] Post ${postId}:`, error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Admin Content Management
  app.post('/api/admin/upload-pdf', authenticateAdmin, upload.single('pdf'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ fileUrl });
  });

  app.post('/api/admin/posts', authenticateAdmin, async (req, res) => {
    try {
      await addPost(req.body);
      res.json({ message: 'Post added successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/admin/posts/:postId', authenticateAdmin, async (req, res) => {
    const { postId } = req.params;
    try {
      await updatePost(postId, req.body);
      res.json({ message: 'Post updated successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/admin/posts/:postId', authenticateAdmin, async (req, res) => {
    const { postId } = req.params;
    try {
      await deletePost(postId);
      res.json({ message: 'Post deleted successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Send Notification to all subscribers
  app.post('/api/admin/notify', authenticateAdmin, async (req, res) => {
    const { message, postTitle } = req.body;
    try {
      const result = await sendNotification(message, postTitle);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Newsletter Subscription
  app.post('/api/subscribe', async (req, res) => {
    const { email } = req.body;
    try {
      await subscribeNewsletter(email);
      res.json({ message: 'Subscribed successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Settings
  app.get('/api/settings', async (req, res) => {
    try {
      const settings = await getSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  app.put('/api/settings', authenticateAdmin, async (req, res) => {
    try {
      await updateSettings(req.body);
      res.json({ message: 'Settings updated successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
