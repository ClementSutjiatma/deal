import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { verifyTxReceipt } from "@/lib/escrow";
import { notifyDeposit } from "@/lib/twilio";

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
  const { escrow_tx_hash } = await request.json();

  if (!escrow_tx_hash) {
    return NextResponse.json({ error: "Missing escrow_tx_hash" }, { status: 400 });
  }

  // Verify on-chain transaction
  const txConfirmed = await verifyTxReceipt(escrow_tx_hash as `0x${string}`);
  if (!txConfirmed) {
    return NextResponse.json({ error: "Transaction not confirmed on-chain" }, { status: 400 });
  }

  // Atomic claim using authenticated user ID
  const { data: claimed, error } = await (supabase.rpc as any)("claim_deal", {
    p_deal_id: id,
    p_buyer_id: auth.user.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!claimed) {
    return NextResponse.json({ error: "Deal already claimed" }, { status: 409 });
  }

  // Update escrow tx hash
  await (supabase
    .from("deals") as any)
    .update({ escrow_tx_hash })
    .eq("id", id);

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: id,
    event_type: "funded",
    actor_id: auth.user.id,
    metadata: { escrow_tx_hash },
  });

  // Fetch deal + seller for SMS notification
  const { data: deal } = await (supabase.from("deals") as any).select("*, seller:users!deals_seller_id_fkey(*)").eq("id", id).single() as { data: any };

  if (deal?.seller) {
    const seller = deal.seller as any;
    const amount = `$${(deal.price_cents / 100).toFixed(2)}`;
    try {
      await notifyDeposit(seller.phone, deal.short_code, amount);
    } catch (e) {
      console.error("SMS notification failed:", e);
    }
  }

  // Insert AI message about deposit
  await (supabase.from("messages") as any).insert({
    deal_id: id,
    role: "ai",
    content: `$${(deal!.price_cents / 100).toFixed(2)} locked in escrow. Seller, please transfer the tickets within 2 hours.`,
    visibility: "all",
  });

  return NextResponse.json({ claimed: true });
}
