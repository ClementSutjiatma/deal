import { PrivyClient } from "@privy-io/node";
import type { AuthorizationContext } from "@privy-io/node";

let privyClient: PrivyClient | null = null;

export function getPrivyClient(): PrivyClient {
  if (!privyClient) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error(
        "Missing NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_SECRET env vars"
      );
    }
    privyClient = new PrivyClient({ appId, appSecret });
  }
  return privyClient;
}

/**
 * Build an AuthorizationContext using the app-level authorization private key.
 * This authorizes the server to sign transactions on behalf of user wallets.
 */
export function getAuthorizationContext(): AuthorizationContext | undefined {
  const authKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
  if (!authKey) return undefined;
  return { authorization_private_keys: [authKey] };
}
