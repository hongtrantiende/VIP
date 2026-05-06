import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function authenticateAdmin(req: Request) {
  return { status: 200, user: { id: "admin", email: "admin@local" } };
}

export async function GET(req: Request) {
  const auth = await authenticateAdmin(req);
  if (auth.status !== 200) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await supabaseAdmin!.auth.admin.listUsers({ perPage: 100 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users = data.users.map((user) => ({
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
    isVip: Boolean(user.app_metadata?.isVip || user.user_metadata?.isVip),
    vipUntil: user.app_metadata?.vipUntil || user.user_metadata?.vipUntil || null,
    isAdmin: Boolean(user.app_metadata?.isAdmin || user.user_metadata?.isAdmin),
  }));

  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const auth = await authenticateAdmin(req);
  if (auth.status !== 200) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const { userId, isVip, vipUntil } = body as { userId?: string; isVip?: boolean; vipUntil?: string | null };

  if (!userId || typeof isVip !== "boolean") {
    return NextResponse.json(
      { error: "Missing userId or isVip flag." }, 
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin!.auth.admin.updateUserById(userId, {
    app_metadata: { isVip, vipUntil },
    user_metadata: { isVip, vipUntil },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: { id: data.user?.id, email: data.user?.email, isVip, vipUntil } });
}
