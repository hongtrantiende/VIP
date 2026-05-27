const https = require('https');
https.get('https://welove-gourmet.com/book/132129', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const idx = data.indexOf('class="bookbox"');
        if (idx !== -1) {
            console.log("HTML around bookbox:", data.substring(idx + 1000, idx + 2000));
        } else {
            console.log("Not found");
        }
    });
});
