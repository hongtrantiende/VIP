async function extract() {
    const cssUrl = "https://chomered.com/Content/icon.css";
    try {
        const response = await fetch(cssUrl);
        const cssContent = await response.text();
        console.log("CSS Content snippet:");
        console.log(cssContent.substring(0, 1000));
    } catch (error) {
        console.error(error);
    }
}

extract();
