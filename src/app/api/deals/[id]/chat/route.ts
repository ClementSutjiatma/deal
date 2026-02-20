import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { streamDealChat } from "@/lib/ai/agent";
import type { DealContext } from "@/lib/ai/agent";
import { CHAT_MODES } from "@/lib/constants";
import { convertToModelMessages, type UIMessage } from "ai";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dealId } = await params;
  const supabase = createServiceClient();

  // Try to authenticate — anonymous buyers won't have a token
  const auth = await authenticateRequest(request);
  const senderId = auth?.user.id ?? null;

  // Read conversation_id and anonymous_id from headers (body merge is broken in DefaultChatTransport)
  const conversationId = request.headers.get("x-conversation-id") || null;
  const anonymousId = request.headers.get("x-anonymous-id") || null;

  // Parse body — AI SDK sends { messages: UIMessage[], ... }
  const body = await request.json();
  const uiMessages: UIMessage[] = body.messages;

  if (!uiMessages || uiMessages.length === 0) {
    return new Response(
      JSON.stringify({ error: "Missing messages" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Extract the latest user message text
  const lastUserMsg = [...uiMessages].reverse().find((m) => m.role === "user");
  const userContent = lastUserMsg
    ? lastUserMsg.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
    : "";

  // Fetch deal
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", dealId)
    .single() as { data: any };

  if (!deal) {
    return new Response(
      JSON.stringify({ error: "Deal not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Determine role
  let role: "seller" | "buyer";
  if (senderId) {
    const isSeller = senderId === deal.seller_id;
    const isBuyer = senderId === deal.buyer_id;
    if (!isSeller && !isBuyer && deal.status !== "OPEN") {
      return new Response(
        JSON.stringify({ error: "Not a party to this deal" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    role = isSeller ? "seller" : "buyer";
  } else if (anonymousId && deal.status === "OPEN") {
    role = "buyer";
  } else {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Resolve conversation_id
  let resolvedConversationId: string | null = conversationId;

  if (!resolvedConversationId && role === "buyer" && senderId) {
    const { data: existing } = await (supabase
      .from("conversations") as any)
      .select("id")
      .eq("deal_id", dealId)
      .eq("buyer_id", senderId)
      .single() as { data: any };

    if (existing) {
      resolvedConversationId = existing.id;
    } else {
      const { data: created, error: createErr } = await (supabase
        .from("conversations") as any)
        .insert({ deal_id: dealId, buyer_id: senderId })
        .select("id")
        .single() as { data: any; error: any };

      if (createErr && createErr.code === "23505") {
        const { data: retry } = await (supabase
          .from("conversations") as any)
          .select("id")
          .eq("deal_id", dealId)
          .eq("buyer_id", senderId)
          .single() as { data: any };
        resolvedConversationId = retry?.id || null;
      } else if (created) {
        resolvedConversationId = created.id;
      }
    }
  } else if (!resolvedConversationId && role === "buyer" && !senderId && anonymousId) {
    const { data: existing } = await (supabase
      .from("conversations") as any)
      .select("id")
      .eq("deal_id", dealId)
      .eq("anonymous_id", anonymousId)
      .single() as { data: any };

    if (existing) {
      resolvedConversationId = existing.id;
    } else {
      const { data: created, error: createErr } = await (supabase
        .from("conversations") as any)
        .insert({ deal_id: dealId, anonymous_id: anonymousId })
        .select("id")
        .single() as { data: any; error: any };

      if (createErr && createErr.code === "23505") {
        const { data: retry } = await (supabase
          .from("conversations") as any)
          .select("id")
          .eq("deal_id", dealId)
          .eq("anonymous_id", anonymousId)
          .single() as { data: any };
        resolvedConversationId = retry?.id || null;
      } else if (created) {
        resolvedConversationId = created.id;
      }
    }
  }

  // Determine visibility
  let visibility = "all";
  if (deal.chat_mode === CHAT_MODES.DISPUTE) {
    visibility = role === "seller" ? "seller_only" : "buyer_only";
  }

  // Insert user message into Supabase
  await (supabase
    .from("messages") as any)
    .insert({
      deal_id: dealId,
      sender_id: senderId || null,
      conversation_id: resolvedConversationId,
      role,
      content: userContent || "[message]",
      visibility,
    });

  // Fetch context for AI (from Supabase, not from UIMessages — Supabase is source of truth)
  const { data: seller } = await (supabase
    .from("users") as any)
    .select("*")
    .eq("id", deal.seller_id)
    .single() as { data: any };

  let buyer = null;
  if (deal.buyer_id) {
    buyer = (await (supabase.from("users") as any).select("*").eq("id", deal.buyer_id).single() as { data: any }).data;
  } else if (role === "buyer" && senderId) {
    buyer = (await (supabase.from("users") as any).select("*").eq("id", senderId).single() as { data: any }).data;
  }

  let conversation = null;
  if (resolvedConversationId) {
    const { data: conv } = await (supabase
      .from("conversations") as any)
      .select("*")
      .eq("id", resolvedConversationId)
      .single() as { data: any };
    conversation = conv;
  }

  // Fetch recent messages from Supabase (source of truth for full history)
  let messagesQuery = (supabase
    .from("messages") as any)
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true })
    .limit(50);

  if (resolvedConversationId) {
    messagesQuery = messagesQuery.eq("conversation_id", resolvedConversationId);
  }

  const { data: recentMessages } = await messagesQuery as { data: any };

  const context: DealContext = {
    deal: deal as any,
    seller: seller as any,
    buyer: buyer as any,
    recentMessages: (recentMessages || []) as any,
    senderRole: role,
    conversation: conversation as any,
  };

  // Stream AI response with tools
  const result = streamDealChat(context, async ({ text }) => {
    // onFinish: persist AI message and handle commands

    // Extract command from text
    const commandMatch = text.match(/<command>(.*?)<\/command>/);
    const command = commandMatch ? commandMatch[1] : null;

    // Clean content for storage
    const cleanContent = text
      .replace(/<command>.*?<\/command>/g, "")
      .trim();

    // Determine deposit amount from command
    let depositRequestCents: number | null = null;
    if (command?.startsWith("PRICE_ACCEPTED:")) {
      const cents = parseInt(command.split(":")[1], 10);
      if (!isNaN(cents)) depositRequestCents = cents;
    }

    // Handle PRICE_ACCEPTED — update deal terms
    if (command?.startsWith("PRICE_ACCEPTED:") && depositRequestCents) {
      const existingTerms = (deal.terms as Record<string, unknown>) || {};
      await (supabase
        .from("deals") as any)
        .update({
          terms: { ...existingTerms, buyer_offer_accepted: true, buyer_offer_cents: depositRequestCents },
        })
        .eq("id", dealId);
    }

    // Only insert AI message if there's actual content or a deposit request.
    // Tool-only responses produce empty text —
    // storing these as empty messages breaks the conversation history.
    // But we do want to store a placeholder if a meaningful tool was called.
    const hasContent = !!cleanContent || !!depositRequestCents;
    if (hasContent) {
      await (supabase
        .from("messages") as any)
        .insert({
          deal_id: dealId,
          sender_id: null,
          conversation_id: resolvedConversationId,
          role: "ai",
          content: cleanContent || `Deposit requested: $${(depositRequestCents! / 100).toFixed(2)}`,
          visibility,
          metadata: depositRequestCents
            ? { deposit_request_cents: depositRequestCents }
            : null,
        });

      // Update conversation metadata
      if (resolvedConversationId) {
        const preview = (cleanContent || `Deposit: $${(depositRequestCents! / 100).toFixed(2)}`).slice(0, 100);
        await (supabase
          .from("conversations") as any)
          .update({
            last_message_preview: preview,
            last_message_at: new Date().toISOString(),
            message_count: (conversation?.message_count || 0) + 2,
            ...(depositRequestCents
              ? { negotiated_price_cents: depositRequestCents }
              : {}),
          })
          .eq("id", resolvedConversationId);
      }
    }
  });

  return result.toUIMessageStreamResponse();
}
