import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ADMIN_EMAILS = ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com"];
function isAdmin(email?: string | null) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * POST /api/bot-translate/queue/claim
 * Used by AI Bots to claim the oldest pending job.
 * Body: { workerName }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Check if user is admin (only admins can run bots usually)
    if (!user || !isAdmin(user.email)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workerName } = await req.json();
    if (!workerName) {
      return NextResponse.json({ error: "workerName is required" }, { status: 400 });
    }

    // 1. Find the oldest pending job
    const { data: pendingJobs, error: fetchError } = await supabase
      .from("translation_queue")
      .select("id")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);

    if (fetchError || !pendingJobs || pendingJobs.length === 0) {
      return NextResponse.json({ message: "No pending jobs" }, { status: 200 });
    }

    const jobId = pendingJobs[0].id;

    // 2. Try to claim it atomically
    const { data: job, error: claimError } = await supabase
      .from("translation_queue")
      .update({ 
        status: "translating", 
        worker_name: workerName,
        started_at: new Date().toISOString()
      })
      .eq("id", jobId)
      .eq("status", "pending") // Ensure it hasn't been claimed yet
      .select("*")
      .single();

    if (claimError || !job) {
      // Someone else might have claimed it in the millisecond between fetch and update
      return NextResponse.json({ message: "Job already claimed by another worker, try again" }, { status: 409 });
    }

    // 3. Return job details with input file
    return NextResponse.json({ job });
  } catch (error) {
    console.error("Bot claim job error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
