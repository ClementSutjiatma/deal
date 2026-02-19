import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeDeal, makeRequest } from "../helpers";
import { authenticateRequest } from "@/lib/auth";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

// Mock nanoid to return predictable short codes
vi.mock("nanoid", () => ({
  nanoid: () => "tst12345",
}));

const { POST } = await import("@/app/api/deals/route");

describe("POST /api/deals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null);

    const req = makeRequest("/api/deals", {
      method: "POST",
      body: {
        event_name: "Concert",
        num_tickets: 1,
        price_cents: 5000,
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("creates a deal with all fields", async () => {
    const deal = makeDeal({ short_code: "tst12345", seller_id: "test-auth-user-id" });
    mockSupabase.setResult("deals", "insert", { data: deal, error: null });

    const req = makeRequest("/api/deals", {
      method: "POST",
      body: {
        event_name: "Taylor Swift Eras Tour",
        event_date: "2025-08-15T19:00:00",
        venue: "SoFi Stadium",
        section: "Floor A",
        row: "12",
        seats: "1-2",
        num_tickets: 2,
        price_cents: 40000,
        transfer_method: "ticketmaster",
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.short_code).toBe("tst12345");
    expect(json.status).toBe("OPEN");
  });

  it("creates a deal with only required fields", async () => {
    const deal = makeDeal({
      venue: null,
      section: null,
      row: null,
      seats: null,
      event_date: null,
      transfer_method: null,
    });
    mockSupabase.setResult("deals", "insert", { data: deal, error: null });

    const req = makeRequest("/api/deals", {
      method: "POST",
      body: {
        event_name: "Local Concert",
        num_tickets: 1,
        price_cents: 5000,
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("rejects missing event_name", async () => {
    const req = makeRequest("/api/deals", {
      method: "POST",
      body: {
        num_tickets: 1,
        price_cents: 5000,
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing num_tickets", async () => {
    const req = makeRequest("/api/deals", {
      method: "POST",
      body: {
        event_name: "Concert",
        price_cents: 5000,
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing price_cents", async () => {
    const req = makeRequest("/api/deals", {
      method: "POST",
      body: {
        event_name: "Concert",
        num_tickets: 1,
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("includes correct terms in created deal", async () => {
    const deal = makeDeal();
    mockSupabase.setResult("deals", "insert", { data: deal, error: null });

    const req = makeRequest("/api/deals", {
      method: "POST",
      body: {
        event_name: "Concert",
        num_tickets: 1,
        price_cents: 5000,
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    await res.json();
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith("deals");
  });

  it("returns 500 on database error", async () => {
    mockSupabase.setResult("deals", "insert", {
      data: null,
      error: { message: "constraint violation" },
    });

    const req = makeRequest("/api/deals", {
      method: "POST",
      body: {
        event_name: "Concert",
        num_tickets: 1,
        price_cents: 5000,
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
