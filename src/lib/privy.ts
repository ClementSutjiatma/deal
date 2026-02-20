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

/**
 * Look up a user's embedded Ethereum wallet ID from Privy's server API.
 * This is the wallet_id needed for server-side gas-sponsored transactions.
 * Falls back to checking the user's linked_accounts for an embedded wallet.
 */
export async function getEmbeddedWalletId(privyUserId: string): Promise<string | null> {
  const privy = getPrivyClient();
  try {
    const user = await privy.users()._get(privyUserId);
    // Find the embedded Ethereum wallet in linked_accounts
    const embeddedWallet = user.linked_accounts.find(
      (a: any) => a.type === "wallet" && a.wallet_client_type === "privy" && a.chain_type === "ethereum"
    ) as { id?: string | null } | undefined;
    return embeddedWallet?.id || null;
  } catch (e) {
    console.error("Failed to fetch Privy user for wallet ID:", e);
    return null;
  }
}
