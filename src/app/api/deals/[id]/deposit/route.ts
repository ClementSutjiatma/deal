import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getDepositParams } from "@/lib/escrow";
import { DEAL_STATUSES, SELLER_TRANSFER_TIMEOUT, BUYER_CONFIRM_TIMEOUT } from "@/lib/constants";
import type { Address } from "viem";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const { buyer_id } = await request.json();

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
    deal.price_cents,
    SELLER_TRANSFER_TIMEOUT,
    BUYER_CONFIRM_TIMEOUT
  );

  return NextResponse.json({
    deal_id: id,
    price_cents: deal.price_cents,
    price_usdc: (deal.price_cents / 100).toFixed(2),
    deposit_params: {
      escrow_address: depositParams.escrowAddress,
      usdc_address: depositParams.usdcAddress,
      deal_id_bytes32: depositParams.dealId,
      seller: depositParams.seller,
      amount: depositParams.amount.toString(),
      fee_bps: depositParams.feeBps.toString(),
      transfer_deadline: depositParams.transferDeadline.toString(),
      confirm_deadline: depositParams.confirmDeadline.toString(),
    },
  });
}
