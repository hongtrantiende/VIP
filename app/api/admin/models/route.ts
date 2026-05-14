import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate user using cookies
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Fetch models from external API using DB settings
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
    
    // Convert URL to /models endpoint
    let modelsUrl = proxyUrl;
    if (proxyUrl.includes("/chat/completions")) {
      modelsUrl = proxyUrl.replace(/\/chat\/completions\/?$/, "/models");
    } else if (!proxyUrl.endsWith("/models")) {
      modelsUrl = proxyUrl.endsWith("/") ? proxyUrl + "models" : proxyUrl + "/models";
    }

    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${proxyKey}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: 60 } // cache for 1 minute
    });

    if (!response.ok) {
      console.warn(`External API returned ${response.status} when fetching models.`);
      return NextResponse.json({ object: 'list', data: [] });
    }

    const data = await response.json();
    
    // The data should be { object: 'list', data: [{ id: '...', ... }] }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch admin models:", error);
    // Trả về mảng rỗng để giao diện không bị sập màn hình đỏ
    return NextResponse.json({ object: 'list', data: [] });
  }
}
