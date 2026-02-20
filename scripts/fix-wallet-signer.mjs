#!/usr/bin/env node
/**
 * Try different approaches to add signer to the csutjiatma wallet.
 */
import { readFileSync } from "fs";
import { PrivyClient } from "@privy-io/node";

const KEY_QUORUM_ID = "mtot90ao7hbycjalg7f269it";
const WALLET_ID = "fvmgupkmscioedhi7t3j12vh";

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

const authKey = env.PRIVY_AUTHORIZATION_PRIVATE_KEY;

// Try with walletApi config
console.log("Attempt 1: PrivyClient with walletApi.authorizationPrivateKey...");
try {
  const privy1 = new PrivyClient({
    appId: env.NEXT_PUBLIC_PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
    walletApi: {
      authorizationPrivateKey: authKey,
    },
  });

  const updated = await privy1.wallets()._update(WALLET_ID, {
    additional_signers: [{ signer_id: KEY_QUORUM_ID }],
  });
  console.log("✅ Success! Signers:", updated.additional_signers);
  process.exit(0);
} catch (e) {
  console.error("❌ Failed:", e.message);
}

// Try public update method
console.log("\nAttempt 2: privy.wallets().update() ...");
try {
  const privy2 = new PrivyClient({
    appId: env.NEXT_PUBLIC_PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
  });

  const updated = await privy2.wallets().update(WALLET_ID, {
    additional_signers: [{ signer_id: KEY_QUORUM_ID }],
    authorization_context: { authorization_private_keys: [authKey] },
  });
  console.log("✅ Success! Signers:", updated.additional_signers);
  process.exit(0);
} catch (e) {
  console.error("❌ Failed:", e.message);
}

// Try changing the owner first, then adding signer
console.log("\nAttempt 3: Set owner to our key quorum, then add signer...");
try {
  const privy3 = new PrivyClient({
    appId: env.NEXT_PUBLIC_PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
  });

  // Try to update without authorization (maybe the current owner is the "app" owner?)
  const updated = await privy3.wallets()._update(WALLET_ID, {
    additional_signers: [{ signer_id: KEY_QUORUM_ID }],
  }, {
    headers: { 'privy-authorization-signature': '' },
  });
  console.log("✅ Success!");
  process.exit(0);
} catch (e) {
  console.error("❌ Failed:", e.message);
}

// Check what methods 'update' expects
console.log("\nAttempt 4: Inspect update method signature...");
try {
  const privy4 = new PrivyClient({
    appId: env.NEXT_PUBLIC_PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
  });

  // Check the update method
  const updateFn = privy4.wallets().update;
  console.log("update.length:", updateFn.length);
  console.log("update.toString() (first 200):", updateFn.toString().substring(0, 200));
} catch (e) {
  console.error("❌ Failed:", e.message);
}
