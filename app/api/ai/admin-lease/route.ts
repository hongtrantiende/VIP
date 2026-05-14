import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const modelId = req.nextUrl.searchParams.get("modelId");
    if (!modelId) return NextResponse.json({ error: "Missing modelId" }, { status: 400 });

    // Clean up expired leases (older than 2 minutes)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await supabase
      .from("model_leases")
      .delete()
      .lt("last_active_at", twoMinutesAgo);

    // Check if model is leased
    const { data: lease } = await supabase
      .from("model_leases")
      .select("user_id, email, last_active_at")
      .eq("id", modelId)
      .single();

    if (lease) {
      if (lease.user_id === user.id) {
        // Heartbeat: update last_active_at
        await supabase
          .from("model_leases")
          .update({ last_active_at: new Date().toISOString() })
          .eq("id", modelId);
        return NextResponse.json({ status: "owned" });
      } else {
        return NextResponse.json({ 
          status: "locked", 
          owner: lease.email || "Người dùng khác" 
        });
      }
    }

    return NextResponse.json({ status: "available" });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { modelId, action } = await req.json();
    if (!modelId) return NextResponse.json({ error: "Missing modelId" }, { status: 400 });

    if (action === "acquire") {
      // 1. Clean up expired
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      await supabase
        .from("model_leases")
        .delete()
        .lt("last_active_at", twoMinutesAgo);

      // 2. Try to acquire
      const { data: existing } = await supabase
        .from("model_leases")
        .select("user_id")
        .eq("id", modelId)
        .single();

      if (existing) {
        if (existing.user_id === user.id) return NextResponse.json({ success: true });
        return NextResponse.json({ success: false, message: "Model này đã có người đang sử dụng!" });
      }

      const { error: insertError } = await supabase
        .from("model_leases")
        .insert({
          id: modelId,
          user_id: user.id,
          email: user.email,
          last_active_at: new Date().toISOString()
        });

      if (insertError) return NextResponse.json({ success: false, message: "Không thể chiếm quyền sử dụng model." });
      return NextResponse.json({ success: true });
    }

    if (action === "release") {
      await supabase
        .from("model_leases")
        .delete()
        .eq("id", modelId)
        .eq("user_id", user.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
