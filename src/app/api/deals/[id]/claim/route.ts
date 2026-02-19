import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyDeposit } from "@/lib/twilio";
import { CONVERSATION_STATUSES } from "@/lib/constants";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const { buyer_id, escrow_tx_hash, conversation_id } = await request.json();

  if (!buyer_id) {
    return NextResponse.json({ error: "Missing buyer_id" }, { status: 400 });
  }

  // Atomic claim
  const { data: claimed, error } = await (supabase.rpc as any)("claim_deal", {
    p_deal_id: id,
    p_buyer_id: buyer_id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!claimed) {
    return NextResponse.json({ error: "Deal already claimed" }, { status: 409 });
  }

  // Update escrow tx hash
  if (escrow_tx_hash) {
    await (supabase
      .from("deals") as any)
      .update({ escrow_tx_hash })
      .eq("id", id);
  }

  // Update conversation statuses
  if (conversation_id) {
    // Mark winning conversation as claimed
    await (supabase
      .from("conversations") as any)
      .update({ status: CONVERSATION_STATUSES.CLAIMED })
      .eq("id", conversation_id);

    // Close all other conversations for this deal
    await (supabase
      .from("conversations") as any)
      .update({ status: CONVERSATION_STATUSES.CLOSED })
      .eq("deal_id", id)
      .neq("id", conversation_id);
  }

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: id,
    event_type: "funded",
    actor_id: buyer_id,
    metadata: { escrow_tx_hash, conversation_id },
  });

  // Fetch deal + seller for SMS notification
  const { data: deal } = await (supabase.from("deals") as any).select("*, seller:users!deals_seller_id_fkey(*)").eq("id", id).single() as { data: any };

  // Get the actual deposit amount (may be negotiated)
  let depositAmount = deal?.price_cents || 0;
  if (conversation_id) {
    const { data: conv } = await (supabase
      .from("conversations") as any)
      .select("negotiated_price_cents")
      .eq("id", conversation_id)
      .single() as { data: any };
    if (conv?.negotiated_price_cents) {
      depositAmount = conv.negotiated_price_cents;
    }
  }

  if (deal?.seller) {
    const seller = deal.seller as any;
    const amount = `$${(depositAmount / 100).toFixed(2)}`;
    try {
      await notifyDeposit(seller.phone, deal.short_code, amount);
    } catch (e) {
      console.error("SMS notification failed:", e);
    }
  }

  // Insert AI message about deposit (in the winning conversation)
  await (supabase.from("messages") as any).insert({
    deal_id: id,
    conversation_id: conversation_id || null,
    role: "ai",
    content: `$${(depositAmount / 100).toFixed(2)} locked in escrow. Seller, please transfer the tickets within 2 hours.`,
    visibility: "all",
  });

  return NextResponse.json({ claimed: true });
}
