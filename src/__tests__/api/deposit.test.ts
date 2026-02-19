import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeDeal, makeUser, makeRequest } from "../helpers";
import { authenticateRequest } from "@/lib/auth";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { POST } = await import("@/app/api/deals/[id]/deposit/route");

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/deals/[id]/deposit", () => {
  const dealId = "deal-uuid-123";
  const sellerId = "seller-uuid-456";
  const seller = makeUser({
    id: sellerId,
    wallet_address: "0xSellerWallet1234567890abcdef1234567890ab",
  });
  const openDeal = makeDeal({
    id: dealId,
    seller_id: sellerId,
    status: "OPEN",
    price_cents: 20000,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null);

    const req = makeRequest(`/api/deals/${dealId}/deposit`, {
      method: "POST",
    });
    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(401);
  });

  it("returns deposit params for a valid OPEN deal", async () => {
    mockSupabase.setResult("deals", "select", { data: openDeal, error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    const req = makeRequest(`/api/deals/${dealId}/deposit`, {
      method: "POST",
      authToken: "test-token",
    });
    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.deal_id).toBe(dealId);
    expect(json.price_cents).toBe(20000);
    expect(json.price_usdc).toBe("200.00");
    expect(json.deposit_params.escrow_address).toBeDefined();
    expect(json.deposit_params.deal_id_bytes32).toBeDefined();
    expect(json.deposit_params.seller).toBeDefined();
  });

  it("rejects if deal is not OPEN", async () => {
    mockSupabase.setResult("deals", "select", { data: null, error: null });

    const req = makeRequest(`/api/deals/${dealId}/deposit`, {
      method: "POST",
      authToken: "test-token",
    });
    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not available/i);
  });

  it("rejects if buyer is the seller (self-dealing)", async () => {
    // Auth user has id "test-auth-user-id", set deal's seller_id to match
    const selfDeal = makeDeal({
      id: dealId,
      seller_id: "test-auth-user-id",
      status: "OPEN",
      price_cents: 20000,
    });
    mockSupabase.setResult("deals", "select", { data: selfDeal, error: null });

    const req = makeRequest(`/api/deals/${dealId}/deposit`, {
      method: "POST",
      authToken: "test-token",
    });
    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/seller cannot be buyer/i);
  });

  it("rejects if seller wallet is not set up", async () => {
    mockSupabase.setResult("deals", "select", { data: openDeal, error: null });
    mockSupabase.setResult("users", "select", {
      data: { wallet_address: null },
      error: null,
    });

    const req = makeRequest(`/api/deals/${dealId}/deposit`, {
      method: "POST",
      authToken: "test-token",
    });
    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/wallet/i);
  });
});
