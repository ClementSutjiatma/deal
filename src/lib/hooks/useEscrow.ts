"use client";

import { useState, useCallback } from "react";
import { useSendTransaction } from "@privy-io/react-auth";
import {
  encodeFunctionData,
  createPublicClient,
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
  transfer_deadline: string;
  confirm_deadline: string;
}

export function useEscrow() {
  const { sendTransaction } = useSendTransaction();
  const [step, setStep] = useState<EscrowStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const getPublicClient = useCallback(() => {
    return createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
  }, []);

  /**
   * Execute the full deposit flow: USDC approve → escrow deposit
   * Uses Privy gas sponsorship so the user doesn't need ETH.
   */
  const deposit = useCallback(
    async (params: DepositParams): Promise<string> => {
      setStep("idle");
      setError(null);
      setTxHash(null);

      try {
        const publicClient = getPublicClient();

        // Step 1: Approve USDC
        setStep("approving");
        const approveData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [params.escrow_address as Hex, BigInt(params.amount)],
        });
        const approveTx = await sendTransaction(
          { to: params.usdc_address, data: approveData },
          { sponsor: true },
        );
        await publicClient.waitForTransactionReceipt({ hash: approveTx.hash });

        // Step 2: Deposit to escrow (no fees)
        setStep("depositing");
        const depositData = encodeFunctionData({
          abi: ESCROW_ABI,
          functionName: "deposit",
          args: [
            params.deal_id_bytes32 as Hex,
            params.seller as Hex,
            BigInt(params.amount),
            BigInt(params.transfer_deadline),
            BigInt(params.confirm_deadline),
          ],
        });
        const depositTx = await sendTransaction(
          { to: params.escrow_address, data: depositData },
          { sponsor: true },
        );

        setStep("confirming");
        await publicClient.waitForTransactionReceipt({ hash: depositTx.hash });

        setTxHash(depositTx.hash);
        setStep("done");
        return depositTx.hash;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        setStep("error");
        throw err;
      }
    },
    [sendTransaction, getPublicClient],
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
        const publicClient = getPublicClient();

        setStep("transferring");
        const data = encodeFunctionData({
          abi: ESCROW_ABI,
          functionName: "markTransferred",
          args: [dealIdBytes32 as Hex],
        });
        const tx = await sendTransaction(
          { to: escrowAddr, data },
          { sponsor: true },
        );

        setStep("confirming");
        await publicClient.waitForTransactionReceipt({ hash: tx.hash });

        setTxHash(tx.hash);
        setStep("done");
        return tx.hash;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        setStep("error");
        throw err;
      }
    },
    [sendTransaction, getPublicClient],
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
        const publicClient = getPublicClient();

        setStep("confirming");
        const data = encodeFunctionData({
          abi: ESCROW_ABI,
          functionName: "confirm",
          args: [dealIdBytes32 as Hex],
        });
        const tx = await sendTransaction(
          { to: escrowAddr, data },
          { sponsor: true },
        );

        await publicClient.waitForTransactionReceipt({ hash: tx.hash });

        setTxHash(tx.hash);
        setStep("done");
        return tx.hash;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        setStep("error");
        throw err;
      }
    },
    [sendTransaction, getPublicClient],
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
        const publicClient = getPublicClient();

        setStep("disputing");
        const data = encodeFunctionData({
          abi: ESCROW_ABI,
          functionName: "dispute",
          args: [dealIdBytes32 as Hex],
        });
        const tx = await sendTransaction(
          { to: escrowAddr, data },
          { sponsor: true },
        );

        setStep("confirming");
        await publicClient.waitForTransactionReceipt({ hash: tx.hash });

        setTxHash(tx.hash);
        setStep("done");
        return tx.hash;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Transaction failed";
        setError(message);
        setStep("error");
        throw err;
      }
    },
    [sendTransaction, getPublicClient],
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
