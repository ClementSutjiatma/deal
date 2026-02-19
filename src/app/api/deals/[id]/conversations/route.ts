import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dealId } = await params;
  const supabase = createServiceClient();
  const sellerId = request.nextUrl.searchParams.get("seller_id");
  const buyerId = request.nextUrl.searchParams.get("buyer_id");
  const anonymousId = request.nextUrl.searchParams.get("anonymous_id");

  // Fetch the deal to verify access
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("id, seller_id")
    .eq("id", dealId)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Seller: list all conversations for this deal
  if (sellerId) {
    if (deal.seller_id !== sellerId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const { data, error } = await (supabase
      .from("conversations") as any)
      .select("*, buyer:users!conversations_buyer_id_fkey(id, name)")
      .eq("deal_id", dealId)
      .order("last_message_at", { ascending: false, nullsFirst: false }) as { data: any; error: any };

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  }

  // Buyer: get-or-create their conversation
  if (buyerId) {
    if (deal.seller_id === buyerId) {
      return NextResponse.json({ error: "Seller cannot be buyer" }, { status: 400 });
    }

    // Try to find existing conversation
    const { data: existing } = await (supabase
      .from("conversations") as any)
      .select("*")
      .eq("deal_id", dealId)
      .eq("buyer_id", buyerId)
      .single() as { data: any };

    if (existing) {
      return NextResponse.json(existing);
    }

    // Create new conversation
    const { data: created, error } = await (supabase
      .from("conversations") as any)
      .insert({
        deal_id: dealId,
        buyer_id: buyerId,
      })
      .select()
      .single() as { data: any; error: any };

    if (error) {
      // Race condition: another request created it first
      if (error.code === "23505") {
        const { data: retry } = await (supabase
          .from("conversations") as any)
          .select("*")
          .eq("deal_id", dealId)
          .eq("buyer_id", buyerId)
          .single() as { data: any };
        return NextResponse.json(retry);
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(created);
  }

  // Anonymous buyer: get-or-create conversation by anonymous_id
  if (anonymousId) {
    // Try to find existing conversation
    const { data: existing } = await (supabase
      .from("conversations") as any)
      .select("*")
      .eq("deal_id", dealId)
      .eq("anonymous_id", anonymousId)
      .single() as { data: any };

    if (existing) {
      return NextResponse.json(existing);
    }

    // Create new conversation for anonymous user
    const { data: created, error } = await (supabase
      .from("conversations") as any)
      .insert({
        deal_id: dealId,
        anonymous_id: anonymousId,
      })
      .select()
      .single() as { data: any; error: any };

    if (error) {
      // Race condition: another request created it first
      if (error.code === "23505") {
        const { data: retry } = await (supabase
          .from("conversations") as any)
          .select("*")
          .eq("deal_id", dealId)
          .eq("anonymous_id", anonymousId)
          .single() as { data: any };
        return NextResponse.json(retry);
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(created);
  }

  return NextResponse.json({ error: "Missing seller_id, buyer_id, or anonymous_id" }, { status: 400 });
}
