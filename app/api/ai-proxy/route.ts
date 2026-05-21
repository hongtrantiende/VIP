import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

export async function POST(req: NextRequest) {
  let targetUrl = req.headers.get("x-target-url");
  let authHeader = req.headers.get("Authorization");
  const contentType = req.headers.get("Content-Type") || "application/json";

  let isAdminModel = false;
  let userId = null;
  let assignedModel = "gcli-gemini-3-pro-preview"; // fallback

  const supabase = createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  // Authenticate user via bearer token in the auth header if present, or from cookies.
  // We'll use the user ID to check quota if using the admin model.
  const authHeaderClient = req.headers.get("x-supabase-auth");
  if (authHeaderClient) {
    const { data: { user } } = await supabase.auth.getUser(authHeaderClient.replace("Bearer ", ""));
    userId = user?.id;
  }

  // Intercept Admin Model requests
  if (authHeader === "Bearer admin-model-key") {
    isAdminModel = true;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized. Please login to use Admin Model." }), { status: 401 });
    }

    // Check quota and assigned model
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("admin_model_quota, admin_assigned_model, admin_daily_quota_limit, admin_quota_last_reset")
      .eq("id", userId)
      .single();

    if (error || !profile) {
      return new Response(JSON.stringify({ error: "Forbidden. Lỗi truy xuất thông tin." }), { status: 403 });
    }

    const currentVnDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })).toDateString();
    let currentQuota = profile.admin_model_quota || 0;
    const dailyLimit = profile.admin_daily_quota_limit || 0;

    // Lazy Reset: Bơm đầy lại nếu đã sang ngày mới (Giờ VN)
    if (profile.admin_quota_last_reset !== currentVnDate && dailyLimit > 0) {
      currentQuota = dailyLimit;

      // Update reset status and decrement 1 for this request
      await supabase
        .from("profiles")
        .update({
          admin_model_quota: currentQuota - 1,
          admin_quota_last_reset: currentVnDate
        })
        .eq("id", userId);
    } else {
      if (currentQuota <= 0) {
        return new Response(JSON.stringify({ error: "Forbidden. Hết lượt dịch tự động miễn phí hôm nay." }), { status: 403 });
      }
      // Decrement quota normally
      await supabase
        .from("profiles")
        .update({ admin_model_quota: currentQuota - 1 })
        .eq("id", userId);
    }

    if (profile.admin_assigned_model) {
      assignedModel = profile.admin_assigned_model;
    }

    // Fetch config from app_settings
    const { data: settingsData } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["admin_proxy_url", "admin_proxy_key", "admin_chat_model"]);

    const settingsMap = (settingsData || []).reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    // Inject hidden URL and Key
    let resolvedUrl = (settingsMap["admin_proxy_url"] || "https://catiecli.sukaka.top/v1").trim().replace(/[^\x20-\x7E]/g, '');
    if (!resolvedUrl.includes("/chat/completions")) {
      resolvedUrl = resolvedUrl.replace(/\/+$/, "") + "/chat/completions";
    }
    targetUrl = resolvedUrl;
    const proxyKey = (settingsMap["admin_proxy_key"] || "cat-a1991b0901187c4cad48859725a67ad185c78184a4fe5e6a").trim().replace(/[^\x20-\x7E]/g, '');
    authHeader = `Bearer ${proxyKey}`;
  }

  if (!targetUrl) {
    return new Response("Missing x-target-url header", { status: 400 });
  }

  try {
    let body = await req.text();

    if (isAdminModel && userId) {
      // Parse the body and inject the actual model name required by the backend
      try {
        const payload = JSON.parse(body);
        // Chat requests use "admin-chat-model" marker — resolve to global chat model or fallback
        if (payload.model === "admin-chat-model") {
          // Temporarily fetch settings Map again here if needed, or query from DB
          const { data: sData } = await supabase.from("app_settings").select("value").eq("key", "admin_chat_model").single();
          payload.model = sData?.value || assignedModel;
        } else {
          payload.model = assignedModel;
        }
        body = JSON.stringify(payload);
      } catch (e) {
        // Ignore if body is not JSON
      }
    }
    // Forward ONLY essential headers to the AI provider
    // (forwarding all browser headers causes many providers to reject with 401/403)
    const headersToSend: Record<string, string> = {
      "Content-Type": contentType,
    };

    if (authHeader) {
      headersToSend["Authorization"] = authHeader;
    }

    // Forward specific provider headers if present (some providers need these)
    const providerHeaders = ["x-api-key", "api-key", "http-referer", "x-title"];
    for (const h of providerHeaders) {
      const val = req.headers.get(h);
      if (val) headersToSend[h] = val;
    }

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: headersToSend,
      body,
    });

    // Proxy the response stream back to the client
    const resHeaders: Record<string, string> = {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
    };

    // Add streaming headers only if it's an event stream
    if (resHeaders["Content-Type"].includes("text/event-stream")) {
      resHeaders["Cache-Control"] = "no-cache";
      resHeaders["Connection"] = "keep-alive";
    }

    return new Response(response.body, {
      status: response.status,
      headers: resHeaders,
    });
  } catch (error) {
    console.error("AI Proxy error:", error);
    return new Response(JSON.stringify({ error: "Failed to proxy AI request" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
