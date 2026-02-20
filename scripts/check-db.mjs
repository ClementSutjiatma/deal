#!/usr/bin/env node
/**
 * Database diagnostic script - reads .env.local and queries Supabase
 * Run: node scripts/check-db.mjs
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// Load .env.local
const envFile = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== DATABASE DIAGNOSTIC ===\n");
  console.log(`Supabase URL: ${supabaseUrl}\n`);

  // 1. All users
  console.log("--- USERS ---");
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, email, name, phone, wallet_address, privy_user_id, privy_wallet_id, created_at")
    .order("created_at", { ascending: false });

  if (usersErr) {
    console.error("Error fetching users:", usersErr.message);
  } else {
    console.log(`Total users: ${users.length}\n`);
    for (const u of users) {
      console.log(`  User: ${u.name || "(no name)"} | ${u.email || "(no email)"} | ${u.phone || "(no phone)"}`);
      console.log(`    id:              ${u.id}`);
      console.log(`    privy_user_id:   ${u.privy_user_id || "NULL"}`);
      console.log(`    wallet_address:  ${u.wallet_address || "NULL"}`);
      console.log(`    privy_wallet_id: ${u.privy_wallet_id || "NULL"}`);
      console.log(`    created_at:      ${u.created_at}`);
      if (!u.privy_wallet_id) {
        console.log(`    ⚠️  MISSING privy_wallet_id — deposits will fail`);
      }
      console.log();
    }
  }

  // 2. All deals
  console.log("--- DEALS ---");
  const { data: deals, error: dealsErr } = await supabase
    .from("deals")
    .select("id, short_code, status, seller_id, buyer_id, event_name, price_cents, escrow_tx_hash, chat_mode, created_at")
    .order("created_at", { ascending: false });

  if (dealsErr) {
    console.error("Error fetching deals:", dealsErr.message);
  } else {
    console.log(`Total deals: ${deals.length}\n`);
    for (const d of deals) {
      console.log(`  Deal: ${d.short_code} | ${d.event_name} | $${(d.price_cents / 100).toFixed(2)}`);
      console.log(`    id:            ${d.id}`);
      console.log(`    status:        ${d.status}`);
      console.log(`    chat_mode:     ${d.chat_mode}`);
      console.log(`    seller_id:     ${d.seller_id}`);
      console.log(`    buyer_id:      ${d.buyer_id || "NULL"}`);
      console.log(`    escrow_tx:     ${d.escrow_tx_hash || "NULL"}`);
      console.log();
    }
  }

  // 3. Conversations — check for duplicates
  console.log("--- CONVERSATIONS ---");
  const { data: convos, error: convosErr } = await supabase
    .from("conversations")
    .select("id, deal_id, buyer_id, anonymous_id, status, negotiated_price_cents, message_count, last_message_at, created_at")
    .order("created_at", { ascending: false });

  if (convosErr) {
    console.error("Error fetching conversations:", convosErr.message);
  } else {
    console.log(`Total conversations: ${convos.length}\n`);
    for (const c of convos) {
      console.log(`  Conv: ${c.id}`);
      console.log(`    deal_id:        ${c.deal_id}`);
      console.log(`    buyer_id:       ${c.buyer_id || "NULL"}`);
      console.log(`    anonymous_id:   ${c.anonymous_id || "NULL"}`);
      console.log(`    status:         ${c.status}`);
      console.log(`    negotiated:     ${c.negotiated_price_cents ? `$${(c.negotiated_price_cents / 100).toFixed(2)}` : "NULL"}`);
      console.log(`    message_count:  ${c.message_count}`);
      console.log(`    last_msg_at:    ${c.last_message_at || "NULL"}`);
      console.log();
    }

    // Check for duplicates (same deal_id + buyer_id)
    const buyerConvos = convos.filter(c => c.buyer_id);
    const grouped = {};
    for (const c of buyerConvos) {
      const key = `${c.deal_id}:${c.buyer_id}`;
      grouped[key] = grouped[key] || [];
      grouped[key].push(c);
    }
    const duplicates = Object.entries(grouped).filter(([, v]) => v.length > 1);
    if (duplicates.length > 0) {
      console.log("⚠️  DUPLICATE CONVERSATIONS (same deal + buyer):");
      for (const [key, convs] of duplicates) {
        console.log(`  ${key}: ${convs.length} conversations`);
        for (const c of convs) {
          console.log(`    - ${c.id} (status: ${c.status}, msgs: ${c.message_count})`);
        }
      }
    } else {
      console.log("✅ No duplicate conversations found");
    }

    // Check for anonymous convos that might need claiming
    const anonConvos = convos.filter(c => c.anonymous_id && !c.buyer_id);
    if (anonConvos.length > 0) {
      console.log(`\n⚠️  ${anonConvos.length} anonymous conversation(s) without buyer_id:`);
      for (const c of anonConvos) {
        console.log(`  - ${c.id} (deal: ${c.deal_id}, anon: ${c.anonymous_id}, msgs: ${c.message_count})`);
      }
    }
    console.log();
  }

  // 4. Messages — check for orphaned (no conversation_id)
  console.log("--- MESSAGES ---");
  const { data: allMsgs, error: msgsErr } = await supabase
    .from("messages")
    .select("id, deal_id, conversation_id, role, content, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (msgsErr) {
    console.error("Error fetching messages:", msgsErr.message);
  } else {
    console.log(`Recent messages (up to 100): ${allMsgs.length}\n`);

    const orphaned = allMsgs.filter(m => !m.conversation_id && (m.role === "buyer" || m.role === "seller"));
    if (orphaned.length > 0) {
      console.log(`⚠️  ${orphaned.length} orphaned messages (no conversation_id):`);
      for (const m of orphaned) {
        console.log(`  - ${m.id} | ${m.role} | deal: ${m.deal_id} | "${m.content.substring(0, 50)}..."`);
      }
    } else {
      console.log("✅ No orphaned buyer/seller messages (all have conversation_id)");
    }

    // Show message counts per conversation
    const msgsByConvo = {};
    for (const m of allMsgs) {
      const key = m.conversation_id || "NULL";
      msgsByConvo[key] = (msgsByConvo[key] || 0) + 1;
    }
    console.log("\nMessage counts by conversation_id:");
    for (const [key, count] of Object.entries(msgsByConvo)) {
      console.log(`  ${key}: ${count} messages`);
    }
    console.log();
  }

  // 5. Show last 10 messages with full detail
  console.log("--- LAST 10 MESSAGES ---");
  const { data: recentMsgs } = await supabase
    .from("messages")
    .select("id, deal_id, conversation_id, role, content, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (recentMsgs) {
    for (const m of recentMsgs) {
      const preview = m.content.length > 80 ? m.content.substring(0, 80) + "..." : m.content;
      console.log(`  [${m.role}] ${preview}`);
      console.log(`    conv: ${m.conversation_id || "NULL"} | deal: ${m.deal_id} | ${m.created_at}`);
      console.log();
    }
  }

  console.log("=== DIAGNOSTIC COMPLETE ===");
}

main().catch(console.error);
