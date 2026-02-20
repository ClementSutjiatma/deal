import { streamDealCreation } from "@/lib/ai/agent";
import { authenticateRequest } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { nanoid } from "nanoid";
import { SELLER_TRANSFER_TIMEOUT, BUYER_CONFIRM_TIMEOUT } from "@/lib/constants";
import { convertToModelMessages, type UIMessage } from "ai";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const seller_id = auth.user.id;
  const body = await request.json();

  // AI SDK v6 DefaultChatTransport sends { messages: UIMessage[], id, trigger, ... }
  const uiMessages: UIMessage[] = body.messages;

  if (!uiMessages) {
    return new Response(
      JSON.stringify({ error: "Missing messages" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Convert UIMessages (with parts) to simple { role, content } format for our agent
  const modelMessages = await convertToModelMessages(uiMessages);
  const simpleMessages = modelMessages.map((m) => ({
    role: m.role === "user" ? ("user" as const) : ("assistant" as const),
    content:
      typeof m.content === "string"
        ? m.content
        : (m.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join(""),
  }));

  const result = streamDealCreation(simpleMessages, async ({ text, toolCalls }) => {
    // Check for createDeal tool call (structured output via tool)
    const createDealCall = toolCalls?.find((tc) => tc.toolName === "createDeal");

    // Also support legacy <deal_data> XML for backward compatibility
    let dealData: Record<string, unknown> | null = null;

    if (createDealCall) {
      // The tool's execute function already applied the cents safety net
      // Use the output (which has corrected price_cents) if available, otherwise input
      dealData = (createDealCall.output as Record<string, unknown>) || (createDealCall.input as Record<string, unknown>);
    } else {
      // Fallback: parse <deal_data> XML from text
      const dealDataMatch = text.match(/<deal_data>([\s\S]*?)<\/deal_data>/);
      if (dealDataMatch) {
        try {
          dealData = JSON.parse(dealDataMatch[1]);
        } catch {
          // Invalid JSON, skip
        }
      }
    }

    if (!dealData) return;

    // Server-side safety net for price_cents
    let priceCents = dealData.price_cents as number;
    if (priceCents > 0 && priceCents < 100) {
      // Looks like dollars were passed instead of cents — convert
      priceCents = Math.round(priceCents * 100);
    }

    const supabase = createServiceClient();
    const short_code = nanoid(8);
    const terms = {
      transfer_timeout_hours: SELLER_TRANSFER_TIMEOUT / 3600,
      confirm_timeout_hours: BUYER_CONFIRM_TIMEOUT / 3600,
      dispute_adjudication: "AI-based, evidence from both parties",
      seller_timeout_action: "automatic refund to buyer",
      buyer_timeout_action: "automatic release to seller",
      event_canceled: "full refund",
    };

    await (supabase.from("deals") as any).insert({
      short_code,
      seller_id,
      event_name: dealData.event_name as string,
      event_date: (dealData.event_date as string) || null,
      venue: (dealData.venue as string) || null,
      section: (dealData.section as string) || null,
      row: (dealData.row as string) || null,
      seats: (dealData.seats as string) || null,
      num_tickets: dealData.num_tickets as number,
      price_cents: priceCents,
      transfer_method: (dealData.transfer_method as string) || null,
      terms,
    });
  });

  return result.toUIMessageStreamResponse();
}
