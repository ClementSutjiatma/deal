/**
 * Shared chain configuration used by both client and server code.
 */

import { base, baseSepolia } from "viem/chains";

export const chain =
  process.env.NEXT_PUBLIC_CHAIN_ID === "84532" ? baseSepolia : base;

export const escrowAddress = process.env
  .NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS as `0x${string}`;

export const usdcAddress = process.env
  .NEXT_PUBLIC_USDC_CONTRACT_ADDRESS as `0x${string}`;

export const rpcUrl =
  process.env.NEXT_PUBLIC_BASE_RPC_URL ||
  (process.env.NEXT_PUBLIC_CHAIN_ID === "84532"
    ? "https://sepolia.base.org"
    : "https://mainnet.base.org");
