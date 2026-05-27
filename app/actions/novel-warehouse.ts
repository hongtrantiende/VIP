"use server";

import { createClient } from "@/lib/supabase/server";
import { downloadFromAdminDrive } from "@/lib/google-drive-admin-v2";
import type { NovelExportData } from "@/lib/novel-io";

export async function getWarehouseNovelDataAction(novelTitle: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const isAdmin = [
      "nthanhnam@gmail.com"
    ].includes(user.email || "");

    if (!isAdmin) throw new Error("Permission denied. Admin only.");

    const userIdentifier = user.email?.replace(/[@.]/g, '_') || user.id;
    const jsonText = await downloadFromAdminDrive(userIdentifier, novelTitle);

    if (!jsonText) throw new Error("Không tìm thấy file trên Google Drive Warehouse");

    const data = JSON.parse(jsonText) as NovelExportData;
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
