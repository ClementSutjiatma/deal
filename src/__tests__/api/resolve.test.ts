import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeDeal, makeUser, makeRequest } from "../helpers";
import { resolveDisputeOnChain } from "@/lib/escrow";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { POST } = await import("@/app/api/deals/[id]/resolve/route");

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/deals/[id]/resolve", () => {
  const dealId = "deal-uuid-resolve";
  const sellerId = "seller-uuid-resolve";
  const buyerId = "buyer-uuid-resolve";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without admin API key", async () => {
    const req = makeRequest(`/api/deals/${dealId}/resolve`, {
      method: "POST",
      body: { favor_buyer: true },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong admin API key", async () => {
    const req = makeRequest(`/api/deals/${dealId}/resolve`, {
      method: "POST",
      body: { favor_buyer: true },
      headers: { "x-admin-api-key": "wrong-key" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(401);
  });

  it("resolves dispute in buyer's favor (refund)", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: buyerId,
      status: "DISPUTED",
    });
    const seller = makeUser({ id: sellerId, phone: "+15559990000" });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    const req = makeRequest(`/api/deals/${dealId}/resolve`, {
      method: "POST",
      body: {
        favor_buyer: true,
        ruling_text: "Seller failed to provide transfer evidence.",
      },
      headers: { "x-admin-api-key": "test-admin-api-key" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.tx_hash).toBeDefined();
    expect(resolveDisputeOnChain).toHaveBeenCalledWith(dealId, true);
  });

  it("resolves dispute in seller's favor (release)", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: buyerId,
      status: "DISPUTED",
    });
    const seller = makeUser({ id: sellerId });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    const req = makeRequest(`/api/deals/${dealId}/resolve`, {
      method: "POST",
      body: {
        favor_buyer: false,
        ruling_text: "Seller provided valid transfer confirmation.",
      },
      headers: { "x-admin-api-key": "test-admin-api-key" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    expect(resolveDisputeOnChain).toHaveBeenCalledWith(dealId, false);
  });

  it("rejects resolution on non-DISPUTED deal", async () => {
    mockSupabase.setResult("deals", "select", { data: null, error: null });

    const req = makeRequest(`/api/deals/${dealId}/resolve`, {
      method: "POST",
      body: { favor_buyer: true },
      headers: { "x-admin-api-key": "test-admin-api-key" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not.*disputed/i);
  });

  it("returns 500 when on-chain resolution fails", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: buyerId,
      status: "DISPUTED",
    });
    mockSupabase.setResult("deals", "select", { data: deal, error: null });

    vi.mocked(resolveDisputeOnChain).mockRejectedValueOnce(
      new Error("contract revert")
    );

    const req = makeRequest(`/api/deals/${dealId}/resolve`, {
      method: "POST",
      body: { favor_buyer: true },
      headers: { "x-admin-api-key": "test-admin-api-key" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/on-chain/i);
  });

  it("uses default ruling text when none provided", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: buyerId,
      status: "DISPUTED",
    });
    const seller = makeUser({ id: sellerId });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    const req = makeRequest(`/api/deals/${dealId}/resolve`, {
      method: "POST",
      body: { favor_buyer: false },
      headers: { "x-admin-api-key": "test-admin-api-key" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
  });
});
