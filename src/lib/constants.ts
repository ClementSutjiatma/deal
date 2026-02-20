export const DEAL_STATUSES = {
  OPEN: "OPEN",
  FUNDED: "FUNDED",
  TRANSFERRED: "TRANSFERRED",
  CONFIRMED: "CONFIRMED",
  RELEASED: "RELEASED",
  DISPUTED: "DISPUTED",
  RESOLVED: "RESOLVED",
  REFUNDED: "REFUNDED",
  AUTO_RELEASED: "AUTO_RELEASED",
  AUTO_REFUNDED: "AUTO_REFUNDED",
  EXPIRED: "EXPIRED",
  CANCELED: "CANCELED",
} as const;

export type DealStatus = (typeof DEAL_STATUSES)[keyof typeof DEAL_STATUSES];

export const CHAT_MODES = {
  OPEN: "open",
  ACTIVE: "active",
  DISPUTE: "dispute",
} as const;

export type ChatMode = (typeof CHAT_MODES)[keyof typeof CHAT_MODES];

export const CONVERSATION_STATUSES = {
  ACTIVE: "active",
  CLAIMED: "claimed",
  CLOSED: "closed",
} as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[keyof typeof CONVERSATION_STATUSES];

// Maximum discount the AI can offer (as fraction of original price)
export const MAX_DISCOUNT_FRACTION = 0.2; // 20% max discount

export const MESSAGE_ROLES = {
  SELLER: "seller",
  BUYER: "buyer",
  AI: "ai",
  SYSTEM: "system",
} as const;

export const MESSAGE_VISIBILITY = {
  ALL: "all",
  SELLER_ONLY: "seller_only",
  BUYER_ONLY: "buyer_only",
} as const;

export const TRANSFER_METHODS = [
  "ticketmaster",
  "axs",
  "seatgeek",
  "other",
] as const;

// Timeouts in seconds
export const SELLER_TRANSFER_TIMEOUT = 2 * 60 * 60; // 2 hours
export const BUYER_CONFIRM_TIMEOUT = 4 * 60 * 60; // 4 hours
export const DEAL_EXPIRY_TIMEOUT = 7 * 24 * 60 * 60; // 7 days
export const DISPUTE_RESPONSE_TIMEOUT = 4 * 60 * 60; // 4 hours (legacy, kept for reference)
export const DISPUTE_INACTIVITY_TIMEOUT = 24 * 60 * 60; // 24 hours — safety net for unresponsive parties
export const DISPUTE_MAX_QUESTIONS = 5; // max evidence questions per party
export const DISPUTE_WINDOW_AFTER_CONFIRM = 24 * 60 * 60; // 24 hours

// Base chain
export const BASE_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

// USDC on Base
export const USDC_ADDRESS =
  process.env.NEXT_PUBLIC_USDC_CONTRACT_ADDRESS ||
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;
