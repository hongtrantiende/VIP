
const fs = require("fs");
const path = require("path");

const filesToUpdate = [
  "app/(dashboard)/admin/page.tsx",
  "app/(dashboard)/convert/page.tsx",
  "app/api/bot-translate/queue/route.ts",
  "app/api/dev/sync-dict/route.ts",
  "app/api/reading-room/route.ts",
  "app/reader/[id]/page.tsx",
  "app/reading-room/page.tsx",
  "lib/utils.ts",
  "lib/vip-guard.ts",
  "middleware.ts"
];

for (const file of filesToUpdate) {
  const p = path.join(__dirname, file);
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, "utf8");
    const newContent = content.replace(/nthanhnam2005@gmail\.com/g, "nthanhnam@gmail.com").replace(/thanhxnam2005@gmail\.com/g, "nthanhnam@gmail.com");
    if (content !== newContent) {
      fs.writeFileSync(p, newContent, "utf8");
      console.log("Updated", p);
    }
  }
}

