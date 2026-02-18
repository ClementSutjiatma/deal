import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { User } from "@/lib/types/database";

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();
  const privy_user_id = body.privy_user_id as string;
  const phone = body.phone as string;
  const name = (body.name as string) || null;
  const wallet_address = (body.wallet_address as string) || null;

  if (!privy_user_id || !phone) {
    return NextResponse.json(
      { error: "Missing privy_user_id or phone" },
      { status: 400 }
    );
  }

  // Check if user exists by privy_user_id
  const { data: existing } = (await supabase
    .from("users")
    .select("*")
    .eq("privy_user_id", privy_user_id)
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
      privy_user_id,
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
