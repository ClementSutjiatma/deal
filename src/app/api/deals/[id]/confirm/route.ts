import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { verifyTxReceipt, getDealOnChain } from "@/lib/escrow";
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
  const { confirm_tx_hash } = await request.json();

  if (!confirm_tx_hash) {
    return NextResponse.json({ error: "Missing confirm_tx_hash" }, { status: 400 });
  }

  // Verify on-chain transaction receipt
  const txConfirmed = await verifyTxReceipt(confirm_tx_hash as `0x${string}`);
  if (!txConfirmed) {
    return NextResponse.json({ error: "Transaction not confirmed on-chain" }, { status: 400 });
  }

  // Verify on-chain deal status is Released (enum value 3)
  const onChainDeal = await getDealOnChain(id) as unknown as any[];
  // Deal struct: [buyer, seller, amount, platformFeeBps, depositedAt, transferredAt, disputedAt, transferDeadline, confirmDeadline, status]
  const onChainStatus = Number(onChainDeal[9]);
  if (onChainStatus !== 3) {
    // 3 = Released
    return NextResponse.json({ error: "On-chain deal not in Released state" }, { status: 400 });
  }

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

  // Update deal — only after on-chain verification
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
