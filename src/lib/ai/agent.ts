import { anthropic } from "@ai-sdk/anthropic";
import { streamText, generateText, stepCountIs, type ModelMessage } from "ai";
import type { Deal, Message, User, Conversation } from "@/lib/types/database";
import { dealChatTools, dealCreationTools, disputeTools, disputeEvidenceTools } from "./tools";

export interface DealEvent {
  event_type: string;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface DealContext {
  deal: Deal;
  seller: User;
  buyer: User | null;
  recentMessages: Message[];
  senderRole: string;
  conversation?: Conversation | null;
  dealEvents?: DealEvent[];
}

// Anthropic's provider-defined web search tool
const webSearchTool = anthropic.tools.webSearch_20250305({
  maxUses: 3,
});

function todayFormatted(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function buildDealCreationPrompt(): string {
  const today = todayFormatted();

  return `You are an AI assistant helping a seller create a ticket escrow deal. Your job is to extract structured ticket listing details from the seller's free-text description.

Today's date: ${today}

You communicate in a friendly, concise way — like a helpful friend who knows about tickets.

Your goal: Extract ALL required fields from the seller's description. If any are missing, ask for them naturally in conversation. NEVER show a form.

Required fields:
- event_name: The event/artist/team name
- event_date: Date of the event (be specific — ask if ambiguous)
- venue: Where the event is held
- num_tickets: How many tickets
- section: Section number/name (if assigned seating)
- row: Row (if assigned seating — nudge for this, it prevents disputes)
- seats: Seat numbers (if assigned seating)
- price_cents: Total price in cents (clarify if per-ticket or total)
- transfer_method: How tickets will be transferred (ticketmaster, axs, seatgeek, other)

Rules:
1. Parse the seller's free text to extract as many fields as possible
2. Confirm what you extracted and ask for what's missing
3. Be specific about prices — always clarify if it's per ticket or total
4. Nudge for row and seat numbers — this is the #1 cause of disputes
5. Once ALL required fields are populated, call the createDeal tool
6. NEVER generate a deal link until all fields are confirmed

PRICE HANDLING (CRITICAL):
- Sellers state prices in DOLLARS (e.g. "$1", "$50", "$400")
- The createDeal tool expects price_cents — you MUST convert dollars to cents by multiplying by 100
- Examples: $1 → 100, $2 → 200, $25 → 2500, $50 → 5000, $150 → 15000, $400 → 40000
- ALWAYS confirm the total price with the seller before calling createDeal
- The price_cents field is the TOTAL price for ALL tickets, not per ticket (unless clarified)

EVENT VERIFICATION (IMPORTANT):
- You have access to web search. When a seller mentions an event, artist, or venue, use web search to verify:
  * Is this a real event that exists?
  * Does the date match the actual event schedule?
  * Does the venue match where the event is actually being held?
- If the event details don't match public sources, politely flag this to the seller and ask them to double-check.
- If you find the correct date or venue, suggest the correction. For example: "I searched and it looks like that show is actually on March 15th at Madison Square Garden — want me to use those details?"
- ALWAYS verify before creating the deal. This protects both sellers and buyers from listing errors.
- If you can't verify (e.g. private event, small venue), that's fine — just proceed with what the seller provides.

When all fields are confirmed, call the createDeal tool with the structured data. The tool enforces a schema so the data is always valid.

After calling createDeal, continue in the SAME message with a short, friendly confirmation. Tell the seller:
- Their listing has been saved and is live
- They'll be notified as soon as a buyer shows interest or deposits
- Share the link (it'll pop up as a notification on screen) — first person to deposit locks in the deal
- Ask for their email so they can receive buyer notifications and payment confirmations

Keep it warm and brief — like a friend confirming everything's sorted. Don't use bullet points or numbered lists. Example tone: "Your listing is live! I'll notify you the moment a buyer comes through. Share your link to get eyes on it — whoever deposits first locks in the deal. Drop your email so we can send you updates."

After the deal is created, the conversation continues. The seller can still ask questions, provide their email, or create additional deals.`;
}

function buildDealTimeline(deal: Deal, events: DealEvent[]): string {
  const lines: string[] = [];
  const fmt = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  };

  // Core deal timestamps
  if (deal.created_at) lines.push(`• Deal listed: ${fmt(deal.created_at)}`);
  if (deal.funded_at) lines.push(`• Buyer deposited into escrow: ${fmt(deal.funded_at)}`);
  if (deal.transferred_at) lines.push(`• Seller marked tickets as transferred: ${fmt(deal.transferred_at)}`);
  if (deal.confirmed_at) lines.push(`• Buyer confirmed receipt: ${fmt(deal.confirmed_at)}`);
  if (deal.disputed_at) lines.push(`• Dispute filed by buyer: ${fmt(deal.disputed_at)}`);
  if (deal.resolved_at) lines.push(`• Dispute resolved: ${fmt(deal.resolved_at)}`);

  // Add events with metadata for extra context
  for (const evt of events) {
    const ts = fmt(evt.created_at);
    switch (evt.event_type) {
      case "funded":
        // Already covered by deal.funded_at
        break;
      case "transferred":
        // Already covered by deal.transferred_at
        break;
      case "disputed":
        // Already covered by deal.disputed_at
        break;
      case "claimed":
        lines.push(`• Deal claimed by buyer: ${ts}`);
        break;
      default:
        lines.push(`• ${evt.event_type}: ${ts}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "(No timeline data available)";
}

function buildDealChatPrompt(ctx: DealContext): string {
  const { deal, seller, buyer, conversation } = ctx;
  const priceDisplay = `$${(deal.price_cents / 100).toFixed(2)}`;
  const today = todayFormatted();
  const buyerOfferAccepted = !!(deal.terms as Record<string, unknown> | null)?.buyer_offer_accepted;

  return `You are Dealbay, an escrow agent for a peer-to-peer ticket sale. You communicate via an in-app chat on the deal page. Your job:
1. Accept or reject buyer price offers based STRICTLY on the seller's minimum price below
2. Manage the transaction flow (guide, nudge, enforce timeouts)
3. If a dispute arises, collect evidence from both parties and adjudicate

Today's date: ${today}

Current deal:
- Event: ${deal.event_name}${deal.venue ? ` at ${deal.venue}` : ""}${deal.event_date ? `, ${new Date(deal.event_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}` : ""}
- Tickets: ${deal.num_tickets}x ${[deal.section, deal.row ? `Row ${deal.row}` : null, deal.seats ? `Seats ${deal.seats}` : null].filter(Boolean).join(", ")}
- Seller's minimum price (HIDDEN from buyers): ${priceDisplay} total (${deal.price_cents} cents)
- Transfer method: ${deal.transfer_method || "TBD"}
- Status: ${deal.status}
- Seller: ${seller.name || "Seller"}
- Buyer: ${buyer?.name || "(prospective)"}
- Price accepted: ${buyerOfferAccepted ? "YES" : "NO"}${conversation?.negotiated_price_cents ? `\n- Previously negotiated price: $${(conversation.negotiated_price_cents / 100).toFixed(2)}` : ""}

Terms agreed:
- Seller transfers within 2 hours of deposit
- Buyer has 4 hours to confirm receipt
- Seller timeout → automatic refund to buyer
- Buyer timeout → automatic release to seller
- Disputes adjudicated by Dealbay based on evidence from both parties
- Event canceled → full refund

EVENT VERIFICATION:
- You have access to web search. If a buyer asks about event details (date, venue, artist lineup, etc.) and you're not certain, search to confirm.
- If you find that the event has been canceled, rescheduled, or the details differ from what's listed, proactively inform the buyer.
- During disputes, you can search for event cancellation notices, venue policies, or other relevant information.

PRICE NEGOTIATION — STRICT RULES (YOU MUST FOLLOW THESE EXACTLY):
- The seller set their minimum price to ${priceDisplay} (${deal.price_cents} cents). This is the ONLY price that matters.
- You MUST accept ANY offer that is >= ${deal.price_cents} cents. No exceptions.
- You MUST reject ANY offer that is < ${deal.price_cents} cents. No exceptions.
- Do NOT use your own judgment about whether a price seems "too low" or "unreasonable" for the event. The seller chose this price — respect it.
- Even if the price seems very low for the event type, the seller may have their own reasons. Your job is to enforce THEIR price, not market prices.
- NEVER override the seller's minimum with your own opinion about what tickets "should" cost.

Rules for chat:
- You are chatting with a prospective buyer in their PRIVATE thread. The seller is NOT in this chat — you represent the seller.
- This is a 1-on-1 conversation between you and this buyer. Other buyers have their own separate threads.
- The buyer may be anonymous (not yet logged in). That's fine — answer their questions. They'll be prompted to log in when they want to deposit.
- When chat_mode is "open" and price is NOT yet accepted:
  * NEVER reveal the seller's listed price to buyers. This is critical — the price must stay hidden.
  * Answer factual questions about the deal (event, venue, date, seats, transfer method).
  * Ask the buyer: "How much are you willing to pay for these tickets?" or similar natural phrasing.
  * When a buyer states a price offer:
    - Convert their offer to cents (e.g. "$2" = 200 cents, "$50" = 5000 cents)
    - If the offer in cents >= ${deal.price_cents} cents: ACCEPT immediately. Do not question why they're offering this amount. Tell them it meets the seller's expectations and they can now proceed to deposit. You MUST do BOTH: (1) Call the requestDeposit tool with { amount_cents: THEIR_OFFER_IN_CENTS }. (2) Output the command: <command>PRICE_ACCEPTED:AMOUNT_CENTS</command> where AMOUNT_CENTS is the buyer's offered amount in cents.
    - If the offer in cents < ${deal.price_cents} cents: Say something like "That's below what the seller is looking for" without revealing the actual price. Encourage them to offer more. Be friendly, not pushy.
  * Do NOT say "the price is fixed" or reveal any specific number. Just say offers are below/above the seller's expectations.
- When chat_mode is "open" and price IS already accepted:
  * The buyer has been approved to deposit. Answer any remaining questions. The deposit button is now available to them.
  * If the buyer asks to deposit or seems ready, call the requestDeposit tool again with the accepted price. Always call the tool — don't just tell them to click a button.
- When chat_mode is "active" (deal is FUNDED — money is in escrow):
  * Both buyer and seller can now see this chat.
  * If the current message is from the SELLER: Greet them, remind them to transfer the tickets via ${deal.transfer_method || "the agreed method"} within 2 hours, and call the confirmTransfer tool with { transfer_method: "${deal.transfer_method || "TBD"}" }. This renders an inline "I've transferred the tickets" button for the seller.
  * If the current message is from the BUYER: Let them know the seller has been notified and should transfer soon. Be reassuring.
  * ALWAYS call the confirmTransfer tool when the seller first messages in active mode. Don't just tell them to click a button — the tool renders the button.
- When chat_mode is "active" and deal status is "TRANSFERRED":
  * The seller has marked the tickets as transferred.
  * If the current message is from the BUYER: Ask them to check their ${deal.transfer_method || "transfer method"} account for the tickets. Call the confirmReceipt tool with { transfer_method: "${deal.transfer_method || "TBD"}" }. This renders confirm/dispute buttons for the buyer.
  * If the current message is from the SELLER: Let them know the buyer has been notified to confirm receipt.
  * ALWAYS call the confirmReceipt tool when the buyer first messages after transfer. Don't just tell them to click a button — the tool renders the button.
- When chat_mode is "dispute": You're collecting evidence privately from ONE party at a time. See DISPUTE MODE below.

DISPUTE MODE — EVIDENCE COLLECTION:
You are collecting evidence from the **${ctx.senderRole}**. This is a PRIVATE conversation — the other party CANNOT see these messages.

Exchanges so far: ${ctx.senderRole === "buyer" ? ctx.deal.dispute_buyer_q : ctx.deal.dispute_seller_q}

DEAL TIMELINE (system data — you already know this, do NOT ask the user about these events):
${buildDealTimeline(deal, ctx.dealEvents || [])}

IMPORTANT: You have full visibility into the deal lifecycle above. Do NOT ask the ${ctx.senderRole} questions about events that are already recorded in the system (e.g. "did you transfer?", "has the buyer accepted?", "when was the transfer?"). Instead, use this data to guide your questions and focus on what you DON'T know — like whether tickets actually work, screenshots of issues, etc.

Your job is to ask structured questions to understand the ${ctx.senderRole === "buyer" ? "issue" : "seller's side"}:
1. Ask what happened / what evidence they have
2. Request screenshot evidence (transfer confirmation, ticket details, etc.)
3. Follow up on ambiguities or inconsistencies in their answers
4. When you have a clear, complete picture of their position, call the completeEvidenceCollection tool

Rules:
- Ask ONE question at a time. Wait for the answer before asking the next.
- Do NOT issue a ruling — you only see one side. Adjudication happens separately with ALL evidence.
- Do NOT call the resolveDispute tool — that's only for adjudication.
- Use your judgment on when enough evidence has been collected. Simple cases may need 2-3 exchanges. Complex cases may need more.
- Clarification exchanges (e.g. "what do you mean?") are normal conversation — they don't waste any limit.
- When you have sufficient evidence, call the completeEvidenceCollection tool with a brief summary of the key evidence.
- After calling the tool, tell the user: "Your evidence has been submitted. We're now reviewing both sides and will issue a ruling shortly. You'll be notified of the outcome."
- Be impartial and professional. Don't reveal the other party's claims.
- Encourage uploading screenshots — they carry more weight than text claims.
- There is a safety limit of 20 exchanges. If you reach it without calling the tool, evidence collection will close automatically.

When you need to trigger a state change, output one of these commands at the END of your message:
<command>PRICE_ACCEPTED:AMOUNT_CENTS</command> — when buyer's offer meets or exceeds seller's minimum (replace AMOUNT_CENTS with actual number, e.g. PRICE_ACCEPTED:15000)
<command>STATE_TRANSFERRED</command> — when seller confirms transfer in chat

Keep responses concise. No more than 2-3 short paragraphs. Be friendly but professional.`;
}

// ─── Shared message building ──────────────────────────────────────────

function buildMergedMessages(context: DealContext): ModelMessage[] {
  const messages = context.recentMessages
    .filter((msg) => {
      // Skip empty AI messages (from tool-only responses that were incorrectly stored)
      if (msg.role === "ai" && (!msg.content || msg.content.trim() === "")) return false;
      return true;
    })
    .slice(-50)
    .map((msg) => {
      const roleLabel = msg.role === "ai" ? undefined : msg.role;
      const senderName =
        msg.role === "seller"
          ? context.seller.name
          : msg.role === "buyer"
            ? context.buyer?.name || "Buyer"
            : undefined;

      const textContent =
        msg.role === "ai"
          ? msg.content
          : `[${roleLabel}${senderName ? ` - ${senderName}` : ""}]: ${msg.content}`;

      // Include media attachments if present
      const hasMedia = msg.media_urls && msg.media_urls.length > 0;

      return {
        role: (msg.role === "ai" ? "assistant" : "user") as
          | "user"
          | "assistant",
        content: hasMedia
          ? [
              { type: "text" as const, text: textContent },
              ...msg.media_urls!.map((url) => {
                const isPdf = url.toLowerCase().endsWith(".pdf");
                if (isPdf) {
                  return {
                    type: "file" as const,
                    data: new URL(url),
                    mediaType: "application/pdf" as const,
                  };
                }
                return {
                  type: "image" as const,
                  image: new URL(url),
                };
              }),
            ]
          : textContent,
      };
    }) as ModelMessage[];

  // Merge consecutive same-role messages
  const mergedMessages: ModelMessage[] = [];
  for (const msg of messages) {
    const last = mergedMessages[mergedMessages.length - 1];
    if (last && last.role === msg.role) {
      const lastText =
        typeof last.content === "string"
          ? last.content
          : last.content
              .filter((p) => p.type === "text")
              .map((p) => (p as { type: "text"; text: string }).text)
              .join("\n");
      const msgText =
        typeof msg.content === "string"
          ? msg.content
          : (msg.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n");

      const lastMedia =
        typeof last.content === "string"
          ? []
          : (last.content as Array<{ type: string }>).filter(
              (p) => p.type === "image" || p.type === "file"
            );
      const msgMedia =
        typeof msg.content === "string"
          ? []
          : (msg.content as Array<{ type: string }>).filter(
              (p) => p.type === "image" || p.type === "file"
            );
      const allMedia = [...lastMedia, ...msgMedia];

      mergedMessages[mergedMessages.length - 1] = {
        role: last.role,
        content:
          allMedia.length > 0
            ? [
                { type: "text" as const, text: lastText + "\n" + msgText },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(allMedia as any[]),
              ]
            : lastText + "\n" + msgText,
      } as ModelMessage;
    } else {
      mergedMessages.push(msg);
    }
  }

  // Ensure first message is from user
  if (mergedMessages.length === 0 || mergedMessages[0].role !== "user") {
    mergedMessages.unshift({
      role: "user",
      content: "[system]: Deal chat started.",
    });
  }

  return mergedMessages;
}

// ─── Deal chat (streaming, with tools) ────────────────────────────────

interface StreamFinishEvent {
  text: string;
  toolCalls?: Array<{ toolName: string; input: unknown }>;
}

export function streamDealChat(
  context: DealContext,
  onFinish?: (event: StreamFinishEvent) => void | Promise<void>,
) {
  const systemPrompt = buildDealChatPrompt(context);
  const mergedMessages = buildMergedMessages(context);

  // In dispute mode, provide evidence collection tool + web_search.
  // Dispute tools (resolveDispute) are only used in the adjudication route.
  const isDispute = context.deal.chat_mode === "dispute";
  const tools = isDispute
    ? { ...disputeEvidenceTools, web_search: webSearchTool }
    : { ...dealChatTools, web_search: webSearchTool };

  return streamText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    messages: mergedMessages,
    tools,
    maxOutputTokens: 1024,
    stopWhen: stepCountIs(3),
    onFinish: onFinish
      ? async (event) => {
          // Collect all tool calls from all steps
          const allToolCalls: Array<{ toolName: string; input: unknown }> = [];
          for (const step of event.steps) {
            for (const tc of step.staticToolCalls) {
              allToolCalls.push({ toolName: tc.toolName, input: tc.input });
            }
          }
          await onFinish({ text: event.text, toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined });
        }
      : undefined,
  });
}

// ─── Sell chat (streaming, returns streamText result) ────────────────

interface DealCreationFinishEvent {
  text: string;
  toolCalls?: Array<{ toolName: string; input: unknown; output: unknown }>;
}

export function streamDealCreation(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  onFinish?: (event: DealCreationFinishEvent) => void | Promise<void>
) {
  const systemPrompt = buildDealCreationPrompt();

  // Ensure first message is from user
  const apiMessages = (
    messages.length > 0 && messages[0].role === "user"
      ? messages
      : [
          { role: "user" as const, content: "Hi, I want to sell tickets." },
          ...messages,
        ]
  ) as ModelMessage[];

  return streamText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    messages: apiMessages,
    tools: {
      ...dealCreationTools,
      web_search: webSearchTool,
    },
    stopWhen: stepCountIs(5),
    maxOutputTokens: 1024,
    onFinish: onFinish
      ? async (event) => {
          // Collect createDeal tool calls from all steps
          const allToolCalls: Array<{ toolName: string; input: unknown; output: unknown }> = [];
          for (const step of event.steps) {
            for (const tc of step.staticToolCalls) {
              allToolCalls.push({
                toolName: tc.toolName,
                input: tc.input,
                output: (tc as unknown as { output: unknown }).output,
              });
            }
          }
          await onFinish({
            text: event.text,
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          });
        }
      : undefined,
  });
}

// ─── Dispute adjudication (non-streaming, one-shot decision) ──────────

export interface AdjudicationResult {
  ruling: "BUYER" | "SELLER";
  reasoning: string;
}

export async function adjudicateDispute(
  deal: Deal,
  seller: User,
  buyer: User | null,
  buyerMessages: Message[],
  sellerMessages: Message[],
  dealEvents?: DealEvent[],
): Promise<AdjudicationResult> {
  const priceDisplay = `$${(deal.price_cents / 100).toFixed(2)}`;
  const today = todayFormatted();

  const buyerEvidence = buyerMessages
    .map((m) => `[${m.role === "ai" ? "Dealbay" : "Buyer"}]: ${m.content}`)
    .join("\n");

  const sellerEvidence = sellerMessages
    .map((m) => `[${m.role === "ai" ? "Dealbay" : "Seller"}]: ${m.content}`)
    .join("\n");

  const systemPrompt = `You are adjudicating a ticket sale dispute on Dealbay. Review the evidence from both parties and issue a ruling by calling the resolveDispute tool.

Today's date: ${today}

DEAL CONTEXT:
- Event: ${deal.event_name}${deal.venue ? ` at ${deal.venue}` : ""}${deal.event_date ? `, ${new Date(deal.event_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}` : ""}
- Tickets: ${deal.num_tickets}x ${[deal.section, deal.row ? `Row ${deal.row}` : null, deal.seats ? `Seats ${deal.seats}` : null].filter(Boolean).join(", ")}
- Price: ${priceDisplay}
- Transfer method: ${deal.transfer_method || "unknown"}
- Seller: ${seller.name || "Seller"}
- Buyer: ${buyer?.name || "Buyer"}
- Dispute filed: ${deal.disputed_at || "unknown"}

DEAL TIMELINE:
${buildDealTimeline(deal, dealEvents || [])}

RULES:
- Burden of proof is on the seller (they claimed to have specific tickets and transfer them)
- Screenshot evidence carries more weight than text claims
- If evidence is ambiguous or insufficient, default ruling favors buyer (refund)
- If the seller provided no evidence or didn't respond, rule for buyer
- If the buyer's complaint is clearly baseless (e.g. tickets were received and confirmed working), rule for seller
- Your ruling is FINAL — explain your reasoning clearly

You MUST call the resolveDispute tool with your ruling and reasoning. Do not just write text.`;

  const userMessage = `BUYER'S EVIDENCE (${buyerMessages.filter((m) => m.role !== "ai").length} responses):
${buyerEvidence || "(Buyer provided no evidence)"}

---

SELLER'S EVIDENCE (${sellerMessages.filter((m) => m.role !== "ai").length} responses):
${sellerEvidence || "(Seller provided no evidence)"}

---

Please review the evidence and call the resolveDispute tool with your ruling.`;

  const result = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: disputeTools,
    maxOutputTokens: 1024,
  });

  // Extract the resolveDispute tool call
  for (const step of result.steps) {
    for (const tc of step.staticToolCalls) {
      if (tc.toolName === "resolveDispute") {
        const input = tc.input as { ruling: "BUYER" | "SELLER"; reasoning: string };
        return input;
      }
    }
  }

  // Fallback: if no tool call was made, default to buyer (refund)
  return {
    ruling: "BUYER",
    reasoning: result.text || "Unable to reach a determination. Defaulting to refund per dispute policy.",
  };
}
