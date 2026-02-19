"use client";

import { useEffect, useState, useCallback, use } from "react";
import { usePrivy, useWallets, useFundWallet } from "@privy-io/react-auth";
import { useAppUser } from "@/components/providers";
import { ProgressTracker } from "@/components/progress-tracker";
import { Chat } from "@/components/chat";
import { Copy, Check, ExternalLink, Lock, Clock, AlertTriangle, Loader2, Plus, Wallet } from "lucide-react";
import { useEscrow, type EscrowStep } from "@/lib/hooks/useEscrow";
import { useUsdcBalance } from "@/lib/hooks/useUsdcBalance";
import type { Deal } from "@/lib/types/database";
import type { DealStatus } from "@/lib/constants";
import { keccak256, toHex } from "viem";
import { base } from "viem/chains";

const STEP_LABELS: Record<EscrowStep, string> = {
  idle: "",
  approving: "Approving USDC...",
  depositing: "Depositing to escrow...",
  confirming: "Confirming transaction...",
  transferring: "Marking as transferred...",
  disputing: "Filing dispute...",
  done: "Done!",
  error: "Transaction failed",
};

function makeDealIdBytes32(dealUuid: string): `0x${string}` {
  return keccak256(toHex(dealUuid));
}

export default function DealPage({ params }: { params: Promise<{ shortCode: string }> }) {
  const { shortCode } = use(params);
  const { authenticated, login, getAccessToken } = usePrivy();
  const { user } = useAppUser();
  const [deal, setDeal] = useState<(Deal & { seller: { id: string; name: string | null } }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const escrow = useEscrow();
  const { wallets } = useWallets();
  const { fundWallet } = useFundWallet();
  const [fundingLoading, setFundingLoading] = useState(false);

  // Get embedded wallet address for balance checking
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const walletAddress = embeddedWallet?.address || null;

  const { balance: usdcBalance, formatted: usdcFormatted, refetch: refetchBalance } = useUsdcBalance(walletAddress);

  const isTestnet = process.env.NEXT_PUBLIC_CHAIN_ID === "84532";

  /** Helper to make authenticated API calls */
  async function authFetch(url: string, options: RequestInit = {}) {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> || {}),
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return fetch(url, { ...options, headers });
  }

  const fetchDeal = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${shortCode}`);
      if (res.ok) {
        const data = await res.json();
        setDeal(data);
      } else {
        setError("Deal not found");
      }
    } catch {
      setError("Failed to load deal");
    } finally {
      setLoading(false);
    }
  }, [shortCode]);

  useEffect(() => {
    fetchDeal();
    const interval = setInterval(fetchDeal, 10000);
    return () => clearInterval(interval);
  }, [fetchDeal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-zinc-500">{error || "Deal not found"}</p>
      </div>
    );
  }

  const isSeller = user?.id === deal.seller_id;
  const isBuyer = user?.id === deal.buyer_id;
  const userRole: "seller" | "buyer" | null = isSeller ? "seller" : "buyer";
  const priceDisplay = `$${(deal.price_cents / 100).toFixed(2)}`;
  const isTerminal = ["RELEASED", "REFUNDED", "AUTO_RELEASED", "AUTO_REFUNDED", "EXPIRED", "CANCELED"].includes(deal.status);
  const buyerOfferAccepted = !!(deal.terms as Record<string, unknown> | null)?.buyer_offer_accepted;
  const escrowAddr = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS || "";
  const dealBytes32 = makeDealIdBytes32(deal.id);

  // ─── On-chain deposit flow ───────────────────────────────────
  async function handleDeposit() {
    if (!authenticated) { login(); return; }
    if (!user) return;

    try {
      // 1. Get deposit params from API
      const depositRes = await authFetch(`/api/deals/${deal!.id}/deposit`, {
        method: "POST",
      });

      if (!depositRes.ok) {
        const data = await depositRes.json();
        alert(data.error || "Failed to get deposit parameters");
        return;
      }

      const { deposit_params } = await depositRes.json();

      // 2. Execute on-chain deposit (approve + deposit)
      const txHash = await escrow.deposit(deposit_params);

      // 3. Claim deal in DB with tx hash
      const claimRes = await authFetch(`/api/deals/${deal!.id}/claim`, {
        method: "POST",
        body: JSON.stringify({ escrow_tx_hash: txHash }),
      });

      if (!claimRes.ok) {
        const data = await claimRes.json();
        alert(data.error || "Failed to claim deal");
        return;
      }

      fetchDeal();
    } catch {
      // On-chain tx failed
    }
  }

  // ─── On-chain transfer flow ──────────────────────────────────
  async function handleTransfer() {
    if (!user) return;

    try {
      const txHash = await escrow.markTransferred(dealBytes32, escrowAddr);

      await authFetch(`/api/deals/${deal!.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({ transfer_tx_hash: txHash }),
      });

      fetchDeal();
    } catch {
      // Error set in hook
    }
  }

  // ─── On-chain confirm flow ───────────────────────────────────
  async function handleConfirm() {
    if (!user) return;

    try {
      const txHash = await escrow.confirmReceipt(dealBytes32, escrowAddr);

      await authFetch(`/api/deals/${deal!.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ confirm_tx_hash: txHash }),
      });

      fetchDeal();
    } catch {
      // Error set in hook
    }
  }

  // ─── On-chain dispute flow ───────────────────────────────────
  async function handleDispute() {
    if (!user) return;

    try {
      const txHash = await escrow.openDispute(dealBytes32, escrowAddr);

      await authFetch(`/api/deals/${deal!.id}/dispute`, {
        method: "POST",
        body: JSON.stringify({ dispute_tx_hash: txHash }),
      });

      fetchDeal();
    } catch {
      // Error set in hook
    }
  }

  // ─── Fund wallet flow ───────────────────────────────────────
  async function handleFundWallet() {
    if (!authenticated) { login(); return; }
    if (!walletAddress) return;

    setFundingLoading(true);
    try {
      if (isTestnet) {
        // Testnet: claim USDC from CDP faucet (1 USDC per claim, max 10/day)
        // Calculate how much USDC is still needed
        const requiredUsdc = deal ? deal.price_cents / 100 : 1;
        const currentBalance = usdcBalance !== null ? Number(usdcBalance) / 1e6 : 0;
        const needed = Math.ceil(Math.max(requiredUsdc - currentBalance, 1));

        const res = await fetch("/api/faucet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: walletAddress, token: "usdc", amount: needed }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || "Failed to claim test USDC");
          return;
        }
        // Wait for the faucet txs to confirm, then refresh balance
        const { claims } = await res.json();
        await new Promise((r) => setTimeout(r, Math.min(claims * 3000, 15000)));
        refetchBalance();
      } else {
        // Mainnet: open Privy funding modal (Coinbase Onramp / Apple Pay)
        await fundWallet({
          address: walletAddress,
          options: {
            chain: base,
            asset: "USDC",
            amount: deal ? String(deal.price_cents / 100) : "10",
          },
        });
        // After modal closes, refresh balance
        refetchBalance();
      }
    } catch (err) {
      console.error("Fund wallet error:", err);
    } finally {
      setFundingLoading(false);
    }
  }

  function copyLink() {
    const link = `${window.location.origin}/deal/${deal!.short_code}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function getTimeLeft(deadline: string, timeoutSeconds: number): string {
    const deadlineTime = new Date(deadline).getTime() + timeoutSeconds * 1000;
    const remaining = deadlineTime - Date.now();
    if (remaining <= 0) return "Expired";
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      {/* Deal header */}
      <div className="px-4 py-4 border-b border-zinc-200 space-y-4">
        <div>
          <h1 className="text-lg font-bold">{deal.event_name}</h1>
          <p className="text-sm text-zinc-500">
            {[
              deal.event_date && new Date(deal.event_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
              deal.venue,
            ].filter(Boolean).join(" · ")}
          </p>
          <p className="text-sm text-zinc-500">
            {deal.num_tickets} ticket{deal.num_tickets !== 1 ? "s" : ""}
            {deal.section ? ` · Section ${deal.section}` : ""}
            {deal.row ? `, Row ${deal.row}` : ""}
            {deal.seats ? `, Seats ${deal.seats}` : ""}
            {deal.transfer_method ? ` · ${deal.transfer_method}` : ""}
          </p>
        </div>

        <ProgressTracker status={deal.status as DealStatus} />

        {/* Seller share link */}
        {deal.status === "OPEN" && isSeller && (
          <div className="bg-zinc-50 rounded-xl p-3 space-y-2">
            <p className="text-sm text-zinc-600">Share your deal link:</p>
            <div className="flex gap-2">
              <div className="flex-1 bg-white rounded-lg px-3 py-2 text-xs font-mono text-zinc-500 truncate border border-zinc-200">
                {typeof window !== "undefined" && window.location.origin}/deal/{deal.short_code}
              </div>
              <button onClick={copyLink} className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-500 hover:text-zinc-700">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {deal.status === "FUNDED" && (
          <div className="flex items-center gap-2 text-sm text-orange-600 font-medium">
            <Lock className="w-4 h-4" />
            {priceDisplay} locked in escrow
            {deal.funded_at && (
              <span className="text-zinc-400 font-normal ml-auto flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {getTimeLeft(deal.funded_at, 7200)} left
              </span>
            )}
          </div>
        )}

        {deal.status === "TRANSFERRED" && (
          <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
            <ExternalLink className="w-4 h-4" />
            Seller says transferred
            {deal.transferred_at && (
              <span className="text-zinc-400 font-normal ml-auto flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {getTimeLeft(deal.transferred_at, 14400)} auto-release
              </span>
            )}
          </div>
        )}

        {deal.status === "RELEASED" || deal.status === "AUTO_RELEASED" ? (
          <div className="text-sm text-green-600 font-medium">Deal complete!</div>
        ) : null}
      </div>

      {/* Terms (for OPEN deal, buyer view) */}
      {deal.status === "OPEN" && !isSeller && (
        <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50">
          <p className="text-xs font-semibold text-zinc-500 mb-2">TERMS</p>
          <ul className="text-xs text-zinc-500 space-y-1">
            <li>• Seller transfers within 2 hours of deposit</li>
            <li>• 4 hours to confirm receipt</li>
            <li>• Seller timeout → automatic refund</li>
            <li>• Disputes adjudicated by Dealbay</li>
          </ul>
          <p className="text-xs text-zinc-400 mt-2">Chat with Dealbay to make an offer.</p>
        </div>
      )}

      {/* On-chain transaction status banner */}
      {escrow.isLoading && (
        <div className="px-4 py-3 bg-orange-50 border-b border-orange-200 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
          <span className="text-sm text-orange-700 font-medium">
            {STEP_LABELS[escrow.step]}
          </span>
        </div>
      )}

      {escrow.step === "error" && escrow.error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{escrow.error}</p>
          <button onClick={escrow.reset} className="text-xs text-red-500 underline mt-1">
            Dismiss
          </button>
        </div>
      )}

      {/* Chat */}
      <div className="flex-1 overflow-hidden">
        <Chat
          dealId={deal.id}
          userId={user?.id || null}
          userRole={userRole}
          chatMode={deal.chat_mode}
          disabled={isTerminal || (!isSeller && !isBuyer && deal.status !== "OPEN")}
          placeholder={deal.status === "OPEN" && !isSeller ? (buyerOfferAccepted ? "Ask a question..." : "Make an offer...") : "Type a message..."}
        />
      </div>

      {/* Action buttons */}
      {!isTerminal && (
        <div className="border-t border-zinc-200 px-4 py-3 space-y-2">
          {deal.status === "OPEN" && !isSeller && buyerOfferAccepted && (() => {
            // USDC has 6 decimals; price_cents / 100 = dollars, * 1e6 = USDC units
            const requiredAmount = BigInt(deal.price_cents) * BigInt(10000);
            const hasEnough = usdcBalance !== null && usdcBalance >= requiredAmount;

            return (
              <>
                {/* Balance indicator */}
                {authenticated && walletAddress && (
                  <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
                    <span className="flex items-center gap-1">
                      <Wallet className="w-3 h-3" />
                      Balance: {usdcFormatted ?? "..."} USDC
                    </span>
                    {!hasEnough && (
                      <span className="text-orange-500">
                        Need {(deal.price_cents / 100).toFixed(2)} USDC
                      </span>
                    )}
                  </div>
                )}

                {/* Get USDC button (shown when balance is insufficient) */}
                {authenticated && !hasEnough && (
                  <button
                    onClick={handleFundWallet}
                    disabled={fundingLoading}
                    className="w-full h-12 rounded-2xl bg-green-500 text-white font-semibold flex items-center justify-center gap-2 hover:bg-green-600 transition-colors disabled:opacity-50"
                  >
                    {fundingLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {isTestnet ? "Claiming test USDC..." : "Opening payment..."}
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        {isTestnet
                          ? `Get ${Math.min(Math.ceil(Math.max((deal.price_cents / 100) - (usdcBalance !== null ? Number(usdcBalance) / 1e6 : 0), 1)), 10)} test USDC`
                          : "Get USDC"}
                      </>
                    )}
                  </button>
                )}

                {/* Deposit button */}
                <button
                  onClick={handleDeposit}
                  disabled={escrow.isLoading || (authenticated && !hasEnough)}
                  className="w-full h-14 rounded-2xl bg-orange-500 text-white font-semibold text-lg flex items-center justify-center gap-2 hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {escrow.isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {STEP_LABELS[escrow.step]}
                    </>
                  ) : (
                    <>
                      <Lock className="w-5 h-5" />
                      Deposit {priceDisplay}
                    </>
                  )}
                </button>
              </>
            );
          })()}

          {deal.status === "FUNDED" && isSeller && (
            <button
              onClick={handleTransfer}
              disabled={escrow.isLoading}
              className="w-full h-14 rounded-2xl bg-blue-500 text-white font-semibold flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {escrow.isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {STEP_LABELS[escrow.step]}
                </>
              ) : (
                "I've transferred the tickets"
              )}
            </button>
          )}

          {deal.status === "TRANSFERRED" && isBuyer && (
            <>
              <button
                onClick={handleConfirm}
                disabled={escrow.isLoading}
                className="w-full h-12 rounded-2xl bg-green-500 text-white font-semibold flex items-center justify-center gap-2 hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                {escrow.isLoading && escrow.step === "confirming" ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Releasing funds...
                  </>
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    Got them — release funds
                  </>
                )}
              </button>
              <button
                onClick={handleDispute}
                disabled={escrow.isLoading}
                className="w-full h-12 rounded-2xl bg-zinc-100 text-zinc-700 font-semibold flex items-center justify-center gap-2 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {escrow.isLoading && escrow.step === "disputing" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Filing dispute...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4" />
                    Something&apos;s wrong
                  </>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
