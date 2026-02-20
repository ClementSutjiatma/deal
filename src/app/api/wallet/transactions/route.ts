import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/wallet/transactions?user_id=...
 * Returns all deal events related to a user (as buyer or seller),
 * joined with deal info for display.
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");

  if (!userId) {
    return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Get all deals where the user is seller or buyer
  const { data: deals, error: dealsError } = (await (
    supabase.from("deals") as any
  )
    .select(
      "id, short_code, event_name, status, price_cents, num_tickets, seller_id, buyer_id, escrow_tx_hash, funded_at, transferred_at, confirmed_at, disputed_at, resolved_at, created_at"
    )
    .or(`seller_id.eq.${userId},buyer_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(50)) as { data: any; error: any };

  if (dealsError) {
    return NextResponse.json({ error: dealsError.message }, { status: 500 });
  }

  if (!deals || deals.length === 0) {
    return NextResponse.json({ deals: [], events: [] });
  }

  const dealIds = deals.map((d: any) => d.id);

  // Get all events for those deals
  const { data: events, error: eventsError } = (await (
    supabase.from("deal_events") as any
  )
    .select("id, deal_id, event_type, actor_id, metadata, created_at")
    .in("deal_id", dealIds)
    .order("created_at", { ascending: false })
    .limit(200)) as { data: any; error: any };

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }

  return NextResponse.json({
    deals: deals || [],
    events: events || [],
  });
}
