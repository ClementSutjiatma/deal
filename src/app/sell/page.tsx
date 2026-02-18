"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Copy, Share2, Check } from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { NamePrompt } from "@/components/name-prompt";
import { useAppUser } from "@/components/providers";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function SellPage() {
  return (
    <AuthGate>
      <SellChat />
    </AuthGate>
  );
}

function SellChat() {
  const { user } = useAppUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [dealLink, setDealLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // Initial AI greeting
  useEffect(() => {
    if (!initialized.current && user) {
      initialized.current = true;
      setMessages([
        {
          role: "assistant",
          content: `Hey${user.name ? ` ${user.name}` : ""}! What are you selling? Just describe it like you would in a Facebook post.`,
        },
      ]);
    }
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending || !user) return;

    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setSending(true);

    try {
      // Call deal creation AI endpoint
      const res = await fetch("/api/sell/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages,
          seller_id: user.id,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages([...updatedMessages, { role: "assistant", content: data.content }]);

        if (data.deal_link) {
          setDealLink(data.deal_link);
        }
      }
    } finally {
      setSending(false);
    }
  }, [input, sending, user, messages]);

  async function copyLink() {
    if (!dealLink) return;
    await navigator.clipboard.writeText(dealLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareLink() {
    if (!dealLink) return;
    if (navigator.share) {
      await navigator.share({ url: dealLink, title: "Ticket deal" });
    } else {
      copyLink();
    }
  }

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200">
        <h1 className="text-lg font-semibold">Sell your tickets</h1>
      </div>

      {/* Name prompt */}
      <div className="px-4 pt-3">
        <NamePrompt />
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-orange-500 text-white"
                  : "bg-zinc-100 text-zinc-700"
              }`}
            >
              {msg.role === "assistant" && (
                <div className="text-xs font-semibold mb-1 text-orange-600">AI Agent</div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {/* Deal link card */}
        {dealLink && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-medium text-green-800">Your deal link is ready!</p>
            <div className="bg-white rounded-xl px-3 py-2 text-sm font-mono text-zinc-700 break-all">
              {dealLink}
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyLink}
                className="flex-1 h-10 rounded-xl bg-green-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-green-600 transition-colors"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied!" : "Copy link"}
              </button>
              <button
                onClick={shareLink}
                className="h-10 w-10 rounded-xl bg-green-100 text-green-700 flex items-center justify-center hover:bg-green-200 transition-colors"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-zinc-100 rounded-2xl px-4 py-2 text-sm text-zinc-400">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!dealLink && (
        <form onSubmit={sendMessage} className="border-t border-zinc-200 px-4 py-3 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your tickets..."
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
