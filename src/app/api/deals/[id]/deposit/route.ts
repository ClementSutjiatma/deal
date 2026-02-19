import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getDepositParams } from "@/lib/escrow";
import { DEAL_STATUSES, SELLER_TRANSFER_TIMEOUT, BUYER_CONFIRM_TIMEOUT, MAX_DISCOUNT_FRACTION } from "@/lib/constants";
import type { Address } from "viem";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const { buyer_id, conversation_id } = await request.json();

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

  if (deal.seller_id === buyer_id) {
    return NextResponse.json({ error: "Seller cannot be buyer" }, { status: 400 });
  }

  // Determine price: use negotiated price from conversation if available
  let priceCents = deal.price_cents;

  if (conversation_id) {
    const { data: conv } = await (supabase
      .from("conversations") as any)
      .select("negotiated_price_cents")
      .eq("id", conversation_id)
      .single() as { data: any };

    if (conv?.negotiated_price_cents) {
      // Validate negotiated price is within acceptable bounds
      const minPrice = Math.round(deal.price_cents * (1 - MAX_DISCOUNT_FRACTION));
      if (conv.negotiated_price_cents >= minPrice && conv.negotiated_price_cents <= deal.price_cents) {
        priceCents = conv.negotiated_price_cents;
      }
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

  const depositParams = getDepositParams(
    id,
    seller.wallet_address as Address,
    priceCents,
    SELLER_TRANSFER_TIMEOUT,
    BUYER_CONFIRM_TIMEOUT
  );

  return NextResponse.json({
    deal_id: id,
    price_cents: priceCents,
    price_usdc: (priceCents / 100).toFixed(2),
    deposit_params: {
      escrow_address: depositParams.escrowAddress,
      usdc_address: depositParams.usdcAddress,
      deal_id_bytes32: depositParams.dealId,
      seller: depositParams.seller,
      amount: depositParams.amount.toString(),
      transfer_deadline: depositParams.transferDeadline.toString(),
      confirm_deadline: depositParams.confirmDeadline.toString(),
    },
  });
}
