import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Address,
} from "viem";
import { createViemAccount } from "@privy-io/server-auth/viem";
import { getPrivyClient } from "./privy";
import { USDC_DECIMALS } from "./constants";
import { ESCROW_ABI, ERC20_ABI } from "./abis";
import { chain, escrowAddress, usdcAddress, rpcUrl } from "./chain";

export function dealIdToBytes32(dealUuid: string): `0x${string}` {
  return keccak256(toHex(dealUuid));
}

export function getPublicClient() {
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

export async function getPlatformWalletClient() {
  const walletId = process.env.PRIVY_WALLET_ID;
  const walletAddress = process.env.PRIVY_WALLET_ADDRESS;

  if (!walletId || !walletAddress) {
    throw new Error(
      "Missing PRIVY_WALLET_ID or PRIVY_WALLET_ADDRESS. Run: pnpm run create-wallet"
    );
  }

  const account = await createViemAccount({
    walletId,
    address: walletAddress as `0x${string}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    privy: getPrivyClient() as any,
  });

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
}

export async function resolveDisputeOnChain(
  dealUuid: string,
  favorBuyer: boolean
): Promise<string> {
  const walletClient = await getPlatformWalletClient();
  const dealId = dealIdToBytes32(dealUuid);

  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "resolveDispute",
    args: [dealId, favorBuyer],
  });

  return hash;
}

export async function triggerRefund(dealUuid: string): Promise<string> {
  const walletClient = await getPlatformWalletClient();
  const dealId = dealIdToBytes32(dealUuid);

  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "refund",
    args: [dealId],
  });

  return hash;
}

export async function triggerAutoRelease(dealUuid: string): Promise<string> {
  const walletClient = await getPlatformWalletClient();
  const dealId = dealIdToBytes32(dealUuid);

  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "autoRelease",
    args: [dealId],
  });

  return hash;
}

export async function getDealOnChain(dealUuid: string) {
  const publicClient = getPublicClient();
  const dealId = dealIdToBytes32(dealUuid);

  const result = await publicClient.readContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "deals",
    args: [dealId],
  });

  return result;
}

/**
 * Verify that a transaction was confirmed on-chain.
 * Returns true if the tx receipt shows success, false otherwise.
 */
export async function verifyTxReceipt(
  txHash: `0x${string}`
): Promise<boolean> {
  const publicClient = getPublicClient();
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    return receipt.status === "success";
  } catch {
    return false;
  }
}

export function getDepositParams(
  dealUuid: string,
  sellerAddress: Address,
  priceCents: number,
  transferDeadlineSeconds: number,
  confirmDeadlineSeconds: number
) {
  return {
    escrowAddress,
    usdcAddress,
    dealId: dealIdToBytes32(dealUuid),
    seller: sellerAddress,
    // Integer arithmetic to avoid floating point precision issues (L-5)
    amount: BigInt(priceCents) * BigInt(10 ** (USDC_DECIMALS - 2)),
    transferDeadline: BigInt(transferDeadlineSeconds),
    confirmDeadline: BigInt(confirmDeadlineSeconds),
    escrowAbi: ESCROW_ABI,
    erc20Abi: ERC20_ABI,
  };
}
