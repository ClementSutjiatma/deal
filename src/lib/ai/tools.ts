import { tool } from "ai";
import { z } from "zod";

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
