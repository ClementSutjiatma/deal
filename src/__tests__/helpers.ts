import { vi } from "vitest";
import type { Deal, User, Message, DealEvent } from "@/lib/types/database";

// ─── Test data factories ─────────────────────────────────────────────

let counter = 0;
function uuid() {
  return `00000000-0000-0000-0000-${String(++counter).padStart(12, "0")}`;
}

export function resetCounter() {
  counter = 0;
}

export function makeUser(overrides: Partial<User> = {}): User {
  const id = overrides.id || uuid();
  return {
    id,
    phone: "+15551110000",
    email: null,
    name: "Test User",
    wallet_address: "0xSellerWallet1234567890abcdef1234567890ab",
    privy_user_id: `privy_${id}`,
    phone_verified_at: new Date().toISOString(),
    email_verified_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeDeal(overrides: Partial<Deal> = {}): Deal {
  const id = overrides.id || uuid();
  return {
    id,
    short_code: "abc12345",
    status: "OPEN",
    seller_id: "seller-uuid",
    buyer_id: null,
    event_name: "Taylor Swift Eras Tour",
    event_date: "2025-08-15T19:00:00",
    venue: "SoFi Stadium",
    section: "Floor A",
    row: "12",
    seats: "1-2",
    num_tickets: 2,
    price_cents: 40000,
    transfer_method: "ticketmaster",
    terms: {
      transfer_timeout_hours: 2,
      confirm_timeout_hours: 4,
      dispute_adjudication: "AI-based, evidence from both parties",
      seller_timeout_action: "automatic refund to buyer",
      buyer_timeout_action: "automatic release to seller",
      event_canceled: "full refund",
    },
    escrow_tx_hash: null,
    chat_mode: "open",
    locked_at: null,
    funded_at: null,
    transferred_at: null,
    confirmed_at: null,
    disputed_at: null,
    resolved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id || uuid(),
    deal_id: "deal-uuid",
    sender_id: null,
    role: "ai",
    channel: "web",
    visibility: "all",
    content: "Test message",
    media_urls: null,
    metadata: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Supabase mock builder ───────────────────────────────────────────

/**
 * Creates a chainable Supabase mock. Each call to `.from()` returns a fresh
 * query builder. Configure expected results via the `results` map before
 * calling the route handler.
 *
 * Usage:
 *   const { supabase, setResult } = createMockSupabase();
 *   setResult("deals", "select", { data: [makeDeal()], error: null });
 *   setResult("users", "insert", { data: makeUser(), error: null });
 */
export function createMockSupabase() {
  // Store results keyed by "table.operation" or "rpc.functionName"
  const results = new Map<
    string,
    { data: unknown; error: unknown; count?: number }
  >();

  function setResult(
    table: string,
    operation: string,
    result: { data: unknown; error: unknown }
  ) {
    results.set(`${table}.${operation}`, result);
  }

  function getResult(table: string, operation: string) {
    return (
      results.get(`${table}.${operation}`) || { data: null, error: null }
    );
  }

  function makeQueryBuilder(table: string) {
    const builder: Record<string, unknown> = {};

    const chainable = [
      "select",
      "insert",
      "update",
      "delete",
      "eq",
      "neq",
      "in",
      "lt",
      "gt",
      "lte",
      "gte",
      "order",
      "limit",
      "range",
    ] as const;

    // Track the first CRUD operation for result lookup.
    // Once set by insert/update/delete, subsequent .select() (used to return
    // the inserted row) should NOT override it.
    let primaryOp = "select";
    let primaryOpLocked = false;

    for (const method of chainable) {
      builder[method] = vi.fn((..._args: unknown[]) => {
        if (["insert", "update", "delete"].includes(method)) {
          primaryOp = method;
          primaryOpLocked = true;
        } else if (method === "select" && !primaryOpLocked) {
          primaryOp = "select";
        }
        return builder;
      });
    }

    // Terminal methods
    builder.single = vi.fn(() => {
      return Promise.resolve(getResult(table, primaryOp));
    });

    // Make the builder itself thenable (for queries without .single())
    builder.then = (resolve: (value: unknown) => void) => {
      const result = getResult(table, primaryOp);
      return Promise.resolve(result).then(resolve);
    };

    return builder;
  }

  const rpcFn = vi.fn((funcName: string, _args?: unknown) => {
    const result = getResult("rpc", funcName);
    return Promise.resolve(result);
  });

  const supabase = {
    from: vi.fn((table: string) => makeQueryBuilder(table)),
    rpc: rpcFn,
  };

  return { supabase, setResult, getResult };
}

// ─── Request helpers ─────────────────────────────────────────────────

/**
 * Creates a Request with a `nextUrl` property that mimics NextRequest.
 * Next.js route handlers access `request.nextUrl.searchParams` which
 * doesn't exist on the standard Request object.
 */
export function makeRequest(
  url: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    searchParams?: Record<string, string>;
    authToken?: string;
    headers?: Record<string, string>;
  } = {}
) {
  const { method = "GET", body, searchParams, authToken, headers: extraHeaders } = options;
  const urlObj = new URL(url, "http://localhost:3000");
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      urlObj.searchParams.set(key, value);
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  const req = new Request(urlObj.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  // Attach nextUrl to mimic NextRequest
  (req as any).nextUrl = urlObj;
  return req;
}
