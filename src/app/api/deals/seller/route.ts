import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/deals/seller?seller_id=...
 * Returns all deals for a seller, ordered by most recent first.
 */
export async function GET(request: NextRequest) {
  const sellerId = request.nextUrl.searchParams.get("seller_id");

  if (!sellerId) {
    return NextResponse.json({ error: "Missing seller_id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await (supabase
    .from("deals") as any)
    .select("id, short_code, event_name, status, price_cents, num_tickets, created_at")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false })
    .limit(20) as { data: any; error: any };

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
