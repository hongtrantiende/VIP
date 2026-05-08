async function extract() {
    const url = "https://chomered.com/book/chapter/18690052";
    try {
        const response = await fetch(url);
        const html = await response.text();

        // Find CSS files (handle relative URLs too)
        const cssFiles = html.match(/href="([^"]+\.css[^"]*)"/g) || [];
        console.log("CSS Files found:");
        for (let cssLink of cssFiles) {
            let cssUrl = cssLink.match(/href="([^"]+)"/)[1];
            if (!cssUrl.startsWith('http')) {
                cssUrl = new URL(cssUrl, url).href;
            }
            console.log(cssUrl);
            try {
                const cssResponse = await fetch(cssUrl);
                const cssContent = await cssResponse.text();
                if (cssContent.includes(".icon-")) {
                    console.log(`Mapping found in ${cssUrl}`);
                    const mappings = cssContent.match(/\.icon-(\d+):before\s*\{\s*content\s*:\s*"([^"]+)"\s*\}/g) || [];
                    const mappingObj = {};
                    mappings.forEach(m => {
                        const parts = m.match(/\.icon-(\d+):before\s*\{\s*content\s*:\s*"([^"]+)"\s*\}/);
                        if (parts) {
                            mappingObj[parts[1]] = parts[2];
                        }
                    });
                    console.log(JSON.stringify(mappingObj, null, 2));
                    return; // Stop after finding the first one with icons
                }
            } catch (e) {
                console.error(`Failed to fetch ${cssUrl}`);
            }
        }
    } catch (error) {
        console.error(error);
    }
}

extract();
