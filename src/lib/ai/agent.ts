import Anthropic from "@anthropic-ai/sdk";
import type { Deal, Message, User } from "@/lib/types/database";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface DealContext {
  deal: Deal;
  seller: User;
  buyer: User | null;
  recentMessages: Message[];
  senderRole: string;
}

function buildDealCreationPrompt(): string {
  return `You are an AI assistant helping a seller create a ticket escrow deal. Your job is to extract structured ticket listing details from the seller's free-text description.

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

Only include the <deal_data> block when ALL fields are confirmed. The system will detect this and create the deal automatically.`;
}

function buildDealChatPrompt(ctx: DealContext): string {
  const { deal, seller, buyer } = ctx;
  const priceDisplay = `$${(deal.price_cents / 100).toFixed(2)}`;

  return `You are an escrow agent for a peer-to-peer ticket sale. You communicate via an in-app chat on the deal page. Your job:
1. Answer buyer questions about the deal (pre-deposit)
2. Manage the transaction flow (guide, nudge, enforce timeouts)
3. If a dispute arises, collect evidence from both parties and adjudicate

Current deal:
- Event: ${deal.event_name}${deal.venue ? ` at ${deal.venue}` : ""}${deal.event_date ? `, ${new Date(deal.event_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}` : ""}
- Tickets: ${deal.num_tickets}x ${[deal.section, deal.row ? `Row ${deal.row}` : null, deal.seats ? `Seats ${deal.seats}` : null].filter(Boolean).join(", ")}
- Price: ${priceDisplay} total
- Transfer method: ${deal.transfer_method || "TBD"}
- Status: ${deal.status}
- Chat mode: ${deal.chat_mode} (open = multi-buyer, active = locked buyer+seller, dispute = private threads)
- Seller: ${seller.name || "Seller"}
- Buyer: ${buyer?.name || "(none yet)"}

Terms agreed:
- Seller transfers within 2 hours of deposit
- Buyer has 4 hours to confirm receipt
- Seller timeout → automatic refund to buyer
- Buyer timeout → automatic release to seller
- Disputes adjudicated by AI based on evidence from both parties
- Event canceled → full refund

Rules for chat:
- When chat_mode is "open": Multiple buyers may be asking questions. Answer factually about the deal. Don't negotiate prices — the price is fixed.
- When chat_mode is "active": Only buyer and seller are in the chat. Guide the transfer process. Be helpful and keep things moving.
- When chat_mode is "dispute": You're collecting evidence privately from each side. Ask structured questions. Request screenshots. Be impartial.

Rules for adjudication:
- Burden of proof is on the seller (they claimed to have specific tickets)
- If evidence is ambiguous or insufficient, default ruling favors buyer (refund)
- Non-responsive party after 4 hours loses the dispute
- Evidence = uploaded screenshots, transfer confirmations, account screenshots
- Your ruling is final per the terms both parties agreed to
- Always explain your reasoning in the ruling

When you need to trigger a state change, output one of these commands at the END of your message:
<command>STATE_TRANSFERRED</command> — when seller confirms transfer in chat
<command>STATE_DISPUTE_RULING:BUYER</command> — ruling favors buyer (refund)
<command>STATE_DISPUTE_RULING:SELLER</command> — ruling favors seller (release)

Keep responses concise. No more than 2-3 short paragraphs. Be friendly but professional.`;
}

export async function getAIResponse(
  context: DealContext
): Promise<{ content: string; command: string | null }> {
  const systemPrompt = buildDealChatPrompt(context);

  const messages: Anthropic.MessageParam[] = context.recentMessages
    .slice(-50)
    .map((msg) => ({
      role: (msg.role === "ai" ? "assistant" : "user") as "user" | "assistant",
      content:
        msg.role === "ai"
          ? msg.content
          : `[${msg.role}${msg.sender_id ? ` - ${msg.role === "seller" ? context.seller.name : context.buyer?.name || "Buyer"}` : ""}]: ${msg.content}`,
    }));

  // Merge consecutive same-role messages
  const mergedMessages: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    if (
      mergedMessages.length > 0 &&
      mergedMessages[mergedMessages.length - 1].role === msg.role
    ) {
      mergedMessages[mergedMessages.length - 1] = {
        ...mergedMessages[mergedMessages.length - 1],
        content:
          mergedMessages[mergedMessages.length - 1].content +
          "\n" +
          msg.content,
      };
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

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: systemPrompt,
    messages: mergedMessages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract command if present
  const commandMatch = text.match(/<command>(.*?)<\/command>/);
  const command = commandMatch ? commandMatch[1] : null;
  const content = text.replace(/<command>.*?<\/command>/g, "").trim();

  return { content, command };
}

export async function getDealCreationResponse(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ content: string; dealData: Record<string, unknown> | null }> {
  const systemPrompt = buildDealCreationPrompt();

  // Ensure first message is from user
  const apiMessages =
    messages.length > 0 && messages[0].role === "user"
      ? messages
      : [{ role: "user" as const, content: "Hi, I want to sell tickets." }, ...messages];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: systemPrompt,
    messages: apiMessages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

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
