import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getDealCreationResponse } from "@/lib/ai/agent";
import { nanoid } from "nanoid";
import { SELLER_TRANSFER_TIMEOUT, BUYER_CONFIRM_TIMEOUT } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const { messages, seller_id } = await request.json();

  if (!messages || !seller_id) {
    return NextResponse.json({ error: "Missing messages or seller_id" }, { status: 400 });
  }

  const aiMessages = messages.map((m: any) => ({
    role: m.role === "user" ? "user" as const : "assistant" as const,
    content: m.content,
  }));

  const { content, dealData } = await getDealCreationResponse(aiMessages);

  let deal_link: string | null = null;

  if (dealData) {
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

    const { data: deal, error } = await (supabase
      .from("deals") as any)
      .insert({
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
      })
      .select()
      .single();

    if (!error && deal) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      deal_link = `${appUrl}/deal/${short_code}`;
    }
  }

  return NextResponse.json({ content, deal_link });
}
