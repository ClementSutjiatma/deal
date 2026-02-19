import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeDeal, makeUser, makeRequest } from "../helpers";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { GET } = await import("@/app/api/deals/[id]/route");

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/deals/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches deal by UUID", async () => {
    const deal = makeDeal({
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
    mockSupabase.setResult("deals", "select", {
      data: { ...deal, seller: makeUser() },
      error: null,
    });

    const req = makeRequest("/api/deals/550e8400-e29b-41d4-a716-446655440000");
    const res = await GET(req, makeParams("550e8400-e29b-41d4-a716-446655440000"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("falls back to short_code lookup when UUID not found", async () => {
    const deal = makeDeal({ short_code: "abc12345" });
    // First select (by id) fails
    mockSupabase.setResult("deals", "select", {
      data: { ...deal, seller: makeUser() },
      error: null,
    });

    const req = makeRequest("/api/deals/abc12345");
    const res = await GET(req, makeParams("abc12345"));
    expect(res.status).toBe(200);
  });

  it("returns 404 when deal does not exist", async () => {
    mockSupabase.setResult("deals", "select", { data: null, error: { code: "PGRST116" } });

    const req = makeRequest("/api/deals/nonexistent");
    const res = await GET(req, makeParams("nonexistent"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("includes seller join data", async () => {
    const seller = makeUser({ name: "Alice" });
    const deal = makeDeal({ seller_id: seller.id });
    mockSupabase.setResult("deals", "select", {
      data: { ...deal, seller },
      error: null,
    });

    const req = makeRequest(`/api/deals/${deal.id}`);
    const res = await GET(req, makeParams(deal.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.seller.name).toBe("Alice");
  });
});
