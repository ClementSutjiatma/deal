import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyConfirm } from "@/lib/twilio";
import { DEAL_STATUSES } from "@/lib/constants";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const { buyer_id } = await request.json();

  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", id)
    .eq("buyer_id", buyer_id)
    .eq("status", DEAL_STATUSES.TRANSFERRED)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not found or not in TRANSFERRED state" }, { status: 404 });
  }

  // Update deal — on-chain release will be triggered by the frontend
  // or we can call it here from the platform wallet
  const { error } = await (supabase
    .from("deals") as any)
    .update({
      status: DEAL_STATUSES.RELEASED,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: id,
    event_type: "confirmed",
    actor_id: buyer_id,
  });

  // SMS to seller
  const { data: seller } = await (supabase.from("users") as any).select("phone").eq("id", deal.seller_id).single() as { data: any };
  if (seller) {
    const amount = `$${(deal.price_cents / 100).toFixed(2)}`;
    try {
      await notifyConfirm(seller.phone, deal.short_code, amount);
    } catch (e) {
      console.error("SMS notification failed:", e);
    }
  }

  // AI message
  const sellerAmount = (deal.price_cents * (1 - 0.025) / 100).toFixed(2);
  await (supabase.from("messages") as any).insert({
    deal_id: id,
    role: "ai",
    content: `Deal complete! $${sellerAmount} released to seller. Enjoy the show!`,
    visibility: "all",
  });

  return NextResponse.json({ success: true });
}
