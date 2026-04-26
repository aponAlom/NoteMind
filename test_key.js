import { JWT } from 'google-auth-library';
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';

async function test() {
  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
  } catch (err) {
    console.error('Failed to read google-credentials.json');
    return;
  }

  const rawKey = credentials.private_key;
  const email = credentials.client_email;
  
  console.log('JSON Key Length:', rawKey.length);
  
  try {
    console.log('Testing with crypto.createPrivateKey...');
    const key = crypto.createPrivateKey(rawKey);
    console.log('crypto.createPrivateKey success!');
  } catch (err) {
    console.error('crypto.createPrivateKey failed:', err.message);
  }

  try {
    console.log('\nTesting with JWT authorize...');
    const auth = new JWT({
      email: email,
      key: rawKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await auth.authorize();
    console.log('JWT Success!');
  } catch (err) {
    console.error('JWT failed:', err.message);
  }
}

test();
