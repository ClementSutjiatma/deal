#!/usr/bin/env node
/**
 * Test script to verify the Privy authorization key and wallet ID work together.
 * This simulates what sponsoredSendTransaction does, but just signs a message instead.
 */
import { readFileSync } from "fs";
import { PrivyClient } from "@privy-io/node";

const envFile = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    let val = m[2].trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1].trim()] = val;
  }
}

const appId = env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = env.PRIVY_APP_SECRET;
const authKey = env.PRIVY_AUTHORIZATION_PRIVATE_KEY;

console.log("=== PRIVY WALLET TEST ===\n");
console.log("App ID:", appId ? "SET" : "NOT SET");
console.log("App Secret:", appSecret ? `SET (${appSecret.length} chars)` : "NOT SET");
console.log("Auth Key:", authKey ? `SET (${authKey.substring(0, 20)}... ${authKey.length} chars)` : "NOT SET");

if (!appId || !appSecret) {
  console.error("Missing PRIVY credentials");
  process.exit(1);
}

const privy = new PrivyClient({ appId, appSecret });

// Step 1: Look up the test user
const privyUserId = "did:privy:cmlucmh8c00950cl5nhdqyeby"; // csutjiatma@gmail.com
console.log(`\nLooking up user: ${privyUserId}`);

try {
  const user = await privy.users()._get(privyUserId);
  const embeddedWallet = user.linked_accounts.find(
    (a) => a.type === "wallet" && a.wallet_client_type === "privy" && a.chain_type === "ethereum"
  );

  console.log("Embedded wallet found:", embeddedWallet ? "YES" : "NO");
  if (embeddedWallet) {
    console.log("  wallet.id:", embeddedWallet.id);
    console.log("  wallet.address:", embeddedWallet.address);
    console.log("  wallet.delegated:", embeddedWallet.delegated);
  }

  // Step 2: Try to sign a message with the authorization key
  if (embeddedWallet?.id && authKey) {
    console.log("\nAttempting to sign a test message with authorization key...");
    const authContext = { authorization_private_keys: [authKey] };

    try {
      const result = await privy.wallets().ethereum().signMessage(embeddedWallet.id, {
        message: "test",
        authorization_context: authContext,
      });
      console.log("✅ SUCCESS! Signature:", result.signature?.substring(0, 30) + "...");
    } catch (e) {
      console.error("❌ SIGN FAILED:", e.message || e);

      // If sign fails, check if the wallet has the right signers
      console.log("\nChecking wallet details...");
      try {
        const walletDetails = await privy.wallets().get(embeddedWallet.id);
        console.log("Wallet details:", JSON.stringify(walletDetails, null, 2));
      } catch (e2) {
        console.error("Failed to get wallet details:", e2.message);
      }
    }
  } else {
    console.log("\nSkipping sign test (missing wallet ID or auth key)");
  }
} catch (e) {
  console.error("Failed to look up user:", e.message || e);
}

// Clean up
rm_env_check();
function rm_env_check() {
  try { import("fs").then(fs => fs.unlinkSync(".env.check")); } catch {}
}
