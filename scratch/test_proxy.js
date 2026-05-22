async function run() {
  const proxyUrl = encodeURIComponent('http://api.mottruyen.com/chapter/?chapter_id=6939417');
  const target = `http://localhost:3000/api/mottruyen-proxy?url=${proxyUrl}`;
  console.log(`Fetching from: ${target}`);
  try {
    const res = await fetch(target);
    console.log("Status:", res.status);
    console.log("Status text:", res.statusText);
    const data = await res.json();
    console.log("Response data:", data);
  } catch (err) {
    console.error("Error fetching proxy:", err);
  }
}
run();
