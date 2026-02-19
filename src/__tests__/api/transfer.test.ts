import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeDeal, makeUser, makeRequest } from "../helpers";
import { authenticateRequest } from "@/lib/auth";
import { verifyTxReceipt } from "@/lib/escrow";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { POST } = await import("@/app/api/deals/[id]/transfer/route");

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/deals/[id]/transfer", () => {
  const dealId = "deal-uuid-xfer";
  const buyerId = "buyer-uuid-xfer";
  // The auth mock returns user with id "test-auth-user-id" which acts as seller

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null);

    const req = makeRequest(`/api/deals/${dealId}/transfer`, {
      method: "POST",
      body: { transfer_tx_hash: "0xtx123" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(401);
  });

  it("rejects missing transfer_tx_hash", async () => {
    const req = makeRequest(`/api/deals/${dealId}/transfer`, {
      method: "POST",
      body: {},
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/missing/i);
  });

  it("rejects unconfirmed on-chain transaction", async () => {
    vi.mocked(verifyTxReceipt).mockResolvedValueOnce(false);

    const req = makeRequest(`/api/deals/${dealId}/transfer`, {
      method: "POST",
      body: { transfer_tx_hash: "0xfailedtx" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not confirmed/i);
  });

  it("marks deal as TRANSFERRED when seller calls with FUNDED deal", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: "test-auth-user-id",
      buyer_id: buyerId,
      status: "FUNDED",
      short_code: "xfr12345",
    });
    const buyer = makeUser({ id: buyerId, phone: "+15559997777" });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("users", "select", { data: buyer, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });

    const req = makeRequest(`/api/deals/${dealId}/transfer`, {
      method: "POST",
      body: { transfer_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("rejects if deal is not in FUNDED state", async () => {
    mockSupabase.setResult("deals", "select", { data: null, error: null });

    const req = makeRequest(`/api/deals/${dealId}/transfer`, {
      method: "POST",
      body: { transfer_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(404);
  });

  it("returns 500 if update fails", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: "test-auth-user-id",
      status: "FUNDED",
    });
    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", {
      data: null,
      error: { message: "update failed" },
    });

    const req = makeRequest(`/api/deals/${dealId}/transfer`, {
      method: "POST",
      body: { transfer_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(500);
  });
});
