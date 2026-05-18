import fetch from "node-fetch";

async function test() {
    const res = await fetch(`http://api.mottruyen.com/chapter/?chapter_id=263193`);
    const data = await res.json();
    console.log(data);
}

test();
