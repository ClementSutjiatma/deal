import { anthropic } from "@ai-sdk/anthropic";
import { generateText, streamText, stepCountIs, type ModelMessage } from "ai";
import type { Deal, Message, User, Conversation } from "@/lib/types/database";
import { dealChatTools } from "./tools";

export interface DealContext {
  deal: Deal;
  seller: User;
  buyer: User | null;
  recentMessages: Message[];
  senderRole: string;
  conversation?: Conversation | null;
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
5. Once ALL required fields are populated, generate a JSON block with the structured data
6. NEVER generate a deal link until all fields are confirmed

EVENT VERIFICATION (IMPORTANT):
- You have access to web search. When a seller mentions an event, artist, or venue, use web search to verify:
  * Is this a real event that exists?
  * Does the date match the actual event schedule?
  * Does the venue match where the event is actually being held?
- If the event details don't match public sources, politely flag this to the seller and ask them to double-check.
- If you find the correct date or venue, suggest the correction. For example: "I searched and it looks like that show is actually on March 15th at Madison Square Garden — want me to use those details?"
- ALWAYS verify before creating the deal. This protects both sellers and buyers from listing errors.
- If you can't verify (e.g. private event, small venue), that's fine — just proceed with what the seller provides.

When all fields are confirmed, output EXACTLY this format at the end of your message:

<deal_data>
{
  "event_name": "...",
  "event_date": "YYYY-MM-DDTHH:mm:ss",
  "venue": "...",
  "num_tickets": 2,
  "section": "...",
  "row": "...",
  "seats": "...",
  "price_cents": 40000,
  "transfer_method": "ticketmaster"
}
</deal_data>

Only include the <deal_data> block when ALL fields are confirmed. The system will detect this and create the deal automatically.

After outputting <deal_data>, continue in the SAME message with a short, friendly confirmation. Tell the seller:
- Their listing has been saved and is live
- They'll be notified as soon as a buyer shows interest or deposits
- Share the link (it'll pop up as a notification on screen) — first person to deposit locks in the deal
- Ask for their email so they can receive buyer notifications and payment confirmations

Keep it warm and brief — like a friend confirming everything's sorted. Don't use bullet points or numbered lists. Example tone: "Your listing is live! I'll notify you the moment a buyer comes through. Share your link to get eyes on it — whoever deposits first locks in the deal. Drop your email so we can send you updates."

After the deal is created, the conversation continues. The seller can still ask questions, provide their email, or create additional deals.`;
}

function buildDealChatPrompt(ctx: DealContext): string {
  const { deal, seller, buyer, conversation } = ctx;
  const priceDisplay = `$${(deal.price_cents / 100).toFixed(2)}`;
  const today = todayFormatted();
  const buyerOfferAccepted = !!(deal.terms as Record<string, unknown> | null)?.buyer_offer_accepted;

  return `You are Dealbay, an escrow agent for a peer-to-peer ticket sale. You communicate via an in-app chat on the deal page. Your job:
1. Negotiate with buyers to find a price that meets the seller's minimum (pre-deposit)
2. Manage the transaction flow (guide, nudge, enforce timeouts)
3. If a dispute arises, collect evidence from both parties and adjudicate

Today's date: ${today}

Current deal:
- Event: ${deal.event_name}${deal.venue ? ` at ${deal.venue}` : ""}${deal.event_date ? `, ${new Date(deal.event_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}` : ""}
- Tickets: ${deal.num_tickets}x ${[deal.section, deal.row ? `Row ${deal.row}` : null, deal.seats ? `Seats ${deal.seats}` : null].filter(Boolean).join(", ")}
- Seller's minimum price (HIDDEN from buyers): ${priceDisplay} total
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

Rules for chat:
- You are chatting with a prospective buyer in their PRIVATE thread. The seller is NOT in this chat — you represent the seller.
- This is a 1-on-1 conversation between you and this buyer. Other buyers have their own separate threads.
- The buyer may be anonymous (not yet logged in). That's fine — answer their questions. They'll be prompted to log in when they want to deposit.
- When chat_mode is "open" and price is NOT yet accepted:
  * NEVER reveal the seller's listed price to buyers. This is critical — the price must stay hidden.
  * Answer factual questions about the deal (event, venue, date, seats, transfer method).
  * Ask the buyer: "How much are you willing to pay for these tickets?" or similar natural phrasing.
  * When a buyer states a price offer:
    - If the offer (in cents) is >= the seller's minimum price (${deal.price_cents} cents / ${priceDisplay}): Accept the offer enthusiastically. Tell them it meets the seller's expectations and they can now proceed to deposit. You MUST do BOTH: (1) Call the requestDeposit tool with { amount_cents: THEIR_OFFER_IN_CENTS }. (2) Output the command: <command>PRICE_ACCEPTED:AMOUNT_CENTS</command> where AMOUNT_CENTS is the buyer's offered amount in cents.
    - If the offer is below the seller's minimum: Say something like "That's below what the seller is looking for" without revealing the actual price. Encourage them to offer more. Be friendly, not pushy.
  * Do NOT say "the price is fixed" or reveal any specific number. Just say offers are below/above the seller's expectations.
- When chat_mode is "open" and price IS already accepted:
  * The buyer has been approved to deposit. Answer any remaining questions. The deposit button is now available to them.
- When chat_mode is "active": Only buyer and seller are in the chat. Guide the transfer process. Be helpful and keep things moving.
- When chat_mode is "dispute": You're collecting evidence privately from each side. Ask structured questions. Request screenshots. Be impartial.

Rules for adjudication (dispute mode only):
- Burden of proof is on the seller (they claimed to have specific tickets)
- If evidence is ambiguous or insufficient, default ruling favors buyer (refund)
- Non-responsive party after 4 hours loses the dispute
- Evidence = uploaded screenshots, transfer confirmations, account screenshots
- Your ruling is final per the terms both parties agreed to
- Always explain your reasoning in the ruling

When you need to trigger a state change, output one of these commands at the END of your message:
<command>PRICE_ACCEPTED:AMOUNT_CENTS</command> — when buyer's offer meets or exceeds seller's minimum (replace AMOUNT_CENTS with actual number, e.g. PRICE_ACCEPTED:15000)
<command>STATE_TRANSFERRED</command> — when seller confirms transfer in chat
<command>STATE_DISPUTE_RULING:BUYER</command> — ruling favors buyer (refund)
<command>STATE_DISPUTE_RULING:SELLER</command> — ruling favors seller (release)

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

      // Include images if present
      const hasImages = msg.media_urls && msg.media_urls.length > 0;

      return {
        role: (msg.role === "ai" ? "assistant" : "user") as
          | "user"
          | "assistant",
        content: hasImages
          ? [
              { type: "text" as const, text: textContent },
              ...msg.media_urls!.map((url) => ({
                type: "image" as const,
                image: new URL(url),
              })),
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

      const lastImages =
        typeof last.content === "string"
          ? []
          : (last.content as Array<{ type: string }>).filter(
              (p) => p.type === "image"
            );
      const msgImages =
        typeof msg.content === "string"
          ? []
          : (msg.content as Array<{ type: string }>).filter(
              (p) => p.type === "image"
            );
      const allImages = [...lastImages, ...msgImages];

      mergedMessages[mergedMessages.length - 1] = {
        role: last.role,
        content:
          allImages.length > 0
            ? [
                { type: "text" as const, text: lastText + "\n" + msgText },
                ...(allImages as Array<{ type: "image"; image: URL }>),
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

export function streamDealChat(
  context: DealContext,
  onFinish?: (event: { text: string }) => void | Promise<void>,
) {
  const systemPrompt = buildDealChatPrompt(context);
  const mergedMessages = buildMergedMessages(context);

  return streamText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    messages: mergedMessages,
    tools: {
      ...dealChatTools,
      web_search: webSearchTool,
    },
    maxOutputTokens: 1024,
    stopWhen: stepCountIs(3),
    onFinish: onFinish
      ? async (event) => {
          await onFinish({ text: event.text });
        }
      : undefined,
  });
}

// ─── Deal chat (non-streaming, legacy) ────────────────────────────────

export async function getAIResponse(
  context: DealContext
): Promise<{ content: string; command: string | null; depositRequestCents: number | null }> {
  const systemPrompt = buildDealChatPrompt(context);
  const mergedMessages = buildMergedMessages(context);

  const result = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    messages: mergedMessages,
    tools: {
      ...dealChatTools,
      web_search: webSearchTool,
    },
    maxOutputTokens: 1024,
    stopWhen: stepCountIs(3),
  });

  const text = result.text;

  // Extract command if present
  const commandMatch = text.match(/<command>(.*?)<\/command>/);
  const command = commandMatch ? commandMatch[1] : null;

  // Extract deposit request from tool calls or XML tag
  let depositRequestCents: number | null = null;
  const depositMatch = text.match(/<deposit_request\s+amount_cents="(\d+)"\s*\/>/);
  if (depositMatch) {
    depositRequestCents = parseInt(depositMatch[1], 10);
  }

  // Also check tool calls for requestDeposit
  for (const step of result.steps) {
    for (const toolCall of step.staticToolCalls) {
      if (toolCall.toolName === "requestDeposit") {
        const input = toolCall.input as { amount_cents?: number };
        if (input.amount_cents) {
          depositRequestCents = input.amount_cents;
        }
      }
    }
  }

  // Backend fallback: derive depositRequestCents from PRICE_ACCEPTED command
  if (!depositRequestCents && command?.startsWith("PRICE_ACCEPTED:")) {
    const cents = parseInt(command.split(":")[1], 10);
    if (!isNaN(cents)) depositRequestCents = cents;
  }

  const content = text
    .replace(/<command>.*?<\/command>/g, "")
    .replace(/<deposit_request\s+amount_cents="\d+"\s*\/>/g, "")
    .trim();

  return { content, command, depositRequestCents };
}

// ─── Sell chat (streaming, returns streamText result) ────────────────

export function streamDealCreation(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  onFinish?: (event: { text: string }) => void | Promise<void>
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
      web_search: webSearchTool,
    },
    stopWhen: stepCountIs(3),
    maxOutputTokens: 1024,
    onFinish: onFinish
      ? async (event) => {
          await onFinish({ text: event.text });
        }
      : undefined,
  });
}

// ─── Legacy non-streaming sell chat (keep for compatibility) ─────────

export async function getDealCreationResponse(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ content: string; dealData: Record<string, unknown> | null }> {
  const systemPrompt = buildDealCreationPrompt();

  const apiMessages = (
    messages.length > 0 && messages[0].role === "user"
      ? messages
      : [
          { role: "user" as const, content: "Hi, I want to sell tickets." },
          ...messages,
        ]
  ) as ModelMessage[];

  const result = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    messages: apiMessages,
    tools: {
      web_search: webSearchTool,
    },
    stopWhen: stepCountIs(3),
    maxOutputTokens: 1024,
  });

  const text = result.text;

  // Extract deal data if present
  const dealDataMatch = text.match(/<deal_data>([\s\S]*?)<\/deal_data>/);
  let dealData: Record<string, unknown> | null = null;
  if (dealDataMatch) {
    try {
      dealData = JSON.parse(dealDataMatch[1]);
    } catch {
      dealData = null;
    }
  }

  const content = text.replace(/<deal_data>[\s\S]*?<\/deal_data>/g, "").trim();

  return { content, dealData };
}
