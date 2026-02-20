import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { getEmbeddedWalletId } from "@/lib/privy";
import { sponsoredConfirm } from "@/lib/escrow";
import { notifyConfirm } from "@/lib/twilio";
import { DEAL_STATUSES } from "@/lib/constants";

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

  // Execute confirm on-chain via server-side gas-sponsored tx
  let confirm_tx_hash: string;
  try {
    confirm_tx_hash = await sponsoredConfirm(buyerWalletId, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "On-chain transaction failed";
    console.error("sponsoredConfirm failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Update deal
  const { error } = await (supabase
    .from("deals") as any)
    .update({
      status: DEAL_STATUSES.RELEASED,
      confirmed_at: new Date().toISOString(),
      confirm_tx_hash,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: id,
    event_type: "confirmed",
    actor_id: auth.user.id,
    metadata: { confirm_tx_hash },
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

  // AI message — fee is 0% on current contract
  const sellerAmount = (deal.price_cents / 100).toFixed(2);
  await (supabase.from("messages") as any).insert({
    deal_id: id,
    role: "ai",
    content: `Deal complete! $${sellerAmount} released to seller. Enjoy the show!`,
    visibility: "all",
  });

  return NextResponse.json({ success: true, tx_hash: confirm_tx_hash });
}
