/**
 * Claims Base Sepolia testnet ETH and USDC via the CDP Faucet API.
 *
 * Usage:
 *   pnpm run claim-faucet
 *
 * Environment (reads from .env.local):
 *   COINBASE_API_KEY_ID    — CDP API key ID
 *   COINBASE_API_KEY_SECRET — CDP API key secret (base64 EC key)
 *   PRIVY_WALLET_ADDRESS   — Address to fund
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { CdpClient } from "@coinbase/cdp-sdk";

const address = process.env.PRIVY_WALLET_ADDRESS;
if (!address) {
  console.error("Missing PRIVY_WALLET_ADDRESS in .env.local");
  process.exit(1);
}

// CDP SDK reads CDP_API_KEY_ID and CDP_API_KEY_SECRET from env.
// Our .env.local uses COINBASE_ prefix, so we map them.
if (!process.env.CDP_API_KEY_ID && process.env.COINBASE_API_KEY_ID) {
  process.env.CDP_API_KEY_ID = process.env.COINBASE_API_KEY_ID;
}
if (!process.env.CDP_API_KEY_SECRET && process.env.COINBASE_API_KEY_SECRET) {
  process.env.CDP_API_KEY_SECRET = process.env.COINBASE_API_KEY_SECRET;
}

async function main() {
  console.log(`Claiming faucet funds for: ${address}`);
  console.log(`Network: base-sepolia\n`);

  const cdp = new CdpClient();

  // Claim ETH (0.0001 per claim, up to 1000/day)
  console.log("Requesting ETH...");
  try {
    const ethResult = await cdp.evm.requestFaucet({
      address: address as `0x${string}`,
      network: "base-sepolia",
      token: "eth",
    });
    console.log(`  ETH faucet tx: https://sepolia.basescan.org/tx/${ethResult.transactionHash}`);
  } catch (err: unknown) {
    console.error("  ETH claim failed:", err instanceof Error ? err.message : err);
  }

  // Claim USDC (1 per claim, up to 10/day)
  console.log("\nRequesting USDC...");
  try {
    const usdcResult = await cdp.evm.requestFaucet({
      address: address as `0x${string}`,
      network: "base-sepolia",
      token: "usdc",
    });
    console.log(`  USDC faucet tx: https://sepolia.basescan.org/tx/${usdcResult.transactionHash}`);
  } catch (err: unknown) {
    console.error("  USDC claim failed:", err instanceof Error ? err.message : err);
  }

  console.log("\nDone! Funds should arrive within ~30 seconds.");
}

main().catch((err) => {
  console.error("Faucet claim failed:", err);
  process.exit(1);
});
