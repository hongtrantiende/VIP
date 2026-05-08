async function extract() {
    const cssUrl = "https://chomered.com/Content/icon.css";
    try {
        const response = await fetch(cssUrl);
        const cssContent = await response.text();
        const mappings = cssContent.match(/\.icon-(\d+):before\s*\{\s*content\s*:\s*"\\([^"]+)"\s*;\s*\}/g) || [];
        const mappingObj = {};
        mappings.forEach(m => {
            const parts = m.match(/\.icon-(\d+):before\s*\{\s*content\s*:\s*"\\([^"]+)"\s*;\s*\}/);
            if (parts) {
                const charCode = parseInt(parts[2], 16);
                mappingObj[parts[1]] = String.fromCharCode(charCode);
            }
        });
        const fs = require('fs');
        fs.writeFileSync('scratch/mapping.json', JSON.stringify(mappingObj, null, 2));
        console.log("Mapping saved to scratch/mapping.json");
    } catch (error) {
        console.error(error);
    }
}

extract();
