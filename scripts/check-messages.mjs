#!/usr/bin/env node
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const envFile = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const convId = "079026fb-1582-4243-a3ac-a6e0297fca5e";
const { data: msgs } = await sb.from("messages").select("*")
  .eq("conversation_id", convId)
  .order("created_at", { ascending: true });

console.log("Raw messages (role sequence):");
msgs.forEach((m, i) => {
  const sdkRole = m.role === "ai" ? "assistant" : "user";
  const content = m.content || "(empty)";
  console.log(`  ${i}. [${sdkRole}] (${m.role}) ${content.substring(0, 70)}`);
});

// Simulate merging
const merged = [];
for (const m of msgs) {
  const sdkRole = m.role === "ai" ? "assistant" : "user";
  const last = merged[merged.length - 1];
  if (last && last.role === sdkRole) {
    merged[merged.length - 1].content += "\n" + (m.content || "");
    merged[merged.length - 1].count++;
  } else {
    merged.push({ role: sdkRole, content: m.content || "", count: 1 });
  }
}

console.log("\nAfter merging (what gets sent to Claude):");
merged.forEach((m, i) => {
  const preview = m.content.length > 80 ? m.content.substring(0, 80) + "..." : m.content;
  console.log(`  ${i}. [${m.role}] (${m.count} merged) ${preview}`);
});

console.log("\nLast message role:", merged[merged.length - 1]?.role);
console.log("Merged message count:", merged.length);

// Check for empty assistant messages
const emptyAI = msgs.filter(m => m.role === "ai" && (!m.content || m.content.trim() === ""));
console.log("\nEmpty AI messages:", emptyAI.length);
for (const m of emptyAI) {
  console.log(`  id: ${m.id} | created: ${m.created_at}`);
}
