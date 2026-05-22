const fs = require("fs");
const path = require("path");
const http = require("https");

const TARGET_DIR = path.join(__dirname, "../public/avatars");

// Ensure target directory exists
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    http.get(url, { headers: { "User-Agent": "NovelStudio/1.0" } }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: Status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function run() {
  console.log("Fetching list of avatars from nekos.best...");
  
  // We can fetch a mix of neko, kitsune, and waifu categories
  const categories = ["neko", "kitsune", "waifu"];
  let allImages = [];

  for (const cat of categories) {
    try {
      const url = `https://nekos.best/api/v2/${cat}?amount=4`;
      const resData = await new Promise((resolve, reject) => {
        http.get(url, { headers: { "User-Agent": "NovelStudio/1.0" } }, (res) => {
          let data = "";
          res.on("data", chunk => data += chunk);
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        }).on("error", reject);
      });

      if (resData && Array.isArray(resData.results)) {
        allImages = allImages.concat(resData.results.map(r => r.url));
      }
    } catch (err) {
      console.warn(`Failed to fetch category ${cat}:`, err.message);
    }
  }

  // Slice to exactly 10 images
  const imageUrls = allImages.slice(0, 10);
  console.log(`Found ${imageUrls.length} images. Downloading...`);

  for (let i = 0; i < imageUrls.length; i++) {
    const ext = path.extname(new URL(imageUrls[i]).pathname) || ".png";
    const filename = `avatar_${i + 1}${ext}`;
    const dest = path.join(TARGET_DIR, filename);
    console.log(`Downloading [${i + 1}/10] to public/avatars/${filename}...`);
    try {
      await downloadFile(imageUrls[i], dest);
      console.log(`Saved ${filename} successfully.`);
    } catch (err) {
      console.error(`Error downloading avatar_${i + 1}:`, err.message);
    }
  }

  console.log("Done downloading all avatars!");
}

run();
