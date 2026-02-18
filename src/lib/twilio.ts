import twilio from "twilio";

function getClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  );
}

function dealLink(shortCode: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${appUrl}/deal/${shortCode}`;
}

export async function notifyDeposit(
  sellerPhone: string,
  shortCode: string,
  amount: string
) {
  await getClient().messages.create({
    body: `Someone deposited ${amount} on your deal! Transfer the tickets now → ${dealLink(shortCode)}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: sellerPhone,
  });
}

export async function notifyTransfer(
  buyerPhone: string,
  shortCode: string
) {
  await getClient().messages.create({
    body: `Seller says tickets transferred. Check and confirm → ${dealLink(shortCode)}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: buyerPhone,
  });
}

export async function notifyConfirm(
  sellerPhone: string,
  shortCode: string,
  amount: string
) {
  await getClient().messages.create({
    body: `${amount} released to your wallet! → ${dealLink(shortCode)}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: sellerPhone,
  });
}

export async function notifyTimeoutWarning(
  phone: string,
  shortCode: string,
  action: string,
  timeLeft: string
) {
  await getClient().messages.create({
    body: `${timeLeft} left to ${action} → ${dealLink(shortCode)}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: phone,
  });
}

export async function notifyDispute(
  phone: string,
  shortCode: string
) {
  await getClient().messages.create({
    body: `Issue reported on your deal → ${dealLink(shortCode)}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: phone,
  });
}

export async function notifyDisputeResolved(
  phone: string,
  shortCode: string,
  outcome: string
) {
  await getClient().messages.create({
    body: `Ruling: ${outcome} → ${dealLink(shortCode)}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: phone,
  });
}

export async function notifyAutoRefund(
  buyerPhone: string,
  shortCode: string,
  amount: string
) {
  await getClient().messages.create({
    body: `Seller didn't transfer in time. ${amount} refunded to your wallet → ${dealLink(shortCode)}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: buyerPhone,
  });
}

export async function notifyAutoRelease(
  sellerPhone: string,
  shortCode: string,
  amount: string
) {
  await getClient().messages.create({
    body: `Buyer didn't respond in time. ${amount} released to your wallet → ${dealLink(shortCode)}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: sellerPhone,
  });
}
