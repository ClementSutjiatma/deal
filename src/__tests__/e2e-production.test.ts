/**
 * E2E Production Integration Tests
 *
 * These tests call the LIVE production APIs at deal-bay.vercel.app
 * to verify the complete deal workflow end-to-end.
 *
 * Run with: npx vitest run src/__tests__/e2e-production.test.ts
 *
 * NOTE: These tests create real data in the production database.
 * They use a dedicated test buyer account to avoid polluting real user data.
 *
 * TODO: These tests need to be updated to use Privy JWT authentication.
 * All API routes now require Bearer tokens from Privy. To re-enable:
 * 1. Generate a valid Privy auth token for the test buyer
 * 2. Pass `Authorization: Bearer <token>` header to all api() calls
 * 3. Remove seller_id/buyer_id from request bodies (derived from auth)
 * 4. Add escrow_tx_hash / transfer_tx_hash / confirm_tx_hash / dispute_tx_hash
 *    to the relevant request bodies (claim, transfer, confirm, dispute)
 * 5. Use ADMIN_API_KEY header for resolve endpoint
 * 6. Use CRON_SECRET bearer token for cron endpoint
 */
import { describe, it, expect } from "vitest";

describe.skip("E2E Production: Deal Lifecycle", () => {
  it("skipped — requires Privy JWT auth tokens (see TODO above)", () => {
    expect(true).toBe(true);
  });
});

describe.skip("E2E Production: Dispute Flow", () => {
  it("skipped — requires Privy JWT auth tokens (see TODO above)", () => {
    expect(true).toBe(true);
  });
});

describe.skip("E2E Production: Edge Cases", () => {
  it("skipped — requires Privy JWT auth tokens (see TODO above)", () => {
    expect(true).toBe(true);
  });
});
