import { describe, it, expect, vi, beforeEach } from "vitest";

// Reset AI mock to test the actual prompt-building logic
vi.unmock("@/lib/ai/agent");

// Mock the anthropic SDK instead
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

import { generateText, streamText } from "ai";
import { makeDeal, makeUser, makeMessage } from "../helpers";

// Import after mocks are set up
const { getAIResponse, streamDealCreation, getDealCreationResponse } =
  await import("@/lib/ai/agent");

describe("getAIResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateText with system prompt containing deal details", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Hello! How can I help?",
    } as any);

    const deal = makeDeal({
      event_name: "Lakers vs Celtics",
      venue: "Crypto.com Arena",
      price_cents: 30000,
      status: "OPEN",
      chat_mode: "open",
    });
    const seller = makeUser({ name: "Alice" });

    await getAIResponse({
      deal,
      seller,
      buyer: null,
      recentMessages: [
        makeMessage({ role: "buyer", content: "How much?" }),
      ],
      senderRole: "buyer",
    });

    expect(generateText).toHaveBeenCalledOnce();
    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.system).toContain("Lakers vs Celtics");
    expect(call.system).toContain("Crypto.com Arena");
    expect(call.system).toContain("$300.00");
    expect(call.system).toContain("Alice");
    expect(call.system).toContain("OPEN");
    expect(call.system).toContain("open");
  });

  it("extracts command from AI response", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Ruling in favor of buyer.\n<command>STATE_DISPUTE_RULING:BUYER</command>",
    } as any);

    const result = await getAIResponse({
      deal: makeDeal({ status: "DISPUTED", chat_mode: "dispute" }),
      seller: makeUser(),
      buyer: makeUser(),
      recentMessages: [],
      senderRole: "buyer",
    });

    expect(result.command).toBe("STATE_DISPUTE_RULING:BUYER");
    expect(result.content).toBe("Ruling in favor of buyer.");
    expect(result.content).not.toContain("<command>");
  });

  it("returns null command when no command tag present", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Just a normal response with no commands.",
    } as any);

    const result = await getAIResponse({
      deal: makeDeal(),
      seller: makeUser(),
      buyer: null,
      recentMessages: [],
      senderRole: "buyer",
    });

    expect(result.command).toBeNull();
    expect(result.content).toBe("Just a normal response with no commands.");
  });

  it("merges consecutive same-role messages", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Got it.",
    } as any);

    const messages = [
      makeMessage({ role: "buyer", content: "Hello" }),
      makeMessage({ role: "buyer", content: "Are these good seats?" }),
      makeMessage({ role: "ai", content: "Yes!" }),
    ];

    await getAIResponse({
      deal: makeDeal(),
      seller: makeUser(),
      buyer: makeUser(),
      recentMessages: messages,
      senderRole: "buyer",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    // After merging, the two consecutive buyer messages become one
    // So we should have 2 messages (1 merged buyer + 1 ai)
    expect(call.messages).toHaveLength(2);
  });

  it("prepends system message if first message is not from user", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Response.",
    } as any);

    const messages = [
      makeMessage({ role: "ai", content: "Welcome to the deal." }),
    ];

    await getAIResponse({
      deal: makeDeal(),
      seller: makeUser(),
      buyer: null,
      recentMessages: messages,
      senderRole: "buyer",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    // Should have prepended a user message
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toContain("Deal chat started");
  });

  it("includes image URLs in multi-modal content", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "I can see the screenshot.",
    } as any);

    const messages = [
      makeMessage({
        role: "buyer",
        content: "See my evidence",
        media_urls: ["https://storage.example.com/evidence.png"],
      }),
    ];

    await getAIResponse({
      deal: makeDeal({ chat_mode: "dispute" }),
      seller: makeUser(),
      buyer: makeUser(),
      recentMessages: messages,
      senderRole: "buyer",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    // The first message should have multimodal content (text + image)
    const firstMsg = call.messages[0];
    expect(Array.isArray(firstMsg.content)).toBe(true);
    const parts = firstMsg.content as Array<{ type: string }>;
    expect(parts.some((p) => p.type === "image")).toBe(true);
    expect(parts.some((p) => p.type === "text")).toBe(true);
  });

  it("handles dispute mode system prompt with adjudication rules", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Please provide evidence.",
    } as any);

    await getAIResponse({
      deal: makeDeal({ status: "DISPUTED", chat_mode: "dispute" }),
      seller: makeUser(),
      buyer: makeUser({ name: "Bob" }),
      recentMessages: [
        makeMessage({ role: "buyer", content: "I didn't get the tickets" }),
      ],
      senderRole: "buyer",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.system).toContain("DISPUTED");
    expect(call.system).toContain("dispute");
    expect(call.system).toContain("Burden of proof");
    expect(call.system).toContain("Bob");
  });

  it("limits messages to last 50", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Response.",
    } as any);

    // Create 60 alternating messages
    const messages = Array.from({ length: 60 }, (_, i) =>
      makeMessage({
        role: i % 2 === 0 ? "buyer" : "ai",
        content: `Message ${i}`,
      })
    );

    await getAIResponse({
      deal: makeDeal(),
      seller: makeUser(),
      buyer: makeUser(),
      recentMessages: messages,
      senderRole: "buyer",
    });

    const call = vi.mocked(generateText).mock.calls[0][0];
    // Should use at most 50 messages (sliced), then merged
    // The exact count depends on merging, but it should be <= 50
    expect(call.messages.length).toBeLessThanOrEqual(50);
  });
});

describe("getDealCreationResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts deal_data JSON from AI response", async () => {
    const dealData = {
      event_name: "Concert",
      event_date: "2025-08-15T19:00:00",
      venue: "Madison Square Garden",
      num_tickets: 2,
      section: "A1",
      row: "5",
      seats: "1-2",
      price_cents: 20000,
      transfer_method: "ticketmaster",
    };
    vi.mocked(generateText).mockResolvedValueOnce({
      text: `Great! Here's your deal:\n<deal_data>${JSON.stringify(dealData)}</deal_data>`,
    } as any);

    const result = await getDealCreationResponse([
      { role: "user", content: "2 tickets to Concert at MSG, section A1 row 5, $200 total via ticketmaster" },
    ]);

    expect(result.dealData).toEqual(dealData);
    expect(result.content).not.toContain("<deal_data>");
    expect(result.content).toContain("Great!");
  });

  it("returns null dealData when no deal_data tag present", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "What venue are the tickets for?",
    } as any);

    const result = await getDealCreationResponse([
      { role: "user", content: "I want to sell 2 concert tickets" },
    ]);

    expect(result.dealData).toBeNull();
    expect(result.content).toBe("What venue are the tickets for?");
  });

  it("handles malformed JSON in deal_data gracefully", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: 'Here it is:\n<deal_data>{bad json}</deal_data>',
    } as any);

    const result = await getDealCreationResponse([
      { role: "user", content: "Sell tickets" },
    ]);

    expect(result.dealData).toBeNull();
  });

  it("prepends default user message if messages start with assistant", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Sure, what event?",
    } as any);

    await getDealCreationResponse([
      { role: "assistant", content: "Hi, how can I help?" },
      { role: "user", content: "Sell my tickets" },
    ]);

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toContain("sell tickets");
  });
});

describe("streamDealCreation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls streamText with deal creation system prompt", () => {
    vi.mocked(streamText).mockReturnValueOnce({} as any);

    streamDealCreation([
      { role: "user", content: "2 Taylor Swift tickets" },
    ]);

    expect(streamText).toHaveBeenCalledOnce();
    const call = vi.mocked(streamText).mock.calls[0][0];
    expect(call.system).toContain("event_name");
    expect(call.system).toContain("price_cents");
    expect(call.system).toContain("<deal_data>");
  });

  it("passes onFinish callback through", () => {
    vi.mocked(streamText).mockReturnValueOnce({} as any);
    const onFinish = vi.fn();

    streamDealCreation(
      [{ role: "user", content: "Sell tickets" }],
      onFinish
    );

    expect(streamText).toHaveBeenCalledOnce();
    const call = vi.mocked(streamText).mock.calls[0][0];
    // The onFinish is wrapped in an async function, so it should exist
    // when a callback is provided
    expect(typeof call.onFinish).toBe("function");
  });

  it("does not set onFinish when no callback provided", () => {
    vi.mocked(streamText).mockReturnValueOnce({} as any);

    streamDealCreation([
      { role: "user", content: "Sell tickets" },
    ]);

    const call = vi.mocked(streamText).mock.calls[0][0];
    expect(call.onFinish).toBeUndefined();
  });
});
