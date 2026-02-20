import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/deals/buyer?buyer_id=...
 * Returns deals where the user has a conversation (i.e. deals they're following).
 */
export async function GET(request: NextRequest) {
  const buyerId = request.nextUrl.searchParams.get("buyer_id");

  if (!buyerId) {
    return NextResponse.json({ error: "Missing buyer_id" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Find deals where this user has a conversation
  const { data: conversations, error: convError } = await (supabase
    .from("conversations") as any)
    .select("deal_id")
    .eq("buyer_id", buyerId) as { data: any; error: any };

  if (convError) {
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }

  if (!conversations || conversations.length === 0) {
    return NextResponse.json([]);
  }

  const dealIds = conversations.map((c: any) => c.deal_id);

  const { data, error } = await (supabase
    .from("deals") as any)
    .select("id, short_code, event_name, status, price_cents, num_tickets, created_at")
    .in("id", dealIds)
    .order("created_at", { ascending: false })
    .limit(20) as { data: any; error: any };

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
