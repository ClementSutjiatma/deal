"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, FileText } from "lucide-react";
import type { Message } from "@/lib/types/database";

interface Props {
  dealId: string;
  conversationId: string;
  buyerName: string;
  onBack: () => void;
}

/** Strip deposit_request tags from displayed content */
function cleanContent(text: string): string {
  return text.replace(/<deposit_request\s+amount_cents="\d+"\s*\/>/g, "").trim();
}

export function ConversationReadView({ dealId, conversationId, buyerName, onBack }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    async function fetchMessages() {
      const params = new URLSearchParams({
        conversation_id: conversationId,
      });
      const res = await fetch(`/api/deals/${dealId}/messages?${params}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
      setLoading(false);
    }
    fetchMessages();
  }, [dealId, conversationId]);

  // Subscribe to realtime for this conversation
  useEffect(() => {
    const channel = supabase
      .channel(`read-messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, supabase]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center hover:bg-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-zinc-600" />
        </button>
        <div>
          <p className="text-sm font-medium text-zinc-900">{buyerName}</p>
          <p className="text-xs text-zinc-400">Read-only view</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-zinc-400 py-8">No messages yet</p>
        ) : (
          messages.map((msg) => {
            const displayContent = cleanContent(msg.content);
            const meta = msg.metadata as Record<string, unknown> | null;
            const depositCents = meta?.deposit_request_cents as number | undefined;

            return (
              <div
                key={msg.id}
                className={`flex ${msg.role === "buyer" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    msg.role === "ai" || msg.role === "system"
                      ? "bg-zinc-100 text-zinc-700"
                      : msg.role === "buyer"
                        ? "bg-blue-500 text-white"
                        : "bg-zinc-200 text-zinc-900"
                  }`}
                >
                  {msg.role === "buyer" && (
                    <div className="text-xs font-semibold mb-1 opacity-70">{buyerName}</div>
                  )}
                  {msg.role === "ai" && (
                    <div className="text-xs font-semibold mb-1 text-emerald-700">AI Agent</div>
                  )}
                  <div className="whitespace-pre-wrap">{displayContent}</div>
                  {depositCents && (
                    <div className="mt-2 text-xs bg-emerald-50 text-emerald-800 rounded-lg px-2 py-1 border border-emerald-200">
                      Deposit prompted: ${(depositCents / 100).toFixed(2)}
                    </div>
                  )}
                  {msg.media_urls && msg.media_urls.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.media_urls.map((url, i) =>
                        url.toLowerCase().endsWith(".pdf") ? (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/50 border border-zinc-200 hover:bg-zinc-50 transition-colors"
                          >
                            <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                            <span className="text-xs text-zinc-600 truncate">
                              {decodeURIComponent(url.split("/").pop() || "document.pdf")}
                            </span>
                          </a>
                        ) : (
                          <img
                            key={i}
                            src={url}
                            alt="attachment"
                            className="rounded-lg max-w-full max-h-48 object-cover"
                          />
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
