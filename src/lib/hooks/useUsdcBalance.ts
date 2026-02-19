"use client";

import { useState, useEffect, useCallback } from "react";
import { createPublicClient, http, type Hex } from "viem";
import { ERC20_ABI } from "@/lib/abis";
import { chain, usdcAddress, rpcUrl } from "@/lib/chain";

const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

/**
 * Reads the USDC balance for a given wallet address.
 * Polls every `intervalMs` (default 10s) when an address is provided.
 */
export function useUsdcBalance(
  address: string | null | undefined,
  intervalMs = 10_000
) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!address || !usdcAddress) return;

    try {
      setIsLoading(true);
      const result = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as Hex],
      });
      setBalance(result);
    } catch (err) {
      console.error("Failed to fetch USDC balance:", err);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchBalance();
    if (!address) return;

    const interval = setInterval(fetchBalance, intervalMs);
    return () => clearInterval(interval);
  }, [fetchBalance, address, intervalMs]);

  /** Format balance as a human-readable string (e.g. "25.00") */
  const formatted =
    balance !== null ? (Number(balance) / 1e6).toFixed(2) : null;

  return { balance, formatted, isLoading, refetch: fetchBalance };
}
