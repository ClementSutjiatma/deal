"use client";

import React from "react";

/**
 * Lightweight markdown renderer for chat messages.
 * Handles: **bold**, - unordered lists, 1. ordered lists.
 * No external dependencies.
 */
export function MarkdownText({ children }: { children: string }) {
  const lines = children.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: { type: "ul" | "ol"; items: React.ReactNode[] } | null = null;
  let key = 0;

  function flushList() {
    if (!currentList) return;
    if (currentList.type === "ul") {
      elements.push(
        <ul key={key++} className="list-disc list-inside space-y-0.5 my-1">
          {currentList.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={key++} className="list-decimal list-inside space-y-0.5 my-1">
          {currentList.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
    }
    currentList = null;
  }

  for (const line of lines) {
    // Unordered list: "- item" or "* item"
    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)/);
    if (ulMatch) {
      if (currentList?.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList!.items.push(renderInline(ulMatch[1]));
      continue;
    }

    // Ordered list: "1. item", "2. item", etc.
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)/);
    if (olMatch) {
      if (currentList?.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList!.items.push(renderInline(olMatch[1]));
      continue;
    }

    // Not a list item — flush any pending list
    flushList();

    // Empty line → spacing
    if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
      continue;
    }

    // Regular paragraph line
    elements.push(
      <div key={key++}>{renderInline(line)}</div>
    );
  }

  flushList();

  return <div className="space-y-0.5">{elements}</div>;
}

/** Render inline markdown: **bold** */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <strong key={key++} className="font-semibold">
        {match[1]}
      </strong>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
