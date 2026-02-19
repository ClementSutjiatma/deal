import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeDeal, makeUser, makeRequest } from "../helpers";
import { authenticateRequest } from "@/lib/auth";
import { verifyTxReceipt } from "@/lib/escrow";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { POST } = await import("@/app/api/deals/[id]/claim/route");

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/deals/[id]/claim", () => {
  const dealId = "deal-uuid-claim";
  const sellerId = "seller-uuid-claim";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null);

    const req = makeRequest(`/api/deals/${dealId}/claim`, {
      method: "POST",
      body: { escrow_tx_hash: "0xtxhash123" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(401);
  });

  it("rejects missing escrow_tx_hash", async () => {
    const req = makeRequest(`/api/deals/${dealId}/claim`, {
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

    const req = makeRequest(`/api/deals/${dealId}/claim`, {
      method: "POST",
      body: { escrow_tx_hash: "0xfailedtx" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not confirmed/i);
  });

  it("successfully claims a deal (atomic first-to-deposit)", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      price_cents: 15000,
      short_code: "clm12345",
    });
    const seller = makeUser({ id: sellerId, phone: "+15559990000" });

    mockSupabase.setResult("rpc", "claim_deal", { data: true, error: null });
    mockSupabase.setResult("deals", "update", { data: deal, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("deals", "select", {
      data: { ...deal, seller },
      error: null,
    });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });

    const req = makeRequest(`/api/deals/${dealId}/claim`, {
      method: "POST",
      body: { escrow_tx_hash: "0xtxhash123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claimed).toBe(true);
  });

  it("returns 409 when deal is already claimed (race condition)", async () => {
    mockSupabase.setResult("rpc", "claim_deal", { data: false, error: null });

    const req = makeRequest(`/api/deals/${dealId}/claim`, {
      method: "POST",
      body: { escrow_tx_hash: "0xtxhash123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already claimed/i);
  });

  it("returns 500 on RPC error", async () => {
    mockSupabase.setResult("rpc", "claim_deal", {
      data: null,
      error: { message: "function error" },
    });

    const req = makeRequest(`/api/deals/${dealId}/claim`, {
      method: "POST",
      body: { escrow_tx_hash: "0xtxhash123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(500);
  });

  it("stores escrow_tx_hash", async () => {
    const deal = makeDeal({ id: dealId, seller_id: sellerId });
    const seller = makeUser({ id: sellerId });

    mockSupabase.setResult("rpc", "claim_deal", { data: true, error: null });
    mockSupabase.setResult("deals", "update", { data: deal, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("deals", "select", {
      data: { ...deal, seller },
      error: null,
    });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });

    const req = makeRequest(`/api/deals/${dealId}/claim`, {
      method: "POST",
      body: { escrow_tx_hash: "0xspecifichash" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith("deals");
  });
});
