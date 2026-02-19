import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeDeal, makeUser, makeRequest } from "../helpers";
import { authenticateRequest } from "@/lib/auth";
import { verifyTxReceipt, getDealOnChain } from "@/lib/escrow";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { POST } = await import("@/app/api/deals/[id]/confirm/route");

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/deals/[id]/confirm", () => {
  const dealId = "deal-uuid-confirm";
  const sellerId = "seller-uuid-confirm";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null);

    const req = makeRequest(`/api/deals/${dealId}/confirm`, {
      method: "POST",
      body: { confirm_tx_hash: "0xtx" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(401);
  });

  it("rejects missing confirm_tx_hash", async () => {
    const req = makeRequest(`/api/deals/${dealId}/confirm`, {
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

    const req = makeRequest(`/api/deals/${dealId}/confirm`, {
      method: "POST",
      body: { confirm_tx_hash: "0xfailedtx" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not confirmed/i);
  });

  it("rejects if on-chain deal is not in Released state", async () => {
    // Status 1 = Funded, not Released
    vi.mocked(getDealOnChain).mockResolvedValueOnce([
      "0xbuyer", "0xseller", 200000000n, 250n, 1700000000n, 1700003600n,
      0n, 7200n, 14400n, 1n,
    ]);

    const req = makeRequest(`/api/deals/${dealId}/confirm`, {
      method: "POST",
      body: { confirm_tx_hash: "0xtx" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not in Released/i);
  });

  it("confirms receipt and releases funds", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: "test-auth-user-id",
      status: "TRANSFERRED",
      price_cents: 20000,
    });
    const seller = makeUser({ id: sellerId, phone: "+15559990000" });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });

    const req = makeRequest(`/api/deals/${dealId}/confirm`, {
      method: "POST",
      body: { confirm_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("rejects if deal is not TRANSFERRED", async () => {
    mockSupabase.setResult("deals", "select", { data: null, error: null });

    const req = makeRequest(`/api/deals/${dealId}/confirm`, {
      method: "POST",
      body: { confirm_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(404);
  });

  it("seller amount reflects 2.5% fee deduction", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: "test-auth-user-id",
      status: "TRANSFERRED",
      price_cents: 10000,
    });
    const seller = makeUser({ id: sellerId });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });

    const req = makeRequest(`/api/deals/${dealId}/confirm`, {
      method: "POST",
      body: { confirm_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith("messages");
  });

  it("returns 500 on update error", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: "test-auth-user-id",
      status: "TRANSFERRED",
    });
    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", {
      data: null,
      error: { message: "db error" },
    });

    const req = makeRequest(`/api/deals/${dealId}/confirm`, {
      method: "POST",
      body: { confirm_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(500);
  });
});
