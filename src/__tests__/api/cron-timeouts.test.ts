import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeDeal, makeUser, makeRequest } from "../helpers";
import { triggerRefund, triggerAutoRelease } from "@/lib/escrow";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { GET } = await import("@/app/api/cron/timeouts/route");

function makeCronRequest() {
  return makeRequest("/api/cron/timeouts", {
    authToken: "test-cron-secret",
  });
}

describe("GET /api/cron/timeouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without cron secret", async () => {
    const req = makeRequest("/api/cron/timeouts");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong cron secret", async () => {
    const req = makeRequest("/api/cron/timeouts", {
      authToken: "wrong-secret",
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("auto-refunds FUNDED deals past 2-hour transfer deadline", async () => {
    const threeHoursAgo = new Date(
      Date.now() - 3 * 60 * 60 * 1000
    ).toISOString();
    const deal = makeDeal({
      id: "deal-funded-expired",
      status: "FUNDED",
      funded_at: threeHoursAgo,
      short_code: "fund0001",
      price_cents: 10000,
      buyer_id: "buyer-1",
    });
    const buyer = { phone: "+15551112222" };
    const seller = { phone: "+15553334444" };

    mockSupabase.setResult("deals", "select", {
      data: [{ ...deal, seller, buyer }],
      error: null,
    });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });

    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBeGreaterThanOrEqual(1);
    expect(triggerRefund).toHaveBeenCalledWith("deal-funded-expired");
  });

  it("auto-releases TRANSFERRED deals past 4-hour confirm deadline", async () => {
    const fiveHoursAgo = new Date(
      Date.now() - 5 * 60 * 60 * 1000
    ).toISOString();
    const deal = makeDeal({
      id: "deal-transferred-expired",
      status: "TRANSFERRED",
      transferred_at: fiveHoursAgo,
      short_code: "xfr0001",
      seller_id: "seller-1",
      price_cents: 20000,
    });
    const seller = { phone: "+15553334444" };
    const buyer = { phone: "+15551112222" };

    mockSupabase.setResult("deals", "select", {
      data: [{ ...deal, seller, buyer }],
      error: null,
    });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });

    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
  });

  it("expires OPEN deals older than 7 days", async () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000
    ).toISOString();
    const deal = makeDeal({
      id: "deal-old-open",
      status: "OPEN",
      created_at: eightDaysAgo,
      short_code: "exp0001",
    });

    mockSupabase.setResult("deals", "select", {
      data: [deal],
      error: null,
    });
    mockSupabase.setResult("deals", "update", { data: {}, error: null });
    mockSupabase.setResult("deal_events", "insert", { data: {}, error: null });
    mockSupabase.setResult("messages", "insert", { data: {}, error: null });

    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBeGreaterThanOrEqual(1);
  });

  it("handles empty results (nothing to process)", async () => {
    mockSupabase.setResult("deals", "select", { data: [], error: null });

    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(json.results).toEqual([]);
  });

  it("handles on-chain refund failure gracefully", async () => {
    const deal = makeDeal({
      id: "deal-refund-fail",
      status: "FUNDED",
      short_code: "fail001",
      price_cents: 5000,
    });
    const seller = { phone: "+15553334444" };
    const buyer = { phone: "+15551112222" };

    mockSupabase.setResult("deals", "select", {
      data: [{ ...deal, seller, buyer }],
      error: null,
    });

    vi.mocked(triggerRefund).mockRejectedValueOnce(
      new Error("contract revert: deadline not passed")
    );

    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.some((r: string) => r.includes("Failed"))).toBe(true);
  });

  it("does not touch deals in terminal states", async () => {
    mockSupabase.setResult("deals", "select", { data: [], error: null });

    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    expect(triggerRefund).not.toHaveBeenCalled();
    expect(triggerAutoRelease).not.toHaveBeenCalled();
  });
});
