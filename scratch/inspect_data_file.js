async function run() {
  const cId = '5926780';
  console.log(`Fetching Mottruyen API for chapter ID: ${cId}...`);
  const mtRes = await fetch(`http://api.mottruyen.com/chapter/?chapter_id=${cId}`);
  if (!mtRes.ok) {
    console.log(`Mottruyen API returned HTTP ${mtRes.status}`);
    return;
  }
  const mtData = await mtRes.json();
  console.log("Mottruyen Chapter API Response success:", mtData.success);
  if (mtData.success === 1 && mtData.data) {
    console.log("Mottruyen Chapter details:");
    console.log("  ID:", mtData.data.ID);
    console.log("  NAME:", mtData.data.ENAME);
    console.log("  ORDER:", mtData.data.ORDER);
    console.log("  NEXT:", mtData.data.NEXT);
    console.log("  PREV:", mtData.data.PREV);
  } else {
    console.log("Mottruyen API error response:", mtData);
  }
}
run();
