import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Address,
} from "viem";
import { createViemAccount } from "@privy-io/node/viem";
import { getPrivyClient, getAuthorizationContext } from "./privy";
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

  const account = createViemAccount(getPrivyClient(), {
    walletId,
    address: walletAddress as `0x${string}`,
    authorizationContext: getAuthorizationContext(),
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

/**
 * Send a gas-sponsored transaction from a user's embedded wallet.
 * Uses @privy-io/node's wallets().ethereum().sendTransaction() which
 * returns { hash, transaction_id } with sponsor: true.
 */
async function sponsoredSendTransaction(
  walletId: string,
  to: Address,
  data: `0x${string}`
): Promise<{ transactionId: string; hash: string }> {
  const privy = getPrivyClient();
  const caip2 = `eip155:${chain.id}`;

  const response = await privy.wallets().ethereum().sendTransaction(walletId, {
    caip2,
    sponsor: true,
    params: { transaction: { to, data } },
    authorization_context: getAuthorizationContext(),
  });

  return {
    transactionId: response.transaction_id ?? "",
    hash: response.hash,
  };
}

/**
 * Poll Privy's transaction API until a gas-sponsored transaction is confirmed.
 * Returns the real on-chain transaction hash once available.
 */
async function waitForSponsoredTransaction(
  transactionId: string,
  maxAttempts = 60,
  intervalMs = 2000
): Promise<string> {
  const privy = getPrivyClient();

  for (let i = 0; i < maxAttempts; i++) {
    const tx = await privy.transactions().get(transactionId);

    switch (tx.status) {
      case "confirmed":
      case "finalized":
        return tx.transaction_hash ?? "";
      case "execution_reverted":
        throw new Error(
          `Transaction reverted (txId: ${transactionId}, hash: ${tx.transaction_hash})`
        );
      case "failed":
        throw new Error(`Transaction failed (txId: ${transactionId})`);
      case "replaced":
        throw new Error(`Transaction replaced (txId: ${transactionId})`);
      case "provider_error":
        throw new Error(`Transaction provider error (txId: ${transactionId})`);
    }

    // Still 'broadcasted' or 'pending' — keep polling
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Transaction not confirmed after ${(maxAttempts * intervalMs) / 1000}s (txId: ${transactionId})`
  );
}

export async function sponsoredApproveAndDeposit(
  buyerWalletId: string,
  dealUuid: string,
  sellerAddress: Address,
  priceCents: number,
  transferDeadlineSeconds: number,
  confirmDeadlineSeconds: number
): Promise<string> {
  const params = getDepositParams(
    dealUuid,
    sellerAddress,
    priceCents,
    transferDeadlineSeconds,
    confirmDeadlineSeconds
  );

  // Step 1: Approve USDC spend and wait for on-chain confirmation
  const approveData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [escrowAddress, params.amount],
  });
  const approveResult = await sponsoredSendTransaction(
    buyerWalletId,
    usdcAddress,
    approveData
  );
  await waitForSponsoredTransaction(approveResult.transactionId);

  // Step 2: Deposit into escrow and wait for on-chain confirmation
  const depositData = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "deposit",
    args: [
      params.dealId,
      params.seller,
      params.amount,
      params.transferDeadline,
      params.confirmDeadline,
    ],
  });
  const depositResult = await sponsoredSendTransaction(
    buyerWalletId,
    escrowAddress,
    depositData
  );
  const depositHash = await waitForSponsoredTransaction(
    depositResult.transactionId
  );

  return depositHash;
}

export async function sponsoredMarkTransferred(
  sellerWalletId: string,
  dealUuid: string
): Promise<string> {
  const dealId = dealIdToBytes32(dealUuid);
  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "markTransferred",
    args: [dealId],
  });
  const result = await sponsoredSendTransaction(sellerWalletId, escrowAddress, data);
  return waitForSponsoredTransaction(result.transactionId);
}

export async function sponsoredConfirm(
  buyerWalletId: string,
  dealUuid: string
): Promise<string> {
  const dealId = dealIdToBytes32(dealUuid);
  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "confirm",
    args: [dealId],
  });
  const result = await sponsoredSendTransaction(buyerWalletId, escrowAddress, data);
  return waitForSponsoredTransaction(result.transactionId);
}

export async function sponsoredDispute(
  buyerWalletId: string,
  dealUuid: string
): Promise<string> {
  const dealId = dealIdToBytes32(dealUuid);
  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "dispute",
    args: [dealId],
  });
  const result = await sponsoredSendTransaction(buyerWalletId, escrowAddress, data);
  return waitForSponsoredTransaction(result.transactionId);
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
