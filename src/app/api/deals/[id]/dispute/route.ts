import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { getEmbeddedWalletId } from "@/lib/privy";
import { sponsoredDispute } from "@/lib/escrow";
import { notifyDispute } from "@/lib/twilio";
import { DEAL_STATUSES, CHAT_MODES } from "@/lib/constants";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", id)
    .eq("buyer_id", auth.user.id)
    .eq("status", DEAL_STATUSES.TRANSFERRED)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not found or not in TRANSFERRED state" }, { status: 404 });
  }

  // Resolve buyer's Privy wallet ID: try DB first, fall back to Privy API lookup
  let buyerWalletId = auth.user.privy_wallet_id;
  if (!buyerWalletId) {
    buyerWalletId = await getEmbeddedWalletId(auth.privyUserId);
    if (buyerWalletId) {
      await (supabase.from("users") as any)
        .update({ privy_wallet_id: buyerWalletId })
        .eq("id", auth.user.id);
    }
  }
  if (!buyerWalletId) {
    return NextResponse.json({ error: "Buyer wallet not configured" }, { status: 400 });
  }

  // Execute dispute on-chain via server-side gas-sponsored tx
  let dispute_tx_hash: string;
  try {
    dispute_tx_hash = await sponsoredDispute(buyerWalletId, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "On-chain transaction failed";
    console.error("sponsoredDispute failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Update deal
  const { error } = await (supabase
    .from("deals") as any)
    .update({
      status: DEAL_STATUSES.DISPUTED,
      disputed_at: new Date().toISOString(),
      chat_mode: CHAT_MODES.DISPUTE,
      dispute_tx_hash,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: id,
    event_type: "disputed",
    actor_id: auth.user.id,
    metadata: { dispute_tx_hash },
  });

  // AI message to buyer (buyer_only)
  await (supabase.from("messages") as any).insert({
    deal_id: id,
    role: "ai",
    content: "What's the issue?\n1. Tickets not received\n2. Wrong tickets (wrong section, date, event)\n3. Tickets don't work (barcode invalid, already used)\n4. Other\n\nPlease describe the problem and upload a screenshot if possible.",
    visibility: "buyer_only",
  });

  // AI message to seller (seller_only)
  await (supabase.from("messages") as any).insert({
    deal_id: id,
    role: "ai",
    content: "Buyer has raised an issue about the tickets. Please upload screenshots of:\n1. Your original purchase confirmation\n2. The transfer confirmation\n\nYou have 4 hours to respond with evidence.",
    visibility: "seller_only",
  });

  // SMS to seller
  const { data: seller } = await (supabase.from("users") as any).select("phone").eq("id", deal.seller_id).single() as { data: any };
  if (seller) {
    try {
      await notifyDispute(seller.phone, deal.short_code);
    } catch (e) {
      console.error("SMS notification failed:", e);
    }
  }

  return NextResponse.json({ success: true, tx_hash: dispute_tx_hash });
}
