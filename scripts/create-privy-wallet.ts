/**
 * Creates a Privy server wallet for use as the platform treasury / deployment wallet.
 *
 * This replaces the need for a raw private key (PLATFORM_WALLET_PRIVATE_KEY) by
 * creating a Privy-managed server wallet. The wallet ID and address are printed
 * so you can add them to your .env.local.
 *
 * Usage:
 *   pnpm run create-wallet
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrivyClient } from "@privy-io/server-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;

if (!appId || !appSecret) {
  console.error(
    "Missing NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_SECRET in .env.local"
  );
  process.exit(1);
}

async function main() {
  const privy = new PrivyClient(appId!, appSecret!);

  console.log("Creating Privy server wallet on Ethereum (Base)...\n");

  const wallet = await privy.walletApi.create({
    chainType: "ethereum",
  });

  console.log("Server wallet created successfully!\n");
  console.log("  Wallet ID:  ", wallet.id);
  console.log("  Address:    ", wallet.address);
  console.log("  Chain Type: ", wallet.chainType);
  console.log("  Created At: ", wallet.createdAt);
  console.log();
  console.log("Add these to your .env.local:");
  console.log();
  console.log(`  PRIVY_WALLET_ID=${wallet.id}`);
  console.log(`  PRIVY_WALLET_ADDRESS=${wallet.address}`);
  console.log();
  console.log(
    "Then update NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS after deploying"
  );
  console.log("the contract with this wallet as the platform address.");
}

main().catch((err) => {
  console.error("Failed to create wallet:", err);
  process.exit(1);
});
