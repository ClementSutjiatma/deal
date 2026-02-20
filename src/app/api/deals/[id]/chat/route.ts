import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { streamDealChat, adjudicateDispute } from "@/lib/ai/agent";
import { resolveDisputeOnChain } from "@/lib/escrow";
import { notifyDisputeResolved } from "@/lib/twilio";
import type { DealContext } from "@/lib/ai/agent";
import { CHAT_MODES, DEAL_STATUSES, DISPUTE_SAFETY_CAP } from "@/lib/constants";
import type { UIMessage } from "ai";
import type { Message } from "@/lib/types/database";

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

  // Extract the latest user message text and file URLs
  const lastUserMsg = [...uiMessages].reverse().find((m) => m.role === "user");
  const userContent = lastUserMsg
    ? lastUserMsg.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
    : "";
  const fileUrls = lastUserMsg
    ? lastUserMsg.parts
        .filter((p): p is { type: "file"; url: string; mediaType: string } => p.type === "file" && !!(p as any).url)
        .map((p) => p.url)
    : [];

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

    // Reject new messages if this party's evidence collection is complete (done flag or safety cap)
    const isDone = role === "buyer" ? deal.dispute_buyer_done : deal.dispute_seller_done;
    const currentQCount = role === "buyer" ? (deal.dispute_buyer_q || 0) : (deal.dispute_seller_q || 0);
    if (isDone || currentQCount >= DISPUTE_SAFETY_CAP) {
      return new Response(
        JSON.stringify({ error: "Evidence collection complete. Waiting for ruling." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
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
      media_urls: fileUrls.length > 0 ? fileUrls : null,
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
  const result = streamDealChat(context, async ({ text, toolCalls }) => {
    // onFinish: persist AI message and handle commands

    // Extract command from text
    const commandMatch = text.match(/<command>(.*?)<\/command>/);
    const command = commandMatch ? commandMatch[1] : null;

    // Clean content for storage
    const cleanContent = text
      .replace(/<command>.*?<\/command>/g, "")
      .trim();

    // Determine deposit amount from command or tool calls
    let depositRequestCents: number | null = null;
    if (command?.startsWith("PRICE_ACCEPTED:")) {
      const cents = parseInt(command.split(":")[1], 10);
      if (!isNaN(cents)) depositRequestCents = cents;
    }

    // Check tool calls for structured data
    let transferMethodFromTool: string | null = null;
    let receiptMethodFromTool: string | null = null;

    if (toolCalls) {
      for (const tc of toolCalls) {
        if (tc.toolName === "requestDeposit") {
          const input = tc.input as { amount_cents?: number };
          if (input.amount_cents && !depositRequestCents) {
            depositRequestCents = input.amount_cents;
          }
        }
        if (tc.toolName === "confirmTransfer") {
          const input = tc.input as { transfer_method?: string };
          transferMethodFromTool = input.transfer_method || deal.transfer_method || "TBD";
        }
        if (tc.toolName === "confirmReceipt") {
          const input = tc.input as { transfer_method?: string };
          receiptMethodFromTool = input.transfer_method || deal.transfer_method || "TBD";
        }
      }
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

    // Build metadata object with all tool call data
    const metadata: Record<string, unknown> = {};
    if (depositRequestCents) metadata.deposit_request_cents = depositRequestCents;
    if (transferMethodFromTool) metadata.transfer_method = transferMethodFromTool;
    if (receiptMethodFromTool) metadata.receipt_method = receiptMethodFromTool;

    // Only insert AI message if there's actual content or tool calls
    const hasContent = !!cleanContent || !!depositRequestCents || !!transferMethodFromTool || !!receiptMethodFromTool;
    if (hasContent) {
      const contentToStore = cleanContent
        || (depositRequestCents ? `Deposit requested: $${(depositRequestCents / 100).toFixed(2)}` : "")
        || (transferMethodFromTool ? "Transfer confirmation requested" : "")
        || (receiptMethodFromTool ? "Receipt confirmation requested" : "");

      await (supabase
        .from("messages") as any)
        .insert({
          deal_id: dealId,
          sender_id: null,
          conversation_id: resolvedConversationId,
          role: "ai",
          content: contentToStore,
          visibility,
          metadata: Object.keys(metadata).length > 0 ? metadata : null,
        });

      // Update conversation metadata
      if (resolvedConversationId) {
        const preview = (cleanContent || contentToStore).slice(0, 100);
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

    // Dispute mode: track exchange count, handle evidence completion tool, trigger adjudication
    if (deal.chat_mode === CHAT_MODES.DISPUTE) {
      const counterField = role === "buyer" ? "dispute_buyer_q" : "dispute_seller_q";
      const doneField = role === "buyer" ? "dispute_buyer_done" : "dispute_seller_done";
      const currentCount = role === "buyer" ? (deal.dispute_buyer_q || 0) : (deal.dispute_seller_q || 0);
      const newCount = currentCount + 1;

      // Check if the AI called the completeEvidenceCollection tool
      let evidenceComplete = false;
      let evidenceSummary: string | null = null;
      if (toolCalls) {
        for (const tc of toolCalls) {
          if (tc.toolName === "completeEvidenceCollection") {
            evidenceComplete = true;
            evidenceSummary = (tc.input as { summary?: string })?.summary || null;
          }
        }
      }

      // Auto-complete if safety cap reached without tool call
      if (!evidenceComplete && newCount >= DISPUTE_SAFETY_CAP) {
        evidenceComplete = true;
        evidenceSummary = "Evidence collection reached safety limit.";
      }

      // Build update object
      const updateData: Record<string, unknown> = { [counterField]: newCount };
      if (evidenceComplete) {
        updateData[doneField] = true;
        // Store evidence summary in deal terms
        const existingTerms = (deal.terms as Record<string, unknown>) || {};
        const summaryField = role === "buyer" ? "dispute_buyer_summary" : "dispute_seller_summary";
        updateData.terms = { ...existingTerms, [summaryField]: evidenceSummary };
      }

      await (supabase.from("deals") as any)
        .update(updateData)
        .eq("id", dealId);

      // If evidence is complete, insert a system message explaining next steps
      if (evidenceComplete) {
        await (supabase.from("messages") as any).insert({
          deal_id: dealId,
          conversation_id: resolvedConversationId,
          role: "ai",
          content: "Your evidence has been submitted. We're now reviewing both sides and will issue a ruling shortly. You'll be notified of the outcome.",
          visibility,
        });
      }

      // Check if both sides are done — trigger adjudication
      if (evidenceComplete) {
        // Re-fetch deal to get latest state (avoid race condition with other party)
        const { data: freshDeal } = await (supabase.from("deals") as any)
          .select("dispute_buyer_done, dispute_seller_done")
          .eq("id", dealId)
          .single() as { data: any };

        const buyerDone = role === "buyer" ? true : freshDeal?.dispute_buyer_done;
        const sellerDone = role === "seller" ? true : freshDeal?.dispute_seller_done;

        if (buyerDone && sellerDone) {
          // Both sides done — trigger adjudication directly (no HTTP self-call
          // which gets blocked by Vercel deployment protection on previews)
          triggerAdjudication(dealId, resolvedConversationId, supabase).catch(
            (err) => console.error("Adjudication failed:", err)
          );
        }
      }
    }
  });

  return result.toUIMessageStreamResponse();
}

/**
 * Run AI adjudication directly (no HTTP self-call).
 * Factored out of the adjudicate route to avoid Vercel deployment protection
 * blocking server-to-server calls on preview deployments.
 */
async function triggerAdjudication(
  dealId: string,
  conversationId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  // Fetch deal
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", dealId)
    .eq("status", DEAL_STATUSES.DISPUTED)
    .single() as { data: any };

  if (!deal) {
    console.error("Adjudication: deal not found or not disputed", dealId);
    return;
  }

  // Fetch ALL dispute messages (both buyer_only and seller_only)
  const { data: allMessages } = await (supabase
    .from("messages") as any)
    .select("*")
    .eq("deal_id", dealId)
    .in("visibility", ["buyer_only", "seller_only"])
    .order("created_at", { ascending: true }) as { data: Message[] };

  const messages = allMessages || [];
  const buyerMessages = messages.filter((m) => m.visibility === "buyer_only");
  const sellerMessages = messages.filter((m) => m.visibility === "seller_only");

  // Fetch users
  const { data: seller } = await (supabase
    .from("users") as any)
    .select("*")
    .eq("id", deal.seller_id)
    .single() as { data: any };

  let buyer = null;
  if (deal.buyer_id) {
    buyer = (await (supabase.from("users") as any).select("*").eq("id", deal.buyer_id).single() as { data: any }).data;
  }

  // Run AI adjudication
  let ruling;
  try {
    ruling = await adjudicateDispute(deal, seller, buyer, buyerMessages, sellerMessages);
  } catch (err) {
    console.error("AI adjudication failed:", err);
    ruling = {
      ruling: "BUYER" as const,
      reasoning: "Adjudication system error. Defaulting to refund per dispute policy.",
    };
  }

  const favorBuyer = ruling.ruling === "BUYER";

  // Execute on-chain resolution
  let txHash: string | null = null;
  try {
    txHash = await resolveDisputeOnChain(dealId, favorBuyer);
  } catch (err) {
    console.error("On-chain resolve failed:", err);
    // Still insert ruling messages so users see the result
  }

  // Update deal status
  const newStatus = favorBuyer ? DEAL_STATUSES.REFUNDED : DEAL_STATUSES.RELEASED;
  await (supabase.from("deals") as any)
    .update({
      status: newStatus,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", dealId);

  // Log event
  await (supabase.from("deal_events") as any).insert({
    deal_id: dealId,
    event_type: "resolved",
    metadata: {
      favor_buyer: favorBuyer,
      tx_hash: txHash,
      ruling: ruling.reasoning,
      automated: true,
    },
  });

  // Insert ruling messages for both parties
  const rulingMeta = {
    dispute_ruling: ruling.ruling,
    dispute_reasoning: ruling.reasoning,
  };

  await (supabase.from("messages") as any).insert([
    {
      deal_id: dealId,
      conversation_id: conversationId,
      role: "ai",
      content: ruling.reasoning,
      visibility: "buyer_only",
      metadata: rulingMeta,
    },
    {
      deal_id: dealId,
      conversation_id: conversationId,
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

  console.log(`Adjudication complete for deal ${dealId}: ${ruling.ruling}`);
}
