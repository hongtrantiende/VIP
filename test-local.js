async function test() {
  try {
    const res = await fetch('http://localhost:3000/api/dict/cloud-storage?action=download-all', {
      method: 'POST'
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (err) {
    console.error(err);
  }
}
test();
