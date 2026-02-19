"use client";

import { useState, useCallback } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Hex,
} from "viem";
import { ESCROW_ABI, ERC20_ABI } from "@/lib/abis";
import { chain, rpcUrl } from "@/lib/chain";

export type EscrowStep =
  | "idle"
  | "approving"
  | "depositing"
  | "confirming"
  | "transferring"
  | "disputing"
  | "done"
  | "error";

interface DepositParams {
  escrow_address: string;
  usdc_address: string;
  deal_id_bytes32: string;
  seller: string;
  amount: string;
  fee_bps: string;
  transfer_deadline: string;
  confirm_deadline: string;
}

export function useEscrow() {
  const { wallets } = useWallets();
  const [step, setStep] = useState<EscrowStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const getWalletClient = useCallback(async () => {
    const embeddedWallet = wallets.find(
      (w) => w.walletClientType === "privy"
    );
    if (!embeddedWallet) {
      throw new Error("No embedded wallet found. Please log in first.");
    }

    const provider = await embeddedWallet.getEthereumProvider();

    // Switch to the correct chain
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${chain.id.toString(16)}` }],
      });
    } catch {
      // Chain might not be added yet, try adding it
      // Privy handles this automatically for supported chains
    }

    const walletClient = createWalletClient({
      account: embeddedWallet.address as Hex,
      chain,
      transport: custom(provider),
    });

    return walletClient;
  }, [wallets]);

  const getPublicClientInstance = useCallback(() => {
    return createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
  }, []);

  /**
   * Execute the full deposit flow: USDC approve → escrow deposit
   */
  const deposit = useCallback(
    async (params: DepositParams): Promise<string> => {
      setStep("idle");
      setError(null);
      setTxHash(null);

      try {
        const walletClient = await getWalletClient();
        const publicClient = getPublicClientInstance();

        // Step 1: Approve USDC
        setStep("approving");
        const approveHash = await walletClient.writeContract({
          address: params.usdc_address as Hex,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [params.escrow_address as Hex, BigInt(params.amount)],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Step 2: Deposit to escrow
        setStep("depositing");
        const depositHash = await walletClient.writeContract({
          address: params.escrow_address as Hex,
          abi: ESCROW_ABI,
          functionName: "deposit",
          args: [
            params.deal_id_bytes32 as Hex,
            params.seller as Hex,
            BigInt(params.amount),
            BigInt(params.fee_bps),
            BigInt(params.transfer_deadline),
            BigInt(params.confirm_deadline),
          ],
        });

        setStep("confirming");
        await publicClient.waitForTransactionReceipt({ hash: depositHash });

        setTxHash(depositHash);
        setStep("done");
        return depositHash;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        setStep("error");
        throw err;
      }
    },
    [getWalletClient, getPublicClientInstance]
  );

  /**
   * Seller marks tickets as transferred on-chain
   */
  const markTransferred = useCallback(
    async (dealIdBytes32: string, escrowAddr: string): Promise<string> => {
      setStep("idle");
      setError(null);
      setTxHash(null);

      try {
        const walletClient = await getWalletClient();
        const publicClient = getPublicClientInstance();

        setStep("transferring");
        const hash = await walletClient.writeContract({
          address: escrowAddr as Hex,
          abi: ESCROW_ABI,
          functionName: "markTransferred",
          args: [dealIdBytes32 as Hex],
        });

        setStep("confirming");
        await publicClient.waitForTransactionReceipt({ hash });

        setTxHash(hash);
        setStep("done");
        return hash;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        setStep("error");
        throw err;
      }
    },
    [getWalletClient, getPublicClientInstance]
  );

  /**
   * Buyer confirms receipt — triggers on-chain fund release
   */
  const confirmReceipt = useCallback(
    async (dealIdBytes32: string, escrowAddr: string): Promise<string> => {
      setStep("idle");
      setError(null);
      setTxHash(null);

      try {
        const walletClient = await getWalletClient();
        const publicClient = getPublicClientInstance();

        setStep("confirming");
        const hash = await walletClient.writeContract({
          address: escrowAddr as Hex,
          abi: ESCROW_ABI,
          functionName: "confirm",
          args: [dealIdBytes32 as Hex],
        });

        await publicClient.waitForTransactionReceipt({ hash });

        setTxHash(hash);
        setStep("done");
        return hash;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        setStep("error");
        throw err;
      }
    },
    [getWalletClient, getPublicClientInstance]
  );

  /**
   * Buyer opens a dispute on-chain
   */
  const openDispute = useCallback(
    async (dealIdBytes32: string, escrowAddr: string): Promise<string> => {
      setStep("idle");
      setError(null);
      setTxHash(null);

      try {
        const walletClient = await getWalletClient();
        const publicClient = getPublicClientInstance();

        setStep("disputing");
        const hash = await walletClient.writeContract({
          address: escrowAddr as Hex,
          abi: ESCROW_ABI,
          functionName: "dispute",
          args: [dealIdBytes32 as Hex],
        });

        setStep("confirming");
        await publicClient.waitForTransactionReceipt({ hash });

        setTxHash(hash);
        setStep("done");
        return hash;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        setStep("error");
        throw err;
      }
    },
    [getWalletClient, getPublicClientInstance]
  );

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setTxHash(null);
  }, []);

  return {
    step,
    error,
    txHash,
    deposit,
    markTransferred,
    confirmReceipt,
    openDispute,
    reset,
    isLoading: !["idle", "done", "error"].includes(step),
  };
}
