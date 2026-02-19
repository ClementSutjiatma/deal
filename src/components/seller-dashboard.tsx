"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { MessageSquare, ChevronRight } from "lucide-react";
import type { Conversation } from "@/lib/types/database";

interface ConversationWithBuyer extends Conversation {
  buyer: { id: string; name: string | null };
}

interface Props {
  dealId: string;
  sellerId: string;
  onSelectConversation: (conversationId: string, buyerName: string) => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SellerDashboard({ dealId, sellerId, onSelectConversation }: Props) {
  const [conversations, setConversations] = useState<ConversationWithBuyer[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function fetchConversations() {
      const res = await fetch(`/api/deals/${dealId}/conversations?seller_id=${sellerId}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
      setLoading(false);
    }
    fetchConversations();
  }, [dealId, sellerId]);

  // Subscribe to realtime updates on conversations
  useEffect(() => {
    const channel = supabase
      .channel(`conversations:${dealId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `deal_id=eq.${dealId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            // Refetch to get the joined buyer data
            fetch(`/api/deals/${dealId}/conversations?seller_id=${sellerId}`)
              .then((res) => res.json())
              .then((data) => setConversations(data))
              .catch(() => {});
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as Conversation;
            setConversations((prev) =>
              prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dealId, sellerId, supabase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-3">
        <MessageSquare className="w-10 h-10 text-zinc-300" />
        <p className="text-sm text-zinc-500">
          No buyers have started a conversation yet. Share your deal link to attract buyers.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-zinc-100">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
          {conversations.length} buyer{conversations.length !== 1 ? "s" : ""} interested
        </p>
      </div>
      <div className="divide-y divide-zinc-100">
        {conversations.map((conv) => {
          const buyerName = conv.buyer?.name || "Anonymous";
          const statusBadge =
            conv.status === "claimed"
              ? "Deposited"
              : conv.status === "closed"
                ? "Closed"
                : conv.negotiated_price_cents
                  ? `$${(conv.negotiated_price_cents / 100).toFixed(2)} offered`
                  : null;

          return (
            <button
              key={conv.id}
              onClick={() => onSelectConversation(conv.id, buyerName)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-zinc-50 transition-colors text-left"
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {buyerName.charAt(0).toUpperCase()}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900 truncate">
                    {buyerName}
                  </span>
                  {statusBadge && (
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        conv.status === "claimed"
                          ? "bg-green-100 text-green-700"
                          : conv.status === "closed"
                            ? "bg-zinc-100 text-zinc-500"
                            : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      {statusBadge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 truncate mt-0.5">
                  {conv.last_message_preview || "No messages yet"}
                </p>
              </div>

              {/* Right side */}
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {conv.last_message_at && (
                  <span className="text-[10px] text-zinc-400">
                    {timeAgo(conv.last_message_at)}
                  </span>
                )}
                {conv.message_count > 0 && (
                  <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">
                    {conv.message_count}
                  </span>
                )}
              </div>

              <ChevronRight className="w-4 h-4 text-zinc-300 flex-shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
