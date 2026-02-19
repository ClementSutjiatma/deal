import { anthropic } from "@ai-sdk/anthropic";
import { generateText, streamText, type ModelMessage } from "ai";
import type { Deal, Message, User } from "@/lib/types/database";

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

Only include the <deal_data> block when ALL fields are confirmed. The system will detect this and create the deal automatically.

After outputting <deal_data>, continue in the SAME message with next steps. Tell the seller:
- Their deal link is being created and will appear on the side of the screen for easy sharing
- Ask them to provide their email address for verification and to receive payment notifications when a buyer deposits
- Remind them to share the deal link — the first person to deposit claims the tickets
- They can keep chatting here if they have any questions

Keep this natural and conversational — like a friend wrapping up. Don't use a numbered list. Example tone: "Your deal is being set up now! One more thing — drop your email so we can verify you and send you a heads up when someone buys. You'll see your share link pop up on the right in a sec."

After the deal is created, the conversation continues. The seller can still ask questions, provide their email, or create additional deals.`;
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

// ─── Deal chat (non-streaming, same interface) ───────────────────────

export async function getAIResponse(
  context: DealContext
): Promise<{ content: string; command: string | null }> {
  const systemPrompt = buildDealChatPrompt(context);

  const messages = context.recentMessages
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
      // Merge text content (keep it simple for merged messages)
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

      // Collect all image parts
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

  const result = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    messages: mergedMessages,
    maxOutputTokens: 1024,
  });

  const text = result.text;

  // Extract command if present
  const commandMatch = text.match(/<command>(.*?)<\/command>/);
  const command = commandMatch ? commandMatch[1] : null;
  const content = text.replace(/<command>.*?<\/command>/g, "").trim();

  return { content, command };
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
