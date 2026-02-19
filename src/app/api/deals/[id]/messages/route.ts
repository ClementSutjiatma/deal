import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { getAIResponse } from "@/lib/ai/agent";
import { CHAT_MODES } from "@/lib/constants";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  // Optional auth — derive userId from token if present
  const auth = await authenticateRequest(request);
  const userId = auth?.user.id ?? null;

  const conversationId = request.nextUrl.searchParams.get("conversation_id");

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

  // Scope to conversation if provided
  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

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
  const { content, media_urls, conversation_id, anonymous_id } = body;

  // Try to authenticate — anonymous buyers won't have a token
  const auth = await authenticateRequest(request);
  const senderId = auth?.user.id ?? null;

  if (!content) {
    return NextResponse.json({ error: "Missing content" }, { status: 400 });
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

  // Determine role: authenticated users derive from deal, anonymous users are buyers
  let role: "seller" | "buyer";
  if (senderId) {
    const isSeller = senderId === deal.seller_id;
    const isBuyer = senderId === deal.buyer_id;
    // Authenticated user who is neither seller nor existing buyer can still be a new buyer on OPEN deals
    if (!isSeller && !isBuyer && deal.status !== "OPEN") {
      return NextResponse.json({ error: "Not a party to this deal" }, { status: 403 });
    }
    role = isSeller ? "seller" : "buyer";
  } else if (anonymous_id && deal.status === "OPEN") {
    // Anonymous buyer on an OPEN deal — allowed
    role = "buyer";
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve conversation_id: use provided, or look up/create for buyer
  let resolvedConversationId: string | null = conversation_id || null;

  if (!resolvedConversationId && role === "buyer" && senderId) {
    // Authenticated buyer: look up or create by buyer_id
    const { data: existing } = await (supabase
      .from("conversations") as any)
      .select("id")
      .eq("deal_id", id)
      .eq("buyer_id", senderId)
      .single() as { data: any };

    if (existing) {
      resolvedConversationId = existing.id;
    } else {
      const { data: created, error: createErr } = await (supabase
        .from("conversations") as any)
        .insert({ deal_id: id, buyer_id: senderId })
        .select("id")
        .single() as { data: any; error: any };

      if (createErr && createErr.code === "23505") {
        const { data: retry } = await (supabase
          .from("conversations") as any)
          .select("id")
          .eq("deal_id", id)
          .eq("buyer_id", senderId)
          .single() as { data: any };
        resolvedConversationId = retry?.id || null;
      } else if (created) {
        resolvedConversationId = created.id;
      }
    }
  } else if (!resolvedConversationId && role === "buyer" && !senderId && anonymous_id) {
    // Anonymous buyer: look up or create by anonymous_id
    const { data: existing } = await (supabase
      .from("conversations") as any)
      .select("id")
      .eq("deal_id", id)
      .eq("anonymous_id", anonymous_id)
      .single() as { data: any };

    if (existing) {
      resolvedConversationId = existing.id;
    } else {
      const { data: created, error: createErr } = await (supabase
        .from("conversations") as any)
        .insert({ deal_id: id, anonymous_id: anonymous_id })
        .select("id")
        .single() as { data: any; error: any };

      if (createErr && createErr.code === "23505") {
        const { data: retry } = await (supabase
          .from("conversations") as any)
          .select("id")
          .eq("deal_id", id)
          .eq("anonymous_id", anonymous_id)
          .single() as { data: any };
        resolvedConversationId = retry?.id || null;
      } else if (created) {
        resolvedConversationId = created.id;
      }
    }
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
      sender_id: senderId || null,
      conversation_id: resolvedConversationId,
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

  // For buyer in open mode, use senderId as the buyer context
  let buyer = null;
  if (deal.buyer_id) {
    buyer = (await (supabase.from("users") as any).select("*").eq("id", deal.buyer_id).single() as { data: any }).data;
  } else if (role === "buyer" && senderId) {
    buyer = (await (supabase.from("users") as any).select("*").eq("id", senderId).single() as { data: any }).data;
  }

  // Fetch conversation for AI context (negotiated price, etc.)
  let conversation = null;
  if (resolvedConversationId) {
    const { data: conv } = await (supabase
      .from("conversations") as any)
      .select("*")
      .eq("id", resolvedConversationId)
      .single() as { data: any };
    conversation = conv;
  }

  // Fetch recent messages scoped to conversation if available
  let messagesQuery = (supabase
    .from("messages") as any)
    .select("*")
    .eq("deal_id", id)
    .order("created_at", { ascending: true })
    .limit(50);

  if (resolvedConversationId) {
    messagesQuery = messagesQuery.eq("conversation_id", resolvedConversationId);
  }

  const { data: recentMessages } = await messagesQuery as { data: any };

  // Get AI response
  try {
    const aiResult = await getAIResponse({
      deal: deal as any,
      seller: seller as any,
      buyer: buyer as any,
      recentMessages: (recentMessages || []) as any,
      senderRole: role,
      conversation: conversation as any,
    });

    // Insert AI message with same visibility and conversation_id
    const { data: aiMsg } = await (supabase
      .from("messages") as any)
      .insert({
        deal_id: id,
        sender_id: null,
        conversation_id: resolvedConversationId,
        role: "ai",
        content: aiResult.content,
        visibility,
        metadata: aiResult.depositRequestCents
          ? { deposit_request_cents: aiResult.depositRequestCents }
          : null,
      })
      .select()
      .single();

    // Update conversation metadata if we have one
    if (resolvedConversationId) {
      const preview = aiResult.content.slice(0, 100);
      await (supabase
        .from("conversations") as any)
        .update({
          last_message_preview: preview,
          last_message_at: new Date().toISOString(),
          message_count: (conversation?.message_count || 0) + 2, // user msg + AI msg
          ...(aiResult.depositRequestCents
            ? { negotiated_price_cents: aiResult.depositRequestCents }
            : {}),
        })
        .eq("id", resolvedConversationId);
    }

    return NextResponse.json({
      userMessage: userMsg,
      aiMessage: aiMsg,
      command: aiResult.command,
      depositRequestCents: aiResult.depositRequestCents,
    });
  } catch (err) {
    // Still return the user message even if AI fails
    // Update conversation with at least the user message
    if (resolvedConversationId) {
      await (supabase
        .from("conversations") as any)
        .update({
          last_message_preview: content.slice(0, 100),
          last_message_at: new Date().toISOString(),
          message_count: (conversation?.message_count || 0) + 1,
        })
        .eq("id", resolvedConversationId);
    }
    return NextResponse.json({ userMessage: userMsg, aiMessage: null, command: null });
  }
}
