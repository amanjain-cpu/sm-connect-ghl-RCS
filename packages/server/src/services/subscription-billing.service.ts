import {
  Prisma,
  type BillingEvent,
  type OrganizationSubscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { stripeService, type StripeCheckoutSession, type StripeSubscription } from './stripe.service.js';

const MESSAGE_OVERAGE_RATE = 0.0039;
const EXTRA_NUMBER_SETUP_FEE = 0.05;
const EXTRA_NUMBER_MONTHLY_RATE = 0.5;
const EXTRA_NUMBER_FIRST_CHARGE = EXTRA_NUMBER_SETUP_FEE + EXTRA_NUMBER_MONTHLY_RATE;
const MIN_REALTIME_CHARGE = 0.5;
const MESSAGE_TOP_UP_OPTIONS = [10, 25, 50, 100] as const;

const PLAN_DEFINITIONS = {
  starter: {
    id: 'starter',
    label: 'Starter',
    monthlyPrice: 36.75,
    smsIncluded: 5000,
    mmsIncluded: 500,
    phoneNumbersIncluded: 1,
  },
  growth: {
    id: 'growth',
    label: 'Growth',
    monthlyPrice: 93.45,
    smsIncluded: 25000,
    mmsIncluded: 2500,
    phoneNumbersIncluded: 5,
  },
  scale: {
    id: 'scale',
    label: 'Scale',
    monthlyPrice: 166.95,
    smsIncluded: 100000,
    mmsIncluded: 10000,
    phoneNumbersIncluded: 15,
  },
} as const satisfies Record<
  'starter' | 'growth' | 'scale',
  {
    id: SubscriptionPlan;
    label: string;
    monthlyPrice: number;
    smsIncluded: number;
    mmsIncluded: number;
    phoneNumbersIncluded: number;
  }
>;

type SupportedPlan = keyof typeof PLAN_DEFINITIONS;

interface StripeInvoicePayload {
  id: string;
  customer?: string | null;
  subscription?: string | null;
}

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toAmount(value: Prisma.Decimal | string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  return Number(value);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundLedger(value: number) {
  return Math.round(value * 10000) / 10000;
}

function floorChargeableAmount(value: number) {
  return Math.floor(value * 100) / 100;
}

function parsePlan(value: unknown): SupportedPlan | null {
  if (typeof value !== 'string') {
    return null;
  }

  return value in PLAN_DEFINITIONS ? (value as SupportedPlan) : null;
}

function extractStripeId(value: string | { id?: string | null } | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return value.id || null;
}

function isActiveSubscriptionStatus(status: SubscriptionStatus) {
  return status === 'active' || status === 'trialing';
}

function requiresBillingBlock(status: SubscriptionStatus) {
  return status === 'past_due' || status === 'unpaid' || status === 'incomplete';
}

export class SubscriptionBillingService {
  private async resolvePlanDefinition(plan: SupportedPlan) {
    const basePlan = PLAN_DEFINITIONS[plan];
    const priceId = await stripeService.getPlanPriceId(plan);

    if (!priceId) {
      return basePlan;
    }

    try {
      const stripePrice = await stripeService.getPrice(priceId);
      return {
        ...basePlan,
        monthlyPrice: (stripePrice.unit_amount ?? Math.round(basePlan.monthlyPrice * 100)) / 100,
      };
    } catch {
      return basePlan;
    }
  }

  async getPlanCatalog() {
    const plans = await Promise.all(
      (Object.keys(PLAN_DEFINITIONS) as SupportedPlan[]).map((plan) =>
        this.resolvePlanDefinition(plan)
      )
    );

    return plans.map((plan) => ({
      ...plan,
      smsOverageRate: MESSAGE_OVERAGE_RATE,
      mmsOverageRate: MESSAGE_OVERAGE_RATE,
      extraPhoneNumberSetupFee: EXTRA_NUMBER_SETUP_FEE,
      extraPhoneNumberMonthlyRate: EXTRA_NUMBER_MONTHLY_RATE,
    }));
  }

  private async getOrganizationRecord(organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!organization) {
      throw new AppError('Organization not found', 'ORGANIZATION_NOT_FOUND', 404);
    }

    return organization;
  }

  private async ensureSubscriptionRecord(organizationId: string) {
    return prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
      },
      update: {},
    });
  }

  private async ensureStripeCustomer(
    subscription: OrganizationSubscription,
    organization: { id: string; name: string; email: string }
  ) {
    if (subscription.stripeCustomerId) {
      return subscription.stripeCustomerId;
    }

    const customer = await stripeService.createCustomer({
      organizationId: organization.id,
      email: organization.email,
      name: organization.name,
    });

    await prisma.organizationSubscription.update({
      where: { id: subscription.id },
      data: {
        stripeCustomerId: customer.id,
      },
    });

    return customer.id;
  }

  private async inferPlanFromPriceId(priceId: string | null | undefined): Promise<SupportedPlan | null> {
    if (!priceId) {
      return null;
    }

    const [starter, growth, scale] = await Promise.all([
      stripeService.getPlanPriceId('starter'),
      stripeService.getPlanPriceId('growth'),
      stripeService.getPlanPriceId('scale'),
    ]);

    if (priceId === starter) return 'starter';
    if (priceId === growth) return 'growth';
    if (priceId === scale) return 'scale';
    return null;
  }

  private async syncSubscriptionFromStripe(
    organizationId: string,
    stripeSubscription: StripeSubscription,
    options?: { planHint?: SupportedPlan | null }
  ) {
    const existing = await prisma.organizationSubscription.findUnique({
      where: { organizationId },
    });

    const itemPriceId = stripeSubscription.items?.data?.[0]?.price?.id || null;
    const inferredPlan =
      parsePlan(stripeSubscription.metadata?.plan) ||
      options?.planHint ||
      await this.inferPlanFromPriceId(itemPriceId);

    const planDefinition = inferredPlan ? PLAN_DEFINITIONS[inferredPlan] : null;
    const status = stripeSubscription.status as SubscriptionStatus;
    const currentPeriodStart = stripeSubscription.current_period_start
      ? new Date(stripeSubscription.current_period_start * 1000)
      : null;
    const currentPeriodEnd = stripeSubscription.current_period_end
      ? new Date(stripeSubscription.current_period_end * 1000)
      : null;
    const periodChanged = Boolean(
      existing?.currentPeriodStart &&
      currentPeriodStart &&
      existing.currentPeriodStart.getTime() !== currentPeriodStart.getTime()
    );

    const createData: Prisma.OrganizationSubscriptionUncheckedCreateInput = {
      organizationId,
      plan: inferredPlan || existing?.plan || null,
      status,
      stripeCustomerId: stripeSubscription.customer,
      stripeSubscriptionId: stripeSubscription.id,
      stripeDefaultPaymentMethodId:
        extractStripeId(stripeSubscription.default_payment_method) ||
        existing?.stripeDefaultPaymentMethodId ||
        null,
      stripeLatestInvoiceId: extractStripeId(stripeSubscription.latest_invoice),
      currentPeriodStart,
      currentPeriodEnd,
      smsIncluded: planDefinition?.smsIncluded ?? existing?.smsIncluded ?? 0,
      mmsIncluded: planDefinition?.mmsIncluded ?? existing?.mmsIncluded ?? 0,
      phoneNumbersIncluded: planDefinition?.phoneNumbersIncluded ?? existing?.phoneNumbersIncluded ?? 0,
      smsUsed: periodChanged ? 0 : existing?.smsUsed ?? 0,
      mmsUsed: periodChanged ? 0 : existing?.mmsUsed ?? 0,
      messageCreditBalance: existing?.messageCreditBalance ?? '0.0000',
      pendingOverageBalance: periodChanged ? '0.0000' : existing?.pendingOverageBalance ?? '0.0000',
      activatedAt: existing?.activatedAt || (isActiveSubscriptionStatus(status) ? new Date() : null),
      canceledAt: status === 'canceled' ? new Date() : existing?.canceledAt ?? null,
      metadata: {
        ...(asRecord(existing?.metadata)),
        stripePriceId: itemPriceId,
      },
      billingBlockedAt: requiresBillingBlock(status)
        ? existing?.billingBlockedAt ?? new Date()
        : existing?.billingBlockedAt ?? null,
      billingBlockedReason: requiresBillingBlock(status)
        ? existing?.billingBlockedReason || 'Stripe reported an unpaid or incomplete subscription state.'
        : existing?.billingBlockedReason ?? null,
    };

    const updateData: Prisma.OrganizationSubscriptionUncheckedUpdateInput = {
      ...createData,
    };

    return prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: createData,
      update: updateData,
    });
  }

  private async refreshSubscriptionIfNeeded(subscription: OrganizationSubscription) {
    if (
      !subscription.stripeSubscriptionId ||
      !subscription.currentPeriodEnd ||
      subscription.status === 'canceled'
    ) {
      return subscription;
    }

    if (subscription.currentPeriodEnd.getTime() > Date.now()) {
      return subscription;
    }

    const stripeSubscription = await stripeService.getSubscription(subscription.stripeSubscriptionId);
    return this.syncSubscriptionFromStripe(subscription.organizationId, stripeSubscription, {
      planHint: parsePlan(subscription.plan),
    });
  }

  private async getCurrentSubscription(organizationId: string) {
    const ensured = await this.ensureSubscriptionRecord(organizationId);
    return this.refreshSubscriptionIfNeeded(ensured);
  }

  private async ensureDefaultPaymentMethod(subscription: OrganizationSubscription) {
    if (subscription.stripeDefaultPaymentMethodId) {
      return subscription.stripeDefaultPaymentMethodId;
    }

    if (subscription.stripeCustomerId) {
      const customer = await stripeService.getCustomer(subscription.stripeCustomerId);
      const paymentMethodId = extractStripeId(customer.invoice_settings?.default_payment_method);
      if (paymentMethodId) {
        await prisma.organizationSubscription.update({
          where: { id: subscription.id },
          data: { stripeDefaultPaymentMethodId: paymentMethodId },
        });
        return paymentMethodId;
      }
    }

    if (subscription.stripeSubscriptionId) {
      const stripeSubscription = await stripeService.getSubscription(subscription.stripeSubscriptionId);
      const synced = await this.syncSubscriptionFromStripe(subscription.organizationId, stripeSubscription, {
        planHint: parsePlan(subscription.plan),
      });
      return synced.stripeDefaultPaymentMethodId;
    }

    return null;
  }

  private async markBillingBlocked(subscriptionId: string, reason: string) {
    await prisma.organizationSubscription.update({
      where: { id: subscriptionId },
      data: {
        billingBlockedAt: new Date(),
        billingBlockedReason: reason,
      },
    });
  }

  private async clearBillingBlock(subscriptionId: string) {
    await prisma.organizationSubscription.update({
      where: { id: subscriptionId },
      data: {
        billingBlockedAt: null,
        billingBlockedReason: null,
      },
    });
  }

  private async listRecentCharges(organizationId: string) {
    return prisma.billingCharge.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  private async countActivePhoneNumbers(organizationId: string) {
    return prisma.phoneNumber.count({
      where: {
        organizationId,
        status: 'active',
      },
    });
  }

  async getSubscriptionSummary(organizationId: string) {
    const [subscription, activePhoneNumbers, recentCharges, plans] = await Promise.all([
      this.getCurrentSubscription(organizationId),
      this.countActivePhoneNumbers(organizationId),
      this.listRecentCharges(organizationId),
      this.getPlanCatalog(),
    ]);

    return {
      plans,
      subscription: {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        billingBlockedAt: subscription.billingBlockedAt,
        billingBlockedReason: subscription.billingBlockedReason,
        messageCreditBalance: toAmount(subscription.messageCreditBalance),
        pendingOverageBalance: toAmount(subscription.pendingOverageBalance),
        smsIncluded: subscription.smsIncluded,
        mmsIncluded: subscription.mmsIncluded,
        phoneNumbersIncluded: subscription.phoneNumbersIncluded,
        hasStripeCustomer: Boolean(subscription.stripeCustomerId),
      },
      usage: {
        smsUsed: subscription.smsUsed,
        smsRemaining: Math.max(0, subscription.smsIncluded - subscription.smsUsed),
        smsOverage: Math.max(0, subscription.smsUsed - subscription.smsIncluded),
        mmsUsed: subscription.mmsUsed,
        mmsRemaining: Math.max(0, subscription.mmsIncluded - subscription.mmsUsed),
        mmsOverage: Math.max(0, subscription.mmsUsed - subscription.mmsIncluded),
        activePhoneNumbers,
        phoneNumbersIncluded: subscription.phoneNumbersIncluded,
        messageCreditBalance: toAmount(subscription.messageCreditBalance),
        extraPhoneNumbers: Math.max(0, activePhoneNumbers - subscription.phoneNumbersIncluded),
      },
      rates: {
        smsOverageRate: MESSAGE_OVERAGE_RATE,
        mmsOverageRate: MESSAGE_OVERAGE_RATE,
        extraPhoneNumberSetupFee: EXTRA_NUMBER_SETUP_FEE,
        extraPhoneNumberMonthlyRate: EXTRA_NUMBER_MONTHLY_RATE,
        realtimeChargeThreshold: MIN_REALTIME_CHARGE,
      },
      topUpOptions: [...MESSAGE_TOP_UP_OPTIONS],
      recentCharges: recentCharges.map((charge) => ({
        ...charge,
        amount: toAmount(charge.amount),
      })),
    };
  }

  async createOrUpdateSubscriptionCheckout(
    organizationId: string,
    plan: SupportedPlan
  ): Promise<
    | { mode: 'current'; summary: any }
    | { mode: 'updated'; summary: any }
    | { mode: 'checkout'; checkoutUrl: string; sessionId: string }
  > {
    const [organization, subscription] = await Promise.all([
      this.getOrganizationRecord(organizationId),
      this.getCurrentSubscription(organizationId),
    ]);
    const resolvedPlan = await this.resolvePlanDefinition(plan);

    if (subscription.plan === plan && isActiveSubscriptionStatus(subscription.status)) {
      return {
        mode: 'current',
        summary: await this.getSubscriptionSummary(organizationId),
      };
    }

    const customerId = await this.ensureStripeCustomer(subscription, organization);

    if (subscription.stripeSubscriptionId && isActiveSubscriptionStatus(subscription.status)) {
      const stripeSubscription = await stripeService.getSubscription(subscription.stripeSubscriptionId);
      const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;

      if (!subscriptionItemId) {
        throw new AppError(
          'Stripe subscription is missing a billable line item',
          'STRIPE_SUBSCRIPTION_ITEM_MISSING',
          502
        );
      }

      const updatedStripeSubscription = await stripeService.updateSubscriptionPlan({
        subscriptionId: stripeSubscription.id,
        subscriptionItemId,
        plan,
      });

      await this.syncSubscriptionFromStripe(organizationId, updatedStripeSubscription, { planHint: plan });

      return {
        mode: 'updated',
        summary: await this.getSubscriptionSummary(organizationId),
      };
    }

    const session = await stripeService.createSubscriptionCheckoutSession({
      organizationId,
      customerId,
      customerEmail: organization.email,
      customerName: organization.name,
      plan,
      unitAmountCents: Math.round(resolvedPlan.monthlyPrice * 100),
      successUrl: `${config.webUrl}/subscriptions?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${config.webUrl}/subscriptions?checkout=cancelled`,
    });

    if (!session.url) {
      throw new AppError(
        'Stripe did not return a checkout URL',
        'STRIPE_CHECKOUT_URL_MISSING',
        502
      );
    }

    await prisma.billingCharge.upsert({
      where: { chargeKey: `checkout:${session.id}` },
      create: {
        chargeKey: `checkout:${session.id}`,
        kind: 'subscription_checkout',
        status: 'pending',
        amount: String(resolvedPlan.monthlyPrice),
        currency: 'usd',
        description: `${resolvedPlan.label} subscription checkout`,
        stripeCheckoutSessionId: session.id,
        organizationId,
        subscriptionId: subscription.id,
        metadata: {
          plan,
        },
      },
      update: {
        status: 'pending',
      },
    });

    return {
      mode: 'checkout',
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  }

  async completeSubscriptionCheckout(organizationId: string, sessionId: string) {
    const session = await stripeService.getCheckoutSession(sessionId);

    if (session.mode !== 'subscription' || !session.subscription) {
      throw new AppError(
        'Stripe session is not a subscription checkout',
        'STRIPE_SESSION_INVALID',
        400
      );
    }

    const sessionOrganizationId =
      session.metadata?.organizationId || session.client_reference_id || null;

    if (sessionOrganizationId !== organizationId) {
      throw new AppError(
        'Checkout session does not belong to this organization',
        'STRIPE_SESSION_ORG_MISMATCH',
        403
      );
    }

    const stripeSubscription = await stripeService.getSubscription(session.subscription);
    await this.syncSubscriptionFromStripe(organizationId, stripeSubscription, {
      planHint: parsePlan(session.metadata?.plan),
    });

    const resolvedPlan = await this.resolvePlanDefinition(
      parsePlan(session.metadata?.plan) || 'starter'
    );

    await prisma.billingCharge.upsert({
      where: { chargeKey: `checkout:${session.id}` },
      create: {
        chargeKey: `checkout:${session.id}`,
        kind: 'subscription_checkout',
        status: 'succeeded',
        amount: String(resolvedPlan.monthlyPrice),
        currency: 'usd',
        description: 'Subscription checkout completed',
        stripeCheckoutSessionId: session.id,
        organizationId,
      },
      update: {
        status: 'succeeded',
        processedAt: new Date(),
      },
    });

    return this.getSubscriptionSummary(organizationId);
  }

  async createBillingPortalSession(organizationId: string) {
    const subscription = await this.getCurrentSubscription(organizationId);

    if (!subscription.stripeCustomerId) {
      throw new AppError(
        'A Stripe customer does not exist for this organization yet',
        'BILLING_PORTAL_UNAVAILABLE',
        400
      );
    }

    const portal = await stripeService.createBillingPortalSession({
      customerId: subscription.stripeCustomerId,
      returnUrl: `${config.webUrl}/subscriptions`,
    });

    return portal;
  }

  async prepareMessageCreditTopupCheckout(input: {
    organizationId: string;
    amountDollars: number;
  }) {
    const amountDollars = roundCurrency(input.amountDollars);

    if (!MESSAGE_TOP_UP_OPTIONS.includes(amountDollars as (typeof MESSAGE_TOP_UP_OPTIONS)[number])) {
      throw new AppError(
        'Select a supported top-up amount.',
        'MESSAGE_CREDIT_TOPUP_INVALID_AMOUNT',
        400
      );
    }

    const [organization, subscription] = await Promise.all([
      this.getOrganizationRecord(input.organizationId),
      this.getCurrentSubscription(input.organizationId),
    ]);

    if (!subscription.plan || !isActiveSubscriptionStatus(subscription.status)) {
      throw new AppError(
        'An active billing subscription is required before buying message credits.',
        'BILLING_SUBSCRIPTION_REQUIRED',
        402
      );
    }

    const customerId = await this.ensureStripeCustomer(subscription, organization);
    const session = await stripeService.createOneTimeCheckoutSession({
      organizationId: input.organizationId,
      customerId,
      customerEmail: organization.email,
      customerName: organization.name,
      amountCents: Math.round(amountDollars * 100),
      successUrl: `${config.webUrl}/subscriptions?credit_topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${config.webUrl}/subscriptions?credit_topup=cancelled`,
      description: 'Message credit top-up',
      metadata: {
        purpose: 'message_credit_topup',
        organizationId: input.organizationId,
        amountDollars: amountDollars.toFixed(2),
      },
    });

    if (!session.url) {
      throw new AppError(
        'Stripe did not return a checkout URL',
        'STRIPE_CHECKOUT_URL_MISSING',
        502
      );
    }

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      amountDollars,
    };
  }

  async completeMessageCreditTopupCheckout(organizationId: string, sessionId: string) {
    const session = await stripeService.getCheckoutSession(sessionId);

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      throw new AppError('Stripe checkout has not been completed', 'STRIPE_CHECKOUT_INCOMPLETE', 402);
    }

    const metadata = session.metadata || {};
    if (metadata.organizationId !== organizationId || metadata.purpose !== 'message_credit_topup') {
      throw new AppError('Checkout session does not belong to this organization', 'STRIPE_SESSION_ORG_MISMATCH', 403);
    }

    const amountDollars = roundCurrency(Number(metadata.amountDollars || 0));
    if (!amountDollars) {
      throw new AppError(
        'Checkout session is missing the message credit amount',
        'STRIPE_SESSION_INVALID',
        400
      );
    }

    const subscription = await this.getCurrentSubscription(organizationId);
    const existingCharge = await prisma.billingCharge.findUnique({
      where: { chargeKey: `message-credit-topup:${session.id}` },
      select: { id: true, status: true },
    });

    if (existingCharge?.status === 'succeeded') {
      return this.getSubscriptionSummary(organizationId);
    }

    await prisma.$transaction(async (tx) => {
      await tx.billingCharge.upsert({
        where: { chargeKey: `message-credit-topup:${session.id}` },
        create: {
          chargeKey: `message-credit-topup:${session.id}`,
          kind: 'message_credit_topup',
          status: 'succeeded',
          amount: amountDollars.toFixed(4),
          currency: 'usd',
          description: 'Message credit top-up',
          stripeCheckoutSessionId: session.id,
          organizationId,
          subscriptionId: subscription.id,
          metadata,
          processedAt: new Date(),
        },
        update: {
          status: 'succeeded',
          metadata,
          processedAt: new Date(),
        },
      });

      if (!existingCharge) {
        await tx.organizationSubscription.update({
          where: { id: subscription.id },
          data: {
            messageCreditBalance: {
              increment: amountDollars,
            },
          },
        });
      }
    });

    if (session.customer && !subscription.stripeCustomerId) {
      await prisma.organizationSubscription.update({
        where: { id: subscription.id },
        data: {
          stripeCustomerId: session.customer,
        },
      });
    }

    return this.getSubscriptionSummary(organizationId);
  }

  async assertCanSendMessage(
    organizationId: string,
    unit: 'sms' | 'mms' = 'sms'
  ) {
    const subscription = await this.getCurrentSubscription(organizationId);

    if (!subscription.plan || !isActiveSubscriptionStatus(subscription.status)) {
      throw new AppError(
        'An active billing subscription is required before sending messages.',
        'BILLING_SUBSCRIPTION_REQUIRED',
        402
      );
    }

    if (subscription.billingBlockedAt) {
      throw new AppError(
        subscription.billingBlockedReason || 'Billing action is required before sending messages.',
        'BILLING_ACTION_REQUIRED',
        402
      );
    }

    const used = unit === 'mms' ? subscription.mmsUsed : subscription.smsUsed;
    const included = unit === 'mms' ? subscription.mmsIncluded : subscription.smsIncluded;
    const includedRemaining = Math.max(0, included - used);

    if (includedRemaining > 0) {
      return subscription;
    }

    const balance = toAmount(subscription.messageCreditBalance);
    if (balance >= MESSAGE_OVERAGE_RATE) {
      return subscription;
    }

    throw new AppError(
      'Message credits are exhausted. Add a Stripe top-up before sending more traffic.',
      'MESSAGE_CREDITS_EXHAUSTED',
      402,
      true,
      {
        unit,
        availableBalance: balance,
        requiredBalance: MESSAGE_OVERAGE_RATE,
      }
    );

    return subscription;
  }

  async assertCanProvisionPhoneNumber(organizationId: string) {
    const subscription = await this.getCurrentSubscription(organizationId);

    if (!subscription.plan || !isActiveSubscriptionStatus(subscription.status)) {
      throw new AppError(
        'An active billing subscription is required before provisioning phone numbers.',
        'BILLING_SUBSCRIPTION_REQUIRED',
        402
      );
    }

    if (subscription.billingBlockedAt) {
      throw new AppError(
        subscription.billingBlockedReason || 'Billing action is required before provisioning phone numbers.',
        'BILLING_ACTION_REQUIRED',
        402
      );
    }

    return subscription;
  }

  async preparePhoneNumberCheckout(input: {
    organizationId: string;
    phoneNumber: string;
    campaignId: string;
    friendlyName?: string;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    const [organization, subscription, activePhoneNumbers] = await Promise.all([
      this.getOrganizationRecord(input.organizationId),
      this.getCurrentSubscription(input.organizationId),
      this.countActivePhoneNumbers(input.organizationId),
    ]);

    const canUseIncludedPhoneNumber =
      isActiveSubscriptionStatus(subscription.status) && !subscription.billingBlockedAt;
    const includedPhoneNumbers = canUseIncludedPhoneNumber
      ? subscription.phoneNumbersIncluded
      : 0;

    if (canUseIncludedPhoneNumber && activePhoneNumbers < includedPhoneNumbers) {
      return {
        mode: 'included' as const,
        activePhoneNumbers,
        includedPhoneNumbers,
      };
    }

    const customerId = await this.ensureStripeCustomer(subscription, organization);
    const session = await stripeService.createOneTimeCheckoutSession({
      organizationId: input.organizationId,
      customerId,
      customerEmail: organization.email,
      customerName: organization.name,
      amountCents: Math.round(EXTRA_NUMBER_FIRST_CHARGE * 100),
      successUrl: input.successUrl ?? `${config.webUrl}/phone-numbers?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: input.cancelUrl ?? `${config.webUrl}/phone-numbers?checkout=cancelled`,
      description: 'Extra phone number activation',
      metadata: {
        purpose: 'phone_number_activation',
        organizationId: input.organizationId,
        phoneNumber: input.phoneNumber,
        campaignId: input.campaignId,
        ...(input.friendlyName ? { friendlyName: input.friendlyName } : {}),
      },
    });

    if (!session.url) {
      throw new AppError(
        'Stripe did not return a checkout URL',
        'STRIPE_CHECKOUT_URL_MISSING',
        502
      );
    }

    return {
      mode: 'checkout' as const,
      checkoutUrl: session.url,
      sessionId: session.id,
      activePhoneNumbers,
      includedPhoneNumbers,
      immediateChargeAmount: EXTRA_NUMBER_FIRST_CHARGE,
    };
  }

  async completePhoneNumberCheckout(organizationId: string, sessionId: string) {
    const session = await stripeService.getCheckoutSession(sessionId);

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      throw new AppError('Stripe checkout has not been completed', 'STRIPE_CHECKOUT_INCOMPLETE', 402);
    }

    const metadata = session.metadata || {};
    if (metadata.organizationId !== organizationId) {
      throw new AppError('Checkout session does not belong to this organization', 'STRIPE_SESSION_ORG_MISMATCH', 403);
    }

    if (metadata.purpose !== 'phone_number_activation') {
      throw new AppError('Checkout session is not a phone-number activation', 'STRIPE_SESSION_INVALID', 400);
    }

    if (!metadata.phoneNumber || !metadata.campaignId) {
      throw new AppError(
        'Checkout session is missing required phone-number metadata',
        'STRIPE_SESSION_INVALID',
        400
      );
    }

    const subscription = await this.getCurrentSubscription(organizationId);

    await prisma.billingCharge.upsert({
      where: { chargeKey: `phone-number-activation:${session.id}` },
      create: {
        chargeKey: `phone-number-activation:${session.id}`,
        kind: 'phone_number_activation',
        status: 'succeeded',
        amount: String(EXTRA_NUMBER_FIRST_CHARGE),
        currency: 'usd',
        description: 'Extra phone number activation charge',
        stripeCheckoutSessionId: session.id,
        organizationId,
        subscriptionId: subscription.id,
        metadata,
        processedAt: new Date(),
      },
      update: {
        status: 'succeeded',
        processedAt: new Date(),
        metadata,
      },
    });

    if (session.customer && !subscription.stripeCustomerId) {
      await prisma.organizationSubscription.update({
        where: { id: subscription.id },
        data: {
          stripeCustomerId: session.customer,
        },
      });
    }

    return {
      phoneNumber: metadata.phoneNumber,
      campaignId: metadata.campaignId,
      friendlyName: metadata.friendlyName || undefined,
    };
  }

  async processMeteredEvent(eventId: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            const event = await tx.billingEvent.findUnique({
              where: { id: eventId },
            });

            if (!event || event.unit === 'phone_number') {
              return null;
            }

            const eventMetadata = asRecord(event.metadata);
            if (eventMetadata.subscriptionUsageProcessedAt) {
              return {
                organizationId: event.organizationId,
                shouldFlush: false,
              };
            }

            const subscription = await tx.organizationSubscription.upsert({
              where: { organizationId: event.organizationId },
              create: {
                organizationId: event.organizationId,
              },
              update: {},
            });

            if (!subscription.plan || !isActiveSubscriptionStatus(subscription.status)) {
              await tx.billingEvent.update({
                where: { id: event.id },
                data: {
                  metadata: {
                    ...eventMetadata,
                    subscriptionUsageProcessedAt: new Date().toISOString(),
                    subscriptionIgnoredReason: 'No active subscription was present when the event was recorded.',
                  },
                },
              });

              return {
                organizationId: event.organizationId,
                shouldFlush: false,
              };
            }

            const currentUsed = event.unit === 'mms' ? subscription.mmsUsed : subscription.smsUsed;
            const included = event.unit === 'mms' ? subscription.mmsIncluded : subscription.smsIncluded;
            const quantity = event.quantity || 1;
            const newUsed = currentUsed + quantity;
            const overageUnits =
              Math.max(0, newUsed - included) - Math.max(0, currentUsed - included);
            const currentCreditBalance = toAmount(subscription.messageCreditBalance);
            const overageCost = roundLedger(overageUnits * MESSAGE_OVERAGE_RATE);
            const creditConsumed = Math.min(currentCreditBalance, overageCost);
            const newCreditBalance = roundLedger(currentCreditBalance - creditConsumed);
            const creditShortfall = roundLedger(overageCost - creditConsumed);

            await tx.organizationSubscription.update({
              where: { id: subscription.id },
              data: event.unit === 'mms'
                ? {
                    mmsUsed: newUsed,
                    messageCreditBalance: newCreditBalance.toFixed(4),
                  }
                : {
                    smsUsed: newUsed,
                    messageCreditBalance: newCreditBalance.toFixed(4),
                  },
            });

            await tx.billingEvent.update({
              where: { id: event.id },
              data: {
                metadata: {
                  ...eventMetadata,
                  subscriptionUsageProcessedAt: new Date().toISOString(),
                  subscriptionOverageUnits: overageUnits,
                  messageCreditBalanceAfter: newCreditBalance.toFixed(4),
                  messageCreditConsumed: creditConsumed.toFixed(4),
                  messageCreditShortfall: creditShortfall.toFixed(4),
                },
              },
            });

            return {
              organizationId: event.organizationId,
              shouldFlush: false,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );

        if (result?.shouldFlush) {
          await this.flushPendingOverageBalance(result.organizationId);
        }

        return;
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < 2) {
          continue;
        }

        throw error;
      }
    }
  }

  private async flushPendingOverageBalance(organizationId: string) {
    const subscription = await this.getCurrentSubscription(organizationId);
    if (!subscription.stripeCustomerId || subscription.billingBlockedAt) {
      return;
    }

    const pendingBalance = toAmount(subscription.pendingOverageBalance);
    const chargeableAmount = floorChargeableAmount(pendingBalance);

    if (chargeableAmount < MIN_REALTIME_CHARGE) {
      return;
    }

    const remainder = roundLedger(pendingBalance - chargeableAmount);
    const claimed = await prisma.organizationSubscription.updateMany({
      where: {
        id: subscription.id,
        pendingOverageBalance: pendingBalance.toFixed(4),
        billingBlockedAt: null,
      },
      data: {
        pendingOverageBalance: remainder.toFixed(4),
      },
    });

    if (claimed.count !== 1) {
      return;
    }

    const charge = await prisma.billingCharge.create({
      data: {
        chargeKey: `message-overage:${subscription.id}:${Date.now()}`,
        kind: 'message_overage',
        status: 'pending',
        amount: chargeableAmount.toFixed(4),
        currency: 'usd',
        description: 'Accumulated real-time message overage charges',
        organizationId,
        subscriptionId: subscription.id,
        metadata: {
          pendingBalanceClaimed: pendingBalance.toFixed(4),
          pendingBalanceRemainder: remainder.toFixed(4),
        },
      },
    });

    try {
      const paymentMethodId = await this.ensureDefaultPaymentMethod(subscription);
      if (!paymentMethodId) {
        throw new AppError(
          'No reusable Stripe payment method is attached to this subscription.',
          'BILLING_PAYMENT_METHOD_REQUIRED',
          402
        );
      }

      const paymentIntent = await stripeService.createOffSessionPayment({
        customerId: subscription.stripeCustomerId,
        paymentMethodId,
        amountCents: Math.round(chargeableAmount * 100),
        description: 'Signalmash Connect message overage',
        metadata: {
          organizationId,
          subscriptionId: subscription.id,
          chargeId: charge.id,
        },
      });

      if (paymentIntent.status !== 'succeeded') {
        throw new AppError(
          paymentIntent.last_payment_error?.message || `Stripe returned status ${paymentIntent.status}`,
          'STRIPE_PAYMENT_FAILED',
          402
        );
      }

      await prisma.billingCharge.update({
        where: { id: charge.id },
        data: {
          status: 'succeeded',
          stripePaymentIntentId: paymentIntent.id,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : 'Real-time message overage payment failed';

      await prisma.$transaction([
        prisma.billingCharge.update({
          where: { id: charge.id },
          data: {
            status: 'failed',
            failureReason: reason,
            processedAt: new Date(),
          },
        }),
        prisma.organizationSubscription.update({
          where: { id: subscription.id },
          data: {
            pendingOverageBalance: {
              increment: chargeableAmount,
            },
            billingBlockedAt: new Date(),
            billingBlockedReason:
              'Real-time message overage payment failed. Update the billing method before sending more messages.',
          },
        }),
      ]);
    }
  }

  async handleStripeWebhook(rawBody: string, signatureHeader: string | undefined) {
    const event = await stripeService.verifyWebhookEvent(rawBody, signatureHeader);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as unknown as StripeCheckoutSession);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.handleSubscriptionUpdated(event.data.object as unknown as StripeSubscription);
        break;
      case 'invoice.created':
        await this.handleInvoiceCreated(event.data.object as unknown as StripeInvoicePayload);
        break;
      case 'invoice.paid':
        await this.handleInvoicePaid(event.data.object as unknown as StripeInvoicePayload);
        break;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as unknown as StripeInvoicePayload);
        break;
      default:
        break;
    }

    return {
      eventId: event.id,
      type: event.type,
    };
  }

  private async handleCheckoutCompleted(session: StripeCheckoutSession) {
    const organizationId = session.metadata?.organizationId || session.client_reference_id || null;
    if (!organizationId) {
      return;
    }

    if (session.mode === 'subscription' && session.subscription) {
      const resolvedPlan = await this.resolvePlanDefinition(
        parsePlan(session.metadata?.plan) || 'starter'
      );
      const stripeSubscription = await stripeService.getSubscription(session.subscription);
      await this.syncSubscriptionFromStripe(organizationId, stripeSubscription, {
        planHint: parsePlan(session.metadata?.plan),
      });

      await prisma.billingCharge.upsert({
        where: { chargeKey: `checkout:${session.id}` },
        create: {
          chargeKey: `checkout:${session.id}`,
          kind: 'subscription_checkout',
          status: 'succeeded',
          amount: String(resolvedPlan.monthlyPrice),
          currency: 'usd',
          description: 'Subscription checkout completed',
          stripeCheckoutSessionId: session.id,
          organizationId,
          processedAt: new Date(),
          metadata: session.metadata || undefined,
        },
        update: {
          status: 'succeeded',
          processedAt: new Date(),
          metadata: session.metadata || undefined,
        },
      });
    }

    if (session.mode === 'payment' && session.metadata?.purpose === 'phone_number_activation') {
      const subscription = await this.getCurrentSubscription(organizationId);
      await prisma.billingCharge.upsert({
        where: { chargeKey: `phone-number-activation:${session.id}` },
        create: {
          chargeKey: `phone-number-activation:${session.id}`,
          kind: 'phone_number_activation',
          status: 'succeeded',
          amount: String(EXTRA_NUMBER_FIRST_CHARGE),
          currency: 'usd',
          description: 'Extra phone number activation charge',
          stripeCheckoutSessionId: session.id,
          organizationId,
          subscriptionId: subscription.id,
          metadata: session.metadata,
          processedAt: new Date(),
        },
        update: {
          status: 'succeeded',
          processedAt: new Date(),
          metadata: session.metadata,
        },
      });
    }
  }

  private async handleSubscriptionUpdated(stripeSubscription: StripeSubscription) {
    const organizationId = stripeSubscription.metadata?.organizationId;
    if (!organizationId) {
      const byStripeId = await prisma.organizationSubscription.findFirst({
        where: { stripeSubscriptionId: stripeSubscription.id },
        select: { organizationId: true },
      });
      if (!byStripeId) {
        return;
      }

      await this.syncSubscriptionFromStripe(byStripeId.organizationId, stripeSubscription, {
        planHint: await this.inferPlanFromPriceId(
          stripeSubscription.items?.data?.[0]?.price?.id || null
        ),
      });
      return;
    }

    await this.syncSubscriptionFromStripe(organizationId, stripeSubscription, {
      planHint: parsePlan(stripeSubscription.metadata?.plan),
    });
  }

  private async handleInvoiceCreated(invoice: StripeInvoicePayload) {
    if (!invoice.id || !invoice.subscription || !invoice.customer) {
      return;
    }

    const subscription = await prisma.organizationSubscription.findFirst({
      where: { stripeSubscriptionId: invoice.subscription },
    });

    if (!subscription || !subscription.plan || !subscription.stripeCustomerId) {
      return;
    }

    const activePhoneNumbers = await this.countActivePhoneNumbers(subscription.organizationId);
    const extraPhoneNumbers = Math.max(0, activePhoneNumbers - subscription.phoneNumbersIncluded);

    if (extraPhoneNumbers <= 0) {
      return;
    }

    const chargeKey = `invoice:${invoice.id}:extra_numbers`;
    const existing = await prisma.billingCharge.findUnique({
      where: { chargeKey },
    });

    if (existing) {
      return;
    }

    const invoiceItem = await stripeService.createInvoiceItem({
      customerId: subscription.stripeCustomerId,
      invoiceId: invoice.id,
      unitAmountCents: Math.round(EXTRA_NUMBER_MONTHLY_RATE * 100),
      quantity: extraPhoneNumbers,
      description: `Extra phone numbers (${extraPhoneNumbers})`,
      metadata: {
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        kind: 'extra_phone_number_mrc',
      },
    });

    await prisma.billingCharge.create({
      data: {
        chargeKey,
        kind: 'phone_number_mrc',
        status: 'pending',
        amount: String(roundCurrency(extraPhoneNumbers * EXTRA_NUMBER_MONTHLY_RATE)),
        currency: 'usd',
        description: `Extra phone number monthly charge (${extraPhoneNumbers})`,
        stripeInvoiceId: invoice.id,
        stripeInvoiceItemId: invoiceItem.id,
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        metadata: {
          quantity: extraPhoneNumbers,
        },
      },
    });
  }

  private async handleInvoicePaid(invoice: StripeInvoicePayload) {
    if (invoice.subscription) {
      const subscription = await prisma.organizationSubscription.findFirst({
        where: { stripeSubscriptionId: invoice.subscription },
      });

      if (subscription) {
        await this.clearBillingBlock(subscription.id);
      }
    }

    if (invoice.id) {
      await prisma.billingCharge.updateMany({
        where: {
          stripeInvoiceId: invoice.id,
          status: 'pending',
        },
        data: {
          status: 'succeeded',
          processedAt: new Date(),
        },
      });
    }
  }

  private async handleInvoicePaymentFailed(invoice: StripeInvoicePayload) {
    if (!invoice.subscription) {
      return;
    }

    const subscription = await prisma.organizationSubscription.findFirst({
      where: { stripeSubscriptionId: invoice.subscription },
    });

    if (!subscription) {
      return;
    }

    if (invoice.id) {
      await prisma.billingCharge.updateMany({
        where: {
          stripeInvoiceId: invoice.id,
          status: 'pending',
        },
        data: {
          status: 'failed',
          failureReason: 'Stripe invoice payment failed.',
          processedAt: new Date(),
        },
      });
    }

    await this.markBillingBlocked(
      subscription.id,
      'Stripe reported a failed invoice payment. Update the billing method before provisioning numbers or sending more messages.'
    );
  }
}

export const subscriptionBillingService = new SubscriptionBillingService();
