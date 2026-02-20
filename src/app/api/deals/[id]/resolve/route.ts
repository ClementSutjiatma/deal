import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveDisputeOnChain } from "@/lib/escrow";
import { notifyDisputeResolved } from "@/lib/twilio";
import { DEAL_STATUSES } from "@/lib/constants";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Admin-only route: verify ADMIN_API_KEY
  const apiKey = request.headers.get("x-admin-api-key");
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();
  const { favor_buyer, ruling_text } = await request.json();

  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", id)
    .eq("status", DEAL_STATUSES.DISPUTED)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not found or not disputed" }, { status: 404 });
  }

  // Call escrow contract
  let txHash: string | null = null;
  try {
    txHash = await resolveDisputeOnChain(id, favor_buyer);
  } catch (e) {
    console.error("On-chain resolve failed:", e);
    return NextResponse.json({ error: "On-chain resolution failed" }, { status: 500 });
  }

  // Update deal
  const newStatus = favor_buyer ? DEAL_STATUSES.REFUNDED : DEAL_STATUSES.RELEASED;
  await (supabase
    .from("deals") as any)
    .update({
      status: newStatus,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: id,
    event_type: "resolved",
    metadata: { favor_buyer, tx_hash: txHash, ruling: ruling_text },
  });

  // Look up conversation for message scoping
  const { data: conv } = await (supabase
    .from("conversations") as any)
    .select("id")
    .eq("deal_id", id)
    .eq("buyer_id", deal.buyer_id)
    .single() as { data: any };
  const convId = conv?.id || null;

  // Post ruling to both parties
  const rulingMessage = ruling_text || (favor_buyer
    ? "Ruling: Refund issued to buyer."
    : "Ruling: Funds released to seller.");

  await (supabase.from("messages") as any).insert([
    {
      deal_id: id,
      conversation_id: convId,
      role: "ai",
      content: rulingMessage,
      visibility: "buyer_only",
      metadata: { dispute_ruling: favor_buyer ? "BUYER" : "SELLER", dispute_reasoning: rulingMessage },
    },
    {
      deal_id: id,
      conversation_id: convId,
      role: "ai",
      content: rulingMessage,
      visibility: "seller_only",
      metadata: { dispute_ruling: favor_buyer ? "BUYER" : "SELLER", dispute_reasoning: rulingMessage },
    },
  ]);

  // SMS to both parties
  const { data: seller } = await (supabase.from("users") as any).select("phone").eq("id", deal.seller_id).single() as { data: any };
  const { data: buyer } = deal.buyer_id
    ? await (supabase.from("users") as any).select("phone").eq("id", deal.buyer_id).single() as { data: any }
    : { data: null };

  const outcome = favor_buyer ? "Refund to buyer" : "Funds released to seller";
  if (seller) {
    try { await notifyDisputeResolved(seller.phone, deal.short_code, outcome); } catch {}
  }
  if (buyer) {
    try { await notifyDisputeResolved(buyer.phone, deal.short_code, outcome); } catch {}
  }

  return NextResponse.json({ success: true, tx_hash: txHash });
}
