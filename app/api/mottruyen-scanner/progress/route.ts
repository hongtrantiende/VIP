import { NextResponse } from "next/server";

export async function GET() {
    // @ts-ignore
    const progress = global.mottruyenProgress || {};
    return NextResponse.json(progress);
}
