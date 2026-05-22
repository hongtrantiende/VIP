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
  console.log("Starting download of Xianxia avatars...");

  // 5 Male, 5 Female characters with Chinese/Xianxia styling
  const characterList = [
    // Male
    { name: "zhongli", filename: "avatar_11.png" },
    { name: "xiao", filename: "avatar_12.png" },
    { name: "baizhu", filename: "avatar_13.png" },
    { name: "chongyun", filename: "avatar_14.png" },
    { name: "xingqiu", filename: "avatar_15.png" },
    // Female
    { name: "shenhe", filename: "avatar_16.png" },
    { name: "ganyu", filename: "avatar_17.png" },
    { name: "hu-tao", filename: "avatar_18.png" },
    { name: "yunjin", filename: "avatar_19.png" },
    { name: "keqing", filename: "avatar_20.png" }
  ];

  for (const char of characterList) {
    const url = `https://genshin.jmp.blue/characters/${char.name}/icon`;
    const dest = path.join(TARGET_DIR, char.filename);
    console.log(`Downloading ${char.name} avatar to public/avatars/${char.filename}...`);
    try {
      await downloadFile(url, dest);
      console.log(`Saved ${char.filename} successfully.`);
    } catch (err) {
      console.error(`Error downloading ${char.name}:`, err.message);
    }
  }

  console.log("Done downloading all Xianxia avatars!");
}

run();
