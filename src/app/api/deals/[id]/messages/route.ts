import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";
import { CHAT_MODES } from "@/lib/constants";

/**
 * GET /api/deals/[id]/messages
 *
 * Fetches messages for a deal, optionally scoped to a conversation.
 * Used by the Chat component to load initial messages on mount.
 * All new messages are sent via the streaming POST /api/deals/[id]/chat route.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  // Optional auth — derive userId from token if present
  const auth = await authenticateRequest(request);
  const userId = auth?.user.id ?? null;

  const conversationId = request.nextUrl.searchParams.get("conversation_id");

  // Fetch deal to determine visibility
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("*")
    .eq("id", id)
    .single() as { data: any };

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  let query = (supabase
    .from("messages") as any)
    .select("*")
    .eq("deal_id", id)
    .order("created_at", { ascending: true });

  // Scope to conversation if provided
  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  // In dispute mode, filter by visibility
  if (deal.chat_mode === CHAT_MODES.DISPUTE && userId) {
    const isSeller = userId === deal.seller_id;
    const visibilities = ["all"];
    visibilities.push(isSeller ? "seller_only" : "buyer_only");
    query = query.in("visibility", visibilities);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
