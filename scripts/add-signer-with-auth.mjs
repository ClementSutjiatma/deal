#!/usr/bin/env node
/**
 * Add signer using authorization context.
 * The wallet owner check requires proper authorization.
 */
import { readFileSync } from "fs";
import { PrivyClient } from "@privy-io/node";

const KEY_QUORUM_ID = "mtot90ao7hbycjalg7f269it";

const envFile = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1].trim()] = val;
  }
}

const privy = new PrivyClient({
  appId: env.NEXT_PUBLIC_PRIVY_APP_ID,
  appSecret: env.PRIVY_APP_SECRET,
});

const walletId = "fvmgupkmscioedhi7t3j12vh";
const authKey = env.PRIVY_AUTHORIZATION_PRIVATE_KEY;

console.log("Auth key:", authKey ? `SET (${authKey.length} chars)` : "NOT SET");

// Check wallet owner
const wallet = await privy.wallets().get(walletId);
console.log("Wallet owner_id:", wallet.owner_id);
console.log("Wallet additional_signers:", wallet.additional_signers);
console.log("Wallet created_at:", wallet.created_at);

// The two working wallets - let's see what they look like
for (const wid of ["to39rrlcujiwbejsko912erz", "q10n4dy2gkvi08f2qr1nidcl"]) {
  const w = await privy.wallets().get(wid);
  console.log(`\nWallet ${wid}:`);
  console.log("  owner_id:", w.owner_id);
  console.log("  additional_signers:", JSON.stringify(w.additional_signers));
}

// Try _update with authorization header
console.log("\nAttempting _update with privy-authorization-signature...");
try {
  // The SDK _update method takes the authorization key in the request options or as walletApi config
  // Let's try passing it differently
  const updated = await privy.wallets()._update(walletId, {
    additional_signers: [{ signer_id: KEY_QUORUM_ID }],
    'privy-authorization-signature': authKey,
  });
  console.log("✅ Success!", updated.additional_signers);
} catch (e) {
  console.error("❌ Failed:", e.message);

  // Try via the wallets API's addSigners method if it exists
  console.log("\nChecking available methods on privy.wallets()...");
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(privy.wallets()));
  console.log("Methods:", methods.join(", "));
}
