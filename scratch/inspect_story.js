async function run() {
  const storyId = '1178';
  const res = await fetch(`http://api.mottruyen.com/story/?story_id=${storyId}`);
  const data = await res.json();
  console.log("Success:", data.success);
  if (data.data) {
    console.log("NAME:", data.data.NAME);
    console.log("TOTALCHAPTER:", data.data.TOTALCHAPTER);
    console.log("CHAPTER is array:", Array.isArray(data.data.CHAPTER));
    if (Array.isArray(data.data.CHAPTER)) {
      console.log("CHAPTER length:", data.data.CHAPTER.length);
      console.log("First chapter:", data.data.CHAPTER[0]);
      console.log("Last chapter:", data.data.CHAPTER[data.data.CHAPTER.length - 1]);
    }
  }
}
run();
