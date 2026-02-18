import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { triggerRefund, triggerAutoRelease } from "@/lib/escrow";
import { notifyAutoRefund, notifyAutoRelease } from "@/lib/twilio";
import { DEAL_STATUSES, SELLER_TRANSFER_TIMEOUT, BUYER_CONFIRM_TIMEOUT, DEAL_EXPIRY_TIMEOUT } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();
  const now = new Date();
  const results: string[] = [];

  // 1. Auto-refund: FUNDED deals past transfer deadline (2 hours)
  const transferCutoff = new Date(now.getTime() - SELLER_TRANSFER_TIMEOUT * 1000).toISOString();
  const { data: expiredFunded } = await (supabase
    .from("deals") as any)
    .select("*, seller:users!deals_seller_id_fkey(phone), buyer:users!deals_buyer_id_fkey(phone)")
    .eq("status", DEAL_STATUSES.FUNDED)
    .lt("funded_at", transferCutoff) as { data: any };

  for (const deal of expiredFunded || []) {
    try {
      const txHash = await triggerRefund(deal.id);

      await (supabase.from("deals") as any).update({
        status: DEAL_STATUSES.AUTO_REFUNDED,
        resolved_at: now.toISOString(),
      }).eq("id", deal.id);

      await (supabase.from("deal_events") as any).insert({
        deal_id: deal.id,
        event_type: "auto_refunded",
        metadata: { tx_hash: txHash },
      });

      await (supabase.from("messages") as any).insert({
        deal_id: deal.id,
        role: "ai",
        content: "Seller didn't transfer tickets in time. Funds have been automatically refunded to the buyer.",
        visibility: "all",
      });

      const buyerPhone = (deal.buyer as any)?.phone;
      if (buyerPhone) {
        const amount = `$${(deal.price_cents / 100).toFixed(2)}`;
        try { await notifyAutoRefund(buyerPhone, deal.short_code, amount); } catch {}
      }

      results.push(`Refunded deal ${deal.short_code}`);
    } catch (e) {
      results.push(`Failed to refund deal ${deal.short_code}: ${e}`);
    }
  }

  // 2. Auto-release: TRANSFERRED deals past confirm deadline (4 hours)
  const confirmCutoff = new Date(now.getTime() - BUYER_CONFIRM_TIMEOUT * 1000).toISOString();
  const { data: expiredTransferred } = await (supabase
    .from("deals") as any)
    .select("*, seller:users!deals_seller_id_fkey(phone), buyer:users!deals_buyer_id_fkey(phone)")
    .eq("status", DEAL_STATUSES.TRANSFERRED)
    .lt("transferred_at", confirmCutoff) as { data: any };

  for (const deal of expiredTransferred || []) {
    try {
      const txHash = await triggerAutoRelease(deal.id);

      await (supabase.from("deals") as any).update({
        status: DEAL_STATUSES.AUTO_RELEASED,
        resolved_at: now.toISOString(),
      }).eq("id", deal.id);

      await (supabase.from("deal_events") as any).insert({
        deal_id: deal.id,
        event_type: "auto_released",
        metadata: { tx_hash: txHash },
      });

      await (supabase.from("messages") as any).insert({
        deal_id: deal.id,
        role: "ai",
        content: "Buyer didn't confirm receipt in time. Funds have been automatically released to the seller.",
        visibility: "all",
      });

      const sellerPhone = (deal.seller as any)?.phone;
      if (sellerPhone) {
        const amount = `$${(deal.price_cents / 100).toFixed(2)}`;
        try { await notifyAutoRelease(sellerPhone, deal.short_code, amount); } catch {}
      }

      results.push(`Auto-released deal ${deal.short_code}`);
    } catch (e) {
      results.push(`Failed to auto-release deal ${deal.short_code}: ${e}`);
    }
  }

  // 3. Expire: OPEN deals older than 7 days
  const expiryCutoff = new Date(now.getTime() - DEAL_EXPIRY_TIMEOUT * 1000).toISOString();
  const { data: expiredOpen } = await (supabase
    .from("deals") as any)
    .select("id, short_code")
    .eq("status", DEAL_STATUSES.OPEN)
    .lt("created_at", expiryCutoff) as { data: any };

  for (const deal of expiredOpen || []) {
    await (supabase.from("deals") as any).update({ status: DEAL_STATUSES.EXPIRED }).eq("id", deal.id);
    await (supabase.from("deal_events") as any).insert({
      deal_id: deal.id,
      event_type: "expired",
    });
    results.push(`Expired deal ${deal.short_code}`);
  }

  return NextResponse.json({ processed: results.length, results });
}
