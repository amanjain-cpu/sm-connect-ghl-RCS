import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV ??= 'test';
process.env.API_URL ??= 'http://localhost:3001';
process.env.WEB_URL ??= 'http://localhost:5173';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'billing-qa-jwt-secret-00000000000000';
process.env.JWT_REFRESH_SECRET ??= 'billing-qa-refresh-secret-000000000000';
process.env.SESSION_SECRET ??= 'billing-qa-session-secret-000000000000';
process.env.ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Use an isolated dev/staging database for billing QA.');
}

type PrismaClientLike = Awaited<typeof import('../src/config/database.js')>['prisma'];
type WalletBillingServiceLike = Awaited<
  typeof import('../src/services/wallet-billing.service.js')
>['walletBillingService'];
type SyncRecorder = {
  syncedMessageIds: Set<string>;
};

const QA_EMAIL_DOMAIN = 'billing-qa.local';
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const fixedNow = new Date('2026-07-20T12:00:00.000Z');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let phoneSequence = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertNear(actual: number, expected: number, message: string, tolerance = 0.00001) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function amount(value: unknown) {
  return Number(value);
}

function emailFor(label: string) {
  return `billing-qa-${runId}-${label}@${QA_EMAIL_DOMAIN}`;
}

function nextPhoneNumber() {
  phoneSequence += 1;
  return `+1555${String(Date.now()).slice(-6)}${String(phoneSequence).padStart(4, '0')}`;
}

function isAppError(error: unknown, code: string) {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === code
  );
}

async function expectAppError(
  action: () => Promise<unknown> | unknown,
  code: string,
  message: string
) {
  try {
    await action();
  } catch (error) {
    if (isAppError(error, code)) {
      return;
    }

    throw error;
  }

  throw new Error(`${message}: expected ${code}`);
}

async function patchStripeService(stripeService: Record<string, unknown>) {
  const sessions = new Map<string, Record<string, unknown>>();
  const paymentIntents = new Map<string, Record<string, unknown>>();
  const setupIntents = new Map<string, Record<string, unknown>>();
  let customerCounter = 0;
  let sessionCounter = 0;
  let paymentIntentCounter = 0;
  let setupIntentCounter = 0;
  let failOffSessionPayment = false;

  stripeService.createCustomer = async (input: {
    organizationId: string;
    email: string;
    name: string;
  }) => {
    customerCounter += 1;
    return {
      id: `cus_qa_${runId}_${customerCounter}`,
      email: input.email,
      name: input.name,
    };
  };

  stripeService.createOneTimeCheckoutSession = async (input: {
    organizationId: string;
    customerId: string;
    customerEmail: string;
    customerName: string;
    amountCents: number;
    successUrl: string;
    cancelUrl: string;
    description: string;
    savePaymentMethod: boolean;
    metadata: Record<string, string>;
  }) => {
    sessionCounter += 1;
    paymentIntentCounter += 1;

    const sessionId = `cs_qa_topup_${runId}_${sessionCounter}`;
    const paymentIntentId = `pi_qa_topup_${runId}_${paymentIntentCounter}`;
    const paymentMethodId = `pm_qa_card_${runId}_${paymentIntentCounter}`;
    const session = {
      id: sessionId,
      url: `https://checkout.stripe.test/${sessionId}`,
      status: 'complete',
      payment_status: 'paid',
      customer: input.customerId,
      payment_intent: paymentIntentId,
      mode: 'payment',
      metadata: input.metadata,
      client_reference_id: input.organizationId,
    };

    sessions.set(sessionId, session);
    paymentIntents.set(paymentIntentId, {
      id: paymentIntentId,
      status: 'succeeded',
      amount: input.amountCents,
      currency: 'usd',
      customer: input.customerId,
      payment_method: paymentMethodId,
    });

    return {
      checkoutUrl: session.url,
      sessionId,
      id: sessionId,
      url: session.url,
    };
  };

  stripeService.createSetupCheckoutSession = async (input: {
    organizationId: string;
    customerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }) => {
    sessionCounter += 1;
    setupIntentCounter += 1;

    const sessionId = `cs_qa_setup_${runId}_${sessionCounter}`;
    const setupIntentId = `seti_qa_${runId}_${setupIntentCounter}`;
    const paymentMethodId = `pm_qa_setup_${runId}_${setupIntentCounter}`;

    sessions.set(sessionId, {
      id: sessionId,
      url: `https://checkout.stripe.test/${sessionId}`,
      status: 'complete',
      customer: input.customerId,
      setup_intent: setupIntentId,
      mode: 'setup',
      metadata: input.metadata,
      client_reference_id: input.organizationId,
    });
    setupIntents.set(setupIntentId, {
      id: setupIntentId,
      status: 'succeeded',
      customer: input.customerId,
      payment_method: paymentMethodId,
    });

    return {
      checkoutUrl: `https://checkout.stripe.test/${sessionId}`,
      sessionId,
      id: sessionId,
      url: `https://checkout.stripe.test/${sessionId}`,
    };
  };

  stripeService.getCheckoutSession = async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown QA Stripe checkout session: ${sessionId}`);
    }

    return session;
  };

  stripeService.getPaymentIntent = async (paymentIntentId: string) => {
    const paymentIntent = paymentIntents.get(paymentIntentId);
    if (!paymentIntent) {
      throw new Error(`Unknown QA Stripe payment intent: ${paymentIntentId}`);
    }

    return paymentIntent;
  };

  stripeService.getSetupIntent = async (setupIntentId: string) => {
    const setupIntent = setupIntents.get(setupIntentId);
    if (!setupIntent) {
      throw new Error(`Unknown QA Stripe setup intent: ${setupIntentId}`);
    }

    return setupIntent;
  };

  stripeService.updateCustomerDefaultPaymentMethod = async () => ({ id: 'qa-customer-updated' });

  stripeService.createOffSessionPayment = async (input: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    description: string;
    metadata: Record<string, string>;
  }) => {
    if (failOffSessionPayment) {
      throw new Error('QA simulated off-session payment failure');
    }

    paymentIntentCounter += 1;
    const paymentIntentId = `pi_qa_mrc_${runId}_${paymentIntentCounter}`;
    const paymentIntent = {
      id: paymentIntentId,
      status: 'succeeded',
      amount: input.amountCents,
      currency: 'usd',
      customer: input.customerId,
      payment_method: input.paymentMethodId,
      metadata: input.metadata,
    };
    paymentIntents.set(paymentIntentId, paymentIntent);
    return paymentIntent;
  };

  return {
    setFailOffSessionPayment(value: boolean) {
      failOffSessionPayment = value;
    },
  };
}

async function cleanup(prisma: PrismaClientLike) {
  await prisma.organization.deleteMany({
    where: {
      email: {
        endsWith: `@${QA_EMAIL_DOMAIN}`,
      },
    },
  });
}

async function createOrganization(prisma: PrismaClientLike, label: string) {
  return prisma.organization.create({
    data: {
      name: `Billing QA ${label}`,
      email: emailFor(label),
    },
  });
}

async function createBillingAccount(
  prisma: PrismaClientLike,
  organizationId: string,
  input?: {
    walletBalance?: number;
    pricingTier?: 'tier_250' | 'tier_500' | 'tier_1400';
    savedPaymentMethod?: boolean;
    setupFeeCharged?: boolean;
    mrcDue?: boolean;
  }
) {
  const savedPaymentMethod = input?.savedPaymentMethod ?? true;
  return prisma.billingAccount.create({
    data: {
      organizationId,
      status: 'active',
      walletBalance: (input?.walletBalance ?? 0).toFixed(4),
      pricingTier: input?.pricingTier ?? 'tier_250',
      stripeCustomerId: savedPaymentMethod ? `cus_qa_seed_${runId}_${organizationId}` : null,
      stripeDefaultPaymentMethodId: savedPaymentMethod ? `pm_qa_seed_${runId}_${organizationId}` : null,
      setupFeeChargedAt: input?.setupFeeCharged ? new Date(fixedNow) : null,
      mrcAnchorAt: new Date('2026-06-20T12:00:00.000Z'),
      mrcNextRunAt: input?.mrcDue
        ? new Date('2026-07-01T00:00:00.000Z')
        : new Date('2026-08-20T12:00:00.000Z'),
    },
  });
}

async function createBrand(prisma: PrismaClientLike, organizationId: string, label: string) {
  return prisma.brand.create({
    data: {
      legalName: `Billing QA ${label} LLC`,
      displayName: `Billing QA ${label}`,
      entityType: 'llc',
      vertical: 'technology',
      streetAddress: '123 QA Street',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
      website: 'https://example.test',
      phone: '+15125550100',
      email: emailFor(`brand-${label}`),
      organizationId,
    },
  });
}

async function createCampaign(
  prisma: PrismaClientLike,
  organizationId: string,
  brandId: string,
  label: string,
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'suspended' | 'expired' =
    'approved'
) {
  return prisma.campaign.create({
    data: {
      name: `Billing QA ${label}`,
      description: 'Billing QA campaign',
      useCase: 'customer_care',
      sampleMessages: ['Your QA appointment is confirmed.'],
      messageFlow: 'Customer opts in on the QA test form.',
      status,
      organizationId,
      brandId,
    },
  });
}

async function createPhoneNumber(
  prisma: PrismaClientLike,
  organizationId: string,
  label: string,
  status: 'active' | 'pending' | 'suspended' | 'released' = 'active',
  campaignId?: string
) {
  const phoneNumber = nextPhoneNumber();
  return prisma.phoneNumber.create({
    data: {
      phoneNumber,
      formattedNumber: phoneNumber,
      friendlyName: `Billing QA ${label}`,
      status,
      organizationId,
      campaignId,
    },
  });
}

async function createMessage(
  prisma: PrismaClientLike,
  organizationId: string,
  input?: {
    direction?: 'inbound' | 'outbound';
    type?: 'sms' | 'mms';
    body?: string;
    mediaUrls?: string[] | null;
    billingEstimate?: unknown;
  }
) {
  const direction = input?.direction ?? 'outbound';
  return prisma.message.create({
    data: {
      direction,
      type: input?.type ?? (input?.mediaUrls?.length ? 'mms' : 'sms'),
      from: direction === 'outbound' ? '+15551230000' : '+15559870000',
      to: direction === 'outbound' ? '+15559870000' : '+15551230000',
      body: input?.body ?? 'Billing QA message',
      mediaUrls: input?.mediaUrls ?? undefined,
      billingEstimate: input?.billingEstimate as never,
      status: direction === 'outbound' ? 'sent' : 'received',
      organizationId,
      signalmashMessageId: `sm_qa_${runId}_${Math.random().toString(36).slice(2, 10)}`,
    },
  });
}

async function countLedger(
  prisma: PrismaClientLike,
  organizationId: string,
  where?: {
    category?: string;
    ledgerKey?: string;
    messageId?: string;
  }
) {
  return prisma.billingLedgerEntry.count({
    where: {
      organizationId,
      category: where?.category as never,
      ledgerKey: where?.ledgerKey,
      messageId: where?.messageId,
    },
  });
}

async function setWalletBalance(
  prisma: PrismaClientLike,
  organizationId: string,
  walletBalance: number
) {
  await prisma.billingAccount.update({
    where: { organizationId },
    data: { walletBalance: walletBalance.toFixed(4) },
  });
}

async function completeTopUp(
  walletBillingService: WalletBillingServiceLike,
  organizationId: string,
  amountDollars: number
) {
  const checkout = await walletBillingService.createWalletTopUpCheckout({
    organizationId,
    amountDollars,
  });
  await walletBillingService.completeWalletTopUpCheckout(organizationId, checkout.sessionId);
  return checkout.sessionId;
}

async function scenarioWalletTopUps(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike
) {
  const org = await createOrganization(prisma, 'topups');

  await expectAppError(
    () => walletBillingService.createWalletTopUpCheckout({
      organizationId: org.id,
      amountDollars: 249,
    }),
    'WALLET_TOPUP_MINIMUM_NOT_MET',
    'Minimum custom top-up should be rejected'
  );

  const session250 = await completeTopUp(walletBillingService, org.id, 250);
  let summary = await walletBillingService.getWalletSummary(org.id);
  assertNear(summary.account.walletBalance, 250, '$250 top-up credits wallet');
  assertEqual(summary.account.pricingTier, 'tier_250', '$250 top-up sets tier');
  assertNear(summary.rates.sms, 0.01, '$250 SMS rate');
  assertNear(summary.rates.mms, 0.025, '$250 MMS rate');
  assertNear(summary.rates.phoneNumberMonthly, 1, '$250 phone MRC rate');
  assertEqual(summary.carrierSurcharges.length, 3, 'Carrier surcharge table should include three carriers');
  assertEqual(summary.carrierSurcharges[0].carrier, 'AT&T', 'Carrier surcharge should include AT&T');
  assertNear(summary.carrierSurcharges[0].sms, 0.003, 'AT&T SMS surcharge should match sheet');
  assertNear(summary.carrierSurcharges[0].mms, 0.0075, 'AT&T MMS surcharge should match sheet');
  assertEqual(summary.carrierSurcharges[1].carrier, 'VZW', 'Carrier surcharge should include VZW');
  assertNear(summary.carrierSurcharges[1].sms, 0.004, 'VZW SMS surcharge should match sheet');
  assertNear(summary.carrierSurcharges[1].mms, 0.0065, 'VZW MMS surcharge should match sheet');
  assertEqual(summary.carrierSurcharges[2].carrier, 'T-Mobile', 'Carrier surcharge should include T-Mobile');
  assertNear(summary.carrierSurcharges[2].sms, 0.0045, 'T-Mobile SMS surcharge should match sheet');
  assertNear(summary.carrierSurcharges[2].mms, 0.01, 'T-Mobile MMS surcharge should match sheet');
  assertEqual(
    summary.carrierSurchargeNote,
    'Carrier surcharges are already included in the above pricing.',
    'Carrier surcharge note should clarify surcharges are included in pricing'
  );
  assert(
    summary.prepayBalanceNote.includes('Monthly fees and setup charges may be deducted'),
    'Billing summary should include prepayment balance note'
  );
  assertEqual(
    await countLedger(prisma, org.id, { ledgerKey: `wallet-topup:${session250}` }),
    1,
    'Wallet top-up ledger should be written once'
  );

  await walletBillingService.completeWalletTopUpCheckout(org.id, session250);
  summary = await walletBillingService.getWalletSummary(org.id);
  assertNear(summary.account.walletBalance, 250, 'Repeated checkout completion is idempotent');

  await completeTopUp(walletBillingService, org.id, 500);
  summary = await walletBillingService.getWalletSummary(org.id);
  assertEqual(summary.account.pricingTier, 'tier_500', '$500 top-up sets tier');
  assertNear(summary.rates.sms, 0.008, '$500 SMS rate');
  assertNear(summary.rates.mms, 0.02, '$500 MMS rate');
  assertNear(summary.rates.phoneNumberMonthly, 0.75, '$500 phone MRC rate');

  await completeTopUp(walletBillingService, org.id, 1400);
  summary = await walletBillingService.getWalletSummary(org.id);
  assertEqual(summary.account.pricingTier, 'tier_1400', '$1400 top-up sets tier');
  assertNear(summary.rates.sms, 0.007, '$1400 SMS rate');
  assertNear(summary.rates.mms, 0.0175, '$1400 MMS rate');
  assertNear(summary.rates.phoneNumberMonthly, 0.5, '$1400 phone MRC rate');
}

async function scenarioSetupFee(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike
) {
  const org = await createOrganization(prisma, 'setup-fee');
  await createBillingAccount(prisma, org.id, {
    walletBalance: 0,
    savedPaymentMethod: true,
  });

  await expectAppError(
    () => walletBillingService.assertCanUsePaidServices(org.id),
    'WALLET_FUNDS_REQUIRED',
    'Saved card with wallet below setup fee should be blocked'
  );

  await setWalletBalance(prisma, org.id, 250);
  await walletBillingService.assertCanUsePaidServices(org.id);
  let account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  assert(account.setupFeeChargedAt, 'Setup fee timestamp should be set');
  assertNear(amount(account.walletBalance), 231, 'Setup fee should debit $19 once');
  assertEqual(
    await countLedger(prisma, org.id, { category: 'setup_fee' }),
    1,
    'Setup fee ledger should exist exactly once'
  );

  await walletBillingService.assertCanUsePaidServices(org.id);
  account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  assertNear(amount(account.walletBalance), 231, 'Second paid action should not charge setup again');
  assertEqual(
    await countLedger(prisma, org.id, { category: 'setup_fee' }),
    1,
    'Setup fee ledger should remain exactly one'
  );
}

async function scenarioOutboundUsage(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike
) {
  const org = await createOrganization(prisma, 'outbound');
  await createBillingAccount(prisma, org.id, {
    walletBalance: 50,
    savedPaymentMethod: true,
    setupFeeCharged: true,
  });

  const smsEstimate = await walletBillingService.assertCanSendMessage({
    organizationId: org.id,
    body: 'hello',
  });
  const sms = await createMessage(prisma, org.id, {
    direction: 'outbound',
    body: 'hello',
    billingEstimate: smsEstimate,
  });
  await walletBillingService.recordOutboundMessageDebit(sms);
  let account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  assertNear(amount(account.walletBalance), 49.99, 'Single SMS should debit current SMS rate');

  await walletBillingService.recordOutboundMessageDebit(sms);
  account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  assertNear(amount(account.walletBalance), 49.99, 'Provider retry should not duplicate SMS debit');
  assertEqual(
    await countLedger(prisma, org.id, { messageId: sms.id, category: 'message_usage' }),
    1,
    'Outbound message usage ledger should be unique per message'
  );

  const longBody = 'a'.repeat(161);
  const longEstimate = await walletBillingService.assertCanSendMessage({
    organizationId: org.id,
    body: longBody,
  });
  assertEqual(longEstimate.smsSegments, 2, 'Long GSM SMS should use two segments');
  const longSms = await createMessage(prisma, org.id, {
    direction: 'outbound',
    body: longBody,
    billingEstimate: longEstimate,
  });
  await walletBillingService.recordOutboundMessageDebit(longSms);

  const mmsEstimate = await walletBillingService.assertCanSendMessage({
    organizationId: org.id,
    body: 'photo',
    mediaUrls: ['https://example.test/image.jpg'],
  });
  assertNear(mmsEstimate.amount, 0.025, 'MMS estimate should use current MMS rate');
  const mms = await createMessage(prisma, org.id, {
    direction: 'outbound',
    type: 'mms',
    body: 'photo',
    mediaUrls: ['https://example.test/image.jpg'],
    billingEstimate: mmsEstimate,
  });
  await walletBillingService.recordOutboundMessageDebit(mms);

  account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  assertNear(
    amount(account.walletBalance),
    49.945,
    'SMS, long SMS, and MMS debits should match tier rates'
  );

  const emptyOrg = await createOrganization(prisma, 'outbound-empty');
  await createBillingAccount(prisma, emptyOrg.id, {
    walletBalance: 0,
    savedPaymentMethod: true,
    setupFeeCharged: true,
  });
  await expectAppError(
    () => walletBillingService.assertCanSendMessage({
      organizationId: emptyOrg.id,
      body: 'blocked',
    }),
    'WALLET_FUNDS_REQUIRED',
    'Outbound with empty wallet should be rejected before provider send'
  );
}

async function scenarioInboundHoldAndRelease(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike,
  syncRecorder: SyncRecorder
) {
  const fundedOrg = await createOrganization(prisma, 'inbound-funded');
  await createBillingAccount(prisma, fundedOrg.id, {
    walletBalance: 1,
    savedPaymentMethod: true,
    setupFeeCharged: true,
  });
  const visibleInbound = await createMessage(prisma, fundedOrg.id, {
    direction: 'inbound',
    body: 'visible inbound',
  });
  const visibleResult = await walletBillingService.recordInboundMessageBilling(visibleInbound);
  assertEqual(visibleResult.held, false, 'Funded inbound message should not be held');
  const refreshedVisible = await prisma.message.findUniqueOrThrow({ where: { id: visibleInbound.id } });
  assertEqual(refreshedVisible.visible, true, 'Funded inbound remains visible');

  const heldOrg = await createOrganization(prisma, 'inbound-held');
  await createBillingAccount(prisma, heldOrg.id, {
    walletBalance: 0,
    savedPaymentMethod: true,
    setupFeeCharged: true,
  });
  const heldOne = await createMessage(prisma, heldOrg.id, {
    direction: 'inbound',
    body: 'held inbound one',
  });
  const heldTwo = await createMessage(prisma, heldOrg.id, {
    direction: 'inbound',
    body: 'held inbound two',
  });
  const holdResult = await walletBillingService.recordInboundMessageBilling(heldOne);
  await walletBillingService.recordInboundMessageBilling(heldTwo);
  assertEqual(holdResult.held, true, 'Unfunded inbound should be held');
  let refreshedHeld = await prisma.message.findUniqueOrThrow({ where: { id: heldOne.id } });
  assertEqual(refreshedHeld.heldForPayment, true, 'Held inbound should set heldForPayment');
  assertEqual(refreshedHeld.visible, false, 'Held inbound should be hidden');
  assertEqual(
    await countLedger(prisma, heldOrg.id, { category: 'inbound_hold' }),
    2,
    'Each held inbound should write a hold ledger entry'
  );

  await setWalletBalance(prisma, heldOrg.id, 0.015);
  let releaseResult = await walletBillingService.releaseHeldInboundMessages(heldOrg.id);
  assertEqual(releaseResult.released, 1, 'Insufficient release funds should release only payable messages');
  assertEqual(releaseResult.heldRemaining, 1, 'Unpayable held inbound should remain held');
  assert(
    syncRecorder.syncedMessageIds.has(heldOne.id),
    'Released inbound should sync to CRM after first release'
  );
  assertEqual(
    await countLedger(prisma, heldOrg.id, { category: 'inbound_release' }),
    1,
    'Released inbound should write a release marker'
  );

  await setWalletBalance(prisma, heldOrg.id, 10);
  releaseResult = await walletBillingService.releaseHeldInboundMessages(heldOrg.id);
  assertEqual(releaseResult.released, 1, 'Remaining held inbound should release after funding');
  refreshedHeld = await prisma.message.findUniqueOrThrow({ where: { id: heldTwo.id } });
  assertEqual(refreshedHeld.visible, true, 'Released inbound should become visible');
  assertEqual(refreshedHeld.heldForPayment, false, 'Released inbound should clear heldForPayment');
  assert(
    syncRecorder.syncedMessageIds.has(heldTwo.id),
    'Released inbound should sync to CRM after subsequent release'
  );

  await walletBillingService.releaseHeldInboundMessages(heldOrg.id);
  assertEqual(
    await countLedger(prisma, heldOrg.id, { category: 'inbound_release' }),
    2,
    'Release endpoint should not duplicate release markers on replay'
  );
}

async function scenarioMrcCalculation(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike
) {
  const emptyOrg = await createOrganization(prisma, 'mrc-empty');
  await createBillingAccount(prisma, emptyOrg.id, {
    walletBalance: 100,
    savedPaymentMethod: true,
    setupFeeCharged: true,
  });
  let summary = await walletBillingService.getWalletSummary(emptyOrg.id);
  assertNear(summary.usage.estimatedMonthlyRecurring, 0, '0 campaigns + 0 numbers MRC should be $0');

  const oneOrg = await createOrganization(prisma, 'mrc-one');
  await createBillingAccount(prisma, oneOrg.id, {
    walletBalance: 100,
    pricingTier: 'tier_250',
    savedPaymentMethod: true,
    setupFeeCharged: true,
  });
  let brand = await createBrand(prisma, oneOrg.id, 'mrc-one');
  let campaign = await createCampaign(prisma, oneOrg.id, brand.id, 'mrc-one');
  await createPhoneNumber(prisma, oneOrg.id, 'mrc-one', 'active', campaign.id);
  summary = await walletBillingService.getWalletSummary(oneOrg.id);
  assertNear(summary.usage.estimatedMonthlyRecurring, 11, '1 campaign + 1 number tier $250 MRC');

  const countsOrg = await createOrganization(prisma, 'mrc-counts');
  await createBillingAccount(prisma, countsOrg.id, {
    walletBalance: 100,
    pricingTier: 'tier_250',
    savedPaymentMethod: true,
    setupFeeCharged: true,
  });
  brand = await createBrand(prisma, countsOrg.id, 'mrc-counts');
  campaign = await createCampaign(prisma, countsOrg.id, brand.id, 'mrc-counts-a');
  await createCampaign(prisma, countsOrg.id, brand.id, 'mrc-counts-b');
  await createCampaign(prisma, countsOrg.id, brand.id, 'mrc-counts-draft', 'draft');
  await createPhoneNumber(prisma, countsOrg.id, 'mrc-counts-a', 'active', campaign.id);
  await createPhoneNumber(prisma, countsOrg.id, 'mrc-counts-b', 'active', campaign.id);
  await createPhoneNumber(prisma, countsOrg.id, 'mrc-counts-c', 'active', campaign.id);
  await createPhoneNumber(prisma, countsOrg.id, 'mrc-counts-pending', 'pending', campaign.id);
  summary = await walletBillingService.getWalletSummary(countsOrg.id);
  assertNear(summary.usage.estimatedMonthlyRecurring, 23, '2 campaigns + 3 numbers tier $250 MRC');
  assertEqual(summary.usage.activeCampaigns, 2, 'Only approved campaigns should count');
  assertEqual(summary.usage.activePhoneNumbers, 3, 'Only active phone numbers should count');

  await prisma.billingAccount.update({
    where: { organizationId: countsOrg.id },
    data: { pricingTier: 'tier_500' },
  });
  summary = await walletBillingService.getWalletSummary(countsOrg.id);
  assertNear(summary.usage.estimatedMonthlyRecurring, 22.25, 'Tier $500 phone MRC rate should apply');

  await prisma.billingAccount.update({
    where: { organizationId: countsOrg.id },
    data: { pricingTier: 'tier_1400' },
  });
  summary = await walletBillingService.getWalletSummary(countsOrg.id);
  assertNear(summary.usage.estimatedMonthlyRecurring, 21.5, 'Tier $1400 phone MRC rate should apply');
}

async function scenarioMrcProcessing(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike
) {
  const org = await createOrganization(prisma, 'mrc-wallet');
  await createBillingAccount(prisma, org.id, {
    walletBalance: 50,
    savedPaymentMethod: true,
    setupFeeCharged: true,
    mrcDue: true,
  });
  const brand = await createBrand(prisma, org.id, 'mrc-wallet');
  const campaign = await createCampaign(prisma, org.id, brand.id, 'mrc-wallet');
  await createPhoneNumber(prisma, org.id, 'mrc-wallet', 'active', campaign.id);

  const result = await walletBillingService.processMonthlyRecurringCharges({
    organizationId: org.id,
    now: fixedNow,
  });
  assertEqual(result.processed, 1, 'MRC wallet-funded account should process');
  assertEqual(result.debited, 1, 'MRC wallet-funded account should debit');
  assertEqual(result.chargedCards, 0, 'MRC wallet-funded account should not charge card');
  let account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  assertNear(amount(account.walletBalance), 39, 'MRC should debit campaign and phone MRC from wallet');
  assert(account.mrcNextRunAt && account.mrcNextRunAt > fixedNow, 'MRC next run should advance');
  assertEqual(
    await countLedger(prisma, org.id, { category: 'mrc_campaign' }),
    1,
    'Campaign MRC ledger should be written once'
  );
  assertEqual(
    await countLedger(prisma, org.id, { category: 'mrc_phone_number' }),
    1,
    'Phone number MRC ledger should be written once'
  );

  const replay = await walletBillingService.processMonthlyRecurringCharges({
    organizationId: org.id,
    now: fixedNow,
  });
  assertEqual(replay.processed, 0, 'Re-running same MRC cycle should not double-charge');
  account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  assertNear(amount(account.walletBalance), 39, 'MRC replay should leave wallet unchanged');
}

async function scenarioMrcShortfallWithSavedCard(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike
) {
  const org = await createOrganization(prisma, 'mrc-card-shortfall');
  await createBillingAccount(prisma, org.id, {
    walletBalance: 0,
    savedPaymentMethod: true,
    setupFeeCharged: true,
    mrcDue: true,
  });
  const brand = await createBrand(prisma, org.id, 'mrc-card-shortfall');
  const campaign = await createCampaign(prisma, org.id, brand.id, 'mrc-card-shortfall');
  await createPhoneNumber(prisma, org.id, 'mrc-card-shortfall', 'active', campaign.id);

  const result = await walletBillingService.processMonthlyRecurringCharges({
    organizationId: org.id,
    now: fixedNow,
  });
  assertEqual(result.processed, 1, 'MRC shortfall should process when saved card succeeds');
  assertEqual(result.chargedCards, 1, 'MRC shortfall should charge saved card');

  const entries = await prisma.billingLedgerEntry.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: 'asc' },
  });
  assert(entries.some((entry) => entry.category === 'card_charge' && amount(entry.amount) === 11), 'Card charge credit should be $11');
  assert(entries.some((entry) => entry.category === 'mrc_campaign' && amount(entry.amount) === 10), 'Campaign MRC debit should be $10');
  assert(entries.some((entry) => entry.category === 'mrc_phone_number' && amount(entry.amount) === 1), 'Phone number MRC debit should be $1');

  const account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  assertNear(amount(account.walletBalance), 0, 'MRC card shortfall should end at $0 spendable balance');

  await expectAppError(
    () => walletBillingService.assertCanSendMessage({
      organizationId: org.id,
      body: 'still blocked',
    }),
    'WALLET_FUNDS_REQUIRED',
    'Outbound should still fail after MRC-only card shortfall charge'
  );
}

async function scenarioMrcFailureAndSuspension(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike,
  stripeControl: { setFailOffSessionPayment(value: boolean): void }
) {
  const noCardOrg = await createOrganization(prisma, 'mrc-no-card');
  await createBillingAccount(prisma, noCardOrg.id, {
    walletBalance: 0,
    savedPaymentMethod: false,
    setupFeeCharged: true,
    mrcDue: true,
  });
  let brand = await createBrand(prisma, noCardOrg.id, 'mrc-no-card');
  let campaign = await createCampaign(prisma, noCardOrg.id, brand.id, 'mrc-no-card');
  await createPhoneNumber(prisma, noCardOrg.id, 'mrc-no-card', 'active', campaign.id);

  let result = await walletBillingService.processMonthlyRecurringCharges({
    organizationId: noCardOrg.id,
    now: fixedNow,
  });
  assertEqual(result.suspended, 1, 'MRC without saved card should suspend billing');
  let account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: noCardOrg.id } });
  assertEqual(account.status, 'suspended', 'Suspension status should be stored');
  assert(account.suspensionReason, 'Suspension reason should be stored');
  await expectAppError(
    () => walletBillingService.assertCanSendMessage({
      organizationId: noCardOrg.id,
      body: 'blocked',
    }),
    'BILLING_SUSPENDED',
    'Outbound should be blocked while billing is suspended'
  );
  await expectAppError(
    () => walletBillingService.preparePhoneNumberProvisioning(noCardOrg.id),
    'BILLING_SUSPENDED',
    'Phone provisioning should be blocked while billing is suspended'
  );
  await expectAppError(
    () => walletBillingService.assertCanUsePaidServices(noCardOrg.id),
    'BILLING_SUSPENDED',
    'Campaign paid actions should be blocked while billing is suspended'
  );

  await completeTopUp(walletBillingService, noCardOrg.id, 250);
  account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: noCardOrg.id } });
  assertEqual(account.status, 'active', 'Successful wallet top-up should clear fundable billing suspension');
  assertNear(
    amount(account.walletBalance),
    250,
    'Suspension recovery top-up should create spendable wallet balance'
  );

  const failingCardOrg = await createOrganization(prisma, 'mrc-failing-card');
  await createBillingAccount(prisma, failingCardOrg.id, {
    walletBalance: 0,
    savedPaymentMethod: true,
    setupFeeCharged: true,
    mrcDue: true,
  });
  brand = await createBrand(prisma, failingCardOrg.id, 'mrc-failing-card');
  campaign = await createCampaign(prisma, failingCardOrg.id, brand.id, 'mrc-failing-card');
  await createPhoneNumber(prisma, failingCardOrg.id, 'mrc-failing-card', 'active', campaign.id);

  stripeControl.setFailOffSessionPayment(true);
  result = await walletBillingService.processMonthlyRecurringCharges({
    organizationId: failingCardOrg.id,
    now: fixedNow,
  });
  stripeControl.setFailOffSessionPayment(false);
  assertEqual(result.suspended, 1, 'Failing saved card should suspend billing');
  account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: failingCardOrg.id } });
  assertEqual(account.status, 'suspended', 'Failing card suspension should be stored');
  assert(
    account.suspensionReason?.includes('QA simulated off-session payment failure'),
    'Failing card suspension reason should preserve failure'
  );

  const setupSession = await walletBillingService.createPaymentMethodSetupSession(failingCardOrg.id);
  await walletBillingService.completePaymentMethodSetup(failingCardOrg.id, setupSession.sessionId);
  account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: failingCardOrg.id } });
  assertEqual(account.status, 'active', 'Successful payment method setup should clear card-failure suspension');

  result = await walletBillingService.processMonthlyRecurringCharges({
    organizationId: failingCardOrg.id,
    now: fixedNow,
  });
  assertEqual(result.processed, 1, 'Recovered failing card account should process due MRC');
  assertEqual(result.chargedCards, 1, 'Recovered failing card account should charge saved card for MRC');
  account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: failingCardOrg.id } });
  assertNear(
    amount(account.walletBalance),
    0,
    'Recovered MRC card payment should not create spendable message balance'
  );
}

async function scenarioAdminOneTimeFees(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike
) {
  const org = await createOrganization(prisma, 'admin-fees');
  await createBillingAccount(prisma, org.id, {
    walletBalance: 200,
    savedPaymentMethod: true,
    setupFeeCharged: true,
  });

  await walletBillingService.debitAdministrativeFee({
    organizationId: org.id,
    fee: 'enhanced_vetting',
    ledgerKey: `admin-fee:${org.id}:enhanced-vetting`,
    sourceId: 'qa-enhanced-vetting',
  });
  await walletBillingService.debitAdministrativeFee({
    organizationId: org.id,
    fee: 'campaign_expedite',
    ledgerKey: `admin-fee:${org.id}:campaign-expedite`,
    sourceId: 'qa-campaign-expedite',
  });

  let account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
  assertNear(amount(account.walletBalance), 95, 'Admin fees should debit $55 and $50');
  assertEqual(
    await countLedger(prisma, org.id, { category: 'enhanced_vetting' }),
    1,
    'Enhanced vetting fee ledger should be written'
  );
  assertEqual(
    await countLedger(prisma, org.id, { category: 'campaign_expedite' }),
    1,
    'Campaign expedite fee ledger should be written'
  );
  const summary = await walletBillingService.getWalletSummary(org.id);
  assertNear(summary.usage.estimatedMonthlyRecurring, 0, 'Admin one-time fees should not affect MRC');

  const lowOrg = await createOrganization(prisma, 'admin-fees-low');
  await createBillingAccount(prisma, lowOrg.id, {
    walletBalance: 10,
    savedPaymentMethod: true,
    setupFeeCharged: true,
  });
  await expectAppError(
    () => walletBillingService.debitAdministrativeFee({
      organizationId: lowOrg.id,
      fee: 'enhanced_vetting',
      sourceId: 'qa-low-funds',
    }),
    'WALLET_FUNDS_REQUIRED',
    'Admin one-time fees should require sufficient wallet balance'
  );

  account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: lowOrg.id } });
  assertNear(amount(account.walletBalance), 10, 'Rejected admin fee should not debit wallet');
}

async function requestJson(input: {
  baseUrl: string;
  path: string;
  method?: string;
  token: string;
  body?: Record<string, unknown>;
  expectedStatus?: number;
}) {
  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method: input.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${input.token}`,
      ...(input.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const json = await response.json() as {
    success?: boolean;
    data?: Record<string, unknown>;
    error?: {
      code?: string;
      message?: string;
    };
  };
  const expectedStatus = input.expectedStatus ?? 200;

  assertEqual(
    response.status,
    expectedStatus,
    `${input.method ?? 'GET'} ${input.path} should return HTTP ${expectedStatus}`
  );

  if (expectedStatus >= 200 && expectedStatus < 300) {
    assertEqual(json.success, true, `${input.method ?? 'GET'} ${input.path} should succeed`);
  }

  return json;
}

async function scenarioApiSmoke(
  prisma: PrismaClientLike,
  walletBillingService: WalletBillingServiceLike
) {
  const [{ default: express }, { billingRoutes }, { errorHandler }, { authService }] =
    await Promise.all([
      import('express'),
      import('../src/routes/billing.routes.js'),
      import('../src/middleware/errorHandler.js'),
      import('../src/services/auth.service.js'),
    ]);

  const app = express();
  app.use(express.json());
  app.use('/billing', billingRoutes);
  app.use(errorHandler);

  const server = await new Promise<import('node:http').Server>((resolveServer) => {
    const listener = app.listen(0, () => resolveServer(listener));
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'API smoke server should bind to an ephemeral port');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const registration = await authService.register({
      email: emailFor('api-smoke-user'),
      password: 'BillingQa123!',
      firstName: 'Billing',
      lastName: 'QA',
      organizationName: 'Billing QA API Smoke',
    });
    const token = registration.tokens.accessToken;
    const organizationId = registration.organization.id;

    await requestJson({
      baseUrl,
      path: '/billing/wallet',
      token,
    });

    const topUpCheckout = await requestJson({
      baseUrl,
      path: '/billing/wallet/top-ups/checkout',
      method: 'POST',
      token,
      body: { amountDollars: 250 },
    });
    assert(
      typeof topUpCheckout.data?.sessionId === 'string',
      'Top-up checkout should return a session ID'
    );

    await requestJson({
      baseUrl,
      path: '/billing/wallet/top-ups/checkout/complete',
      method: 'POST',
      token,
      body: { sessionId: topUpCheckout.data.sessionId },
    });

    const setupCheckout = await requestJson({
      baseUrl,
      path: '/billing/wallet/payment-method/setup',
      method: 'POST',
      token,
    });
    assert(
      typeof setupCheckout.data?.sessionId === 'string',
      'Payment method setup should return a session ID'
    );

    await requestJson({
      baseUrl,
      path: '/billing/wallet/payment-method/setup/complete',
      method: 'POST',
      token,
      body: { sessionId: setupCheckout.data.sessionId },
    });

    await setWalletBalance(prisma, organizationId, 0);
    const held = await createMessage(prisma, organizationId, {
      direction: 'inbound',
      body: 'API smoke held inbound',
    });
    await walletBillingService.recordInboundMessageBilling(held);
    await setWalletBalance(prisma, organizationId, 1);
    const release = await requestJson({
      baseUrl,
      path: '/billing/wallet/release-held',
      method: 'POST',
      token,
    });
    assertEqual(release.data?.released, 1, 'Release-held endpoint should release funded held inbound');

    const brand = await createBrand(prisma, organizationId, 'api-smoke');
    const campaign = await createCampaign(prisma, organizationId, brand.id, 'api-smoke');
    await createPhoneNumber(prisma, organizationId, 'api-smoke', 'active', campaign.id);
    await prisma.billingAccount.update({
      where: { organizationId },
      data: { mrcNextRunAt: new Date('2026-07-01T00:00:00.000Z') },
    });

    const mrc = await requestJson({
      baseUrl,
      path: '/billing/wallet/mrc/process',
      method: 'POST',
      token,
    });
    assertEqual(mrc.data?.processed, 1, 'MRC process endpoint should process due account');
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

async function scenarioUiStaticAcceptance() {
  const subscriptionsPath = resolve(repoRoot, 'packages/web/src/pages/subscriptions/index.tsx');
  const source = await readFile(subscriptionsPath, 'utf8');
  const monthlyStart = source.indexOf('Monthly Charges');
  const oneTimeStart = source.indexOf('One-Time Fees');
  assert(monthlyStart >= 0, 'Billing dashboard should include Monthly Charges section');
  assert(oneTimeStart > monthlyStart, 'Billing dashboard should include One-Time Fees after Monthly Charges');
  const monthlySection = source.slice(monthlyStart, oneTimeStart);
  const oneTimeSection = source.slice(oneTimeStart);
  assert(monthlySection.includes('Estimated MRC'), 'Monthly Charges should show Estimated MRC');
  assert(monthlySection.includes('Next MRC run'), 'Monthly Charges should show Next MRC run');
  assert(!monthlySection.includes('Basic setup fee'), 'Monthly Charges should not show setup fee');
  assert(oneTimeSection.includes('Basic setup fee'), 'One-Time Fees should show basic setup fee');
  assert(oneTimeSection.includes("'Paid'"), 'One-Time Fees should show Paid when setup fee is charged');
  assert(source.includes('Carrier Surcharges'), 'Billing dashboard should show carrier surcharges');
  assert(source.includes('summary.carrierSurcharges'), 'Billing dashboard should render carrier surcharge data from API');
  assert(
    source.includes('summary.carrierSurchargeNote'),
    'Billing dashboard should show carrier surcharge inclusion note from API'
  );
  assert(source.includes('summary.prepayBalanceNote'), 'Billing dashboard should show the prepayment balance note from API');
}

async function main() {
  const [
    { prisma },
    { walletBillingService },
    { stripeService },
    { redis },
    { inboundMessageSyncService },
  ] = await Promise.all([
    import('../src/config/database.js'),
    import('../src/services/wallet-billing.service.js'),
    import('../src/services/stripe.service.js'),
    import('../src/config/redis.js'),
    import('../src/services/inbound-message-sync.service.js'),
  ]);
  const stripeControl = await patchStripeService(stripeService as unknown as Record<string, unknown>);
  const syncRecorder: SyncRecorder = {
    syncedMessageIds: new Set<string>(),
  };
  inboundMessageSyncService.syncToPlatform = async (message) => {
    syncRecorder.syncedMessageIds.add(message.id);
    return message;
  };

  const scenarios: Array<[string, () => Promise<void>]> = [
    ['Wallet top-up and tier pricing', () => scenarioWalletTopUps(prisma, walletBillingService)],
    ['Setup fee behavior', () => scenarioSetupFee(prisma, walletBillingService)],
    ['Outbound SMS/MMS wallet debit', () => scenarioOutboundUsage(prisma, walletBillingService)],
    [
      'Inbound hold and release',
      () => scenarioInboundHoldAndRelease(prisma, walletBillingService, syncRecorder),
    ],
    ['MRC calculation', () => scenarioMrcCalculation(prisma, walletBillingService)],
    ['MRC processing with wallet funds', () => scenarioMrcProcessing(prisma, walletBillingService)],
    [
      'MRC shortfall with saved card',
      () => scenarioMrcShortfallWithSavedCard(prisma, walletBillingService),
    ],
    [
      'MRC failure and suspension',
      () => scenarioMrcFailureAndSuspension(prisma, walletBillingService, stripeControl),
    ],
    ['Admin one-time fees', () => scenarioAdminOneTimeFees(prisma, walletBillingService)],
    ['Authenticated billing API smoke', () => scenarioApiSmoke(prisma, walletBillingService)],
    ['UI static acceptance', scenarioUiStaticAcceptance],
  ];

  await cleanup(prisma);

  try {
    for (const [name, scenario] of scenarios) {
      process.stdout.write(`- ${name}... `);
      await scenario();
      process.stdout.write('passed\n');
    }
  } finally {
    await cleanup(prisma);
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().catch((error) => {
  console.error('\nBilling QA failed.');
  console.error(error);
  process.exit(1);
});
