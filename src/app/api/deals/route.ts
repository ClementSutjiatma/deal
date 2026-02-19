import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { nanoid } from "nanoid";
import { DEAL_STATUSES, SELLER_TRANSFER_TIMEOUT, BUYER_CONFIRM_TIMEOUT } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const body = await request.json();

  const { event_name, event_date, venue, section, row, seats, num_tickets, price_cents, transfer_method } = body;

  if (!event_name || !num_tickets || !price_cents) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const short_code = nanoid(8);
  const terms = {
    transfer_timeout_hours: SELLER_TRANSFER_TIMEOUT / 3600,
    confirm_timeout_hours: BUYER_CONFIRM_TIMEOUT / 3600,
    dispute_adjudication: "AI-based, evidence from both parties",
    seller_timeout_action: "automatic refund to buyer",
    buyer_timeout_action: "automatic release to seller",
    event_canceled: "full refund",
  };

  const { data, error } = await (supabase
    .from("deals") as any)
    .insert({
      short_code,
      seller_id: auth.user.id,
      event_name,
      event_date: event_date || null,
      venue: venue || null,
      section: section || null,
      row: row || null,
      seats: seats || null,
      num_tickets,
      price_cents,
      transfer_method: transfer_method || null,
      terms,
      status: DEAL_STATUSES.OPEN,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
