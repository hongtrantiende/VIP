
const fs = require("fs");
const path = require("path");

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === "node_modules" || file === ".next" || file === ".git") continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walk(__dirname);
for (const p of files) {
  let content = fs.readFileSync(p, "utf8");
  
  // Clean up ["nthanhnam@gmail.com", "nthanhnam@gmail.com"] -> ["nthanhnam@gmail.com"]
  content = content.replace(/"nthanhnam@gmail\.com",\s*"nthanhnam@gmail\.com"/g, "\"nthanhnam@gmail.com\"");
  content = content.replace(/"nthanhnam@gmail\.com",\s*\\n\s*"nthanhnam@gmail\.com"/g, "\"nthanhnam@gmail.com\"");
  
  // Clean up email === "nthanhnam@gmail.com" || email === "nthanhnam@gmail.com" -> email === "nthanhnam@gmail.com"
  content = content.replace(/email === "nthanhnam@gmail\.com" \|\| email === "nthanhnam@gmail\.com"/g, "email === \"nthanhnam@gmail.com\"");

  if (content !== fs.readFileSync(p, "utf8")) {
    fs.writeFileSync(p, content, "utf8");
    console.log("Cleaned", p);
  }
}

