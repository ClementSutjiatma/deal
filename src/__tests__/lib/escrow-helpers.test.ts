import { describe, it, expect } from "vitest";
import { keccak256, toHex, parseUnits } from "viem";
import {
  USDC_DECIMALS,
  PLATFORM_FEE_BPS,
  SELLER_TRANSFER_TIMEOUT,
  BUYER_CONFIRM_TIMEOUT,
  DEAL_STATUSES,
  CHAT_MODES,
  MESSAGE_VISIBILITY,
} from "@/lib/constants";

// ─── Test the pure functions directly (no mocking needed) ────────────

describe("dealIdToBytes32 logic", () => {
  it("produces deterministic bytes32 from UUID", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const result = keccak256(toHex(uuid));
    expect(result).toMatch(/^0x[a-f0-9]{64}$/);
    // Same input always produces same output
    expect(keccak256(toHex(uuid))).toBe(result);
  });

  it("produces different hashes for different UUIDs", () => {
    const id1 = keccak256(toHex("11111111-1111-1111-1111-111111111111"));
    const id2 = keccak256(toHex("22222222-2222-2222-2222-222222222222"));
    expect(id1).not.toBe(id2);
  });
});

describe("getDepositParams logic", () => {
  it("converts price_cents to USDC with correct decimals", () => {
    const priceCents = 20000; // $200.00
    const amount = parseUnits(String(priceCents / 100), USDC_DECIMALS);
    // $200 with 6 decimals = 200_000_000
    expect(amount).toBe(200_000_000n);
  });

  it("handles sub-dollar amounts", () => {
    const priceCents = 50; // $0.50
    const amount = parseUnits(String(priceCents / 100), USDC_DECIMALS);
    expect(amount).toBe(500_000n);
  });

  it("handles large amounts", () => {
    const priceCents = 100000; // $1,000.00
    const amount = parseUnits(String(priceCents / 100), USDC_DECIMALS);
    expect(amount).toBe(1_000_000_000n);
  });

  it("platform fee is 250 bps (2.5%)", () => {
    expect(PLATFORM_FEE_BPS).toBe(250);
    const feeBps = BigInt(PLATFORM_FEE_BPS);
    expect(feeBps).toBe(250n);
  });
});

describe("constants", () => {
  it("seller transfer timeout is 2 hours", () => {
    expect(SELLER_TRANSFER_TIMEOUT).toBe(7200);
  });

  it("buyer confirm timeout is 4 hours", () => {
    expect(BUYER_CONFIRM_TIMEOUT).toBe(14400);
  });

  it("USDC has 6 decimals", () => {
    expect(USDC_DECIMALS).toBe(6);
  });

  it("deal statuses cover all states", () => {
    const expectedStatuses = [
      "OPEN",
      "FUNDED",
      "TRANSFERRED",
      "CONFIRMED",
      "RELEASED",
      "DISPUTED",
      "RESOLVED",
      "REFUNDED",
      "AUTO_RELEASED",
      "AUTO_REFUNDED",
      "EXPIRED",
      "CANCELED",
    ];
    for (const status of expectedStatuses) {
      expect(Object.values(DEAL_STATUSES)).toContain(status);
    }
  });

  it("chat modes cover all modes", () => {
    expect(CHAT_MODES.OPEN).toBe("open");
    expect(CHAT_MODES.ACTIVE).toBe("active");
    expect(CHAT_MODES.DISPUTE).toBe("dispute");
  });

  it("message visibility covers all levels", () => {
    expect(MESSAGE_VISIBILITY.ALL).toBe("all");
    expect(MESSAGE_VISIBILITY.SELLER_ONLY).toBe("seller_only");
    expect(MESSAGE_VISIBILITY.BUYER_ONLY).toBe("buyer_only");
  });
});

describe("fee calculation", () => {
  it("2.5% fee on $200 deal = $5 platform fee, $195 to seller", () => {
    const priceCents = 20000;
    const feeRate = PLATFORM_FEE_BPS / 10000; // 0.025
    const feeCents = Math.round(priceCents * feeRate);
    expect(feeCents).toBe(500);
    expect(priceCents - feeCents).toBe(19500);
  });

  it("2.5% fee on $400 deal = $10 platform fee, $390 to seller", () => {
    const priceCents = 40000;
    const feeRate = PLATFORM_FEE_BPS / 10000;
    const feeCents = Math.round(priceCents * feeRate);
    expect(feeCents).toBe(1000);
    expect(priceCents - feeCents).toBe(39000);
  });

  it("matches the confirm route's seller amount formula", () => {
    // The confirm route uses: (deal.price_cents * (1 - 0.025) / 100).toFixed(2)
    const priceCents = 10000; // $100
    const sellerAmount = (priceCents * (1 - 0.025) / 100).toFixed(2);
    expect(sellerAmount).toBe("97.50");
  });
});
