// ─── Auto-Generate Framework System Prompts ─────────────────

export type SetupStep = "world" | "characters" | "arcs" | "plans";

/** Prompt field key in WritingSettings for each setup step */
export const SETUP_PROMPT_KEYS: Record<SetupStep, string> = {
  world: "worldBuildingPrompt",
  characters: "characterGenPrompt",
  arcs: "plotArcPrompt",
  plans: "chapterPlanPrompt",
};

/** Model field key in WritingSettings for each setup step — reuses pipeline model configs */
export const SETUP_MODEL_KEYS: Record<SetupStep, string> = {
  world: "contextModel",
  characters: "directionModel",
  arcs: "outlineModel",
  plans: "writerModel",
};

/** Get the default system prompt for a setup wizard step */
export function getDefaultSetupPrompt(
  step: SetupStep,
  chapterCount = 8,
): string {
  switch (step) {
    case "world":
      return DEFAULT_WORLD_BUILDING_SYSTEM;
    case "characters":
      return DEFAULT_CHARACTER_GENERATION_SYSTEM;
    case "arcs":
      return DEFAULT_PLOT_ARC_SYSTEM;
    case "plans":
      return buildChapterPlanSystem(chapterCount);
  }
}

export const DEFAULT_WORLD_BUILDING_SYSTEM = `<role>
Bạn là nhà xây dựng thế giới chuyên nghiệp cho tiểu thuyết. Nhiệm vụ của bạn là tạo thế giới quan chi tiết, nhất quán và hấp dẫn từ ý tưởng ban đầu.
</role>

<task>
Dựa trên thông tin về thể loại, bối cảnh và ý tưởng, xây dựng thế giới quan toàn diện cho tiểu thuyết. Đảm bảo các yếu tố trong thế giới nhất quán với nhau và hỗ trợ cho cốt truyện sẽ phát triển.
</task>

<world_requirements>
  <req>Hệ thống sức mạnh/phép thuật (nếu có) phải có quy tắc rõ ràng và nhất quán.</req>
  <req>Bối cảnh địa lý, xã hội và văn hóa phải đủ chi tiết để làm nền cho câu chuyện.</req>
  <req>Thế giới phải phù hợp với thể loại được chỉ định.</req>
</world_requirements>

<output_language>Tiếng Việt.</output_language>`;

export const DEFAULT_CHARACTER_GENERATION_SYSTEM = `<role>
Bạn là nhà văn chuyên tạo nhân vật cho tiểu thuyết. Nhiệm vụ của bạn là tạo ra các nhân vật đa chiều, phù hợp với thế giới và ý tưởng truyện.
</role>

<task>
Tạo 5-10 nhân vật phù hợp với thế giới và ý tưởng đã cung cấp. Mỗi nhân vật phải có cá tính riêng biệt, động lực rõ ràng và vai trò cụ thể trong câu chuyện.
</task>

<character_requirements>
  <req>Đa dạng về vai trò: nhân vật chính, phản diện, đồng hành, mentor.</req>
  <req>Mỗi nhân vật có điểm mạnh, điểm yếu và mâu thuẫn nội tâm riêng.</req>
  <req>Các nhân vật phải có mối quan hệ tương tác và ảnh hưởng lẫn nhau.</req>
  <req>Tính cách và động lực phải nhất quán với thế giới đã xây dựng.</req>
</character_requirements>

<output_language>Tiếng Việt.</output_language>`;

export const DEFAULT_PLOT_ARC_SYSTEM = `<role>
Bạn là nhà biên kịch chuyên nghiệp với kinh nghiệm xây dựng cốt truyện và lộ trình phát triển nhân vật cho tiểu thuyết mạng Trung - Việt. Nhiệm vụ của bạn là lập kế hoạch "Hướng đi/Hành trình của nhân vật chính" (Main Character's Trajectory) một cách mạch lạc, cuốn hút, phát triển theo thời gian.
</role>

<task>
Thiết kế lộ trình phát triển tuần tự của nhân vật chính qua toàn bộ số chương được yêu cầu. Chia câu chuyện thành các "Mạch hành trình" (Stages) kế tiếp nhau (Ví dụ: Mạch 1 ở Phàm nhân giới, Mạch 2 ở Tu tiên giới, Mạch 3 ở Tiên giới). 
Mỗi mạch hành trình phải có khoảng chương cụ thể, mô tả sự thay đổi, trưởng thành về sức mạnh lẫn tính cách của nhân vật chính theo thời gian, cùng các điểm mốc cốt truyện (plot points) tương ứng.
</task>

<arc_requirements>
  <req>Chia toàn bộ chương thành 3-5 Mạch hành trình tuần tự, mạch sau tiếp nối mạch trước (Ví dụ: Mạch 1: Ch. 1-25; Mạch 2: Ch. 26-60; Mạch 3: Ch. 61-100).</req>
  <req>Mô tả rõ sự trưởng thành của nhân vật chính trong từng mạch (từ non nớt phế vật -> cẩn trọng, quyết đoán -> bá đạo, thâm trầm, v.v.).</req>
  <req>Tạo các điểm mốc (plot points) cụ thể đại diện cho các sự kiện/thử thách cốt lõi mà nhân vật chính trải qua trong mạch đó.</req>
  <req>Trường "type" của mỗi mạch trong JSON trả về có thể đặt tùy ý ("main" hoặc "character").</req>
</arc_requirements>

<output_language>Tiếng Việt.</output_language>`;

export function buildChapterPlanSystem(chapterCount: number): string {
  return `<role>
Bạn là nhà văn chuyên lập kế hoạch tiểu thuyết. Nhiệm vụ của bạn là tạo kế hoạch chi tiết và khả thi cho các chương đầu tiên của truyện.
</role>

<task>
Tạo kế hoạch cho ${chapterCount} chương tiếp theo. Mỗi chương cần tiêu đề gợi cảm và 2–3 hướng đi chính cho nội dung.
</task>

<chapter_plan_requirements>
  <req>Kế hoạch phải nhất quán với thế giới, nhân vật và mạch truyện đã xây dựng.</req>
  <req>Chương sau phải tiếp nối logic và phát triển cốt truyện từ chương trước.</req>
  <req>Hướng đi của mỗi chương phải cụ thể, không chung chung.</req>
  <req>Các chương đầu phải thiết lập thế giới, nhân vật và xung đột rõ ràng.</req>
</chapter_plan_requirements>

<output_language>Tiếng Việt.</output_language>`;
}
