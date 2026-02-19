# Deal — AI-Powered Ticket Escrow

Peer-to-peer ticket sales have a trust problem. Buyers send money and hope. Sellers send tickets and hope. StubHub charges 20-30%. Venmo offers zero protection.

Deal sits in the middle: AI-managed USDC escrow on Base, accessible via a shareable link. Seller describes their tickets in plain English, AI structures the deal, first buyer to deposit claims it. Completely free — zero fees, gas sponsored.

```
Seller posts link in Facebook group
  → 15 people click it
  → First to deposit $400 USDC wins
  → Seller transfers tickets via Ticketmaster
  → Buyer confirms receipt
  → $400 released to seller (zero fees)
  → Gas cost: sponsored by Deal
```

## How It Works

### For Sellers
1. Log in with your phone number (SMS OTP via Privy)
2. Describe your tickets in plain text — the AI extracts event, date, venue, section, row, seats, price, and transfer method
3. Get a shareable deal link (`deal.app/deal/abc123`)
4. Share it anywhere — Facebook groups, DMs, Marketplace
5. First buyer to deposit claims the deal. Transfer the tickets, get paid.

### For Buyers
1. Open the deal link — see event details, terms, price
2. Ask the AI questions before committing ("Are these aisle seats?", "Is the price firm?")
3. Deposit USDC via Coinbase Onramp (Apple Pay or debit card, no crypto knowledge needed)
4. Seller transfers tickets to your Ticketmaster/AXS account
5. Confirm receipt — or open a dispute if something's wrong

### Disputes
When a buyer reports an issue, the chat splits into private threads. The AI collects evidence (screenshots) from both sides independently, then renders a binding ruling. No human admin in the loop.

- Wrong tickets delivered → seller must resend or refund
- Tickets never received → auto-refund after timeout
- Invalid/fake tickets → refund
- No evidence from either party → buyer-favoring default (seller has burden of proof)

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  DEAL LINK                        │
│           deal.app/deal/abc123                     │
│                                                   │
│  Seller View         AI Agent         Buyer View  │
│                                                   │
│         ┌──────────────────────────┐              │
│         │     Next.js on Vercel    │              │
│         └────────────┬─────────────┘              │
│                      │                            │
│    ┌─────────┬───────┼───────┬──────────┐         │
│    │         │       │       │          │         │
│  Supabase  Twilio  Privy  Escrow    Claude        │
│  DB+RT+RLS  SMS    Auth+  Contract   AI Agent     │
│             notify  Wallet (Base)                  │
└──────────────────────────────────────────────────┘
```

**Supabase** — Postgres database, Row Level Security, Realtime subscriptions for live chat, Storage for dispute screenshots

**Privy** — SMS login, embedded wallets on Base (no seed phrases, passkey-based). Both buyer and seller get wallets automatically — they never need to know about crypto.

**Coinbase Onramp** — Guest checkout with Apple Pay or debit card. USDC delivered to buyer's Privy wallet in seconds. Zero-fee USDC (with Coinbase approval). Chargebacks hit Coinbase, not us.

**Escrow Contract** — Solidity contract on Base holding USDC. Zero fees — the full deposit amount goes to the seller. Permissionless timeouts, dispute freezing. Full lifecycle: deposit → transfer → confirm → release.

**Claude API** — AI agent for deal creation (free text parsing), buyer Q&A, transaction mediation, and dispute adjudication with evidence review.

**Twilio** — SMS notifications only (not conversational). Each text links the user back to the deal page.

## Deal State Machine

```
OPEN ──→ FUNDED ──→ TRANSFERRED ──→ CONFIRMED ──→ RELEASED
           │            │
           │            ├──→ DISPUTED ──→ RESOLVED (refund or release)
           │            │
           │            └──→ AUTO_RELEASED (buyer timeout: 4h)
           │
           └──→ AUTO_REFUNDED (seller timeout: 2h)

OPEN ──→ EXPIRED (no deposit within 7 days)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Auth | Privy (SMS OTP + embedded wallets) |
| Database | Supabase (Postgres + Realtime + RLS) |
| Payments | Coinbase Onramp (Apple Pay, debit card → USDC) |
| Escrow | Solidity on Base (OpenZeppelin, zero fees, gas sponsored) |
| AI | Claude Sonnet via Anthropic API |
| SMS | Twilio (notification-only) |
| Hosting | Vercel (with cron for timeout enforcement) |

## Project Structure

```
src/
├── app/
│   ├── page.tsx                          # Landing page
│   ├── sell/page.tsx                     # Seller deal creation (AI chat)
│   ├── deal/[shortCode]/page.tsx         # Deal page (progress + chat + actions)
│   └── api/
│       ├── auth/route.ts                 # User upsert after Privy auth
│       ├── deals/route.ts                # POST: create deal
│       ├── deals/[id]/route.ts           # GET: deal by ID or short_code
│       ├── deals/[id]/messages/route.ts  # GET/POST: chat messages + AI
│       ├── deals/[id]/deposit/route.ts   # POST: escrow deposit params
│       ├── deals/[id]/claim/route.ts     # POST: atomic first-to-deposit claim
│       ├── deals/[id]/transfer/route.ts  # POST: seller marks transferred
│       ├── deals/[id]/confirm/route.ts   # POST: buyer confirms → release
│       ├── deals/[id]/dispute/route.ts   # POST: open dispute
│       ├── deals/[id]/resolve/route.ts   # POST: AI ruling → on-chain resolve
│       ├── sell/chat/route.ts            # POST: seller AI chat
│       └── cron/timeouts/route.ts        # Vercel cron (every 15min)
├── components/
│   ├── providers.tsx                     # Privy + app context
│   ├── auth-gate.tsx                     # Auth guard
│   ├── progress-tracker.tsx              # 4-step deal progress bar
│   ├── chat.tsx                          # Realtime chat (Supabase channels)
│   └── name-prompt.tsx                   # First-name collection
├── lib/
│   ├── ai/agent.ts                       # Claude AI agent (deal creation + chat)
│   ├── constants.ts                      # Statuses, timeouts, chain config
│   ├── escrow.ts                         # Viem contract interactions
│   ├── twilio.ts                         # SMS notification functions
│   ├── supabase/client.ts                # Browser Supabase client
│   ├── supabase/server.ts                # Service role Supabase client
│   └── types/database.ts                 # TypeScript types for all tables
contracts/
├── TicketEscrow.sol                      # USDC escrow contract
└── MockERC20.sol                         # Test token
supabase/
└── migrations/001_initial_schema.sql     # Full schema + RLS + triggers
```

## Database Schema

Four tables with Row Level Security:

- **users** — phone, wallet_address, privy_user_id, name, email
- **deals** — short_code, status, seller/buyer IDs, event details, pricing, timestamps for each state transition
- **messages** — deal_id, sender, role (seller/buyer/ai/system), visibility (all/seller_only/buyer_only), content
- **deal_events** — audit log of every state change

Race condition protection for first-to-deposit via atomic Postgres function:
```sql
UPDATE deals
SET buyer_id = $1, status = 'FUNDED', locked_at = now()
WHERE id = $2 AND status = 'OPEN' AND buyer_id IS NULL
RETURNING id;
```

## Escrow Contract

Deployed on Base. Holds USDC for active deals. Key functions:

| Function | Caller | Condition |
|---|---|---|
| `deposit()` | Buyer | Deal doesn't exist yet |
| `markTransferred()` | Seller | Funded, before deadline |
| `confirm()` | Buyer | Transferred |
| `refund()` | Anyone | Funded, deadline passed (permissionless) |
| `autoRelease()` | Anyone | Transferred, deadline passed (permissionless) |
| `dispute()` | Buyer | Transferred, before deadline |
| `resolveDispute()` | Platform only | Disputed (AI ruling) |

Gas for a full deal lifecycle: sponsored by Deal (free for users).

## Setup

### Prerequisites
- Node.js 20+ (Node 22 LTS for Hardhat contract compilation)
- Accounts: Supabase, Privy, Twilio, Anthropic, Coinbase Developer Platform

### 1. Clone and install

```bash
git clone https://github.com/ClementSutjiatma/deal.git
cd deal
npm install
```

### 2. Set up Supabase

Create a Supabase project and run the migration:

```bash
# Via Supabase dashboard: SQL Editor → paste contents of
# supabase/migrations/001_initial_schema.sql
```

### 3. Configure environment

Copy `.env.local.example` to `.env.local` and fill in:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Privy (privy.io → create app → enable SMS + embedded wallets on Base)
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# Twilio (twilio.com → get phone number)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+15551234567

# Anthropic (console.anthropic.com)
ANTHROPIC_API_KEY=your_anthropic_api_key

# Escrow contract (deploy first, then fill in)
NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_USDC_CONTRACT_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
PLATFORM_WALLET_PRIVATE_KEY=your_platform_wallet_private_key

# Base
NEXT_PUBLIC_CHAIN_ID=8453
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org

# Coinbase Onramp (coinbase.com/developer-platform)
COINBASE_ONRAMP_APP_ID=your_coinbase_app_id

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Deploy the escrow contract

```bash
# Requires Node.js <= 22 LTS
npx hardhat compile
npx hardhat run scripts/deploy.ts --network base-sepolia
```

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Economics

```
Ticket sale:      $400
Onramp fee:       $0 (zero-fee USDC)
Gas (Base):       $0 (sponsored by Deal)
Platform fee:     $0 (completely free)
───────────────────────
Buyer pays:       $400
Seller receives:  $400

vs. StubHub:      $80-120 in fees (20-30%)
vs. Venmo:        $0 fees, $400 of risk
```

## License

MIT
