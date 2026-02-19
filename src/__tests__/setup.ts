import { vi } from "vitest";

// ─── Environment variables ───────────────────────────────────────────
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_PRIVY_APP_ID = "test-privy-app-id";
process.env.PRIVY_APP_SECRET = "test-privy-secret";
process.env.PRIVY_WALLET_ID = "test-wallet-id";
process.env.PRIVY_WALLET_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS =
  "0x29e155ed24bb2cf34af5bbf553e407a2878dba7d";
process.env.NEXT_PUBLIC_USDC_CONTRACT_ADDRESS =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
process.env.NEXT_PUBLIC_CHAIN_ID = "84532";
process.env.TWILIO_ACCOUNT_SID = "test-twilio-sid";
process.env.TWILIO_AUTH_TOKEN = "test-twilio-token";
process.env.TWILIO_PHONE_NUMBER = "+15551234567";
process.env.NEXT_PUBLIC_APP_URL = "https://deal-bay.vercel.app";
process.env.CRON_SECRET = "test-cron-secret";
process.env.ADMIN_API_KEY = "test-admin-api-key";

// ─── Mock Twilio ─────────────────────────────────────────────────────
vi.mock("twilio", () => ({
  default: () => ({
    messages: {
      create: vi.fn().mockResolvedValue({ sid: "SM_test" }),
    },
  }),
}));

// ─── Mock escrow (on-chain) ──────────────────────────────────────────
vi.mock("@/lib/escrow", () => ({
  getDepositParams: vi.fn(
    (
      dealUuid: string,
      sellerAddress: string,
      priceCents: number,
      transferDeadline: number,
      confirmDeadline: number
    ) => ({
      escrowAddress: "0x29e155ed24bb2cf34af5bbf553e407a2878dba7d",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      dealId: "0xabcdef1234567890",
      seller: sellerAddress,
      amount: BigInt(priceCents) * BigInt(10000),
      transferDeadline: BigInt(transferDeadline),
      confirmDeadline: BigInt(confirmDeadline),
      escrowAbi: [],
      erc20Abi: [],
    })
  ),
  resolveDisputeOnChain: vi
    .fn()
    .mockResolvedValue("0xtx_resolve_hash"),
  triggerRefund: vi.fn().mockResolvedValue("0xtx_refund_hash"),
  triggerAutoRelease: vi
    .fn()
    .mockResolvedValue("0xtx_autorelease_hash"),
  dealIdToBytes32: vi.fn().mockReturnValue("0xabcdef1234567890"),
  getPublicClient: vi.fn(),
  getPlatformWalletClient: vi.fn(),
  getDealOnChain: vi.fn().mockResolvedValue([
    // buyer, seller, amount, platformFeeBps, depositedAt, transferredAt,
    // disputedAt, transferDeadline, confirmDeadline, status
    "0xbuyer", "0xseller", 200000000n, 250n, 1700000000n, 1700003600n,
    0n, 7200n, 14400n, 3n, // 3 = Released
  ]),
  verifyTxReceipt: vi.fn().mockResolvedValue(true),
}));

// ─── Mock Privy (server auth for API routes) ─────────────────────────
vi.mock("@/lib/privy", () => ({
  getPrivyClient: vi.fn().mockReturnValue({
    verifyAuthToken: vi.fn().mockResolvedValue({
      userId: "privy_test-user",
    }),
  }),
}));

// ─── Mock auth helper ────────────────────────────────────────────────
// Default: returns an authenticated test user. Tests can override with
// vi.mocked(authenticateRequest).mockResolvedValueOnce(null) for 401 tests.
vi.mock("@/lib/auth", () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    user: {
      id: "test-auth-user-id",
      phone: "+15551110000",
      email: null,
      name: "Test Auth User",
      wallet_address: "0xTestWallet1234567890abcdef1234567890ab",
      privy_user_id: "privy_test-user",
      phone_verified_at: new Date().toISOString(),
      email_verified_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    privyUserId: "privy_test-user",
  }),
}));

// ─── Mock AI agent ───────────────────────────────────────────────────
vi.mock("@/lib/ai/agent", () => ({
  getAIResponse: vi.fn().mockResolvedValue({
    content: "AI response for testing",
    command: null,
  }),
  streamDealCreation: vi.fn(),
  getDealCreationResponse: vi.fn(),
}));
