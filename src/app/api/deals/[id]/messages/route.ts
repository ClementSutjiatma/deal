import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAIResponse } from "@/lib/ai/agent";
import { CHAT_MODES } from "@/lib/constants";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const userId = request.nextUrl.searchParams.get("user_id");

  // Fetch deal to determine visibility
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", id)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  let query = (supabase
    .from("messages") as any)
    .select("*")
    .eq("deal_id", id)
    .order("created_at", { ascending: true });

  // In dispute mode, filter by visibility
  if (deal.chat_mode === CHAT_MODES.DISPUTE && userId) {
    const isSeller = userId === deal.seller_id;
    const visibilities = ["all"];
    visibilities.push(isSeller ? "seller_only" : "buyer_only");
    query = query.in("visibility", visibilities);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();
  const body = await request.json();
  const { sender_id, content, role, media_urls } = body;

  if (!content || !role) {
    return NextResponse.json({ error: "Missing content or role" }, { status: 400 });
  }

  // Fetch deal
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", id)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Determine visibility based on chat mode
  let visibility = "all";
  if (deal.chat_mode === CHAT_MODES.DISPUTE) {
    visibility = role === "seller" ? "seller_only" : "buyer_only";
  }

  // Insert user message
  const { data: userMsg, error: userErr } = await (supabase
    .from("messages") as any)
    .insert({
      deal_id: id,
      sender_id: sender_id || null,
      role,
      content,
      visibility,
      media_urls: media_urls || null,
    })
    .select()
    .single();

  if (userErr) {
    return NextResponse.json({ error: userErr.message }, { status: 500 });
  }

  // Fetch context for AI
  const { data: seller } = await (supabase
    .from("users") as any)
    .select("*")
    .eq("id", deal.seller_id)
    .single() as { data: any };

  const buyer = deal.buyer_id
    ? (await (supabase.from("users") as any).select("*").eq("id", deal.buyer_id).single() as { data: any }).data
    : null;

  const { data: recentMessages } = await (supabase
    .from("messages") as any)
    .select("*")
    .eq("deal_id", id)
    .order("created_at", { ascending: true })
    .limit(50) as { data: any };

  // Get AI response
  try {
    const aiResult = await getAIResponse({
      deal: deal as any,
      seller: seller as any,
      buyer: buyer as any,
      recentMessages: (recentMessages || []) as any,
      senderRole: role,
    });

    // Handle PRICE_ACCEPTED command — update deal terms so frontend can show deposit button
    if (aiResult.command?.startsWith("PRICE_ACCEPTED:")) {
      const offerCents = parseInt(aiResult.command.split(":")[1], 10);
      if (!isNaN(offerCents)) {
        const existingTerms = (deal.terms as Record<string, unknown>) || {};
        await (supabase
          .from("deals") as any)
          .update({
            terms: { ...existingTerms, buyer_offer_accepted: true, buyer_offer_cents: offerCents },
          })
          .eq("id", id);
      }
    }

    // Insert AI message with same visibility
    const { data: aiMsg } = await (supabase
      .from("messages") as any)
      .insert({
        deal_id: id,
        sender_id: null,
        role: "ai",
        content: aiResult.content,
        visibility,
      })
      .select()
      .single();

    return NextResponse.json({ userMessage: userMsg, aiMessage: aiMsg, command: aiResult.command });
  } catch (err) {
    // Still return the user message even if AI fails
    return NextResponse.json({ userMessage: userMsg, aiMessage: null, command: null });
  }
}
