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

    // 1. Get ALL Master folders
    const q1 = encodeURIComponent(`name = 'Kho_chua_du_lieu_App' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const searchRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q1}&fields=files(id,name,createdTime)`);
    console.log("Master folders:", searchRes.files);

    if (searchRes.files && searchRes.files.length > 0) {
      for (const master of searchRes.files) {
         console.log(`\nContents of Master ${master.id} (created: ${master.createdTime}):`);
         const q2 = encodeURIComponent(`'${master.id}' in parents and trashed = false`);
         const children = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q2}&fields=files(id,name,mimeType)`);
         console.log(children.files);
      }
    }
  } catch (err) {
    console.error('Test error:', err);
  }
}

test();
