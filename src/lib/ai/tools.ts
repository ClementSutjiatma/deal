import { tool } from "ai";
import { z } from "zod";

/**
 * AI SDK tool for deal creation.
 *
 * The AI calls this tool when all deal fields are confirmed by the seller.
 * Using a tool (with Zod schema) instead of <deal_data> XML tags ensures
 * structured output with proper type enforcement — especially price_cents.
 */
export const dealCreationTools = {
  createDeal: tool({
    description:
      "Create a new deal listing. Call this ONLY when ALL required fields have been confirmed with the seller. The price_cents field MUST be the total price converted to cents (e.g. $1 = 100 cents, $50 = 5000 cents, $400 = 40000 cents). NEVER pass a dollar amount — always multiply dollars by 100.",
    inputSchema: z.object({
      event_name: z.string().describe("The event/artist/team name"),
      event_date: z
        .string()
        .describe("Event date in ISO format: YYYY-MM-DDTHH:mm:ss"),
      venue: z.string().describe("Venue name and location"),
      num_tickets: z.number().int().positive().describe("Number of tickets"),
      section: z
        .string()
        .nullable()
        .describe("Section number/name, or null if GA"),
      row: z
        .string()
        .nullable()
        .describe("Row number/name, or null if GA/unknown"),
      seats: z
        .string()
        .nullable()
        .describe("Seat numbers, or null if GA/unknown"),
      price_cents: z
        .number()
        .int()
        .positive()
        .min(100, "Minimum price is $1.00 (100 cents)")
        .describe(
          "Total price in CENTS. Convert dollars to cents by multiplying by 100. Examples: $1 = 100, $25 = 2500, $150 = 15000, $400 = 40000. NEVER pass the dollar amount directly."
        ),
      transfer_method: z
        .string()
        .describe(
          "How tickets will be transferred: ticketmaster, axs, seatgeek, or other"
        ),
    }),
    execute: async (input) => {
      // Server-side safety net: if price_cents looks like dollars (< 100), multiply by 100
      let priceCents = input.price_cents;
      if (priceCents > 0 && priceCents < 100) {
        priceCents = priceCents * 100;
      }
      return { ...input, price_cents: priceCents };
    },
  }),
};

/**
 * AI SDK tools for the deal negotiation chat.
 *
 * These tools render inline action buttons in the chat via AI SDK's
 * generative UI (tool-part) system. Each maps to a deal lifecycle action.
 */
export const dealChatTools = {
  requestDeposit: tool({
    description:
      "Request the buyer to deposit funds into escrow. Call this ONLY when the buyer's price offer meets or exceeds the seller's minimum price. This renders a deposit button inline in the chat.",
    inputSchema: z.object({
      amount_cents: z
        .number()
        .describe("The accepted price in cents (e.g. 10000 for $100.00)"),
    }),
    execute: async ({ amount_cents }) => ({ amount_cents }),
  }),

  confirmTransfer: tool({
    description:
      "Prompt the seller to confirm they have transferred the tickets. Call this when the deal is FUNDED and the seller is in the chat. This renders a 'I've transferred the tickets' button inline.",
    inputSchema: z.object({
      transfer_method: z
        .string()
        .describe("The transfer method (e.g. ticketmaster, axs, seatgeek)"),
    }),
    execute: async ({ transfer_method }) => ({ transfer_method }),
  }),

  confirmReceipt: tool({
    description:
      "Prompt the buyer to confirm they received the tickets OR file a dispute. Call this when the deal is TRANSFERRED and the buyer is in the chat. This renders confirm/dispute buttons inline.",
    inputSchema: z.object({
      transfer_method: z
        .string()
        .describe("The transfer method used (e.g. ticketmaster, axs, seatgeek)"),
    }),
    execute: async ({ transfer_method }) => ({ transfer_method }),
  }),
};

/**
 * AI SDK tools for dispute evidence collection.
 *
 * Used during dispute chat to signal when evidence gathering is complete.
 * The AI calls completeEvidenceCollection when it determines it has sufficient
 * evidence from a party, rather than relying on a hard question counter.
 */
export const disputeEvidenceTools = {
  completeEvidenceCollection: tool({
    description:
      "Call when you have gathered sufficient evidence from this party to make a fair ruling. Before calling, ensure you've asked about the core issue, requested screenshot evidence, and followed up on any ambiguities. Do NOT call prematurely — only when you have a clear picture of this party's position.",
    inputSchema: z.object({
      summary: z
        .string()
        .describe("Brief summary of the key evidence collected from this party"),
    }),
    execute: async ({ summary }) => ({ summary }),
  }),
};

/**
 * AI SDK tools for dispute adjudication.
 *
 * Used only in the adjudication route (not during evidence collection).
 * The resolveDispute tool triggers on-chain resolution automatically.
 */
export const disputeTools = {
  resolveDispute: tool({
    description:
      "Issue a final dispute ruling after reviewing evidence from both parties. This triggers automatic on-chain resolution (refund or release). Call this ONLY during adjudication, never during evidence collection.",
    inputSchema: z.object({
      ruling: z
        .enum(["BUYER", "SELLER"])
        .describe("Who wins the dispute — BUYER (refund) or SELLER (release funds)"),
      reasoning: z
        .string()
        .describe("Clear explanation of the ruling citing specific evidence from both parties"),
    }),
    execute: async ({ ruling, reasoning }) => ({ ruling, reasoning }),
  }),
};
