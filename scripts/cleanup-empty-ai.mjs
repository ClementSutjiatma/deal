#!/usr/bin/env node
/**
 * Cleanup script: Delete empty AI messages that were stored from tool-only responses.
 * These empty messages break conversation history by creating empty assistant turns.
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const envFile = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Find all empty AI messages
const { data: emptyMsgs, error } = await sb
  .from("messages")
  .select("id, deal_id, conversation_id, content, created_at")
  .eq("role", "ai")
  .or("content.is.null,content.eq.");

if (error) {
  console.error("Error:", error.message);
  process.exit(1);
}

console.log(`Found ${emptyMsgs.length} empty AI message(s):`);
for (const m of emptyMsgs) {
  console.log(`  ${m.id} | deal: ${m.deal_id} | conv: ${m.conversation_id} | created: ${m.created_at}`);
}

if (emptyMsgs.length === 0) {
  console.log("Nothing to clean up.");
  process.exit(0);
}

// Delete them
const ids = emptyMsgs.map(m => m.id);
const { error: delErr } = await sb
  .from("messages")
  .delete()
  .in("id", ids);

if (delErr) {
  console.error("Delete error:", delErr.message);
  process.exit(1);
}

console.log(`\nDeleted ${ids.length} empty AI message(s).`);
