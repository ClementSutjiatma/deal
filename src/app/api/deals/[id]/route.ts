import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  // Try by ID first, then by short_code
  let { data, error } = await (supabase
    .from("deals") as any)
    .select("*, seller:users!deals_seller_id_fkey(id, name, wallet_address)")
    .eq("id", id)
    .single() as { data: any; error: any };

  if (error || !data) {
    // Try by short_code
    const result = await (supabase
      .from("deals") as any)
      .select("*, seller:users!deals_seller_id_fkey(id, name, wallet_address)")
      .eq("short_code", id)
      .single() as { data: any; error: any };
    data = result.data;
    error = result.error;
  }

  if (error || !data) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
