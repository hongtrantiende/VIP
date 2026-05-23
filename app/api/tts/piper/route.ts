import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import https from "https";

export const maxDuration = 120; // Allow up to 120 seconds to allow for model download on first request

// Concurrency download locks to prevent parallel write errors (ONNX system error number 13 - Permission Denied)
const downloadLocks = new Map<string, Promise<void>>();

// Helper function to download file
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP status code ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Atomically download model and config files from tts-piper.pages.dev using a mutex lock and temp files
function getOrCreateDownloadPromise(cleanVoice: string, modelPath: string, jsonPath: string): Promise<void> {
  let downloadPromise = downloadLocks.get(cleanVoice);
  if (!downloadPromise) {
    downloadPromise = (async () => {
      try {
        const needsModel = !fs.existsSync(modelPath) || fs.statSync(modelPath).size === 0;
        const needsJson = !fs.existsSync(jsonPath) || fs.statSync(jsonPath).size === 0;

        if (needsModel) {
          console.log(`[Piper Proxy] Downloading voice model ${cleanVoice} to temp file...`);
          const tempModelPath = `${modelPath}.tmp`;
          const encoded = encodeURIComponent(cleanVoice);
          const modelUrl = `https://tts-piper.pages.dev/api/model/${encoded}.onnx`;
          await downloadFile(modelUrl, tempModelPath);
          fs.renameSync(tempModelPath, modelPath);
          console.log(`[Piper Proxy] Successfully atomic-saved: ${modelPath}`);
        }

        if (needsJson) {
          console.log(`[Piper Proxy] Downloading config for ${cleanVoice} to temp file...`);
          const tempJsonPath = `${jsonPath}.tmp`;
          const encoded = encodeURIComponent(cleanVoice);
          const jsonUrl = `https://tts-piper.pages.dev/api/model/${encoded}.onnx.json`;
          await downloadFile(jsonUrl, tempJsonPath);
          fs.renameSync(tempJsonPath, jsonPath);
          console.log(`[Piper Proxy] Successfully atomic-saved config: ${jsonPath}`);
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

export async function POST(req: NextRequest) {
  const targetUrl = req.headers.get("x-piper-server-url") || "http://localhost:5000";

  try {
    const body = await req.json();
    const { text, voice, rate } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    let finalVoice = voice;
    if (voice && typeof voice === "string") {
      let cleanVoice = voice.replace(/^voices\//, "").replace(/^vi\//, "").replace(/\.onnx$/, "");
      
      const modelPath = path.join(process.cwd(), "voices", `${cleanVoice}.onnx`);
      const jsonPath = path.join(process.cwd(), "voices", `${cleanVoice}.onnx.json`);

      const dir = path.dirname(modelPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Synchronize concurrent download requests via the mutex lock
      try {
        await getOrCreateDownloadPromise(cleanVoice, modelPath, jsonPath);
      } catch (downloadErr: any) {
        return NextResponse.json(
          { error: `Lỗi tải giọng đọc ${cleanVoice}: ${downloadErr.message}` },
          { status: 502 }
        );
      }

      finalVoice = `voices/${cleanVoice}`;
    }

    const lengthScale = rate ? 1.0 / rate : 1.0;

    // Send synthesis request to the Piper HTTP server
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice: finalVoice || undefined,
        length_scale: lengthScale,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[Piper Proxy] Server at ${targetUrl} returned status ${response.status}:`, errorText);
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
    console.error("[Piper Proxy] Error processing request:", error);
    let errorMsg = error.message || "Internal server error connecting to Piper";
    if (errorMsg.includes("fetch failed") || errorMsg.includes("ECONNREFUSED")) {
      errorMsg = `Không thể kết nối đến máy chủ Piper TTS. Hãy chắc chắn rằng máy chủ đang chạy tại địa chỉ: ${targetUrl} (mặc định: http://localhost:5000). Chạy máy chủ bằng lệnh: 'py -m piper.http_server -m voices/Ban Mai.onnx --port 5000'`;
    }
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const checkVoice = req.nextUrl.searchParams.get("check");
  const downloadVoice = req.nextUrl.searchParams.get("download");

  if (checkVoice) {
    const clean = checkVoice.replace(/^voices\//, "").replace(/^vi\//, "").replace(/\.onnx$/, "");
    const modelPath = path.join(process.cwd(), "voices", `${clean}.onnx`);
    const exists = fs.existsSync(modelPath) && fs.statSync(modelPath).size > 0;
    return NextResponse.json({ downloaded: exists });
  }

  if (downloadVoice) {
    const clean = downloadVoice.replace(/^voices\//, "").replace(/^vi\//, "").replace(/\.onnx$/, "");
    const modelPath = path.join(process.cwd(), "voices", `${clean}.onnx`);
    const jsonPath = path.join(process.cwd(), "voices", `${clean}.onnx.json`);
    
    const dir = path.dirname(modelPath);
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

  const targetUrl = req.headers.get("x-piper-server-url") || "http://localhost:5000";

  try {
    const response = await fetch(`${targetUrl}/voices`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices from Piper server: ${response.statusText}`);
    }

    const voices = await response.json();
    return NextResponse.json(voices);
  } catch (error: any) {
    console.error("[Piper Proxy GET] Error fetching voices:", error);
    let errorMsg = error.message || "Failed to fetch voices list from Piper";
    if (errorMsg.includes("fetch failed") || errorMsg.includes("ECONNREFUSED")) {
      errorMsg = `Không thể kết nối đến máy chủ Piper TTS tại địa chỉ ${targetUrl} để tải danh sách giọng đọc.`;
    }
    return NextResponse.json(
      { error: errorMsg },
      { status: 502 }
    );
  }
}
