import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyTransfer } from "@/lib/twilio";
import { DEAL_STATUSES } from "@/lib/constants";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const { seller_id } = await request.json();

  // Verify seller and deal status
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", id)
    .eq("seller_id", seller_id)
    .eq("status", DEAL_STATUSES.FUNDED)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not found or not in FUNDED state" }, { status: 404 });
  }

  // Update deal
  const { error } = await (supabase
    .from("deals") as any)
    .update({
      status: DEAL_STATUSES.TRANSFERRED,
      transferred_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: id,
    event_type: "transferred",
    actor_id: seller_id,
  });

  // SMS to buyer
  if (deal.buyer_id) {
    const { data: buyer } = await (supabase.from("users") as any).select("phone").eq("id", deal.buyer_id).single() as { data: any };
    if (buyer) {
      try {
        await notifyTransfer(buyer.phone, deal.short_code);
      } catch (e) {
        console.error("SMS notification failed:", e);
      }
    }
  }

  // AI message
  await (supabase.from("messages") as any).insert({
    deal_id: id,
    role: "ai",
    content: "Seller says tickets transferred. Buyer, please check your ticket account and confirm receipt within 4 hours.",
    visibility: "all",
  });

  return NextResponse.json({ success: true });
}
