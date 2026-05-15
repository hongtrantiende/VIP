import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ADMIN_EMAILS = ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com"];
function isAdmin(email?: string | null) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * GET /api/bot-translate/queue
 * - Users: get their own jobs
 * - Admin: get all jobs (with ?all=true) or pending jobs (with ?status=pending)
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "true";
    const statusFilter = url.searchParams.get("status");
    const jobId = url.searchParams.get("jobId");

    // Single job detail with chapters
    if (jobId) {
      const { data: job } = await supabase
        .from("translation_queue")
        .select("*")
        .eq("id", jobId)
        .single();

      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      // Non-admin can only see their own
      if (!isAdmin(user.email) && job.user_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const { data: chapters } = await supabase
        .from("translation_queue_chapters")
        .select("id, chapter_order, chapter_title, status, translated_title, translated_scenes, error_message")
        .eq("queue_id", jobId)
        .order("chapter_order");

      return NextResponse.json({ job, chapters: chapters || [] });
    }

    // List jobs
    let query = supabase
      .from("translation_queue")
      .select("id, user_email, novel_name, novel_genre, chapter_count, status, current_chapter, translate_mode, created_at, started_at, completed_at, error_message, custom_prompt, prompt_type, extract_dict, dict_sources, worker_name, assigned_worker")
      .order("created_at", { ascending: false });

    if (!isAdmin(user.email) || !all) {
      query = query.eq("user_id", user.id);
    }

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data: jobs, error } = await query.limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ jobs: jobs || [] });
  } catch (error) {
    console.error("Bot translate queue error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * PATCH /api/bot-translate/queue
 * Admin updates job status / progress.
 * Body: { jobId, status?, currentChapter?, errorMessage? }
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { jobId, status, currentChapter, errorMessage, workerName } = body;

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    // Check permissions
    const { data: job } = await supabase
      .from("translation_queue")
      .select("user_id")
      .eq("id", jobId)
      .single();

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Only admin or job owner (for cancelling) can update
    const userIsAdmin = isAdmin(user.email);
    if (!userIsAdmin && job.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Non-admin can only cancel
    if (!userIsAdmin && status !== "cancelled") {
      return NextResponse.json({ error: "Bạn chỉ có thể hủy job của mình" }, { status: 403 });
    }

    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (currentChapter !== undefined) updates.current_chapter = currentChapter;
    if (errorMessage !== undefined) updates.error_message = errorMessage;
    if (workerName !== undefined) updates.worker_name = workerName;
    if (status === "translating" && !updates.started_at) updates.started_at = new Date().toISOString();
    if (status === "completed" || status === "failed") updates.completed_at = new Date().toISOString();

    const { error } = await supabase
      .from("translation_queue")
      .update(updates)
      .eq("id", jobId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Bot translate queue PATCH error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * DELETE /api/bot-translate/queue?jobId=xxx
 * Admin deletes a completed/failed job and its chapters.
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    // Check permissions
    const { data: job } = await supabase
      .from("translation_queue")
      .select("user_id")
      .eq("id", jobId)
      .single();

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!isAdmin(user.email) && job.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // CASCADE will delete chapters too
    const { error } = await supabase
      .from("translation_queue")
      .delete()
      .eq("id", jobId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Bot translate queue DELETE error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
