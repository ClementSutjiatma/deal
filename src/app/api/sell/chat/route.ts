import { streamDealCreation } from "@/lib/ai/agent";
import { createServiceClient } from "@/lib/supabase/server";
import { nanoid } from "nanoid";
import { SELLER_TRANSFER_TIMEOUT, BUYER_CONFIRM_TIMEOUT } from "@/lib/constants";
import { convertToModelMessages, type UIMessage } from "ai";

export async function POST(request: Request) {
  // seller_id from custom header (DefaultChatTransport body merge is unreliable)
  const seller_id = request.headers.get("x-seller-id");

  const body = await request.json();

  // AI SDK v6 DefaultChatTransport sends { messages: UIMessage[], id, trigger, ... }
  const uiMessages: UIMessage[] = body.messages;

  if (!uiMessages || !seller_id) {
    return new Response(
      JSON.stringify({ error: "Missing messages or seller_id" }),
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

  const result = streamDealCreation(simpleMessages, async ({ text }) => {
    // onFinish: create the deal if <deal_data> is present in the final text
    const dealDataMatch = text.match(/<deal_data>([\s\S]*?)<\/deal_data>/);
    if (!dealDataMatch) return;

    let dealData: Record<string, unknown>;
    try {
      dealData = JSON.parse(dealDataMatch[1]);
    } catch {
      return;
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
      price_cents: dealData.price_cents as number,
      transfer_method: (dealData.transfer_method as string) || null,
      terms,
    });
  });

  return result.toUIMessageStreamResponse();
}
