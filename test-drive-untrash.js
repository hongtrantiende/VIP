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

    const q = encodeURIComponent(`'1oTZxtxtt7EarqeiE197bor6bgh9n9m81' in parents and trashed = true`);
    const searchRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,trashed)`);
    console.log("Trashed children of Master folder:", searchRes.files);

    if (searchRes.files) {
        for (const file of searchRes.files) {
            console.log(`Untrashing ${file.name}...`);
            await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trashed: false })
            });
            console.log(`Untrashed ${file.name} successfully!`);
        }
    }

  } catch (err) {
    console.error('Test error:', err);
  }
}

test();
