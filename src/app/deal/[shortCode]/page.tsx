"use client";

import { useEffect, useState, useCallback, use } from "react";
import { usePrivy, useWallets, useFundWallet } from "@privy-io/react-auth";
import { useAppUser } from "@/components/providers";
import { ProgressTracker } from "@/components/progress-tracker";
import { Chat } from "@/components/chat";
import { SellerDashboard } from "@/components/seller-dashboard";
import { ConversationReadView } from "@/components/conversation-read-view";
import { Copy, Check, ExternalLink, Lock, Clock, AlertTriangle, Loader2, Plus, Wallet, Share2 } from "lucide-react";
import { useEscrow, type EscrowStep } from "@/lib/hooks/useEscrow";
import { useUsdcBalance } from "@/lib/hooks/useUsdcBalance";
import { useAnonymousId, clearAnonymousId } from "@/lib/hooks/useAnonymousId";
import { createClient } from "@/lib/supabase/client";
import type { Deal, Conversation } from "@/lib/types/database";
import type { DealStatus } from "@/lib/constants";
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

export default function DealPage({ params }: { params: Promise<{ shortCode: string }> }) {
  const { shortCode } = use(params);
  const { authenticated, login, user: privyUser, getAccessToken } = usePrivy();
  const { user, syncUser } = useAppUser();
  const [deal, setDeal] = useState<(Deal & { seller: { id: string; name: string | null } }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Buyer conversation state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationStatus, setConversationStatus] = useState<string | null>(null);
  const [negotiatedPriceCents, setNegotiatedPriceCents] = useState<number | null>(null);

  // Seller dashboard state
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedBuyerName, setSelectedBuyerName] = useState<string>("");

  const escrow = useEscrow();
  const { wallets } = useWallets();
  const { fundWallet } = useFundWallet();
  const [fundingLoading, setFundingLoading] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  // Get embedded wallet address for balance checking
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const walletAddress = embeddedWallet?.address || null;

  const { balance: usdcBalance, formatted: usdcFormatted, refetch: refetchBalance } = useUsdcBalance(walletAddress);

  const isTestnet = process.env.NEXT_PUBLIC_CHAIN_ID === "84532";
  const supabase = createClient();

  // Access token for Chat transport (refreshed on auth state changes)
  const [chatAccessToken, setChatAccessToken] = useState<string | null>(null);
  useEffect(() => {
    if (authenticated) {
      getAccessToken().then((t) => setChatAccessToken(t));
    } else {
      setChatAccessToken(null);
    }
  }, [authenticated, getAccessToken]);

  // Anonymous buyer ID (generated per-deal, stored in localStorage)
  const anonymousId = useAnonymousId(deal?.id);

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

  // Sync Privy user -> app user (populates privy_wallet_id, wallet_address, etc.)
  const [hasSynced, setHasSynced] = useState(false);
  useEffect(() => {
    if (authenticated && privyUser && !hasSynced && (!user || !user.privy_wallet_id)) {
      (async () => {
        const token = await getAccessToken();
        if (token) {
          await syncUser(privyUser, token);
          setHasSynced(true);
        }
      })();
    }
  }, [authenticated, privyUser, user, syncUser, hasSynced, getAccessToken]);

  // Fetch/create buyer conversation when deal loads
  // Handles: authenticated buyers, anonymous buyers, and sellers on post-OPEN deals
  useEffect(() => {
    if (!deal) return;

    const isSeller = user?.id === deal.seller_id;

    if (isSeller) {
      // Seller: only need conversation scoping for post-OPEN deals with a buyer
      if (deal.status === "OPEN" || !deal.buyer_id) return;

      async function fetchClaimedConversation() {
        const res = await fetch(`/api/deals/${deal!.id}/conversations?seller_id=${user!.id}`);
        if (res.ok) {
          const convs: Conversation[] = await res.json();
          // Find the claimed conversation (preferred) or the one with buyer_id matching deal.buyer_id
          const claimed = convs.find((c) => c.status === "claimed")
            || convs.find((c) => c.buyer_id === deal!.buyer_id);
          if (claimed) {
            setConversationId(claimed.id);
            setConversationStatus(claimed.status);
            if (claimed.negotiated_price_cents) {
              setNegotiatedPriceCents(claimed.negotiated_price_cents);
            }
          }
        }
      }
      fetchClaimedConversation();
      return;
    }

    // Authenticated buyer
    if (user) {
      if (deal.status !== "OPEN" && user.id !== deal.buyer_id) return;

      async function initAuthenticatedConversation() {
        const res = await fetch(`/api/deals/${deal!.id}/conversations?buyer_id=${user!.id}`);
        if (res.ok) {
          const conv: Conversation = await res.json();
          setConversationId(conv.id);
          setConversationStatus(conv.status);
          if (conv.negotiated_price_cents) {
            setNegotiatedPriceCents(conv.negotiated_price_cents);
          }
        }
      }
      initAuthenticatedConversation();
      return;
    }

    // Anonymous buyer (not authenticated, deal is OPEN)
    if (!authenticated && deal.status === "OPEN" && anonymousId) {
      async function initAnonymousConversation() {
        const res = await fetch(`/api/deals/${deal!.id}/conversations?anonymous_id=${anonymousId}`);
        if (res.ok) {
          const conv: Conversation = await res.json();
          setConversationId(conv.id);
          setConversationStatus(conv.status);
        }
      }
      initAnonymousConversation();
    }
  }, [deal?.id, deal?.seller_id, deal?.status, deal?.buyer_id, user?.id, authenticated, anonymousId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auth transition: claim anonymous conversation when user logs in
  useEffect(() => {
    if (!user || !anonymousId || !deal || !conversationId) return;
    if (user.id === deal.seller_id) return; // seller doesn't claim

    async function claimAnonymousConversation() {
      try {
        const res = await fetch(`/api/deals/${deal!.id}/conversations/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anonymous_id: anonymousId,
            buyer_id: user!.id,
          }),
        });
        if (res.ok) {
          const conv: Conversation = await res.json();
          setConversationId(conv.id);
          setConversationStatus(conv.status);
          if (conv.negotiated_price_cents) {
            setNegotiatedPriceCents(conv.negotiated_price_cents);
          }
          // Clear the anonymous ID from localStorage
          clearAnonymousId(deal!.id);
        }
      } catch {
        // Claim failed -- not critical, user can still chat with new conversation
      }
    }
    claimAnonymousConversation();
  }, [user?.id, anonymousId, deal?.id, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to conversation status changes (for buyer -- detect "closed")
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`conv-status:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as Conversation;
          setConversationStatus(updated.status);
          if (updated.negotiated_price_cents) {
            setNegotiatedPriceCents(updated.negotiated_price_cents);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, supabase]);

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
  // Anonymous users get "buyer" role when deal is OPEN (can ask questions via chat)
  const userRole: "seller" | "buyer" | null = isSeller
    ? "seller"
    : isBuyer
      ? "buyer"
      : (authenticated || deal.status === "OPEN")
        ? "buyer"
        : null;
  const effectivePrice = negotiatedPriceCents ?? deal.price_cents;
  const priceDisplay = `$${(effectivePrice / 100).toFixed(2)}`;
  const isTerminal = ["RELEASED", "REFUNDED", "AUTO_RELEASED", "AUTO_REFUNDED", "EXPIRED", "CANCELED"].includes(deal.status);
  const buyerOfferAccepted = !!(deal.terms as Record<string, unknown> | null)?.buyer_offer_accepted;
  const isConversationClosed = conversationStatus === "closed";
  // Disable chat input when this party has completed their dispute evidence questions
  const disputeQuestionsComplete = deal.status === "DISPUTED" && (
    (isBuyer && (deal as Record<string, unknown>).dispute_buyer_q as number >= 5) ||
    (isSeller && (deal as Record<string, unknown>).dispute_seller_q as number >= 5)
  );

  // --- Server-side deposit flow ---
  async function handleDeposit() {
    if (!authenticated) { login(); return; }
    if (!user) {
      if (privyUser) {
        const token = await getAccessToken();
        if (token) await syncUser(privyUser, token);
      }
      setDepositError("Your account is still loading. Please try again in a moment.");
      return;
    }

    setDepositLoading(true);
    setDepositError(null);

    try {
      const res = await authFetch(`/api/deals/${deal!.id}/deposit`, {
        method: "POST",
        body: JSON.stringify({ conversation_id: conversationId }),
      });

      if (!res.ok) {
        const data = await res.json();
        setDepositError(data.error || "Deposit failed");
        return;
      }

      fetchDeal();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deposit failed";
      setDepositError(message);
    } finally {
      setDepositLoading(false);
    }
  }

  // --- Server-side transfer flow (gas-sponsored) ---
  async function handleTransfer() {
    if (!user) return;
    escrow.setLoading("transferring");
    try {
      const res = await authFetch(`/api/deals/${deal!.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        escrow.setError(data.error || "Transfer failed");
        return;
      }
      escrow.setDone();
      fetchDeal();
    } catch (err) {
      escrow.setError(err instanceof Error ? err.message : "Transfer failed");
    }
  }

  // --- Server-side confirm flow (gas-sponsored) ---
  async function handleConfirm() {
    if (!user) return;
    escrow.setLoading("confirming");
    try {
      const res = await authFetch(`/api/deals/${deal!.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        escrow.setError(data.error || "Confirm failed");
        return;
      }
      escrow.setDone();
      fetchDeal();
    } catch (err) {
      escrow.setError(err instanceof Error ? err.message : "Confirm failed");
    }
  }

  // --- Server-side dispute flow (gas-sponsored) ---
  async function handleDispute() {
    if (!user) return;
    escrow.setLoading("disputing");
    try {
      const res = await authFetch(`/api/deals/${deal!.id}/dispute`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        escrow.setError(data.error || "Dispute failed");
        return;
      }
      escrow.setDone();
      fetchDeal();
    } catch (err) {
      escrow.setError(err instanceof Error ? err.message : "Dispute failed");
    }
  }

  // --- Fund wallet flow ---
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
            amount: deal ? String(effectivePrice / 100) : "10",
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

  // --- Render seller's conversation detail view ---
  if (isSeller && deal.status === "OPEN" && selectedConvId) {
    return (
      <div className="flex flex-col h-screen max-w-lg mx-auto pt-14">
        <ConversationReadView
          dealId={deal.id}
          conversationId={selectedConvId}
          buyerName={selectedBuyerName}
          onBack={() => { setSelectedConvId(null); setSelectedBuyerName(""); }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      {/* Deal header */}
      <div className="px-4 pt-14 pb-4 border-b border-zinc-200 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
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
        </div>

        <ProgressTracker status={deal.status as DealStatus} />

        {/* Seller share link */}
        {deal.status === "OPEN" && isSeller && (() => {
          const dealUrl = typeof window !== "undefined"
            ? `${window.location.origin}/deal/${deal.short_code}`
            : `/deal/${deal.short_code}`;
          const shareText = `${deal.event_name} — ${deal.num_tickets} ticket${deal.num_tickets !== 1 ? "s" : ""}${deal.section ? `, Section ${deal.section}` : ""}. Buy here:`;

          return (
            <div className="bg-zinc-50 rounded-xl p-3 space-y-3">
              <p className="text-sm text-zinc-600">Share your deal link:</p>
              <div className="flex gap-2">
                <div className="flex-1 bg-white rounded-lg px-3 py-2 text-xs font-mono text-zinc-500 truncate border border-zinc-200">
                  {dealUrl}
                </div>
                <button onClick={copyLink} className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-500 hover:text-zinc-700">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              {/* Social share buttons */}
              <div className="flex gap-2">
                {/* iMessage / SMS */}
                <a
                  href={`sms:&body=${encodeURIComponent(`${shareText} ${dealUrl}`)}`}
                  className="flex-1 h-9 rounded-lg bg-green-500 text-white text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-green-600 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>
                  iMessage
                </a>
                {/* WhatsApp */}
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${dealUrl}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-9 rounded-lg bg-[#25D366] text-white text-xs font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  WhatsApp
                </a>
                {/* X (Twitter) */}
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(dealUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-9 rounded-lg bg-black text-white text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-zinc-800 transition-colors"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  X
                </a>
                {/* Native share (mobile) */}
                {typeof navigator !== "undefined" && navigator.share && (
                  <button
                    onClick={() => navigator.share({ title: deal.event_name, text: shareText, url: dealUrl })}
                    className="w-9 h-9 rounded-lg bg-zinc-200 text-zinc-600 flex items-center justify-center hover:bg-zinc-300 transition-colors flex-shrink-0"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })()}

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

      {/* Conversation closed banner */}
      {isConversationClosed && deal.status !== "OPEN" && (
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
          <p className="text-sm text-zinc-500 text-center">This deal was claimed by another buyer.</p>
        </div>
      )}

      {/* On-chain transaction status banner */}
      {(escrow.isLoading || depositLoading) && (
        <div className="px-4 py-3 bg-orange-50 border-b border-orange-200 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
          <span className="text-sm text-orange-700 font-medium">
            {depositLoading ? "Processing deposit..." : STEP_LABELS[escrow.step]}
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

      {depositError && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{depositError}</p>
          <button onClick={() => setDepositError(null)} className="text-xs text-red-500 underline mt-1">
            Dismiss
          </button>
        </div>
      )}

      {/* Chat / Dashboard area */}
      <div className="flex-1 overflow-hidden">
        {/* Seller sees dashboard when deal is OPEN */}
        {isSeller && deal.status === "OPEN" ? (
          <SellerDashboard
            dealId={deal.id}
            sellerId={user!.id}
            onSelectConversation={(convId, name) => {
              setSelectedConvId(convId);
              setSelectedBuyerName(name);
            }}
          />
        ) : (!isSeller && !conversationId) || (isSeller && deal.status !== "OPEN" && deal.buyer_id && !conversationId) ? (
          /* Waiting for conversation to load (both anonymous and authenticated) */
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          /* Both anonymous and authenticated users see Chat */
          <Chat
            dealId={deal.id}
            userId={user?.id || null}
            userRole={userRole}
            chatMode={deal.chat_mode}
            conversationId={conversationId}
            anonymousId={!authenticated ? anonymousId : null}
            disabled={isTerminal || isConversationClosed || disputeQuestionsComplete || (!isSeller && !isBuyer && deal.status !== "OPEN")}
            placeholder={deal.status === "OPEN" && !isSeller ? (buyerOfferAccepted ? "Ask a question..." : "Make an offer...") : "Type a message..."}
            onDepositRequest={(cents) => setNegotiatedPriceCents(cents)}
            onDeposit={handleDeposit}
            onLogin={!authenticated ? login : undefined}
            depositLoading={depositLoading}
            accessToken={chatAccessToken}
            authenticated={authenticated}
            dealStatus={deal.status}
            dealPriceCents={effectivePrice}
            buyerOfferAccepted={buyerOfferAccepted}
            onTransfer={handleTransfer}
            transferLoading={escrow.isLoading && escrow.step === "transferring"}
            onConfirm={handleConfirm}
            onDispute={handleDispute}
            confirmLoading={escrow.isLoading && escrow.step === "confirming"}
            disputeLoading={escrow.isLoading && escrow.step === "disputing"}
            transferMethod={deal.transfer_method || ""}
          />
        )}
      </div>

      {/* Action buttons */}
      {!isTerminal && !isConversationClosed && (
        <div className="border-t border-zinc-200 px-4 py-3 space-y-2">
          {deal.status === "OPEN" && !isSeller && buyerOfferAccepted && (() => {
            // USDC has 6 decimals; price_cents / 100 = dollars, * 1e6 = USDC units
            const requiredAmount = BigInt(effectivePrice) * BigInt(10000);
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
                        Need {(effectivePrice / 100).toFixed(2)} USDC
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

                {/* Deposit button removed — now shown inline in chat via requestDeposit tool */}
              </>
            );
          })()}

          {/* Transfer and confirm/dispute buttons moved inline to chat via tools */}
        </div>
      )}
    </div>
  );
}
