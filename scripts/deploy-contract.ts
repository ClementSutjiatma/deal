/**
 * Deploys the TicketEscrow contract to Base Sepolia (or Base mainnet)
 * using the Privy server wallet as the deployer.
 *
 * The Privy wallet becomes the Ownable owner (for resolveDispute).
 * There are no platform fees — Deal is completely free to use.
 *
 * Usage:
 *   pnpm run deploy-contract
 *
 * Environment:
 *   Set NEXT_PUBLIC_CHAIN_ID=84532 for Base Sepolia (default)
 *   Set NEXT_PUBLIC_CHAIN_ID=8453 for Base mainnet
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { PrivyClient } from "@privy-io/server-auth";
import { createViemAccount } from "@privy-io/server-auth/viem";
import { readFileSync } from "fs";
import { resolve } from "path";

// Base Sepolia USDC (Circle's official test token)
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Base mainnet USDC
const BASE_MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function main() {
  // Validate env
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const walletId = process.env.PRIVY_WALLET_ID;
  const walletAddress = process.env.PRIVY_WALLET_ADDRESS;

  if (!appId || !appSecret || !walletId || !walletAddress) {
    console.error(
      "Missing env vars. Need: NEXT_PUBLIC_PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_WALLET_ID, PRIVY_WALLET_ADDRESS"
    );
    console.error("Run: pnpm run create-wallet first");
    process.exit(1);
  }

  // Determine chain
  const chainId = process.env.NEXT_PUBLIC_CHAIN_ID || "84532";
  const isTestnet = chainId === "84532";
  const chain = isTestnet ? baseSepolia : base;
  const usdcAddress = isTestnet ? BASE_SEPOLIA_USDC : BASE_MAINNET_USDC;
  const rpcUrl = isTestnet
    ? "https://sepolia.base.org"
    : process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";

  console.log(`Deploying TicketEscrow to ${chain.name}...`);
  console.log(`  Chain ID:          ${chain.id}`);
  console.log(`  USDC address:      ${usdcAddress}`);
  console.log(`  Deployer (owner):  ${walletAddress}`);
  console.log();

  // Read compiled artifact
  const artifactPath = resolve(
    "artifacts/contracts/TicketEscrow.sol/TicketEscrow.json"
  );
  let artifact: { abi: any[]; bytecode: string };
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  } catch {
    console.error(
      "Contract artifact not found. Run: npx hardhat compile first"
    );
    process.exit(1);
  }

  // Create Privy viem account
  const privy = new PrivyClient(appId, appSecret);
  const account = await createViemAccount({
    walletId,
    address: walletAddress as Hex,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    privy: privy as any,
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Check deployer balance
  const balance = await publicClient.getBalance({
    address: walletAddress as Hex,
  });
  console.log(
    `  Deployer balance:  ${(Number(balance) / 1e18).toFixed(6)} ETH`
  );

  if (balance === BigInt(0)) {
    console.error(
      "\nDeployer has no ETH for gas! Fund the wallet first:"
    );
    console.error(`  Address: ${walletAddress}`);
    if (isTestnet) {
      console.error(
        "  Faucet:  https://www.coinbase.com/faucets/base-ethereum-goerli-faucet"
      );
    }
    process.exit(1);
  }

  // Deploy (constructor takes only USDC address — no fees)
  console.log("Deploying contract...");

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    args: [usdcAddress as Hex],
  });

  console.log(`  Tx hash: ${hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    console.error("Deployment REVERTED!");
    process.exit(1);
  }

  const contractAddress = receipt.contractAddress;
  console.log();
  console.log("Contract deployed successfully!");
  console.log(`  Address: ${contractAddress}`);
  console.log(`  Block:   ${receipt.blockNumber}`);
  console.log();
  console.log("Update your .env.local:");
  console.log(`  NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS=${contractAddress}`);
  if (isTestnet) {
    console.log(`  NEXT_PUBLIC_CHAIN_ID=84532`);
    console.log(`  NEXT_PUBLIC_BASE_RPC_URL=https://sepolia.base.org`);
    console.log(
      `  NEXT_PUBLIC_USDC_CONTRACT_ADDRESS=${BASE_SEPOLIA_USDC}`
    );
  }
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
