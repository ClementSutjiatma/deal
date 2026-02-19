# Deal Project — Claude Notes

## Vercel Environment Variables

**CRITICAL: When adding env vars to Vercel via CLI, use `echo -n` (no trailing newline), NOT `printf "%s\n"`.**

Bad (adds literal `\n` to the value):
```bash
printf "%s\n" "value" | vercel env add NAME production
```

Good (clean value, no trailing characters):
```bash
echo -n "value" | vercel env add NAME production
```

If env vars appear broken (e.g. Privy says "invalid app ID"), pull and inspect with `cat -v`:
```bash
vercel env pull .env.check --environment production --yes
cat -v .env.check  # look for \n at end of values
```

## Deployment

- **Vercel project**: `clemsut-gmailcoms-projects/deal`
- **Production URL**: `https://deal-bay.vercel.app`
- **Hobby plan**: Cron jobs limited to once daily (`0 0 * * *`)
- Always use `vercel --prod --force --yes` after changing env vars to ensure clean build

## Key Infrastructure

- **Chain**: Base Sepolia (testnet, chain ID 84532)
- **Escrow contract**: `0x29e155ed24bb2cf34af5bbf553e407a2878dba7d`
- **USDC**: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- **Privy wallet**: `0x448B6EBdBc5B6D0fcC25B5Ad0d6f6b0E9A242D73` (ID: `z6pytacq5jhpezkytramtd6l`)
- **Supabase project**: `ahnogtglijmujnfbkyww`

## Node Version

Hardhat 3 requires Node 22. Use:
```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22
```
Or use absolute path: `/Users/clementsutjiatma/.nvm/versions/node/v22.22.0/bin/node`

pnpm is installed via homebrew at `/opt/homebrew/bin/pnpm`.

## AI SDK v6 Notes

- **Package**: `ai@6` + `@ai-sdk/anthropic@3` + `@ai-sdk/react@3`
- **`DefaultChatTransport` body merge is broken** — The `body` option does NOT get merged into POST requests (known SDK bug). Use custom headers (`headers: { "x-seller-id": user.id }`) instead.
- **`useChat` has no `input`/`setInput`/`handleSubmit`** — Manage input state yourself with `useState`. Call `sendMessage({ text })`.
- **Messages use `parts` array** — `UIMessage` has `parts: [{type: "text", text: "..."}]`, not `content`.
- **Server route must convert UIMessages** — Use `convertToModelMessages(uiMessages)` from `ai` to convert before passing to `streamText`/`generateText`.
- **`toUIMessageStreamResponse()`** — Correct method for streaming responses compatible with `useChat` (not `toDataStreamResponse`).
- **Transport is constructed once** — `DefaultChatTransport` bakes in its config at construction time. Gate the component on `user` being loaded so transport gets the correct seller_id header.

## Supabase API Keys

- **`@supabase/supabase-js` requires legacy JWT keys** — It sends the key as both `apikey` header AND `Authorization: Bearer` header. New-format keys (`sbp_`, `sb_secret_`, `sb_publishable_`) cannot be used as Bearer tokens.
- **To get legacy service_role key**: `supabase projects api-keys --project-ref ahnogtglijmujnfbkyww`
- **Current service_role key format**: JWT starting with `eyJ...` (NOT `sbp_...`)

## Known Type Workaround

`@privy-io/server-auth` has a `.d.ts` / `.d.mts` type conflict for `PrivyClient`. Use `as any` cast:
```typescript
privy: getPrivyClient() as any
```
