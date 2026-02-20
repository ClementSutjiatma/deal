import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { adjudicateDispute } from "@/lib/ai/agent";
import { resolveDisputeOnChain } from "@/lib/escrow";
import { notifyDisputeResolved } from "@/lib/twilio";
import { DEAL_STATUSES } from "@/lib/constants";
import type { Message } from "@/lib/types/database";

/**
 * POST /api/deals/[id]/adjudicate
 *
 * Triggers AI adjudication for a disputed deal.
 * Can be called by:
 *   1. Internal secret (from cron or server-side)
 *   2. Admin API key (manual)
 *   3. Authenticated deal participant (buyer/seller) — client-side fallback
 *      when both parties have completed evidence collection.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  // Check internal/admin auth
  const secret = request.headers.get("x-internal-secret");
  const expectedSecret = process.env.INTERNAL_API_SECRET;
  const adminKey = request.headers.get("x-admin-api-key");
  const expectedAdminKey = process.env.ADMIN_API_KEY;

  let isAuthorized =
    (expectedSecret && secret === expectedSecret) ||
    (expectedAdminKey && adminKey === expectedAdminKey);

  // Also allow authenticated deal participants (buyer or seller)
  if (!isAuthorized) {
    const auth = await authenticateRequest(request);
    if (auth?.user.id) {
      // Verify they're a party to this deal
      const { data: dealCheck } = await (supabase.from("deals") as any)
        .select("seller_id, buyer_id")
        .eq("id", id)
        .single() as { data: any };
      if (dealCheck && (auth.user.id === dealCheck.seller_id || auth.user.id === dealCheck.buyer_id)) {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch deal
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", id)
    .eq("status", DEAL_STATUSES.DISPUTED)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not found or not disputed" }, { status: 404 });
  }

  // Look up conversation for message scoping
  const { data: conv } = await (supabase
    .from("conversations") as any)
    .select("id")
    .eq("deal_id", id)
    .eq("buyer_id", deal.buyer_id)
    .single() as { data: any };
  const convId = conv?.id || null;

  // Fetch ALL dispute messages (both buyer_only and seller_only)
  const { data: allMessages } = await (supabase
    .from("messages") as any)
    .select("*")
    .eq("deal_id", id)
    .in("visibility", ["buyer_only", "seller_only"])
    .order("created_at", { ascending: true }) as { data: Message[] };

  const messages = allMessages || [];
  const buyerMessages = messages.filter((m) => m.visibility === "buyer_only");
  const sellerMessages = messages.filter((m) => m.visibility === "seller_only");

  // Fetch users for context
  const { data: seller } = await (supabase
    .from("users") as any)
    .select("*")
    .eq("id", deal.seller_id)
    .single() as { data: any };

  let buyer = null;
  if (deal.buyer_id) {
    buyer = (await (supabase.from("users") as any).select("*").eq("id", deal.buyer_id).single() as { data: any }).data;
  }

  // Fetch deal events for timeline context
  const { data: dealEvents } = await (supabase
    .from("deal_events") as any)
    .select("event_type, actor_id, metadata, created_at")
    .eq("deal_id", id)
    .order("created_at", { ascending: true }) as { data: any[] };

  // Run AI adjudication
  let ruling;
  try {
    ruling = await adjudicateDispute(deal, seller, buyer, buyerMessages, sellerMessages, dealEvents || []);
  } catch (err) {
    console.error("AI adjudication failed:", err);
    // Fallback: default to buyer refund
    ruling = {
      ruling: "BUYER" as const,
      reasoning: "Adjudication system error. Defaulting to refund per dispute policy.",
    };
  }

  const favorBuyer = ruling.ruling === "BUYER";

  // Execute on-chain resolution
  let txHash: string | null = null;
  try {
    txHash = await resolveDisputeOnChain(id, favorBuyer);
  } catch (err) {
    console.error("On-chain resolve failed:", err);
    return NextResponse.json({ error: "On-chain resolution failed" }, { status: 500 });
  }

  // Update deal status
  const newStatus = favorBuyer ? DEAL_STATUSES.REFUNDED : DEAL_STATUSES.RELEASED;
  await (supabase.from("deals") as any)
    .update({
      status: newStatus,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: id,
    event_type: "resolved",
    metadata: {
      favor_buyer: favorBuyer,
      tx_hash: txHash,
      ruling: ruling.reasoning,
      automated: true,
    },
  });

  // Insert ruling messages (one for each party, both with ruling metadata)
  const rulingMeta = {
    dispute_ruling: ruling.ruling,
    dispute_reasoning: ruling.reasoning,
  };

  await (supabase.from("messages") as any).insert([
    {
      deal_id: id,
      conversation_id: convId,
      role: "ai",
      content: ruling.reasoning,
      visibility: "buyer_only",
      metadata: rulingMeta,
    },
    {
      deal_id: id,
      conversation_id: convId,
      role: "ai",
      content: ruling.reasoning,
      visibility: "seller_only",
      metadata: rulingMeta,
    },
  ]);

  // SMS notify both parties
  const outcome = favorBuyer ? "Refund to buyer" : "Funds released to seller";
  if (seller?.phone) {
    try { await notifyDisputeResolved(seller.phone, deal.short_code, outcome); } catch {}
  }
  if (buyer?.phone) {
    try { await notifyDisputeResolved(buyer.phone, deal.short_code, outcome); } catch {}
  }

  return NextResponse.json({
    success: true,
    ruling: ruling.ruling,
    reasoning: ruling.reasoning,
    tx_hash: txHash,
  });
}
