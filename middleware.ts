import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  let user = null;
  try {
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    user = supabaseUser;
  } catch (err) {
    console.error("Middleware Auth Error:", err);
  }

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login") || request.nextUrl.pathname.startsWith("/register");
  
  if (!user && !isAuthRoute && !request.nextUrl.pathname.startsWith("/api")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  // Check VIP access for Reading Room & Reader routes
  const pathname = request.nextUrl.pathname;
  const isReadingRoomRoute = pathname.startsWith("/reading-room") || pathname.startsWith("/reader");
  const isApiReadingRoomRoute = pathname.startsWith("/api/reading-room");

  if (isReadingRoomRoute || isApiReadingRoomRoute) {
    if (!user) {
      if (isApiReadingRoomRoute) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      return NextResponse.redirect(redirectUrl);
    }

    const email = user.email?.toLowerCase() || "";
    const isAdmin = email === "nthanhnam2005@gmail.com" || email === "thanhxnam2005@gmail.com";

    let isVip = isAdmin;

    if (!isVip) {
      try {
        // Query app_settings free_mode and profile in parallel
        const [settingsResult, profileResult] = await Promise.all([
          supabase.from("app_settings").select("key, value").eq("key", "free_mode").maybeSingle(),
          supabase.from("profiles").select("vip_until").eq("id", user.id).maybeSingle()
        ]);

        const isFreeMode = settingsResult.data?.value === "true";
        const vipUntil = profileResult.data?.vip_until;
        const hasVipActive = vipUntil && new Date(vipUntil) > new Date();

        isVip = isFreeMode || !!hasVipActive;
      } catch (dbErr) {
        console.error("Middleware VIP check database error:", dbErr);
        isVip = false; // Fallback to secure default (non-VIP)
      }
    }

    if (!isVip) {
      if (isApiReadingRoomRoute) {
        return NextResponse.json(
          { error: "Phòng đọc dành riêng cho thành viên VIP!" },
          { status: 403 }
        );
      }
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      return NextResponse.redirect(redirectUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|zip|txt)$).*)",
  ],
};
