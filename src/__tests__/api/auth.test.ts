import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeUser, makeRequest } from "../helpers";

// Mock supabase before importing route
const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { POST } = await import("@/app/api/auth/route");

describe("POST /api/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without authorization header", async () => {
    const req = makeRequest("/api/auth", {
      method: "POST",
      body: { phone: "+15551110000" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects request missing phone", async () => {
    const req = makeRequest("/api/auth", {
      method: "POST",
      body: {},
      authToken: "test-token",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/missing/i);
  });

  it("creates a new user when none exists", async () => {
    const newUser = makeUser({ privy_user_id: "privy_test-user" });
    mockSupabase.setResult("users", "select", { data: null, error: { code: "PGRST116" } });
    mockSupabase.setResult("users", "insert", { data: newUser, error: null });

    const req = makeRequest("/api/auth", {
      method: "POST",
      body: {
        phone: "+15551110000",
        name: "Test User",
        wallet_address: "0xabc",
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(newUser.id);
  });

  it("updates an existing user on re-login", async () => {
    const existing = makeUser({
      privy_user_id: "privy_test-user",
      name: "Old Name",
      wallet_address: "0xold",
    });
    const updated = { ...existing, name: "New Name", wallet_address: "0xnew" };

    mockSupabase.setResult("users", "select", { data: existing, error: null });
    mockSupabase.setResult("users", "update", { data: updated, error: null });

    const req = makeRequest("/api/auth", {
      method: "POST",
      body: {
        phone: "+15551110000",
        name: "New Name",
        wallet_address: "0xnew",
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("New Name");
  });

  it("preserves existing name if new name is not provided", async () => {
    const existing = makeUser({
      privy_user_id: "privy_test-user",
      name: "Kept Name",
    });
    mockSupabase.setResult("users", "select", { data: existing, error: null });
    mockSupabase.setResult("users", "update", { data: existing, error: null });

    const req = makeRequest("/api/auth", {
      method: "POST",
      body: {
        phone: "+15559998888",
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Kept Name");
  });

  it("returns 500 on supabase insert error", async () => {
    mockSupabase.setResult("users", "select", { data: null, error: { code: "PGRST116" } });
    mockSupabase.setResult("users", "insert", {
      data: null,
      error: { message: "duplicate key" },
    });

    const req = makeRequest("/api/auth", {
      method: "POST",
      body: {
        phone: "+15551110000",
      },
      authToken: "test-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("duplicate key");
  });
});
