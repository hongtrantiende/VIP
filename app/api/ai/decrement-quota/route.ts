import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { amount = 1 } = await req.json();

    // Use RPC to safely decrement quota
    const { data, error } = await supabase.rpc("decrement_admin_quota", {
      user_id: user.id,
      dec_amount: amount
    });

    if (error) {
      // Fallback to manual update if RPC doesn't exist
      const { data: profile } = await supabase
        .from("profiles")
        .select("admin_model_quota")
        .eq("id", user.id)
        .single();
      
      if (profile) {
        const newQuota = Math.max(0, (profile.admin_model_quota || 0) - amount);
        await supabase
          .from("profiles")
          .update({ admin_model_quota: newQuota })
          .eq("id", user.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
