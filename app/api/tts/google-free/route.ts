import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60; // Allow up to 60 seconds

const GOOGLE_API_KEY = "AIzaSyA33f9cSqKdR-V4XNkZNZ_rh_dbT1VQJFo";
const BASE_URL = "https://www.google.com/speech-api/v2/synthesize";

const PREMIUM_API_KEY = "AIzaSyCRZVR4LpsA2hIxn8wkbnaSxxduHheAvhc";
const PREMIUM_BASE_URL = "https://readaloud.googleapis.com/v1:generateAudioDocStream";

/**
 * Resolves voice code mapping for the premium Google ReadAloud API.
 */
function resolvePremiumVoiceCode(voice: string | null | undefined): string {
  if (!voice) return "via";

  const clean = voice.trim().toLowerCase();

  // If it's already one of the 3-letter codes
  if (["via", "vib", "vic", "vid", "vie", "vif"].includes(clean)) {
    return clean;
  }

  // Handle server IDs like "google:1" to "google:6"
  if (clean.startsWith("google:")) {
    const idx = parseInt(clean.split(":")[1], 10);
    const indexMapping = [null, "via", "vib", "vic", "vid", "vie", "vif"];
    return indexMapping[idx] || "via";
  }

  // Handle legacy numeric index (0 to 5)
  const numIdx = parseInt(clean, 10);
  if (!isNaN(numIdx) && numIdx >= 0 && numIdx < 6) {
    const indexMapping = [
      "via", // 0 -> google:1 -> via
      "vic", // 1 -> google:3 -> vic
      "vie", // 2 -> google:5 -> vie
      "vib", // 3 -> google:2 -> vib
      "vid", // 4 -> google:4 -> vid
      "vif"  // 5 -> google:6 -> vif
    ];
    return indexMapping[numIdx] || "via";
  }

  // Handle full Google Cloud voice names mapping to the codes
  const nameMapping: Record<string, string> = {
    "vi-vn-wavenet-a": "via",
    "vi-vn-wavenet-b": "vib",
    "vi-vn-wavenet-c": "vic",
    "vi-vn-wavenet-d": "vid",
    "vi-vn-standard-a": "vie",
    "vi-vn-standard-d": "vif",
    "vi-vn-standard-c": "vif" // fallback
  };

  if (nameMapping[clean]) {
    return nameMapping[clean];
  }

  return "via";
}

/**
 * Maps the 3-letter code back to standard Google Cloud voice names for fallback.
 */
function getFallbackVoiceName(code: string): string {
  const mapping: Record<string, string> = {
    via: "vi-VN-Wavenet-A",
    vib: "vi-VN-Wavenet-B",
    vic: "vi-VN-Wavenet-C",
    vid: "vi-VN-Wavenet-D",
    vie: "vi-VN-Standard-A",
    vif: "vi-VN-Standard-D"
  };
  return mapping[code] || "vi-VN-Wavenet-A";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = body.text;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    // Get parameters from query parameters first, fallback to request body
    const searchParams = req.nextUrl.searchParams;
    const voiceId = searchParams.get("voice") || body.voice;
    const rateVal = searchParams.get("rate") || body.rate;
    const pitchVal = searchParams.get("pitch") || body.pitch;

    const voiceCode = resolvePremiumVoiceCode(voiceId);

    // Rate and pitch for premium API (native scale, normal is 1.0)
    // Round to 1 decimal place. Google Premium API only supports increments of 0.1
    // Values like 1.35 will cause a 400 Bad Request and fallback to the robotic keyless API.
    let rate = parseFloat(String(rateVal)) || 1.0;
    rate = Math.round(rate * 10) / 10;
    const speedFactor = Math.min(Math.max(rate, 0.5), 4.0);

    let pitch = parseFloat(String(pitchVal)) || 1.0;
    pitch = Math.round(pitch * 10) / 10;
    const pitchFactor = Math.min(Math.max(pitch, 0.5), 2.0);

    // 1. Try fetching from the Premium Google ReadAloud API
    try {
      const googleUrl = `${PREMIUM_BASE_URL}?key=${PREMIUM_API_KEY}`;
      const payload = {
        text: { textParts: text },
        advanced_options: {
          force_language: "vi",
          audio_generation_options: {
            speed_factor: speedFactor,
            pitch_factor: pitchFactor,
          },
        },
        voice_settings: {
          voice_criteria_and_selections: [
            {
              criteria: { language: "vi" },
              selection: { default_voice: voiceCode },
            },
          ],
        },
      };

      const googleResponse = await fetch(googleUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PREMIUM_API_KEY,
        },
        body: JSON.stringify(payload),
      });

      if (googleResponse.ok) {
        const responseData = await googleResponse.json();
        // The audio stream is at index 2 of the response array
        const audioStream = responseData[2] as { audio?: { bytes?: string } } | undefined;
        if (audioStream?.audio?.bytes) {
          const audioBuffer = Buffer.from(audioStream.audio.bytes, "base64");
          return new NextResponse(audioBuffer, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        }
      }
      
      console.warn(`[Google Premium Proxy] Premium API response not OK or empty bytes. Status: ${googleResponse.status}. Falling back to keyless speech API v2...`);
    } catch (premiumError) {
      console.error("[Google Premium Proxy] Premium API call failed. Falling back to keyless speech API v2...", premiumError);
    }

    // 2. FALLBACK: Keyless Google Speech API v2
    const voiceName = getFallbackVoiceName(voiceCode);
    const speed = Math.min(Math.max(rate * 0.5, 0.1), 1.0); // keyless API uses 0.5 as normal, bounds [0.1, 1.0]
    const apiPitch = Math.min(Math.max(pitch * 0.5, 0.1), 1.0);

    const queryParams = new URLSearchParams({
      client: "android-tts/com.apps.google:1.1.0",
      lang: "vi-VN",
      key: GOOGLE_API_KEY,
      name: voiceName,
      rate: "24000",
      speed: String(speed),
      pitch: String(apiPitch),
      text: text,
      enc: "mpeg"
    });

    const url = `${BASE_URL}?${queryParams.toString()}`;

    // Perform the API call to Google's keyless speech API v2
    const googleResponse = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "Accept": "*/*"
      }
    });

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text().catch(() => "Unknown error");
      console.error(`[Google Free Proxy] Fallback Google API returned ${googleResponse.status}:`, errorText);
      return NextResponse.json(
        { error: `Google API error: ${googleResponse.statusText}` },
        { status: googleResponse.status }
      );
    }

    const audioBuffer = await googleResponse.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });

  } catch (error: any) {
    console.error("[Google Free Proxy] Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
