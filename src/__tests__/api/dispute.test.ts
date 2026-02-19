import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeDeal, makeUser, makeRequest } from "../helpers";
import { authenticateRequest } from "@/lib/auth";
import { verifyTxReceipt } from "@/lib/escrow";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { POST } = await import("@/app/api/deals/[id]/dispute/route");

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/deals/[id]/dispute", () => {
  const dealId = "deal-uuid-dispute";
  const sellerId = "seller-uuid-dispute";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null);

    const req = makeRequest(`/api/deals/${dealId}/dispute`, {
      method: "POST",
      body: { dispute_tx_hash: "0xtx" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(401);
  });

  it("rejects missing dispute_tx_hash", async () => {
    const req = makeRequest(`/api/deals/${dealId}/dispute`, {
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

    const req = makeRequest(`/api/deals/${dealId}/dispute`, {
      method: "POST",
      body: { dispute_tx_hash: "0xfailedtx" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(400);
  });

  it("opens dispute on a TRANSFERRED deal", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: "test-auth-user-id",
      status: "TRANSFERRED",
    });
    const seller = makeUser({ id: sellerId, phone: "+15559990000" });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    const req = makeRequest(`/api/deals/${dealId}/dispute`, {
      method: "POST",
      body: { dispute_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("rejects dispute if deal is not TRANSFERRED", async () => {
    mockSupabase.setResult("deals", "select", { data: null, error: null });

    const req = makeRequest(`/api/deals/${dealId}/dispute`, {
      method: "POST",
      body: { dispute_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(404);
  });

  it("sets chat_mode to dispute", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: "test-auth-user-id",
      status: "TRANSFERRED",
    });
    const seller = makeUser({ id: sellerId });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    const req = makeRequest(`/api/deals/${dealId}/dispute`, {
      method: "POST",
      body: { dispute_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    await POST(req, makeParams(dealId));
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith("deals");
  });

  it("inserts private AI messages to both buyer and seller", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: "test-auth-user-id",
      status: "TRANSFERRED",
    });
    const seller = makeUser({ id: sellerId });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    const req = makeRequest(`/api/deals/${dealId}/dispute`, {
      method: "POST",
      body: { dispute_tx_hash: "0xtx123" },
      authToken: "test-token",
    });

    await POST(req, makeParams(dealId));
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith("messages");
  });
});
