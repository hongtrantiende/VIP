async function test() {
  try {
    console.log("Fetching API...");
    // Mock req
    const res = await fetch('http://localhost:3000/api/dict/cloud-storage?action=list-novels', {
      method: 'POST',
      headers: {
        // mock auth maybe?
      }
    });
    
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text.substring(0, 500));
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

test();
