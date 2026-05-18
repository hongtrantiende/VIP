import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

        // @ts-ignore
        const progress = global.mottruyenProgress?.[id];
        if (!progress) return NextResponse.json({ error: "Progress not found" }, { status: 404 });

        const safeName = progress.name.replace(/[\\/*?:"<>|]/g, "");
        const filePath = path.join(process.cwd(), "downloads", "mottruyen", `[${id}]_${safeName}.json`);

        if (!fs.existsSync(filePath)) {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
