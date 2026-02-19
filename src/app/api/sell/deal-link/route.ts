import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/auth";

/**
 * GET /api/sell/deal-link
 * Returns the most recently created deal link for the authenticated seller.
 * Called by the sell page after streaming finishes and <deal_data> was detected.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: deal } = await (supabase
    .from("deals") as any)
    .select("short_code")
    .eq("seller_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!deal) {
    return NextResponse.json({ deal_link: null });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.json({ deal_link: `${appUrl}/deal/${deal.short_code}` });
}
