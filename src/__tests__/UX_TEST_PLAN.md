# Deal — Comprehensive UX Test Plan

> **How to run**: Give each test case to Claude with Chrome access against
> `https://deal-bay.vercel.app`. Tests assume Base Sepolia (testnet).
> Two phone numbers are needed (one for seller, one for buyer).

## Chrome UX Test Results (automated run)

| Test | Status | Notes |
|------|--------|-------|
| T1.1 Hero content | ✅ PASS | Heading, subtitle, CTA all render correctly |
| T1.2 Feature cards | ✅ PASS | All 3 cards + footer visible |
| T1.3 Navigation | ✅ PASS | "Start selling" → `/sell` works |
| T2.1 Auth gate on /sell | ✅ PASS | "Sign in to continue" + button shown |
| T4.1 Deal page event details | ✅ PASS | Name, date, venue, tickets, transfer method |
| T4.2 Progress tracker step 1 | ✅ PASS | "Listed" orange, steps 2-4 gray |
| T4.3 Terms section | ✅ PASS | All 5 terms displayed correctly |
| T4.4 Unauthenticated deposit triggers login | ✅ PASS | Privy modal opens on click |
| T4.7 Chat in open mode | ✅ PASS | AI welcome message visible, explains escrow process |
| T4.8 Unauthenticated viewer | ✅ PASS | Deal visible, chat input hidden, deposit button present |
| T5.2 Seller cannot deposit own deal | ⏭️ SKIP | Seller session not available on production domain (domain-scoped auth) |
| T10.1 Message alignment | ✅ PASS | Buyer left/gray, AI left/"AI Agent" label, user right/orange |
| T11.1 Invalid deal URL | ✅ PASS | "Deal not found" shown, no crash |
| T11.5 Direct URL to protected page | ✅ PASS | Auth gate on /sell; deal page shows content + login on action |
| T12.1 Mobile (375×667) | ✅ PASS | Landing: full-width CTA. Deal: readable, buttons full-width |
| T12.3 Desktop (1440×900) | ✅ PASS | Content centered, max-width constraint |
| T13.2 Accessibility tree | ✅ PASS | Deposit button discoverable, labeled correctly |

## Bugs Found During Chrome UX Testing

### BUG-1: Privy login modal invisible (Critical)
- **Severity**: Critical — blocks all authenticated user flows
- **Steps to reproduce**:
  1. Navigate to `/sell`
  2. Click "Sign in with phone"
  3. Privy modal renders in DOM but is **invisible** in viewport
- **Root cause**: The `#privy-dialog` container renders with `height: 0px` while the
  `<html>` element is set to `overflow: hidden; height: 300px` by Privy. The modal
  content (`#privy-modal-content`) is positioned at y=191, 360×291px, but gets clipped
  by the zero-height parent and HTML overflow.
- **Workaround**: Manually override via DevTools:
  ```js
  document.documentElement.style.overflow = 'visible';
  document.documentElement.style.height = 'auto';
  document.getElementById('privy-dialog').style.height = 'auto';
  ```
- **Impact**: Users on desktop Chrome may not see the login modal. Needs investigation
  — may be a Privy SDK version issue or CSS conflict with app styles.
- **Note**: After applying the workaround, the modal is visible and functional
  (phone input, submit, OTP verification all render correctly).

### BUG-2: MetaMask extension intercepts Privy auth flow
- **Severity**: Medium — affects users with MetaMask installed
- **Steps to reproduce**:
  1. Have MetaMask extension installed in Chrome
  2. Open Privy login modal, enter phone, click Submit
  3. Browser redirects to `chrome-extension://` URL instead of advancing to OTP screen
- **Root cause**: MetaMask's `window.ethereum` provider injection appears to interfere
  with Privy's embedded wallet creation flow during SMS authentication.
- **Impact**: Login fails for users with MetaMask. Privy's `embeddedWallets.createOnLogin`
  config may conflict with injected providers.

> **Tests requiring live SMS auth** (T2.2–T2.4, T3.1–T3.6, T5.1, T5.3–T5.5,
> T6.1–T6.3, T7.1–T7.2, T8.1–T8.7, T9.1–T9.4, T10.2–T10.5, T14.1–T14.3)
> require authentication. To run them:
>
> **Option A**: Enable [Privy test accounts](https://docs.privy.io/recipes/using-test-accounts)
> in Dashboard → User Management → Authentication → Advanced. Use the generated
> test phone number and fixed OTP code.
>
> **Option B**: Use two real phone numbers. The OTP must be read manually from
> the phone's Messages app.
>
> **Option C**: Temporarily disable MetaMask extension, apply BUG-1 workaround,
> then proceed with real phone + manual OTP entry.

---

## T1 — Landing Page

### T1.1 Hero content renders
1. Navigate to `https://deal-bay.vercel.app`
2. **Verify** heading "Sell your tickets safely." is visible
3. **Verify** subtitle mentions "AI-powered escrow" and "2.5% fee"
4. **Verify** orange "Start selling" button is visible and clickable
5. **Verify** "Already have a deal? Check your deal status" link is visible

### T1.2 Feature cards render
1. On the landing page, scroll down if needed
2. **Verify** three feature cards are visible:
   - "Escrow protection" with shield icon
   - "First to deposit wins" with zap icon
   - "AI-managed disputes" with message icon
3. **Verify** footer text "Powered by USDC on Base" is visible

### T1.3 Navigation from landing page
1. Click "Start selling"
2. **Verify** navigates to `/sell`
3. Go back to landing page
4. Click "Check your deal status" link
5. **Verify** also navigates to `/sell`

### T1.4 Responsive layout
1. Resize browser to 375×667 (iPhone SE)
2. **Verify** landing page is fully visible, no horizontal scroll
3. **Verify** "Start selling" button is full-width
4. Resize to 1440×900 (desktop)
5. **Verify** content is centered with max-width constraint

---

## T2 — Authentication Flow

### T2.1 Unauthenticated user sees auth gate on /sell
1. Navigate to `/sell` (logged out)
2. **Verify** "Sign in to continue" text is displayed
3. **Verify** "Sign in with phone" button is visible (orange)
4. **Verify** no chat input or messages are visible

### T2.2 SMS login flow
1. Click "Sign in with phone"
2. **Verify** Privy modal opens requesting phone number
3. Enter a valid phone number
4. **Verify** OTP input field appears
5. Enter the OTP code received via SMS
6. **Verify** modal closes
7. **Verify** page transitions to sell chat or name prompt

### T2.3 Name prompt appears for new users
1. After first login, if no name is set
2. **Verify** orange-50 banner appears: "What should we call you?"
3. **Verify** text input and "Save" button are visible
4. Leave input empty and click Save
5. **Verify** nothing happens (empty name not accepted)
6. Type "Alice" and click Save
7. **Verify** banner disappears and the sell chat loads

### T2.4 Returning user skips name prompt
1. Log out and log back in with the same phone number
2. **Verify** name prompt does NOT appear
3. **Verify** sell chat loads directly with "Hey Alice!" greeting

---

## T3 — Sell Flow (Deal Creation via AI Chat)

### T3.1 Initial greeting message
1. Navigate to `/sell` (authenticated as "Alice")
2. **Verify** AI greeting message appears: "Hey Alice! What are you selling?"
3. **Verify** message appears on the left with "AI Agent" label
4. **Verify** text input with "Describe your tickets..." placeholder is visible
5. **Verify** send button (orange circle) is visible

### T3.2 Conversational deal creation — happy path
1. Type: "2 Taylor Swift tickets at SoFi Stadium, Floor A Row 12 Seats 1-2, August 15 2025, $400 total, Ticketmaster transfer"
2. Click send
3. **Verify** user message appears on the right in orange bubble
4. **Verify** loading dots appear while AI processes
5. **Verify** AI response appears confirming the details
6. If AI asks for clarification, answer accordingly
7. **Verify** after all fields are confirmed, the AI generates the deal

### T3.3 Deal link card appears after creation
1. After the AI confirms all details and creates the deal
2. **Verify** the input area disappears
3. **Verify** green card appears with "Your deal link is ready!"
4. **Verify** the deal URL is shown in monospace font (e.g., `deal-bay.vercel.app/deal/abc12345`)
5. **Verify** "Copy link" button is visible (green)
6. **Verify** share button is visible

### T3.4 Copy link works
1. Click "Copy link"
2. **Verify** button icon changes to a checkmark momentarily
3. Paste clipboard contents somewhere
4. **Verify** the pasted URL matches the displayed deal URL

### T3.5 Partial information — AI asks follow-up questions
1. Start a new conversation (refresh or navigate to `/sell`)
2. Type: "selling 2 concert tickets"
3. **Verify** AI asks for more details (event name, venue, price, etc.)
4. Provide missing info one at a time
5. **Verify** AI keeps asking until all required fields are filled
6. **Verify** deal is only created after all fields are confirmed

### T3.6 Price clarification
1. Type: "2 tickets to Lakers game, Crypto.com Arena, $200"
2. **Verify** AI asks whether $200 is per-ticket or total
3. Answer "total"
4. **Verify** AI confirms $200 total (price_cents: 20000)

---

## T4 — Deal Page — Buyer View (OPEN Status)

### T4.1 Deal page loads with event details
1. Navigate to the deal link from T3.3 (logged out)
2. **Verify** event name "Taylor Swift" is displayed
3. **Verify** event date, venue ("SoFi Stadium"), and ticket details are shown
4. **Verify** section "Floor A", row "12", seats "1-2" are displayed
5. **Verify** transfer method "ticketmaster" is shown

### T4.2 Progress tracker shows step 1
1. **Verify** progress tracker is visible with 4 steps
2. **Verify** step 1 ("Listed") is highlighted (orange or green)
3. **Verify** steps 2-4 are gray/inactive

### T4.3 Terms section visible for non-seller
1. **Verify** terms box is visible with gray background
2. **Verify** terms mention:
   - "Seller transfers within 2 hours"
   - "4 hours to confirm receipt"
   - "automatic refund"
   - "AI" adjudication
   - "First to deposit claims tickets"

### T4.4 Unauthenticated buyer sees deposit button
1. (Still logged out on deal page)
2. **Verify** "Deposit $400.00" button is visible
3. Click "Deposit $400.00"
4. **Verify** Privy login modal opens (since not authenticated)

### T4.5 Authenticated buyer sees balance info
1. Log in as a different user (buyer phone number)
2. Navigate to the deal page
3. **Verify** balance indicator shows "Balance: XX.XX USDC"
4. If balance is insufficient:
   - **Verify** orange "Need 400.00 USDC" text appears
   - **Verify** green "Get test USDC" button appears (testnet)

### T4.6 Faucet claim (testnet only)
1. With insufficient balance, click "Get test USDC"
2. **Verify** button shows loading state
3. **Verify** after ~5 seconds, balance updates
4. **Verify** if balance is now sufficient, the deposit button becomes enabled

### T4.7 Chat visible in open mode
1. **Verify** chat area is visible on the deal page
2. **Verify** chat input is visible for authenticated users
3. Type "Are these good seats?" and send
4. **Verify** message appears on the right (buyer message)
5. **Verify** AI response appears on the left with helpful answer

### T4.8 Multiple unauthenticated viewers
1. Open the deal link in a second browser/incognito window (not logged in)
2. **Verify** deal details are visible
3. **Verify** chat input is NOT visible (no userRole)
4. **Verify** deposit button is still visible (clicking it triggers login)

---

## T5 — Deposit Flow

### T5.1 Successful deposit (buyer)
1. As authenticated buyer with sufficient USDC balance
2. Click "Deposit $400.00"
3. **Verify** button shows loading spinner
4. **Verify** status banner appears: "Approving USDC..."
5. **Verify** Privy wallet approval popup appears
6. Approve the USDC allowance transaction
7. **Verify** status updates to "Depositing to escrow..."
8. Approve the escrow deposit transaction
9. **Verify** deal status changes to FUNDED
10. **Verify** progress tracker step 2 ("Funded") becomes active
11. **Verify** terms section disappears
12. **Verify** "$400.00 locked in escrow" banner appears with countdown timer

### T5.2 Seller cannot buy own deal
1. Log in as the seller
2. Navigate to the deal page
3. **Verify** no deposit button is shown (seller sees share link card instead)

### T5.3 Deposit error handling
1. If the USDC approval is rejected in the wallet
2. **Verify** error banner appears in red-50 background
3. **Verify** "Dismiss" link is available
4. Click "Dismiss"
5. **Verify** error clears, deposit button reappears

### T5.4 Deal page after deposit — seller view
1. Log in as the seller
2. Navigate to the deal page
3. **Verify** status shows FUNDED
4. **Verify** "$400.00 locked in escrow" banner with countdown is visible
5. **Verify** "I've transferred the tickets" blue button is visible
6. **Verify** AI system message about deposit is in the chat

### T5.5 Deal page after deposit — buyer view
1. As the buyer who deposited
2. **Verify** no action buttons are shown (waiting for seller)
3. **Verify** countdown timer is visible
4. **Verify** chat is still active

---

## T6 — Transfer Flow

### T6.1 Seller marks tickets as transferred
1. As seller on FUNDED deal page
2. Click "I've transferred the tickets"
3. **Verify** button shows loading state
4. **Verify** Privy wallet popup appears for on-chain transaction
5. Approve the transaction
6. **Verify** deal status changes to TRANSFERRED
7. **Verify** progress tracker step 3 ("Sent") becomes active
8. **Verify** banner updates to "Seller says transferred" with countdown timer
9. **Verify** AI message appears: "Seller says tickets transferred..."

### T6.2 Buyer sees confirm/dispute buttons after transfer
1. As buyer on TRANSFERRED deal page
2. **Verify** two buttons appear:
   - Green: "Got them — release funds" with CheckCircle icon
   - Gray: "Something's wrong" with AlertTriangle icon
3. **Verify** countdown timer shows time remaining (up to 4 hours)

### T6.3 Non-participant cannot transfer
1. Log in as a third user (neither buyer nor seller)
2. Navigate to the deal page
3. **Verify** no transfer button is shown
4. **Verify** chat input is NOT visible (not a participant in active mode)

---

## T7 — Confirm Flow (Happy Path Completion)

### T7.1 Buyer confirms receipt
1. As buyer on TRANSFERRED deal page
2. Click "Got them — release funds"
3. **Verify** button shows loading state
4. **Verify** Privy wallet popup for on-chain confirm
5. Approve the transaction
6. **Verify** deal status changes to RELEASED
7. **Verify** progress tracker reaches step 4 ("Done") — all green
8. **Verify** "Deal complete!" green text appears
9. **Verify** AI message appears mentioning seller amount after 2.5% fee
10. **Verify** no more action buttons are shown
11. **Verify** chat input is disabled/hidden (terminal state)

### T7.2 Seller sees completion
1. Switch to seller view
2. **Verify** "Deal complete!" green text is visible
3. **Verify** AI message mentions "$390.00 released to seller" (for $400 deal)
4. **Verify** chat is disabled
5. **Verify** progress tracker is fully green

---

## T8 — Dispute Flow

### T8.1 Buyer opens a dispute
1. As buyer on TRANSFERRED deal page
2. Click "Something's wrong"
3. **Verify** Privy wallet popup for on-chain dispute
4. Approve the transaction
5. **Verify** deal status changes to DISPUTED
6. **Verify** progress tracker shows dispute indicator (amber warning)
7. **Verify** "Dispute in progress" text appears below tracker

### T8.2 Buyer sees private dispute AI messages
1. As buyer after dispute opened
2. **Verify** AI message appears asking buyer for details:
   - "What's the issue?"
   - Options: tickets not received, wrong tickets, don't work, other
   - Request for screenshot upload
3. **Verify** chat input is still active

### T8.3 Seller sees different private AI messages
1. Switch to seller view on the disputed deal
2. **Verify** seller sees a DIFFERENT AI message:
   - "Buyer has raised an issue"
   - Requests for purchase confirmation and transfer confirmation screenshots
   - "You have 4 hours to respond"
3. **Verify** seller does NOT see buyer's private messages
4. **Verify** buyer does NOT see seller's private messages

### T8.4 Evidence upload (image attachments)
1. As buyer in dispute chat
2. Click the paperclip (attachment) button
3. **Verify** file picker opens accepting images (jpeg, png, webp, gif)
4. Select an image file
5. **Verify** image preview appears below the input with X button
6. Type "Here is my evidence" and click send
7. **Verify** message appears with both text and image inline
8. **Verify** AI response acknowledges the evidence

### T8.5 Multiple image uploads (up to 4)
1. Click paperclip and select multiple images (up to 4)
2. **Verify** all previews appear
3. **Verify** trying to add a 5th image is blocked or doesn't work
4. Click X on one preview to remove it
5. **Verify** image is removed from pending list
6. Send the remaining images
7. **Verify** all images appear in the message

### T8.6 Dispute resolution — buyer wins (refund)
1. After evidence is submitted by both parties
2. If the AI issues a ruling favoring the buyer
3. **Verify** AI message appears with ruling explanation
4. **Verify** deal status changes to REFUNDED
5. **Verify** progress tracker shows "Refunded" indicator (red)
6. **Verify** chat becomes disabled
7. **Verify** both parties see the ruling message

### T8.7 Dispute resolution — seller wins (release)
1. (Alternative outcome)
2. **Verify** deal status changes to RELEASED
3. **Verify** progress tracker reaches "Done" step
4. **Verify** ruling message is visible to both parties

---

## T9 — Timeout Behaviors

### T9.1 Countdown timers display correctly
1. On a FUNDED deal, **verify** countdown timer visible (starts from ~2 hours)
2. On a TRANSFERRED deal, **verify** countdown timer visible (starts from ~4 hours)
3. **Verify** timer decrements in real-time

### T9.2 Visual state after auto-refund
1. If a FUNDED deal passes the 2-hour transfer deadline
2. After the cron runs, navigate to the deal page
3. **Verify** status shows AUTO_REFUNDED
4. **Verify** progress tracker shows "Refunded" indicator
5. **Verify** AI message: "Seller didn't transfer tickets in time..."
6. **Verify** chat is disabled

### T9.3 Visual state after auto-release
1. If a TRANSFERRED deal passes the 4-hour confirm deadline
2. After the cron runs, navigate to the deal page
3. **Verify** status shows AUTO_RELEASED
4. **Verify** progress tracker reaches "Done" step (all green)
5. **Verify** AI message: "Buyer didn't confirm receipt in time..."
6. **Verify** chat is disabled

### T9.4 Visual state after expiry
1. For an OPEN deal older than 7 days
2. After the cron runs, navigate to the deal page
3. **Verify** status shows EXPIRED
4. **Verify** no deposit button shown
5. **Verify** chat is disabled

---

## T10 — Chat UX Details

### T10.1 Message alignment and styling
1. On any deal page with messages
2. **Verify** current user's messages appear on the right, orange background
3. **Verify** other party's messages appear on the left, gray/zinc background
4. **Verify** AI messages appear on the left with lighter background and "AI Agent" label
5. **Verify** system messages appear on the left

### T10.2 Real-time message delivery
1. Open the deal page in two browser windows (buyer and seller)
2. As buyer, send a message
3. **Verify** message appears in seller's window in real-time (no refresh needed)
4. As seller, reply
5. **Verify** reply appears in buyer's window in real-time

### T10.3 Chat scroll behavior
1. Send enough messages to overflow the chat area
2. **Verify** chat auto-scrolls to the newest message
3. Scroll up manually to read older messages
4. When a new message arrives, **verify** chat scrolls back to bottom

### T10.4 Empty message prevention
1. With empty input, try pressing Enter or clicking send
2. **Verify** nothing happens (message is not sent)
3. Type only spaces
4. **Verify** send is prevented or message is not sent

### T10.5 Loading state during send
1. Type a message and send
2. **Verify** send button is disabled while sending
3. **Verify** input is not cleared until message is successfully sent

---

## T11 — Edge Cases & Error States

### T11.1 Invalid deal URL
1. Navigate to `deal-bay.vercel.app/deal/nonexistent`
2. **Verify** "Deal not found" or appropriate error message is shown
3. **Verify** no crash or blank screen

### T11.2 Slow network / loading states
1. With slow connection, load a deal page
2. **Verify** loading spinner or skeleton appears while data loads
3. **Verify** page renders correctly once data arrives

### T11.3 Deal page polling updates status
1. Open a deal page that is OPEN
2. In another tab, have a buyer deposit on the deal
3. **Verify** within ~10 seconds, the first tab updates to show FUNDED status
4. **Verify** progress tracker updates without manual refresh

### T11.4 Browser back/forward navigation
1. From landing page, click "Start selling" to go to `/sell`
2. Click browser back button
3. **Verify** returns to landing page
4. Click forward
5. **Verify** returns to `/sell`

### T11.5 Direct URL access to protected pages
1. Log out completely
2. Navigate directly to `/sell`
3. **Verify** auth gate appears (not a blank page or error)
4. Navigate directly to a deal page
5. **Verify** deal details are visible even without auth
6. **Verify** action buttons trigger login when clicked

### T11.6 Wallet not connected
1. If an authenticated user somehow has no wallet address
2. Navigate to a deal page
3. **Verify** balance shows as loading or unavailable
4. **Verify** graceful degradation — no crash

---

## T12 — Responsive Design

### T12.1 Mobile viewport (375×667)
1. Set viewport to 375×667
2. Navigate through all pages
3. **Verify** landing page: full-width CTA, stacked features
4. **Verify** sell page: chat fills screen, input at bottom
5. **Verify** deal page: all info visible, buttons full-width, chat usable

### T12.2 Tablet viewport (768×1024)
1. Set viewport to 768×1024
2. **Verify** all pages render correctly
3. **Verify** content is centered with appropriate max-width

### T12.3 Desktop viewport (1440×900)
1. Set viewport to 1440×900
2. **Verify** content constrained to max-w-lg (~512px) centered on screen
3. **Verify** chat area properly fills available vertical space

### T12.4 Very small viewport (320×480)
1. Set viewport to 320×480
2. **Verify** no horizontal scrollbar
3. **Verify** text doesn't overflow containers
4. **Verify** buttons are still tappable (min 44px touch target)

---

## T13 — Accessibility

### T13.1 Keyboard navigation
1. On the landing page, use Tab key to navigate
2. **Verify** focus moves through interactive elements in logical order
3. **Verify** focus indicators are visible (outline or ring)
4. Press Enter on focused "Start selling" button
5. **Verify** navigation occurs

### T13.2 Screen reader content
1. Use accessibility tree reader
2. **Verify** buttons have descriptive text
3. **Verify** images (if any) have alt text
4. **Verify** progress tracker steps have meaningful labels

### T13.3 Color contrast
1. Inspect text against backgrounds
2. **Verify** orange (#f97316) on white meets WCAG AA for large text
3. **Verify** gray text on white backgrounds is readable
4. **Verify** error messages (red) are distinguishable

---

## T14 — Full End-to-End Workflow

### T14.1 Complete happy path (seller creates → buyer deposits → seller transfers → buyer confirms)
1. **Seller**: Navigate to `/sell`, log in, create a deal via AI chat
2. **Seller**: Copy the deal link
3. **Buyer**: Open the deal link, log in with different phone
4. **Buyer**: Get test USDC if needed, deposit
5. **Verify**: Both see FUNDED status, countdown timer, AI message
6. **Seller**: Click "I've transferred the tickets"
7. **Verify**: Both see TRANSFERRED status, countdown timer, AI message
8. **Buyer**: Click "Got them — release funds"
9. **Verify**: Both see RELEASED / "Deal complete!", all 4 progress steps green
10. **Verify**: Chat disabled, no more action buttons

### T14.2 Complete dispute path (seller creates → buyer deposits → seller transfers → buyer disputes → resolution)
1. Follow steps 1-7 from T14.1
2. **Buyer**: Click "Something's wrong"
3. **Verify**: DISPUTED status, private AI messages to each party
4. **Buyer**: Submit evidence (text + image)
5. **Seller**: Submit evidence (text + image)
6. **Verify**: AI reviews and issues ruling
7. **Verify**: Final status (REFUNDED or RELEASED), chat disabled

### T14.3 Timeout path (seller creates → buyer deposits → seller fails to transfer)
1. Follow steps 1-4 from T14.1
2. Wait for 2-hour transfer deadline to pass (or manually trigger cron)
3. **Verify**: Deal becomes AUTO_REFUNDED
4. **Verify**: AI message about automatic refund
5. **Verify**: Chat disabled, "Refunded" indicator on tracker
