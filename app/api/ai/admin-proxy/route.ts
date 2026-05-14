import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/utils";

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Check user quota (Skip for Admins)
    const isUserAdmin = isAdmin(user.email);
    let profile = null;

    if (!isUserAdmin) {
      const { data: p, error: profileError } = await supabase
        .from("profiles")
        .select("admin_model_quota")
        .eq("id", user.id)
        .single();

      if (profileError || !p) {
        return NextResponse.json({ error: "User profile not found" }, { status: 404 });
      }
      profile = p;

      if (profile.admin_model_quota <= 0) {
        return NextResponse.json({ error: "Hết lượt dịch model Admin. Vui lòng nạp thêm hoặc dùng key riêng." }, { status: 403 });
      }
    }

    const body = await req.json();
    const modelId = body.model;

    // 3. Check if the user owns the lease for this model (skip for admins)
    if (!isUserAdmin) {
      const { data: lease } = await supabase
        .from("model_leases")
        .select("user_id")
        .eq("id", modelId)
        .single();

      if (!lease || lease.user_id !== user.id) {
        return NextResponse.json({ error: "Bạn chưa chiếm quyền sử dụng Model này hoặc đã hết hạn. Vui lòng chọn lại model." }, { status: 403 });
      }
    }

    // 4. Lấy cấu hình URL và API Key từ bảng app_settings
    const { data: settingsData } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["admin_proxy_url", "admin_proxy_key"]);

    const settingsMap = (settingsData || []).reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    const proxyUrl = settingsMap["admin_proxy_url"] || "https://catiecli.sukaka.top/v1/chat/completions";
    const proxyKey = settingsMap["admin_proxy_key"] || "cat-a1991b0901187c4cad48859725a67ad185c78184a4fe5e6a";

    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${proxyKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000), // 120s timeout to prevent infinite hang
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Admin Proxy Error:", errorText);
      return new Response(errorText, { status: response.status, headers: { "Content-Type": "application/json" } });
    }

    // Note: We don't decrement quota here yet because this might be a stream
    // or the request might fail later. We'll decrement it from the client
    // after a successful chapter translation.
    
    return response;
  } catch (error) {
    console.error("Admin Proxy Exception:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
