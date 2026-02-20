#!/usr/bin/env node
/**
 * Add the server-deposit authorization key as a signer to all user embedded wallets.
 * This enables server-side gas-sponsored transactions for deposits, transfers, etc.
 *
 * Key quorum ID: mtot90ao7hbycjalg7f269it (server-deposit)
 */
import { readFileSync } from "fs";
import { PrivyClient } from "@privy-io/node";
import { createClient } from "@supabase/supabase-js";

const KEY_QUORUM_ID = "mtot90ao7hbycjalg7f269it";

// Load env
const envFile = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1].trim()] = val;
  }
}

const privy = new PrivyClient({
  appId: env.NEXT_PUBLIC_PRIVY_APP_ID,
  appSecret: env.PRIVY_APP_SECRET,
});

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Get all users with privy_wallet_id
  const { data: users } = await sb
    .from("users")
    .select("id, email, phone, name, privy_user_id, privy_wallet_id")
    .not("privy_wallet_id", "is", null);

  console.log(`Found ${users.length} users with privy_wallet_id\n`);

  for (const user of users) {
    const label = user.email || user.phone || user.name || user.id;
    console.log(`--- ${label} (wallet: ${user.privy_wallet_id}) ---`);

    // Check current wallet signers
    try {
      const wallet = await privy.wallets().get(user.privy_wallet_id);
      const hasSigner = wallet.additional_signers?.some(s => s.signer_id === KEY_QUORUM_ID);

      if (hasSigner) {
        console.log("  ✅ Already has server-deposit signer");
        continue;
      }

      console.log("  ⚠️  Missing server-deposit signer, adding...");

      // Add the signer (preserve existing signers)
      const existingSigners = (wallet.additional_signers || []).map(s => ({
        signer_id: s.signer_id,
      }));

      const updated = await privy.wallets()._update(user.privy_wallet_id, {
        additional_signers: [
          ...existingSigners,
          { signer_id: KEY_QUORUM_ID },
        ],
      });

      console.log("  ✅ Added! Signers now:", updated.additional_signers?.map(s => s.signer_id));
    } catch (e) {
      console.error(`  ❌ Error: ${e.message}`);
    }
    console.log();
  }

  // Also check for users WITHOUT privy_wallet_id but who have privy_user_id
  // (we can look up and store their wallet ID)
  const { data: noWalletUsers } = await sb
    .from("users")
    .select("id, email, phone, privy_user_id")
    .is("privy_wallet_id", null)
    .not("privy_user_id", "is", null);

  const realUsers = noWalletUsers.filter(u => !u.privy_user_id.startsWith("test"));
  if (realUsers.length > 0) {
    console.log(`\n${realUsers.length} real user(s) missing privy_wallet_id — resolving...`);
    for (const user of realUsers) {
      const label = user.email || user.phone || user.id;
      try {
        const privyUser = await privy.users()._get(user.privy_user_id);
        const embeddedWallet = privyUser.linked_accounts.find(
          (a) => a.type === "wallet" && a.wallet_client_type === "privy" && a.chain_type === "ethereum"
        );
        if (embeddedWallet?.id) {
          console.log(`  ${label}: found wallet ${embeddedWallet.id}, updating DB and adding signer...`);

          // Update DB
          await sb.from("users").update({ privy_wallet_id: embeddedWallet.id }).eq("id", user.id);

          // Add signer
          const wallet = await privy.wallets().get(embeddedWallet.id);
          const hasSigner = wallet.additional_signers?.some(s => s.signer_id === KEY_QUORUM_ID);
          if (!hasSigner) {
            const existingSigners = (wallet.additional_signers || []).map(s => ({
              signer_id: s.signer_id,
            }));
            await privy.wallets()._update(embeddedWallet.id, {
              additional_signers: [...existingSigners, { signer_id: KEY_QUORUM_ID }],
            });
            console.log(`  ✅ Signer added to ${embeddedWallet.id}`);
          } else {
            console.log(`  ✅ Already has signer`);
          }
        } else {
          console.log(`  ${label}: no embedded wallet found`);
        }
      } catch (e) {
        console.error(`  ${label}: error — ${e.message}`);
      }
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
