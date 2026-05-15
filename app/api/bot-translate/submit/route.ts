import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/bot-translate/submit
 * User submits a novel to the translation queue.
 * Body: { novelName, novelGenre, customPrompt, dictSources, translateMode, promptType, extractDict, nameDict, chapters }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      novelName,
      novelGenre,
      customPrompt,
      dictSources,
      translateMode,
      promptType,
      extractDict,
      nameDict,
      chapterCount,
      inputFileUrl,
    } = body;

    if (!novelName || !inputFileUrl) {
      return NextResponse.json({ error: "Thiếu dữ liệu truyện hoặc file đầu vào" }, { status: 400 });
    }

    // ── Smart Distribution Logic ──
    const workers = ["AI-1", "AI-2", "AI-3"];
    
    // 1. Get current load for each worker
    const { data: activeJobs } = await supabase
      .from("translation_queue")
      .select("assigned_worker, chapter_count, current_chapter, status")
      .in("status", ["pending", "translating"]);

    // 2. Calculate remaining work (chapters) for each potential worker
    const workerLoads = workers.map(name => {
      const load = (activeJobs || [])
        .filter(j => j.assigned_worker === name)
        .reduce((sum, j) => sum + (j.chapter_count - (j.current_chapter || 0)), 0);
      return { name, load };
    });

    // 3. Pick the worker with the minimum load
    const bestWorker = workerLoads.sort((a, b) => a.load - b.load)[0].name;

    // 1. Create queue entry with pre-assigned worker
    const { data: job, error: jobError } = await supabase
      .from("translation_queue")
      .insert({
        user_id: user.id,
        user_email: user.email || "unknown",
        novel_name: novelName,
        novel_genre: novelGenre || null,
        chapter_count: chapterCount || 0,
        status: "pending",
        translate_mode: translateMode || "hybrid",
        dict_sources: dictSources || ["tienhiep"],
        custom_prompt: customPrompt || null,
        prompt_type: promptType || "khuyen_nghi",
        extract_dict: extractDict || false,
        name_dict: nameDict || [],
        assigned_worker: bestWorker, // Giao việc cho AI này
      })
      .select("id")
      .single();

    if (jobError || !job) {
      console.error("Failed to create queue job:", jobError);
      return NextResponse.json({ error: jobError?.message || "Lỗi tạo job" }, { status: 500 });
    }

    // Lưu Drive file ID vào error_message tạm thời hoặc sau này thêm cột. Ở đây mượn cột error_message
    const { error: updateError } = await supabase
      .from("translation_queue")
      .update({ error_message: `input_drive_id:${inputFileUrl}` })
      .eq("id", job.id);

    return NextResponse.json({ success: true, jobId: job.id, chapterCount });
  } catch (error) {
    console.error("Bot translate submit error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
