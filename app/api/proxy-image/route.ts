import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  try {
    const targetUrl = new URL(url);
    console.log(`[proxy-image] Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        "Referer": targetUrl.origin + "/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        console.warn(`[proxy-image] 403/401 Forbidden. Attempting fallback via wsrv.nl for: ${url}`);
        const cleanUrl = url.replace(/^https?:\/\//, ""); // wsrv.nl works well without protocol if problems occur, but protocol is fine too
        const fallbackUrl = `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}`;
        const fbResponse = await fetch(fallbackUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36" },
          redirect: "follow"
        });

        if (fbResponse.ok) {
          const fbContentType = fbResponse.headers.get("content-type") || "image/jpeg";
          const fbArrayBuffer = await fbResponse.arrayBuffer();
          return new NextResponse(fbArrayBuffer, {
            headers: {
              "Content-Type": fbContentType,
              "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400",
            },
          });
        }
      }

      console.error(`[proxy-image] Failed: ${url} - Status: ${response.status}`);
      // Trả về một ảnh trống 1x1 để không bị icon lỗi to đùng
      const transparentPixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
      return new NextResponse(transparentPixel, {
        headers: { "Content-Type": "image/gif" },
      });
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400",
      },
    });
  } catch (error: any) {
    console.error("[proxy-image] Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
