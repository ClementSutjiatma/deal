import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabase,
  makeDeal,
  makeUser,
  makeMessage,
  makeRequest,
} from "../helpers";
import { getAIResponse } from "@/lib/ai/agent";
import { authenticateRequest } from "@/lib/auth";

const mockSupabase = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mockSupabase.supabase,
}));

const { GET, POST } = await import("@/app/api/deals/[id]/messages/route");

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/deals/[id]/messages", () => {
  const dealId = "deal-uuid-msg";
  const sellerId = "seller-uuid-msg";
  const buyerId = "test-auth-user-id";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all messages for non-dispute deal", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: buyerId,
      chat_mode: "active",
    });
    const messages = [
      makeMessage({ deal_id: dealId, role: "buyer", content: "Hello" }),
      makeMessage({ deal_id: dealId, role: "ai", content: "Hi there" }),
    ];

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("messages", "select", {
      data: messages,
      error: null,
    });

    const req = makeRequest(`/api/deals/${dealId}/messages`, {
      authToken: "test-token",
    });
    const res = await GET(req, makeParams(dealId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
  });

  it("filters messages by visibility in dispute mode (buyer view)", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: buyerId,
      chat_mode: "dispute",
    });
    const messages = [
      makeMessage({
        deal_id: dealId,
        role: "ai",
        visibility: "all",
        content: "Dispute opened",
      }),
      makeMessage({
        deal_id: dealId,
        role: "ai",
        visibility: "buyer_only",
        content: "What's the issue?",
      }),
    ];

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("messages", "select", {
      data: messages,
      error: null,
    });

    const req = makeRequest(`/api/deals/${dealId}/messages`, {
      authToken: "test-token",
    });

    const res = await GET(req, makeParams(dealId));
    expect(res.status).toBe(200);
  });

  it("returns 404 for nonexistent deal", async () => {
    mockSupabase.setResult("deals", "select", { data: null, error: null });

    const req = makeRequest(`/api/deals/${dealId}/messages`);
    const res = await GET(req, makeParams(dealId));
    expect(res.status).toBe(404);
  });

  it("returns all messages when no auth in open mode", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null);

    const deal = makeDeal({
      id: dealId,
      chat_mode: "open",
    });
    const messages = [
      makeMessage({ visibility: "all" }),
    ];

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("messages", "select", { data: messages, error: null });

    const req = makeRequest(`/api/deals/${dealId}/messages`);
    const res = await GET(req, makeParams(dealId));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/deals/[id]/messages", () => {
  const dealId = "deal-uuid-msg-post";
  const sellerId = "seller-uuid-msg-post";
  const buyerId = "test-auth-user-id";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null);

    const req = makeRequest(`/api/deals/${dealId}/messages`, {
      method: "POST",
      body: { content: "Hello" },
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(401);
  });

  it("sends a buyer message and receives AI response", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: buyerId,
      chat_mode: "active",
    });
    const seller = makeUser({ id: sellerId });
    const userMsg = makeMessage({
      deal_id: dealId,
      sender_id: buyerId,
      role: "buyer",
      content: "Are these tickets real?",
    });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("messages", "insert", { data: userMsg, error: null });
    mockSupabase.setResult("messages", "select", { data: [], error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    vi.mocked(getAIResponse).mockResolvedValueOnce({
      content: "These are verified Ticketmaster tickets.",
      command: null,
    });

    const req = makeRequest(`/api/deals/${dealId}/messages`, {
      method: "POST",
      body: { content: "Are these tickets real?" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.userMessage).toBeDefined();
  });

  it("rejects missing content", async () => {
    const req = makeRequest(`/api/deals/${dealId}/messages`, {
      method: "POST",
      body: {},
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/missing/i);
  });

  it("rejects user not party to deal (403)", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: "other-seller",
      buyer_id: "other-buyer",
      chat_mode: "active",
    });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });

    const req = makeRequest(`/api/deals/${dealId}/messages`, {
      method: "POST",
      body: { content: "Hello" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(403);
  });

  it("returns 404 for nonexistent deal", async () => {
    mockSupabase.setResult("deals", "select", { data: null, error: null });

    const req = makeRequest(`/api/deals/${dealId}/messages`, {
      method: "POST",
      body: { content: "Hello" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(404);
  });

  it("handles AI response with command tag", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: buyerId,
      chat_mode: "dispute",
      status: "DISPUTED",
    });
    const seller = makeUser({ id: sellerId });
    const userMsg = makeMessage({ deal_id: dealId });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("messages", "insert", { data: userMsg, error: null });
    mockSupabase.setResult("messages", "select", { data: [], error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    vi.mocked(getAIResponse).mockResolvedValueOnce({
      content: "Based on the evidence, I'm ruling in favor of the buyer.",
      command: "STATE_DISPUTE_RULING:BUYER",
    });

    const req = makeRequest(`/api/deals/${dealId}/messages`, {
      method: "POST",
      body: { content: "Here is my evidence" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.command).toBe("STATE_DISPUTE_RULING:BUYER");
  });

  it("still returns user message if AI response fails", async () => {
    const deal = makeDeal({
      id: dealId,
      seller_id: sellerId,
      buyer_id: buyerId,
    });
    const seller = makeUser({ id: sellerId });
    const userMsg = makeMessage({ deal_id: dealId });

    mockSupabase.setResult("deals", "select", { data: deal, error: null });
    mockSupabase.setResult("messages", "insert", { data: userMsg, error: null });
    mockSupabase.setResult("messages", "select", { data: [], error: null });
    mockSupabase.setResult("users", "select", { data: seller, error: null });

    vi.mocked(getAIResponse).mockRejectedValueOnce(new Error("AI down"));

    const req = makeRequest(`/api/deals/${dealId}/messages`, {
      method: "POST",
      body: { content: "Hello?" },
      authToken: "test-token",
    });

    const res = await POST(req, makeParams(dealId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.userMessage).toBeDefined();
    expect(json.aiMessage).toBeNull();
    expect(json.command).toBeNull();
  });
});
