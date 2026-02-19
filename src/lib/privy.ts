import { PrivyClient } from "@privy-io/server-auth";

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
    const authKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
    privyClient = new PrivyClient(appId, appSecret, {
      walletApi: authKey ? { authorizationPrivateKey: authKey } : undefined,
    });
  }
  return privyClient;
}
