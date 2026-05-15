require('dotenv').config({ path: '.env.local' });

async function test() {
  try {
    const fetchDriveAPI = async (url, options = {}) => {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      });
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      const data = await res.json();
      const token = data.access_token;
      
      const res2 = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`
        }
      });
      return res2.json();
    };

    // 1. Search for Truyen_nguoi_dung globally
    const q1 = encodeURIComponent(`name = 'Truyen_nguoi_dung' and mimeType = 'application/vnd.google-apps.folder'`);
    const searchRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q1}&fields=files(id,name,createdTime,trashed,parents)`);
    console.log("Truyen_nguoi_dung folders:", searchRes.files);

    const q2 = encodeURIComponent(`name = 'Kho_chua_du_lieu_App' and mimeType = 'application/vnd.google-apps.folder'`);
    const searchRes2 = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q2}&fields=files(id,name,createdTime,trashed,parents)`);
    console.log("Kho_chua_du_lieu_App folders:", searchRes2.files);

  } catch (err) {
    console.error('Test error:', err);
  }
}

test();
