import { NextRequest } from "next/server";
import { getPrivyClient } from "./privy";
import { createServiceClient } from "./supabase/server";
import type { User } from "./types/database";

export interface AuthResult {
  user: User;
  privyUserId: string;
}

/**
 * Verify the Privy JWT from the Authorization header and return the
 * authenticated user from the database.
 *
 * Returns null if the token is missing, invalid, or the user doesn't exist.
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<AuthResult | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  try {
    const verifiedClaims = await getPrivyClient().verifyAuthToken(token);
    const privyUserId = verifiedClaims.userId;

    const supabase = createServiceClient();
    const { data: user } = (await supabase
      .from("users")
      .select("*")
      .eq("privy_user_id", privyUserId)
      .single()) as { data: User | null };

    if (!user) return null;

    return { user, privyUserId };
  } catch {
    return null;
  }
}
