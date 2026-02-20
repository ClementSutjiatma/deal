import { tool } from "ai";
import { z } from "zod";

/**
 * AI SDK tools for the deal negotiation chat.
 *
 * The `requestDeposit` tool is called by the AI when a buyer's price offer
 * meets or exceeds the seller's minimum. It renders an inline deposit button
 * in the chat via the AI SDK's generative UI (tool-part) system.
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
};
