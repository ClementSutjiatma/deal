"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Send, Copy, Share2, Check } from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { NamePrompt } from "@/components/name-prompt";
import { useAppUser } from "@/components/providers";

export default function SellPage() {
  return (
    <AuthGate>
      <SellChatGate />
    </AuthGate>
  );
}

/** Wait for user to load before rendering chat (transport needs seller_id at construction) */
function SellChatGate() {
  const { user } = useAppUser();
  if (!user) {
    return (
      <div className="flex flex-col h-screen max-w-lg mx-auto items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return <SellChat />;
}

/** Extract text content from a UIMessage's parts array */
function getMessageText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

/** Strip <deal_data> tags from displayed text */
function cleanContent(text: string): string {
  return text.replace(/<deal_data>[\s\S]*?<\/deal_data>/g, "").trim();
}

function SellChat() {
  const { user } = useAppUser();
  const [dealLink, setDealLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const greeting = user?.name
    ? `Hey ${user.name}! What are you selling? Just describe it like you would in a Facebook post.`
    : "Hey! What are you selling? Just describe it like you would in a Facebook post.";

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/sell/chat",
      headers: {
        "x-seller-id": user?.id ?? "",
      },
    }),
    messages: [
      {
        id: "greeting",
        role: "assistant" as "assistant" | "user" | "system",
        parts: [{ type: "text" as const, text: greeting }],
      },
    ],
    onFinish: async ({ message }) => {
      // When the AI response finishes, check if it contains deal data
      const text = getMessageText(message.parts as Array<{ type: string; text?: string }>);
      if (text.includes("<deal_data>") && user?.id) {
        // Give the server a moment to create the deal in its onFinish callback
        await new Promise((r) => setTimeout(r, 1500));

        // Fetch the deal link
        const res = await fetch(`/api/sell/deal-link?seller_id=${user.id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.deal_link) {
            setDealLink(data.deal_link);
          }
        }
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading || !user) return;
      const text = input.trim();
      setInput("");
      await sendMessage({ text });
    },
    [input, isLoading, user, sendMessage]
  );

  const copyLink = useCallback(async () => {
    if (!dealLink) return;
    await navigator.clipboard.writeText(dealLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [dealLink]);

  const shareLink = useCallback(async () => {
    if (!dealLink) return;
    if (navigator.share) {
      await navigator.share({ url: dealLink, title: "Ticket deal" });
    } else {
      copyLink();
    }
  }, [dealLink, copyLink]);

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
        {messages.map((msg) => {
          const rawText = getMessageText(msg.parts as Array<{ type: string; text?: string }>);
          const content = cleanContent(rawText);
          if (!content) return null;

          return (
            <div
              key={msg.id}
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
                  <div className="text-xs font-semibold mb-1 text-orange-600">
                    AI Agent
                  </div>
                )}
                <div className="whitespace-pre-wrap">{content}</div>
              </div>
            </div>
          );
        })}

        {/* Deal link card */}
        {dealLink && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-medium text-green-800">
              Your deal link is ready!
            </p>
            <div className="bg-white rounded-xl px-3 py-2 text-sm font-mono text-zinc-700 break-all">
              {dealLink}
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyLink}
                className="flex-1 h-10 rounded-xl bg-green-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-green-600 transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
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

        {/* Loading indicator */}
        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-zinc-100 rounded-2xl px-4 py-2 text-sm text-zinc-400">
              <div className="flex gap-1">
                <div
                  className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!dealLink && (
        <form
          onSubmit={handleSubmit}
          className="border-t border-zinc-200 px-4 py-3 flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your tickets..."
            className="flex-1 h-10 px-4 rounded-full bg-zinc-100 text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  );
}
