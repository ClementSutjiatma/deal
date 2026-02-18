"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Send, Paperclip } from "lucide-react";
import type { Message } from "@/lib/types/database";

interface Props {
  dealId: string;
  userId: string | null;
  userRole: "seller" | "buyer" | null;
  chatMode: string;
  disabled?: boolean;
  placeholder?: string;
}

export function Chat({ dealId, userId, userRole, chatMode, disabled, placeholder }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Fetch initial messages
  useEffect(() => {
    async function fetchMessages() {
      const params = new URLSearchParams();
      if (userId) params.set("user_id", userId);

      const res = await fetch(`/api/deals/${dealId}/messages?${params}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    }
    fetchMessages();
  }, [dealId, userId]);

  // Subscribe to realtime
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${dealId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `deal_id=eq.${dealId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          // Check visibility
          if (chatMode === "dispute" && userId) {
            if (newMsg.visibility === "seller_only" && userRole !== "seller") return;
            if (newMsg.visibility === "buyer_only" && userRole !== "buyer") return;
          }
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
  }, [dealId, userId, userRole, chatMode, supabase]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !userRole || sending) return;

    setSending(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_id: userId,
          content: input.trim(),
          role: userRole,
        }),
      });

      if (res.ok) {
        setInput("");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === userRole ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                msg.role === "ai" || msg.role === "system"
                  ? "bg-zinc-100 text-zinc-700"
                  : msg.role === userRole
                    ? "bg-orange-500 text-white"
                    : "bg-zinc-200 text-zinc-900"
              }`}
            >
              {msg.role !== userRole && msg.role !== "ai" && msg.role !== "system" && (
                <div className="text-xs font-semibold mb-1 opacity-70">
                  {msg.role === "seller" ? "Seller" : "Buyer"}
                </div>
              )}
              {msg.role === "ai" && (
                <div className="text-xs font-semibold mb-1 text-orange-600">AI Agent</div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.media_urls && msg.media_urls.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.media_urls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt="attachment"
                      className="rounded-lg max-w-full max-h-48 object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!disabled && userRole && (
        <form onSubmit={sendMessage} className="border-t border-zinc-200 px-4 py-3 flex gap-2">
          <button
            type="button"
            className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder || "Type a message..."}
            className="flex-1 h-10 px-4 rounded-full bg-zinc-100 text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  );
}
