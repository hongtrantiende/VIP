import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

// ─── Environment Detection ────────────────────────────────────────────────────
// Cloudflare Workers không có filesystem writable. Ta phát hiện điều này bằng
// cách import fs/path một cách lazy và bắt lỗi khi gọi các hàm FS cụ thể.

let _fs: typeof import("fs") | null = null;
let _path: typeof import("path") | null = null;
let _https: typeof import("https") | null = null;
let _fsAvailable: boolean | null = null;

/** Trả về true nếu Node.js filesystem có thể ghi (local/VPS). False trên Cloudflare Edge. */
function isFsAvailable(): boolean {
  if (_fsAvailable !== null) return _fsAvailable;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // Kiểm tra quyền GHI vào thư mục gốc của app.
    // Trên Cloudflare Workers/Pages, process.cwd() là read-only → throws EROFS/EACCES.
    fs.accessSync(process.cwd(), fs.constants.W_OK);
    _fs = fs;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _path = require("path") as typeof import("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _https = require("https") as typeof import("https");
    _fsAvailable = true;
  } catch {
    _fsAvailable = false;
  }
  return _fsAvailable;
}


// ─── FS Helpers (chỉ dùng khi isFsAvailable() === true) ──────────────────────

const downloadLocks = new Map<string, Promise<void>>();

function downloadFile(url: string, dest: string): Promise<void> {
  const fs = _fs!;
  const https = _https!;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP status code ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function getOrCreateDownloadPromise(
  cleanVoice: string,
  modelPath: string,
  jsonPath: string
): Promise<void> {
  const fs = _fs!;
  let downloadPromise = downloadLocks.get(cleanVoice);
  if (!downloadPromise) {
    downloadPromise = (async () => {
      try {
        const needsModel = !fs.existsSync(modelPath) || fs.statSync(modelPath).size === 0;
        const needsJson  = !fs.existsSync(jsonPath)  || fs.statSync(jsonPath).size  === 0;

        if (needsModel) {
          const tempPath = `${modelPath}.tmp`;
          const encoded  = encodeURIComponent(cleanVoice);
          await downloadFile(`https://tts-piper.pages.dev/api/model/${encoded}.onnx`, tempPath);
          fs.renameSync(tempPath, modelPath);
        }
        if (needsJson) {
          const tempPath = `${jsonPath}.tmp`;
          const encoded  = encodeURIComponent(cleanVoice);
          await downloadFile(`https://tts-piper.pages.dev/api/model/${encoded}.onnx.json`, tempPath);
          fs.renameSync(tempPath, jsonPath);
        }
      } catch (err: any) {
        console.error(`[Piper Proxy] Download failed for ${cleanVoice}:`, err);
        throw err;
      } finally {
        downloadLocks.delete(cleanVoice);
      }
    })();
    downloadLocks.set(cleanVoice, downloadPromise);
  }
  return downloadPromise;
}

// ─── POST — Text-to-Speech synthesis ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const targetUrl = req.headers.get("x-piper-server-url") || "http://localhost:5000";

  try {
    const body = await req.json();
    const { text, voice, rate } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    let finalVoice = voice;

    // Chỉ thực hiện FS operations khi đang chạy trên môi trường có filesystem
    if (isFsAvailable() && voice && typeof voice === "string") {
      try {
        const fs   = _fs!;
        const path = _path!;
        const cleanVoice = voice
          .replace(/^voices\//, "")
          .replace(/^vi\//, "")
          .replace(/\.onnx$/, "");

        const modelPath = path.join(process.cwd(), "voices", `${cleanVoice}.onnx`);
        const jsonPath  = path.join(process.cwd(), "voices", `${cleanVoice}.onnx.json`);
        const dir       = path.dirname(modelPath);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        await getOrCreateDownloadPromise(cleanVoice, modelPath, jsonPath);
        finalVoice = `voices/${cleanVoice}`;
      } catch (fsErr: any) {
        // Tải model thất bại — vẫn tiếp tục gửi request tới server với voice gốc
        console.warn("[Piper Proxy] FS model download skipped:", fsErr.message);
      }
    }

    const lengthScale = rate ? 1.0 / rate : 1.0;

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: finalVoice || undefined,
        length_scale: lengthScale,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[Piper Proxy] Server at ${targetUrl} returned ${response.status}:`, errorText);
      return NextResponse.json(
        { error: `Máy chủ Piper báo lỗi: ${response.statusText} (${errorText})` },
        { status: response.status }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "audio/wav",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    console.error("[Piper Proxy] Error:", error);
    let errorMsg = error.message || "Internal server error";
    if (errorMsg.includes("fetch failed") || errorMsg.includes("ECONNREFUSED")) {
      errorMsg = `Không thể kết nối đến máy chủ Piper TTS tại: ${targetUrl}. Hãy chạy server cục bộ hoặc cấu hình địa chỉ server từ xa trong phần API URL.`;
    }
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

// ─── GET — Check / Download voice model / List voices ────────────────────────

export async function GET(req: NextRequest) {
  const checkVoice    = req.nextUrl.searchParams.get("check");
  const downloadVoice = req.nextUrl.searchParams.get("download");

  // --- ?check=VoiceName ---
  if (checkVoice) {
    // Trên Cloudflare (không có FS), kiểm tra trực tiếp với Piper server
    // thay vì kiểm tra filesystem local
    if (!isFsAvailable()) {
      const serverUrl = req.headers.get("x-piper-server-url") || "http://localhost:5000";
      try {
        // Ping server to see if it's reachable and voice is available
        const voicesRes = await fetch(`${serverUrl}/voices`, {
          signal: AbortSignal.timeout(5000),
        });
        if (voicesRes.ok) {
          // Server is reachable — voice is available on the server side
          return NextResponse.json({ downloaded: true });
        }
      } catch {
        // Server unreachable
      }
      return NextResponse.json({ downloaded: false });
    }
    const fs   = _fs!;
    const path = _path!;
    const clean     = checkVoice.replace(/^voices\//, "").replace(/^vi\//, "").replace(/\.onnx$/, "");
    const modelPath = path.join(process.cwd(), "voices", `${clean}.onnx`);
    const exists    = fs.existsSync(modelPath) && fs.statSync(modelPath).size > 0;
    return NextResponse.json({ downloaded: exists });
  }

  // --- ?download=VoiceName ---
  if (downloadVoice) {
    // Trên Cloudflare — không thể ghi file, thử kiểm tra xem Piper server
    // đã có model chưa bằng cách gửi test synthesis
    if (!isFsAvailable()) {
      const serverUrl = req.headers.get("x-piper-server-url") || "http://localhost:5000";
      const clean = downloadVoice.replace(/^voices\//, "").replace(/^vi\//, "").replace(/\.onnx$/, "");

      try {
        // Test synthesis — if server already has the model, this succeeds
        const testRes = await fetch(serverUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: "xin chào",
            voice: `voices/${clean}`,
            length_scale: 1.0,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (testRes.ok) {
          return NextResponse.json({ success: true });
        }
      } catch {
        // Server unreachable or model not found
      }

      return NextResponse.json(
        { error: "Filesystem read-only (edge/cloud environment). Please download manually." },
        { status: 503 }
      );
    }

    const fs   = _fs!;
    const path = _path!;
    const clean     = downloadVoice.replace(/^voices\//, "").replace(/^vi\//, "").replace(/\.onnx$/, "");
    const modelPath = path.join(process.cwd(), "voices", `${clean}.onnx`);
    const jsonPath  = path.join(process.cwd(), "voices", `${clean}.onnx.json`);
    const dir       = path.dirname(modelPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      await getOrCreateDownloadPromise(clean, modelPath, jsonPath);
      return NextResponse.json({ success: true });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
  }

  // --- Lấy danh sách voices từ Piper server ---
  const targetUrl = req.headers.get("x-piper-server-url") || "http://localhost:5000";
  try {
    const response = await fetch(`${targetUrl}/voices`, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.statusText}`);
    }

    const voices = await response.json();
    return NextResponse.json(voices);
  } catch (error: any) {
    console.error("[Piper Proxy GET] Error:", error);
    let errorMsg = error.message || "Failed to fetch voices list";
    if (errorMsg.includes("fetch failed") || errorMsg.includes("ECONNREFUSED")) {
      errorMsg = `Không thể kết nối đến máy chủ Piper TTS tại ${targetUrl}.`;
    }
    return NextResponse.json({ error: errorMsg }, { status: 502 });
  }
}
