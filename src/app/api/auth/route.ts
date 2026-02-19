import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPrivyClient } from "@/lib/privy";
import type { User } from "@/lib/types/database";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);

  let privyUserId: string;
  try {
    const verifiedClaims = await getPrivyClient().verifyAuthToken(token);
    privyUserId = verifiedClaims.userId;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const body = await request.json();
  const phone = body.phone as string;
  const name = (body.name as string) || null;
  const wallet_address = (body.wallet_address as string) || null;

  if (!phone) {
    return NextResponse.json(
      { error: "Missing phone" },
      { status: 400 }
    );
  }

  // Check if user exists by privy_user_id (derived from verified token, not body)
  const { data: existing } = (await supabase
    .from("users")
    .select("*")
    .eq("privy_user_id", privyUserId)
    .single()) as { data: User | null };

  if (existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("users") as any)
      .update({
        phone,
        name: name || existing.name,
        wallet_address: wallet_address || existing.wallet_address,
        phone_verified_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("users") as any)
    .insert({
      privy_user_id: privyUserId,
      phone,
      name,
      wallet_address,
      phone_verified_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
