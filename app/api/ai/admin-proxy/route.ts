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

    // 4. Lấy cấu hình URL và API Key từ bảng app_settings
    const { data: settingsData } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["admin_proxy_url", "admin_proxy_key"]);

    const settingsMap = (settingsData || []).reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    let proxyUrl = (settingsMap["admin_proxy_url"] || "https://catiecli.sukaka.top/v1").trim().replace(/[^\x20-\x7E]/g, '');

    // Auto append /chat/completions if missing
    if (!proxyUrl.includes("/chat/completions")) {
      proxyUrl = proxyUrl.replace(/\/+$/, "") + "/chat/completions";
    }

    const proxyKey = (settingsMap["admin_proxy_key"] || "cat-a1991b0901187c4cad48859725a67ad185c78184a4fe5e6a").trim().replace(/[^\x20-\x7E]/g, '');

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

    const resHeaders: Record<string, string> = {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
    };

    if (resHeaders["Content-Type"].includes("text/event-stream")) {
      resHeaders["Cache-Control"] = "no-cache";
      resHeaders["Connection"] = "keep-alive";
    }

    return new Response(response.body, {
      status: response.status,
      headers: resHeaders,
    });
  } catch (error) {
    console.error("Admin Proxy Exception:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
