import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user?.email !== "nthanhnam2005@gmail.com") {
    return NextResponse.json({ error: "Chỉ Admin mới có quyền lưu file vào mã nguồn" }, { status: 403 });
  }
  
  try {
    const { source, text } = await req.json();
    
    if (!source || typeof text !== "string") {
      return NextResponse.json({ error: "Thiếu tên nguồn (source) hoặc nội dung (text)" }, { status: 400 });
    }
    
    // Bảo mật: Chỉ cho phép tên file hợp lệ (chữ cái, số, gạch ngang, gạch dưới)
    if (!/^[a-zA-Z0-9_-]+$/.test(source)) {
      return NextResponse.json({ error: "Tên nguồn không hợp lệ" }, { status: 400 });
    }
    
    const filePath = path.join(process.cwd(), "public", "dict", `${source}.txt`);
    await fs.writeFile(filePath, text, "utf-8");
    
    return NextResponse.json({ success: true, message: `Đã lưu thành công vào public/dict/${source}.txt` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
