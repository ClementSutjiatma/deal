import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { getEmbeddedWalletId } from "@/lib/privy";
import { sponsoredApproveAndDeposit } from "@/lib/escrow";
import { notifyDeposit } from "@/lib/twilio";
import { DEAL_STATUSES, SELLER_TRANSFER_TIMEOUT, BUYER_CONFIRM_TIMEOUT, CONVERSATION_STATUSES } from "@/lib/constants";
import type { Address } from "viem";

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
  const { conversation_id } = await request.json();

  // Fetch deal
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", id)
    .eq("status", DEAL_STATUSES.OPEN)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not available" }, { status: 404 });
  }

  if (deal.seller_id === auth.user.id) {
    return NextResponse.json({ error: "Seller cannot be buyer" }, { status: 400 });
  }

  // Resolve buyer's Privy wallet ID: try DB first, fall back to Privy API lookup
  let buyerWalletId = auth.user.privy_wallet_id;
  if (!buyerWalletId) {
    buyerWalletId = await getEmbeddedWalletId(auth.privyUserId);
    // Cache it in the DB for future use
    if (buyerWalletId) {
      await (supabase.from("users") as any)
        .update({ privy_wallet_id: buyerWalletId })
        .eq("id", auth.user.id);
    }
  }
  if (!buyerWalletId) {
    return NextResponse.json({ error: "Buyer wallet not configured" }, { status: 400 });
  }

  // Determine price: use negotiated price from conversation or deal terms.
  // The seller sets a MINIMUM price (deal.price_cents). Buyers offer at or above it.
  // The negotiated price can be higher than the listed minimum — that's expected.
  let priceCents = deal.price_cents;

  // First try conversation's negotiated price
  if (conversation_id) {
    const { data: conv } = await (supabase
      .from("conversations") as any)
      .select("negotiated_price_cents")
      .eq("id", conversation_id)
      .single() as { data: any };

    if (conv?.negotiated_price_cents && conv.negotiated_price_cents >= deal.price_cents) {
      priceCents = conv.negotiated_price_cents;
    }
  }

  // Fallback: check deal.terms.buyer_offer_cents (set when AI accepts an offer).
  // This covers cases where the conversation's negotiated_price wasn't set
  // (e.g. anonymous→authenticated user conversation mismatch).
  const terms = deal.terms as Record<string, unknown> | null;
  if (priceCents === deal.price_cents && terms?.buyer_offer_accepted && terms?.buyer_offer_cents) {
    const offerCents = terms.buyer_offer_cents as number;
    if (offerCents >= deal.price_cents) {
      priceCents = offerCents;
    }
  }

  // Fetch seller wallet
  const { data: seller } = await (supabase
    .from("users") as any)
    .select("wallet_address")
    .eq("id", deal.seller_id)
    .single() as { data: any };

  if (!seller?.wallet_address) {
    return NextResponse.json({ error: "Seller wallet not set up" }, { status: 400 });
  }

  // Execute approve + deposit on-chain via server-side gas-sponsored tx
  let escrow_tx_hash: string;
  try {
    escrow_tx_hash = await sponsoredApproveAndDeposit(
      buyerWalletId,
      id,
      seller.wallet_address as Address,
      priceCents,
      SELLER_TRANSFER_TIMEOUT,
      BUYER_CONFIRM_TIMEOUT
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "On-chain deposit failed";
    console.error("sponsoredApproveAndDeposit failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Atomic claim
  const { data: claimed, error: claimErr } = await (supabase.rpc as any)("claim_deal", {
    p_deal_id: id,
    p_buyer_id: auth.user.id,
  });

  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claimed) {
    return NextResponse.json({ error: "Deal already claimed" }, { status: 409 });
  }

  // Update escrow tx hash
  await (supabase.from("deals") as any)
    .update({ escrow_tx_hash })
    .eq("id", id);

  // Update conversation statuses
  if (conversation_id) {
    await (supabase.from("conversations") as any)
      .update({ status: CONVERSATION_STATUSES.CLAIMED })
      .eq("id", conversation_id);
    await (supabase.from("conversations") as any)
      .update({ status: CONVERSATION_STATUSES.CLOSED })
      .eq("deal_id", id)
      .neq("id", conversation_id);
  }

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: id,
    event_type: "funded",
    actor_id: auth.user.id,
    metadata: { escrow_tx_hash, conversation_id },
  });

  // SMS to seller
  const { data: sellerUser } = await (supabase.from("users") as any)
    .select("phone")
    .eq("id", deal.seller_id)
    .single() as { data: any };

  if (sellerUser?.phone) {
    const amount = `$${(priceCents / 100).toFixed(2)}`;
    try {
      await notifyDeposit(sellerUser.phone, deal.short_code, amount);
    } catch (e) {
      console.error("SMS notification failed:", e);
    }
  }

  // AI message
  await (supabase.from("messages") as any).insert({
    deal_id: id,
    conversation_id: conversation_id || null,
    role: "ai",
    content: `$${(priceCents / 100).toFixed(2)} locked in escrow. Seller, please transfer the tickets within 2 hours.`,
    visibility: "all",
  });

  return NextResponse.json({ success: true, tx_hash: escrow_tx_hash });
}
