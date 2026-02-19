import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/deals/{id}/conversations/claim
 * Links an anonymous conversation to an authenticated user.
 * Body: { anonymous_id: string, buyer_id: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dealId } = await params;
  const supabase = createServiceClient();
  const { anonymous_id, buyer_id } = await request.json();

  if (!anonymous_id || !buyer_id) {
    return NextResponse.json(
      { error: "Missing anonymous_id or buyer_id" },
      { status: 400 }
    );
  }

  // Find the anonymous conversation
  const { data: anonConv } = await (supabase
    .from("conversations") as any)
    .select("*")
    .eq("deal_id", dealId)
    .eq("anonymous_id", anonymous_id)
    .single() as { data: any };

  if (!anonConv) {
    return NextResponse.json(
      { error: "Anonymous conversation not found" },
      { status: 404 }
    );
  }

  // Check if buyer already has a conversation for this deal
  const { data: existingConv } = await (supabase
    .from("conversations") as any)
    .select("*")
    .eq("deal_id", dealId)
    .eq("buyer_id", buyer_id)
    .single() as { data: any };

  if (existingConv) {
    // Buyer already has a conversation — merge anonymous messages into it
    await (supabase
      .from("messages") as any)
      .update({ conversation_id: existingConv.id })
      .eq("conversation_id", anonConv.id);

    // Update message count on existing conversation
    await (supabase
      .from("conversations") as any)
      .update({
        message_count: existingConv.message_count + anonConv.message_count,
        last_message_preview:
          anonConv.last_message_at &&
          (!existingConv.last_message_at ||
            anonConv.last_message_at > existingConv.last_message_at)
            ? anonConv.last_message_preview
            : existingConv.last_message_preview,
        last_message_at:
          anonConv.last_message_at &&
          (!existingConv.last_message_at ||
            anonConv.last_message_at > existingConv.last_message_at)
            ? anonConv.last_message_at
            : existingConv.last_message_at,
      })
      .eq("id", existingConv.id);

    // Delete the anonymous conversation
    await (supabase.from("conversations") as any)
      .delete()
      .eq("id", anonConv.id);

    // Return the existing conversation
    const { data: updated } = await (supabase
      .from("conversations") as any)
      .select("*")
      .eq("id", existingConv.id)
      .single() as { data: any };

    return NextResponse.json(updated);
  }

  // No existing conversation — claim the anonymous one
  const { data: claimed, error } = await (supabase
    .from("conversations") as any)
    .update({
      buyer_id,
      anonymous_id: null,
    })
    .eq("id", anonConv.id)
    .select()
    .single() as { data: any; error: any };

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(claimed);
}
