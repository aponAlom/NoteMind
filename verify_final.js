import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fs from 'node:fs';
import 'dotenv/config';

async function verifyPostsSheet() {
  try {
    console.log('--- "Posts" Sheet Verification ---');
    const creds = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
    const auth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_ID, auth);
    await doc.loadInfo(); // This reloads the spreadsheet definition
    
    console.log('Available Sheet Titles:', JSON.stringify(Object.keys(doc.sheetsByTitle)));
    
    const postsSheet = doc.sheetsByTitle['Posts'];
    if (!postsSheet) {
      console.error('FAILED: "Posts" sheet still not found.');
      return;
    }

    console.log('SUCCESS: "Posts" sheet found.');
    const rows = await postsSheet.getRows();
    console.log(`ROWS FOUND: ${rows.length}`);
    
    if (rows.length > 0) {
      console.log('FIRST ROW DATA:', JSON.stringify(rows[0].toObject()));
    } else {
      console.log('NOTICE: The sheet is empty.');
    }

  } catch (err) {
    console.error('Verification failed:', err.message);
  }
}

verifyPostsSheet();
