require('dotenv').config({ path: '.env.local' });

// We simulate the lib/google-drive-admin-v2.ts manually
const { downloadAllUserNovelsFromAdminDrive } = require('./test-lib.js');

async function test() {
  try {
    console.log("Testing downloadAllUserNovelsFromAdminDrive...");
    const res = await downloadAllUserNovelsFromAdminDrive("nam_gmail_com");
    console.log("Success! Novels count:", res.length);
  } catch (err) {
    console.error("Test Error:", err);
  }
}

test();
