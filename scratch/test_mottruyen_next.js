const path = require('path');
const fs = require('fs');
let cachedToken = null;
let tokenExpiryTime = 0;

// Load environment variables from .env and .env.local
const rootPath = path.resolve(__dirname, '..');
for (const envFile of ['.env', '.env.local']) {
  const envPath = path.join(rootPath, envFile);
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  }
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiryTime) {
    return cachedToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || '';

  if (!refreshToken) {
    throw new Error(`Missing GOOGLE_REFRESH_TOKEN`);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error("Lỗi lấy Access Token từ Google: " + (data.error_description || data.error));
  }

  cachedToken = data.access_token;
  tokenExpiryTime = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function fetchDriveAPI(url, options = {}) {
  const token = await getAccessToken();
  const headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API Error (${res.status}): ${text}`);
  }
  return await res.json();
}

async function run() {
  try {
    // 1. Get index to find files
    console.log("Fetching reading room index...");
    const masterFolderRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name = 'Kho_chua_du_lieu_App' and mimeType = 'application/vnd.google-apps.folder' and trashed = false")}`);
    if (masterFolderRes.files.length === 0) {
      console.log("Master folder not found.");
      return;
    }
    const masterId = masterFolderRes.files[0].id;
    
    const readingRoomRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name = 'Phong_doc_cong_dong' and mimeType = 'application/vnd.google-apps.folder' and parents in '${masterId}' and trashed = false`)}`);
    if (readingRoomRes.files.length === 0) {
      console.log("Reading room folder not found.");
      return;
    }
    const readingRoomId = readingRoomRes.files[0].id;

    console.log("Finding index.json...");
    const indexFileRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name = 'index.json' and parents in '${readingRoomId}' and trashed = false`)}`);
    if (indexFileRes.files.length === 0) {
      console.log("index.json not found.");
      return;
    }
    const indexFileId = indexFileRes.files[0].id;

    const token = await getAccessToken();
    const indexContentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${indexFileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const indexData = await indexContentRes.json();
    
    const targetNovel = indexData.find(n => n.id === 'mottruyen-14670' || n.id === 'mottruyen-1178');
    if (!targetNovel) {
      console.log("mottruyen-14670 or mottruyen-1178 not found in index.json");
      console.log("Available mottruyen novels in index:", indexData.filter(n => n.id.startsWith('mottruyen-')).map(n => `${n.id}: ${n.title} (${n.chapterCount} ch)`));
      return;
    }

    console.log(`Found novel: ${targetNovel.title} (${targetNovel.id})`);
    console.log(`Uploader: ${targetNovel.uploaderName}, Chapters: ${targetNovel.chapterCount}`);
    
    // Download its data file
    const dataFileName = `${targetNovel.id}_data.json`;
    console.log(`Finding data file: ${dataFileName}...`);
    const dataFileRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name = '${dataFileName}' and parents in '${readingRoomId}' and trashed = false`)}`);
    if (dataFileRes.files.length === 0) {
      console.log("Data file not found.");
      return;
    }
    const dataFileId = dataFileRes.files[0].id;

    console.log("Downloading data file contents (might be compressed)...");
    const dataContentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${dataFileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const arrayBuffer = await dataContentRes.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Decompress if gzip/deflate
    let decompressedText;
    const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (isGzip) {
      console.log("Data is gzipped. Decompressing...");
      const zlib = require('zlib');
      decompressedText = zlib.gunzipSync(bytes).toString('utf-8');
    } else {
      decompressedText = new TextDecoder().decode(bytes);
    }

    const fullData = JSON.parse(decompressedText);
    console.log("Novel metadata:", fullData.novel);
    console.log("Total chapters in data file:", fullData.chapters?.length);
    
    if (fullData.chapters && fullData.chapters.length > 0) {
      const sorted = [...fullData.chapters].sort((a, b) => b.order - a.order);
      const lastCh = sorted[0];
      console.log("Last chapter in data file:", lastCh);
      
      const numericId = lastCh.id.replace("chap-", "");
      console.log(`Fetching Mottruyen API for chapter ID: ${numericId}...`);
      const mtRes = await fetch(`http://api.mottruyen.com/chapter/?chapter_id=${numericId}`);
      if (!mtRes.ok) {
        console.log(`Mottruyen API returned HTTP ${mtRes.status}`);
        return;
      }
      const mtData = await mtRes.json();
      console.log("Mottruyen Chapter API Response success:", mtData.success);
      if (mtData.success === 1 && mtData.data) {
        console.log("Mottruyen Chapter details:");
        console.log("  ID:", mtData.data.ID);
        console.log("  NAME:", mtData.data.ENAME);
        console.log("  ORDER:", mtData.data.ORDER);
        console.log("  NEXT:", mtData.data.NEXT);
        console.log("  PREV:", mtData.data.PREV);
      } else {
        console.log("Mottruyen API error response:", mtData);
      }
    } else {
      console.log("No chapters found in data file.");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
