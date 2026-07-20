import {
  Prisma,
  type BillingAccount,
  type BillingLedgerCategory,
  type BillingPricingTier,
  type Message,
} from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { stripeService, type StripeCheckoutSession } from './stripe.service.js';

const WALLET_CURRENCY = 'usd';
const PRICE_CATALOG_VERSION = '2026-07-17-google-sheet';
const MIN_TOP_UP_AMOUNT = 250;
const FIXED_TOP_UP_OPTIONS = [250, 500, 1400] as const;
const BASIC_SETUP_FEE = 19;
const ENHANCED_VETTING_FEE = 55;
const CAMPAIGN_EXPEDITE_FEE = 50;
const PREPAY_BALANCE_NOTE =
  'Monthly fees and setup charges may be deducted out of prepayment balance which can result in a lower number of messages.';
const CARRIER_SURCHARGE_NOTE = 'Carrier surcharges are already included in the above pricing.';
const CARRIER_SURCHARGES = [
  {
    carrier: 'AT&T',
    sms: 0.003,
    mms: 0.0075,
  },
  {
    carrier: 'VZW',
    sms: 0.004,
    mms: 0.0065,
  },
  {
    carrier: 'T-Mobile',
    sms: 0.0045,
    mms: 0.01,
  },
] as const;

const PRICING_TIERS = {
  tier_250: {
    id: 'tier_250',
    label: '$250',
    minTopUpAmount: 250,
    maxTopUpAmount: 499,
    smsRate: 0.01,
    mmsRate: 0.025,
    campaignMonthlyRate: 10,
    phoneNumberMonthlyRate: 1,
    basicSetupFee: BASIC_SETUP_FEE,
    enhancedVettingFee: ENHANCED_VETTING_FEE,
    campaignExpediteFee: CAMPAIGN_EXPEDITE_FEE,
  },
  tier_500: {
    id: 'tier_500',
    label: '$500',
    minTopUpAmount: 500,
    maxTopUpAmount: 1399,
    smsRate: 0.008,
    mmsRate: 0.02,
    campaignMonthlyRate: 10,
    phoneNumberMonthlyRate: 0.75,
    basicSetupFee: BASIC_SETUP_FEE,
    enhancedVettingFee: ENHANCED_VETTING_FEE,
    campaignExpediteFee: CAMPAIGN_EXPEDITE_FEE,
  },
  tier_1400: {
    id: 'tier_1400',
    label: '$1400',
    minTopUpAmount: 1400,
    maxTopUpAmount: null,
    smsRate: 0.007,
    mmsRate: 0.0175,
    campaignMonthlyRate: 10,
    phoneNumberMonthlyRate: 0.5,
    basicSetupFee: BASIC_SETUP_FEE,
    enhancedVettingFee: ENHANCED_VETTING_FEE,
    campaignExpediteFee: CAMPAIGN_EXPEDITE_FEE,
  },
} as const satisfies Record<
  BillingPricingTier,
  {
    id: BillingPricingTier;
    label: string;
    minTopUpAmount: number;
    maxTopUpAmount: number | null;
    smsRate: number;
    mmsRate: number;
    campaignMonthlyRate: number;
    phoneNumberMonthlyRate: number;
    basicSetupFee: number;
    enhancedVettingFee: number;
    campaignExpediteFee: number;
  }
>;

type PricingTierDefinition = (typeof PRICING_TIERS)[BillingPricingTier];
type AdministrativeFeeKind = 'enhanced_vetting' | 'campaign_expedite';

interface MessageBillingEstimate {
  catalogVersion: string;
  pricingTier: BillingPricingTier;
  unit: 'sms' | 'mms';
  units: number;
  rate: number;
  amount: number;
  smsSegments?: number;
  encoding?: 'gsm7' | 'unicode';
  estimatedAt: string;
}

const GSM_7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_7_EXTENDED = '^{}\\[~]|€';

function toAmount(value: Prisma.Decimal | string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  return Number(value);
}

function roundLedger(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function toCents(value: number) {
  return Math.round(value * 100);
}

function asInputJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  return value ? (value as Prisma.InputJsonValue) : undefined;
}

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getCycleMonth(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function estimateSmsSegments(body: string): {
  segments: number;
  encoding: 'gsm7' | 'unicode';
  length: number;
} {
  const chars = Array.from(body || '');
  let gsmUnits = 0;
  let isGsm7 = true;

  for (const char of chars) {
    if (GSM_7_BASIC.includes(char)) {
      gsmUnits += 1;
    } else if (GSM_7_EXTENDED.includes(char)) {
      gsmUnits += 2;
    } else {
      isGsm7 = false;
      break;
    }
  }

  if (isGsm7) {
    const singleLimit = 160;
    const multipartLimit = 153;
    return {
      segments: Math.max(1, gsmUnits <= singleLimit ? 1 : Math.ceil(gsmUnits / multipartLimit)),
      encoding: 'gsm7',
      length: gsmUnits,
    };
  }

  const unicodeLength = chars.length;
  const singleLimit = 70;
  const multipartLimit = 67;
  return {
    segments: Math.max(
      1,
      unicodeLength <= singleLimit ? 1 : Math.ceil(unicodeLength / multipartLimit)
    ),
    encoding: 'unicode',
    length: unicodeLength,
  };
}

function tierForTopUp(amountDollars: number): BillingPricingTier {
  if (amountDollars >= 1400) {
    return 'tier_1400';
  }

  if (amountDollars >= 500) {
    return 'tier_500';
  }

  return 'tier_250';
}

function estimateMessageCharge(input: {
  body: string;
  mediaUrls?: string[] | null;
  pricingTier: BillingPricingTier;
  now?: Date;
}): MessageBillingEstimate {
  const tier = PRICING_TIERS[input.pricingTier];

  if (input.mediaUrls && input.mediaUrls.length > 0) {
    return {
      catalogVersion: PRICE_CATALOG_VERSION,
      pricingTier: input.pricingTier,
      unit: 'mms',
      units: 1,
      rate: tier.mmsRate,
      amount: roundLedger(tier.mmsRate),
      estimatedAt: (input.now ?? new Date()).toISOString(),
    };
  }

  const sms = estimateSmsSegments(input.body);
  return {
    catalogVersion: PRICE_CATALOG_VERSION,
    pricingTier: input.pricingTier,
    unit: 'sms',
    units: sms.segments,
    rate: tier.smsRate,
    amount: roundLedger(sms.segments * tier.smsRate),
    smsSegments: sms.segments,
    encoding: sms.encoding,
    estimatedAt: (input.now ?? new Date()).toISOString(),
  };
}

function parseEstimate(value: Prisma.JsonValue | null | undefined): MessageBillingEstimate | null {
  const record = asRecord(value);
  if (
    typeof record.amount !== 'number' ||
    typeof record.rate !== 'number' ||
    typeof record.units !== 'number' ||
    (record.unit !== 'sms' && record.unit !== 'mms') ||
    typeof record.pricingTier !== 'string'
  ) {
    return null;
  }

  return record as unknown as MessageBillingEstimate;
}

export class WalletBillingService {
  getPricingCatalog() {
    return {
      version: PRICE_CATALOG_VERSION,
      minTopUpAmount: MIN_TOP_UP_AMOUNT,
      fixedTopUpOptions: [...FIXED_TOP_UP_OPTIONS],
      tiers: Object.values(PRICING_TIERS),
      carrierSurcharges: [...CARRIER_SURCHARGES],
      carrierSurchargeNote: CARRIER_SURCHARGE_NOTE,
      prepayBalanceNote: PREPAY_BALANCE_NOTE,
    };
  }

  getTopUpPricingTier(amountDollars: number) {
    if (amountDollars < MIN_TOP_UP_AMOUNT) {
      throw new AppError(
        `Wallet top-ups must be at least $${MIN_TOP_UP_AMOUNT}.`,
        'WALLET_TOPUP_MINIMUM_NOT_MET',
        400
      );
    }

    return tierForTopUp(amountDollars);
  }

  estimateMessage(input: {
    body: string;
    mediaUrls?: string[] | null;
    pricingTier: BillingPricingTier;
  }) {
    return estimateMessageCharge(input);
  }

  private async getOrganizationRecord(organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        suspendedAt: true,
        suspensionReason: true,
        subscription: {
          select: {
            id: true,
            messageCreditBalance: true,
            stripeCustomerId: true,
            stripeDefaultPaymentMethodId: true,
            billingBlockedAt: true,
            billingBlockedReason: true,
            activatedAt: true,
          },
        },
      },
    });

    if (!organization) {
      throw new AppError('Organization not found', 'ORGANIZATION_NOT_FOUND', 404);
    }

    return organization;
  }

  async getOrCreateAccount(organizationId: string) {
    const existing = await prisma.billingAccount.findUnique({
      where: { organizationId },
    });

    if (existing) {
      return existing;
    }

    const organization = await this.getOrganizationRecord(organizationId);
    const migratedBalance = roundLedger(
      toAmount(organization.subscription?.messageCreditBalance)
    );

    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.billingAccount.create({
          data: {
            organizationId,
            status:
              organization.status === 'suspended' ||
              organization.subscription?.billingBlockedAt
                ? 'suspended'
                : 'active',
            walletBalance: migratedBalance.toFixed(4),
            stripeCustomerId: organization.subscription?.stripeCustomerId ?? null,
            stripeDefaultPaymentMethodId:
              organization.subscription?.stripeDefaultPaymentMethodId ?? null,
            suspensionReason:
              organization.subscription?.billingBlockedReason ??
              organization.suspensionReason ??
              null,
            suspendedAt:
              organization.subscription?.billingBlockedAt ??
              organization.suspendedAt ??
              null,
            mrcAnchorAt: organization.subscription?.activatedAt ?? new Date(),
            mrcNextRunAt: addMonths(new Date(), 1),
            metadata: {
              migration: 'lazy_prepaid_wallet_billing',
              legacySubscriptionId: organization.subscription?.id ?? null,
            },
          },
        });

        if (migratedBalance > 0) {
          await tx.billingLedgerEntry.create({
            data: {
              ledgerKey: `legacy-message-credit-balance:${organizationId}`,
              entryType: 'credit',
              category: 'adjustment',
              amount: migratedBalance.toFixed(4),
              balanceAfter: migratedBalance.toFixed(4),
              description: 'Legacy message credit balance migrated to wallet',
              sourceId: organization.subscription?.id,
              organizationId,
              billingAccountId: created.id,
              metadata: {
                source: 'organization_subscriptions.message_credit_balance',
              },
            },
          });
        }

        return created;
      });
    } catch (error) {
      const racedAccount = await prisma.billingAccount.findUnique({
        where: { organizationId },
      });

      if (racedAccount) {
        return racedAccount;
      }

      throw error;
    }
  }

  private async ensureStripeCustomer(
    account: BillingAccount,
    organization: { id: string; name: string; email: string }
  ) {
    if (account.stripeCustomerId) {
      return account.stripeCustomerId;
    }

    const customer = await stripeService.createCustomer({
      organizationId: organization.id,
      email: organization.email,
      name: organization.name,
    });

    await prisma.billingAccount.update({
      where: { id: account.id },
      data: {
        stripeCustomerId: customer.id,
      },
    });

    return customer.id;
  }

  private assertAccountActive(account: BillingAccount) {
    if (account.status === 'suspended') {
      throw new AppError(
        account.suspensionReason ||
          'Billing is suspended. Add funds or update the saved payment method before using paid services.',
        'BILLING_SUSPENDED',
        402,
        true,
        {
          suspendedAt: account.suspendedAt?.toISOString() ?? null,
        }
      );
    }
  }

  private assertSavedPaymentMethod(account: BillingAccount) {
    if (!account.stripeDefaultPaymentMethodId) {
      throw new AppError(
        'A saved payment method is required before using paid services.',
        'SAVED_PAYMENT_METHOD_REQUIRED',
        402
      );
    }
  }

  private async suspendForBilling(
    organizationId: string,
    reason: string,
    metadata?: Record<string, unknown>
  ) {
    const now = new Date();
    await prisma.$transaction([
      prisma.billingAccount.update({
        where: { organizationId },
        data: {
          status: 'suspended',
          suspendedAt: now,
          suspensionReason: reason,
          metadata: asInputJson({
            ...metadata,
            suspendedAt: now.toISOString(),
          }),
        },
      }),
      prisma.organization.update({
        where: { id: organizationId },
        data: {
          status: 'suspended',
          suspendedAt: now,
          suspensionReason: `Billing suspended: ${reason}`,
        },
      }),
    ]);
  }

  private async clearBillingSuspension(organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        status: true,
        suspensionReason: true,
      },
    });

    await prisma.billingAccount.update({
      where: { organizationId },
      data: {
        status: 'active',
        suspendedAt: null,
        suspensionReason: null,
      },
    });

    if (
      organization?.status === 'suspended' &&
      organization.suspensionReason?.startsWith('Billing suspended:')
    ) {
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          status: 'active',
          suspendedAt: null,
          suspensionReason: null,
        },
      });
    }
  }

  private async writeZeroAmountLedgerEntry(input: {
    organizationId: string;
    account: BillingAccount;
    ledgerKey: string;
    category: BillingLedgerCategory;
    description: string;
    sourceId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const existing = await prisma.billingLedgerEntry.findUnique({
      where: { ledgerKey: input.ledgerKey },
    });

    if (existing) {
      return existing;
    }

    return prisma.billingLedgerEntry.create({
      data: {
        ledgerKey: input.ledgerKey,
        entryType: 'release',
        category: input.category,
        amount: '0.0000',
        balanceAfter: input.account.walletBalance,
        description: input.description,
        sourceId: input.sourceId,
        organizationId: input.organizationId,
        billingAccountId: input.account.id,
        metadata: asInputJson(input.metadata),
      },
    });
  }

  private async creditWallet(input: {
    organizationId: string;
    ledgerKey: string;
    amount: number;
    category: BillingLedgerCategory;
    description: string;
    sourceId?: string | null;
    metadata?: Record<string, unknown>;
    pricingTier?: BillingPricingTier;
  }) {
    const amount = roundLedger(input.amount);

    return prisma.$transaction(async (tx) => {
      const existing = await tx.billingLedgerEntry.findUnique({
        where: { ledgerKey: input.ledgerKey },
      });

      if (existing) {
        return existing;
      }

      const account = await tx.billingAccount.update({
        where: { organizationId: input.organizationId },
        data: {
          walletBalance: {
            increment: amount,
          },
          ...(input.pricingTier ? { pricingTier: input.pricingTier } : {}),
          status: 'active',
          suspendedAt: null,
          suspensionReason: null,
        },
      });

      return tx.billingLedgerEntry.create({
        data: {
          ledgerKey: input.ledgerKey,
          entryType: 'credit',
          category: input.category,
          amount: amount.toFixed(4),
          balanceAfter: account.walletBalance,
          description: input.description,
          sourceId: input.sourceId,
          organizationId: input.organizationId,
          billingAccountId: account.id,
          metadata: asInputJson(input.metadata),
        },
      });
    });
  }

  private async debitWallet(input: {
    organizationId: string;
    ledgerKey: string;
    amount: number;
    category: BillingLedgerCategory;
    description: string;
    sourceId?: string | null;
    messageId?: string | null;
    metadata?: Record<string, unknown>;
    requireFunds?: boolean;
  }) {
    const amount = roundLedger(input.amount);

    return prisma.$transaction(async (tx) => {
      const existing = await tx.billingLedgerEntry.findUnique({
        where: { ledgerKey: input.ledgerKey },
      });

      if (existing) {
        return existing;
      }

      const account = await tx.billingAccount.findUnique({
        where: { organizationId: input.organizationId },
      });

      if (!account) {
        throw new AppError('Billing account not found', 'BILLING_ACCOUNT_NOT_FOUND', 404);
      }

      if (input.requireFunds && toAmount(account.walletBalance) < amount) {
        throw new AppError(
          'Wallet balance is too low for this charge.',
          'WALLET_FUNDS_REQUIRED',
          402,
          true,
          {
            requiredAmount: amount,
            walletBalance: toAmount(account.walletBalance),
          }
        );
      }

      const updated = await tx.billingAccount.update({
        where: { id: account.id },
        data: {
          walletBalance: {
            decrement: amount,
          },
        },
      });

      return tx.billingLedgerEntry.create({
        data: {
          ledgerKey: input.ledgerKey,
          entryType: 'debit',
          category: input.category,
          amount: amount.toFixed(4),
          balanceAfter: updated.walletBalance,
          description: input.description,
          sourceId: input.sourceId,
          messageId: input.messageId,
          organizationId: input.organizationId,
          billingAccountId: account.id,
          metadata: asInputJson(input.metadata),
        },
      });
    });
  }

  private async holdWalletCharge(input: {
    organizationId: string;
    account: BillingAccount;
    ledgerKey: string;
    amount: number;
    description: string;
    messageId: string;
    metadata?: Record<string, unknown>;
  }) {
    const existing = await prisma.billingLedgerEntry.findUnique({
      where: { ledgerKey: input.ledgerKey },
    });

    if (existing) {
      return existing;
    }

    return prisma.billingLedgerEntry.create({
      data: {
        ledgerKey: input.ledgerKey,
        entryType: 'hold',
        category: 'inbound_hold',
        amount: roundLedger(input.amount).toFixed(4),
        balanceAfter: input.account.walletBalance,
        description: input.description,
        sourceId: input.messageId,
        messageId: input.messageId,
        organizationId: input.organizationId,
        billingAccountId: input.account.id,
        metadata: asInputJson(input.metadata),
      },
    });
  }

  private async chargeSetupFeeIfNeeded(organizationId: string) {
    const account = await this.getOrCreateAccount(organizationId);

    if (account.setupFeeChargedAt) {
      return account;
    }

    this.assertAccountActive(account);
    this.assertSavedPaymentMethod(account);

    if (toAmount(account.walletBalance) < BASIC_SETUP_FEE) {
      throw new AppError(
        'Wallet balance is too low for the one-time setup fee.',
        'WALLET_FUNDS_REQUIRED',
        402,
        true,
        {
          requiredAmount: BASIC_SETUP_FEE,
          walletBalance: toAmount(account.walletBalance),
          category: 'setup_fee',
        }
      );
    }

    await this.debitWallet({
      organizationId,
      ledgerKey: `setup-fee:${organizationId}`,
      amount: BASIC_SETUP_FEE,
      category: 'setup_fee',
      description: 'One-time basic setup fee',
      requireFunds: true,
      metadata: {
        catalogVersion: PRICE_CATALOG_VERSION,
      },
    });

    return prisma.billingAccount.update({
      where: { organizationId },
      data: {
        setupFeeChargedAt: new Date(),
      },
    });
  }

  async assertCanUsePaidServices(organizationId: string) {
    const account = await this.chargeSetupFeeIfNeeded(organizationId);
    this.assertAccountActive(account);
    this.assertSavedPaymentMethod(account);
    return account;
  }

  async assertCanSendMessage(input: {
    organizationId: string;
    body: string;
    mediaUrls?: string[] | null;
  }) {
    const account = await this.chargeSetupFeeIfNeeded(input.organizationId);
    this.assertAccountActive(account);
    this.assertSavedPaymentMethod(account);

    const estimate = estimateMessageCharge({
      body: input.body,
      mediaUrls: input.mediaUrls,
      pricingTier: account.pricingTier,
    });

    if (toAmount(account.walletBalance) < estimate.amount) {
      throw new AppError(
        'Wallet balance is too low to send this message. Add funds before sending more traffic.',
        'WALLET_FUNDS_REQUIRED',
        402,
        true,
        {
          requiredAmount: estimate.amount,
          walletBalance: toAmount(account.walletBalance),
          estimate,
        }
      );
    }

    return estimate;
  }

  async recordOutboundMessageDebit(message: Message) {
    const account = await this.getOrCreateAccount(message.organizationId);
    const estimate =
      parseEstimate(message.billingEstimate) ??
      estimateMessageCharge({
        body: message.body,
        mediaUrls: Array.isArray(message.mediaUrls) ? message.mediaUrls as string[] : null,
        pricingTier: account.pricingTier,
      });

    return this.debitWallet({
      organizationId: message.organizationId,
      ledgerKey: `msg:${message.id}:outbound:wallet-debit`,
      amount: estimate.amount,
      category: 'message_usage',
      description: `Outbound ${estimate.unit.toUpperCase()} accepted by provider`,
      sourceId: message.signalmashMessageId ?? message.id,
      messageId: message.id,
      metadata: {
        ...estimate,
        direction: 'outbound',
      },
    });
  }

  async recordInboundMessageBilling(message: Message) {
    const account = await this.getOrCreateAccount(message.organizationId);
    const estimate = estimateMessageCharge({
      body: message.body,
      mediaUrls: Array.isArray(message.mediaUrls) ? message.mediaUrls as string[] : null,
      pricingTier: account.pricingTier,
    });

    const canDebit =
      account.status === 'active' &&
      Boolean(account.stripeDefaultPaymentMethodId) &&
      toAmount(account.walletBalance) >= estimate.amount;

    if (!canDebit) {
      await this.holdWalletCharge({
        organizationId: message.organizationId,
        account,
        ledgerKey: `msg:${message.id}:inbound:wallet-hold`,
        amount: estimate.amount,
        description: `Inbound ${estimate.unit.toUpperCase()} held for wallet funding`,
        messageId: message.id,
        metadata: {
          ...estimate,
          direction: 'inbound',
          walletBalance: toAmount(account.walletBalance),
          billingAccountStatus: account.status,
          hasSavedPaymentMethod: Boolean(account.stripeDefaultPaymentMethodId),
        },
      });

      await prisma.message.update({
        where: { id: message.id },
        data: {
          visible: false,
          heldForPayment: true,
          released: false,
          heldAt: new Date(),
          holdReason: 'Wallet balance or saved payment method is insufficient for inbound billing.',
          billingEstimate: estimate as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        held: true,
        estimate,
      };
    }

    await prisma.message.update({
      where: { id: message.id },
      data: {
        billingEstimate: estimate as unknown as Prisma.InputJsonValue,
      },
    });

    await this.debitWallet({
      organizationId: message.organizationId,
      ledgerKey: `msg:${message.id}:inbound:wallet-debit`,
      amount: estimate.amount,
      category: 'message_usage',
      description: `Inbound ${estimate.unit.toUpperCase()} accepted by provider`,
      sourceId: message.signalmashMessageId ?? message.id,
      messageId: message.id,
      metadata: {
        ...estimate,
        direction: 'inbound',
      },
      requireFunds: true,
    });

    return {
      held: false,
      estimate,
    };
  }

  async releaseHeldInboundMessages(organizationId: string, options?: { limit?: number }) {
    const { inboundMessageSyncService } = await import('./inbound-message-sync.service.js');
    const limit = options?.limit ?? 100;
    let released = 0;
    let remainingHeld = 0;

    const heldMessages = await prisma.message.findMany({
      where: {
        organizationId,
        direction: 'inbound',
        heldForPayment: true,
        visible: false,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    for (const message of heldMessages) {
      const account = await this.getOrCreateAccount(organizationId);
      if (account.status !== 'active' || !account.stripeDefaultPaymentMethodId) {
        remainingHeld += 1;
        break;
      }

      const estimate =
        parseEstimate(message.billingEstimate) ??
        estimateMessageCharge({
          body: message.body,
          mediaUrls: Array.isArray(message.mediaUrls) ? message.mediaUrls as string[] : null,
          pricingTier: account.pricingTier,
        });

      if (toAmount(account.walletBalance) < estimate.amount) {
        remainingHeld += 1;
        break;
      }

      await this.debitWallet({
        organizationId,
        ledgerKey: `msg:${message.id}:inbound:wallet-debit`,
        amount: estimate.amount,
        category: 'message_usage',
        description: `Inbound ${estimate.unit.toUpperCase()} released from payment hold`,
        sourceId: message.signalmashMessageId ?? message.id,
        messageId: message.id,
        metadata: {
          ...estimate,
          direction: 'inbound',
          releasedFromHold: true,
        },
        requireFunds: true,
      });

      const updatedMessage = await prisma.message.update({
        where: { id: message.id },
        data: {
          visible: true,
          heldForPayment: false,
          released: true,
          releasedAt: new Date(),
          holdReason: null,
          billingEstimate: estimate as unknown as Prisma.InputJsonValue,
        },
      });

      const refreshedAccount = await this.getOrCreateAccount(organizationId);
      await this.writeZeroAmountLedgerEntry({
        organizationId,
        account: refreshedAccount,
        ledgerKey: `msg:${message.id}:inbound:wallet-release`,
        category: 'inbound_release',
        description: 'Inbound message released after wallet funding',
        sourceId: message.id,
        metadata: {
          messageId: message.id,
        },
      });

      try {
        await inboundMessageSyncService.syncToPlatform(updatedMessage);
      } catch (error) {
        logger.error(
          { err: error, messageId: message.id, organizationId },
          'Failed to sync released inbound message to CRM platform'
        );
      }

      released += 1;
    }

    const heldCount = await prisma.message.count({
      where: {
        organizationId,
        direction: 'inbound',
        heldForPayment: true,
        visible: false,
      },
    });

    return {
      released,
      heldRemaining: Math.max(heldCount, remainingHeld),
    };
  }

  async createWalletTopUpCheckout(input: {
    organizationId: string;
    amountDollars: number;
  }) {
    const amountDollars = roundLedger(input.amountDollars);
    const pricingTier = this.getTopUpPricingTier(amountDollars);
    const organization = await this.getOrganizationRecord(input.organizationId);
    const account = await this.getOrCreateAccount(input.organizationId);
    const customerId = await this.ensureStripeCustomer(account, organization);

    const session = await stripeService.createOneTimeCheckoutSession({
      organizationId: input.organizationId,
      customerId,
      customerEmail: organization.email,
      customerName: organization.name,
      amountCents: toCents(amountDollars),
      successUrl: `${config.webUrl}/subscriptions?wallet_topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${config.webUrl}/subscriptions?wallet_topup=cancelled`,
      description: `Signalmash Connect wallet top-up (${PRICING_TIERS[pricingTier].label} tier)`,
      savePaymentMethod: true,
      metadata: {
        purpose: 'wallet_topup',
        organizationId: input.organizationId,
        amountDollars: amountDollars.toFixed(2),
        pricingTier,
        catalogVersion: PRICE_CATALOG_VERSION,
      },
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      amountDollars,
      pricingTier,
    };
  }

  async completeWalletTopUpCheckout(organizationId: string, sessionId: string) {
    const session = await stripeService.getCheckoutSession(sessionId);
    await this.applyWalletTopUpSession(organizationId, session);
    await this.releaseHeldInboundMessages(organizationId);
    return this.getWalletSummary(organizationId);
  }

  private async applyWalletTopUpSession(organizationId: string, session: StripeCheckoutSession) {
    const metadata = session.metadata ?? {};
    if (metadata.organizationId !== organizationId || metadata.purpose !== 'wallet_topup') {
      throw new AppError('Checkout session does not belong to this wallet top-up.', 'CHECKOUT_SESSION_MISMATCH', 400);
    }

    if (session.payment_status && session.payment_status !== 'paid') {
      throw new AppError('Wallet top-up checkout has not been paid yet.', 'CHECKOUT_NOT_PAID', 400);
    }

    const amountDollars = Number(metadata.amountDollars);
    if (!Number.isFinite(amountDollars) || amountDollars < MIN_TOP_UP_AMOUNT) {
      throw new AppError('Checkout session is missing the wallet top-up amount.', 'CHECKOUT_METADATA_INVALID', 400);
    }

    const pricingTier = this.getTopUpPricingTier(amountDollars);
    const account = await this.getOrCreateAccount(organizationId);

    if (session.customer && session.customer !== account.stripeCustomerId) {
      await prisma.billingAccount.update({
        where: { organizationId },
        data: {
          stripeCustomerId: session.customer,
        },
      });
    }

    if (session.payment_intent) {
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent.id;
      if (paymentIntentId) {
        const paymentIntent = await stripeService.getPaymentIntent(paymentIntentId);
        const paymentMethodId =
          typeof paymentIntent.payment_method === 'string'
            ? paymentIntent.payment_method
            : paymentIntent.payment_method?.id ?? null;

        if (paymentMethodId) {
          const customerId = session.customer ?? account.stripeCustomerId;
          if (customerId) {
            await stripeService.updateCustomerDefaultPaymentMethod({
              customerId,
              paymentMethodId,
            });
          }

          await prisma.billingAccount.update({
            where: { organizationId },
            data: {
              stripeDefaultPaymentMethodId: paymentMethodId,
            },
          });
        }
      }
    }

    await this.creditWallet({
      organizationId,
      ledgerKey: `wallet-topup:${session.id}`,
      amount: amountDollars,
      category: 'wallet_topup',
      description: 'Stripe wallet top-up',
      sourceId: session.id,
      pricingTier,
      metadata: {
        stripeCheckoutSessionId: session.id,
        pricingTier,
        catalogVersion: PRICE_CATALOG_VERSION,
      },
    });

    await prisma.billingCharge.upsert({
      where: { chargeKey: `wallet-topup:${session.id}` },
      create: {
        chargeKey: `wallet-topup:${session.id}`,
        kind: 'message_credit_topup',
        status: 'succeeded',
        amount: amountDollars.toFixed(4),
        description: 'Stripe wallet top-up',
        stripeCheckoutSessionId: session.id,
        organizationId,
        processedAt: new Date(),
        metadata: {
          purpose: 'wallet_topup',
          pricingTier,
        },
      },
      update: {
        status: 'succeeded',
        processedAt: new Date(),
      },
    });

    await this.clearBillingSuspension(organizationId);
  }

  async createPaymentMethodSetupSession(organizationId: string) {
    const organization = await this.getOrganizationRecord(organizationId);
    const account = await this.getOrCreateAccount(organizationId);
    const customerId = await this.ensureStripeCustomer(account, organization);
    const session = await stripeService.createSetupCheckoutSession({
      organizationId,
      customerId,
      successUrl: `${config.webUrl}/subscriptions?payment_method=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${config.webUrl}/subscriptions?payment_method=cancelled`,
      metadata: {
        purpose: 'saved_payment_method_setup',
        organizationId,
      },
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  }

  async completePaymentMethodSetup(organizationId: string, sessionId: string) {
    const session = await stripeService.getCheckoutSession(sessionId);
    const metadata = session.metadata ?? {};

    if (
      metadata.organizationId !== organizationId ||
      metadata.purpose !== 'saved_payment_method_setup'
    ) {
      throw new AppError('Checkout session does not belong to this payment method setup.', 'CHECKOUT_SESSION_MISMATCH', 400);
    }

    const setupIntentId =
      typeof session.setup_intent === 'string'
        ? session.setup_intent
        : session.setup_intent?.id ?? null;

    if (!setupIntentId) {
      throw new AppError('Stripe setup session is missing a setup intent.', 'SETUP_INTENT_MISSING', 400);
    }

    const setupIntent = await stripeService.getSetupIntent(setupIntentId);
    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id ?? null;

    if (!paymentMethodId) {
      throw new AppError('Stripe setup intent does not include a payment method.', 'PAYMENT_METHOD_MISSING', 400);
    }

    const account = await this.getOrCreateAccount(organizationId);
    const customerId = session.customer ?? account.stripeCustomerId;

    if (customerId) {
      await stripeService.updateCustomerDefaultPaymentMethod({
        customerId,
        paymentMethodId,
      });
    }

    const updatedAccount = await prisma.billingAccount.update({
      where: { organizationId },
      data: {
        stripeCustomerId: customerId ?? account.stripeCustomerId,
        stripeDefaultPaymentMethodId: paymentMethodId,
        status: 'active',
        suspendedAt: null,
        suspensionReason: null,
      },
    });

    await this.writeZeroAmountLedgerEntry({
      organizationId,
      account: updatedAccount,
      ledgerKey: `payment-method-setup:${session.id}`,
      category: 'saved_payment_method',
      description: 'Saved Stripe payment method',
      sourceId: session.id,
      metadata: {
        stripeSetupIntentId: setupIntentId,
        paymentMethodId,
      },
    });

    await this.clearBillingSuspension(organizationId);
    await this.releaseHeldInboundMessages(organizationId);
    return this.getWalletSummary(organizationId);
  }

  async createBillingPortalSession(organizationId: string) {
    const organization = await this.getOrganizationRecord(organizationId);
    const account = await this.getOrCreateAccount(organizationId);
    const customerId = await this.ensureStripeCustomer(account, organization);

    return stripeService.createBillingPortalSession({
      customerId,
      returnUrl: `${config.webUrl}/subscriptions`,
    });
  }

  async preparePhoneNumberProvisioning(organizationId: string) {
    const account = await this.assertCanUsePaidServices(organizationId);
    const activePhoneNumbers = await prisma.phoneNumber.count({
      where: {
        organizationId,
        status: 'active',
      },
    });

    return {
      mode: 'wallet_ready' as const,
      activePhoneNumbers,
      phoneNumberMonthlyRate: PRICING_TIERS[account.pricingTier].phoneNumberMonthlyRate,
      pricingTier: account.pricingTier,
    };
  }

  async debitAdministrativeFee(input: {
    organizationId: string;
    fee: AdministrativeFeeKind;
    ledgerKey?: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const account = await this.assertCanUsePaidServices(input.organizationId);
    const tier = PRICING_TIERS[account.pricingTier];
    const amount =
      input.fee === 'enhanced_vetting'
        ? tier.enhancedVettingFee
        : tier.campaignExpediteFee;

    return this.debitWallet({
      organizationId: input.organizationId,
      ledgerKey:
        input.ledgerKey ??
        `admin-fee:${input.fee}:${input.sourceId ?? input.organizationId}:${Date.now()}`,
      amount,
      category: input.fee,
      description:
        input.fee === 'enhanced_vetting'
          ? 'Enhanced vetting fee'
          : 'Campaign expedite fee',
      sourceId: input.sourceId,
      requireFunds: true,
      metadata: {
        ...(input.metadata ?? {}),
        catalogVersion: PRICE_CATALOG_VERSION,
      },
    });
  }

  async processMonthlyRecurringCharges(options?: {
    organizationId?: string;
    now?: Date;
    limit?: number;
  }) {
    const now = options?.now ?? new Date();
    const accounts = await prisma.billingAccount.findMany({
      where: {
        ...(options?.organizationId ? { organizationId: options.organizationId } : {}),
        status: 'active',
        OR: [
          { mrcNextRunAt: null },
          { mrcNextRunAt: { lte: now } },
        ],
      },
      orderBy: { mrcNextRunAt: 'asc' },
      take: options?.limit ?? 100,
    });

    let processed = 0;
    let suspended = 0;
    let chargedCards = 0;
    let debited = 0;

    for (const account of accounts) {
      const tier = PRICING_TIERS[account.pricingTier];
      const [activeCampaigns, activePhoneNumbers] = await Promise.all([
        prisma.campaign.count({
          where: {
            organizationId: account.organizationId,
            status: 'approved',
          },
        }),
        prisma.phoneNumber.count({
          where: {
            organizationId: account.organizationId,
            status: 'active',
          },
        }),
      ]);

      const campaignMrc = roundLedger(activeCampaigns * tier.campaignMonthlyRate);
      const phoneMrc = roundLedger(activePhoneNumbers * tier.phoneNumberMonthlyRate);
      const totalMrc = roundLedger(campaignMrc + phoneMrc);
      const cycleMonth = getCycleMonth(now);

      if (totalMrc <= 0) {
        await prisma.billingAccount.update({
          where: { id: account.id },
          data: {
            mrcAnchorAt: now,
            mrcNextRunAt: addMonths(now, 1),
          },
        });
        processed += 1;
        continue;
      }

      const currentAccount = await this.getOrCreateAccount(account.organizationId);
      const shortfall = roundLedger(totalMrc - toAmount(currentAccount.walletBalance));

      if (shortfall > 0) {
        if (!currentAccount.stripeCustomerId || !currentAccount.stripeDefaultPaymentMethodId) {
          await this.suspendForBilling(
            account.organizationId,
            'Monthly recurring charges exceeded the wallet balance and no saved payment method is available.',
            { cycleMonth, totalMrc, walletBalance: toAmount(currentAccount.walletBalance) }
          );
          suspended += 1;
          continue;
        }

        try {
          const paymentIntent = await stripeService.createOffSessionPayment({
            customerId: currentAccount.stripeCustomerId,
            paymentMethodId: currentAccount.stripeDefaultPaymentMethodId,
            amountCents: toCents(shortfall),
            description: 'Signalmash Connect monthly recurring wallet refill',
            metadata: {
              purpose: 'mrc_wallet_shortfall',
              organizationId: account.organizationId,
              cycleMonth,
              amountDollars: shortfall.toFixed(2),
            },
          });

          await this.creditWallet({
            organizationId: account.organizationId,
            ledgerKey: `mrc-card-charge:${account.organizationId}:${cycleMonth}`,
            amount: shortfall,
            category: 'card_charge',
            description: 'Saved card charge for monthly recurring wallet shortfall',
            sourceId: paymentIntent.id,
            metadata: {
              stripePaymentIntentId: paymentIntent.id,
              cycleMonth,
            },
          });
          chargedCards += 1;
        } catch (error) {
          const reason =
            error instanceof Error
              ? error.message
              : 'Saved card charge failed for monthly recurring charges.';
          await this.suspendForBilling(account.organizationId, reason, {
            cycleMonth,
            totalMrc,
            shortfall,
          });
          suspended += 1;
          continue;
        }
      }

      if (campaignMrc > 0) {
        await this.debitWallet({
          organizationId: account.organizationId,
          ledgerKey: `mrc:${account.organizationId}:${cycleMonth}:campaigns`,
          amount: campaignMrc,
          category: 'mrc_campaign',
          description: 'Monthly campaign recurring charge',
          requireFunds: true,
          metadata: {
            cycleMonth,
            activeCampaigns,
            unitRate: tier.campaignMonthlyRate,
            catalogVersion: PRICE_CATALOG_VERSION,
          },
        });
      }

      if (phoneMrc > 0) {
        await this.debitWallet({
          organizationId: account.organizationId,
          ledgerKey: `mrc:${account.organizationId}:${cycleMonth}:phone-numbers`,
          amount: phoneMrc,
          category: 'mrc_phone_number',
          description: 'Monthly phone number recurring charge',
          requireFunds: true,
          metadata: {
            cycleMonth,
            activePhoneNumbers,
            unitRate: tier.phoneNumberMonthlyRate,
            catalogVersion: PRICE_CATALOG_VERSION,
          },
        });
      }

      await prisma.billingAccount.update({
        where: { id: account.id },
        data: {
          mrcAnchorAt: now,
          mrcNextRunAt: addMonths(now, 1),
        },
      });

      debited += 1;
      processed += 1;
    }

    return {
      processed,
      debited,
      chargedCards,
      suspended,
    };
  }

  async getWalletSummary(organizationId: string) {
    const account = await this.getOrCreateAccount(organizationId);
    const tier: PricingTierDefinition = PRICING_TIERS[account.pricingTier];
    const cycleMonth = getCycleMonth();
    const cycleStart = new Date(`${cycleMonth}-01T00:00:00.000Z`);
    const [recentLedgerEntries, heldInboundCount, activePhoneNumbers, activeCampaigns, messageEntries] =
      await Promise.all([
        prisma.billingLedgerEntry.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: {
            message: {
              select: {
                id: true,
                direction: true,
                type: true,
                from: true,
                to: true,
                createdAt: true,
              },
            },
          },
        }),
        prisma.message.count({
          where: {
            organizationId,
            direction: 'inbound',
            heldForPayment: true,
            visible: false,
          },
        }),
        prisma.phoneNumber.count({
          where: {
            organizationId,
            status: 'active',
          },
        }),
        prisma.campaign.count({
          where: {
            organizationId,
            status: 'approved',
          },
        }),
        prisma.billingLedgerEntry.findMany({
          where: {
            organizationId,
            category: 'message_usage',
            createdAt: { gte: cycleStart },
          },
        }),
      ]);

    let smsUnits = 0;
    let mmsUnits = 0;

    for (const entry of messageEntries) {
      const metadata = asRecord(entry.metadata);
      const units = typeof metadata.units === 'number' ? metadata.units : 1;
      if (metadata.unit === 'mms') {
        mmsUnits += units;
      } else {
        smsUnits += units;
      }
    }

    return {
      account: {
        id: account.id,
        status: account.status,
        suspensionReason: account.suspensionReason,
        suspendedAt: account.suspendedAt,
        pricingTier: account.pricingTier,
        pricingTierLabel: tier.label,
        walletBalance: toAmount(account.walletBalance),
        hasStripeCustomer: Boolean(account.stripeCustomerId),
        hasSavedPaymentMethod: Boolean(account.stripeDefaultPaymentMethodId),
        mrcNextRunAt: account.mrcNextRunAt,
        setupFeeChargedAt: account.setupFeeChargedAt,
      },
      pricingCatalog: this.getPricingCatalog(),
      carrierSurcharges: [...CARRIER_SURCHARGES],
      carrierSurchargeNote: CARRIER_SURCHARGE_NOTE,
      prepayBalanceNote: PREPAY_BALANCE_NOTE,
      rates: {
        sms: tier.smsRate,
        mms: tier.mmsRate,
        campaignMonthly: tier.campaignMonthlyRate,
        phoneNumberMonthly: tier.phoneNumberMonthlyRate,
        basicSetup: tier.basicSetupFee,
        enhancedVetting: tier.enhancedVettingFee,
        campaignExpedite: tier.campaignExpediteFee,
      },
      topUpOptions: [...FIXED_TOP_UP_OPTIONS],
      usage: {
        cycleMonth,
        smsUnits,
        mmsUnits,
        activePhoneNumbers,
        activeCampaigns,
        heldInboundCount,
        estimatedMonthlyRecurring: roundLedger(
          activeCampaigns * tier.campaignMonthlyRate +
          activePhoneNumbers * tier.phoneNumberMonthlyRate
        ),
      },
      recentLedgerEntries: recentLedgerEntries.map((entry) => ({
        id: entry.id,
        ledgerKey: entry.ledgerKey,
        entryType: entry.entryType,
        category: entry.category,
        amount: toAmount(entry.amount),
        balanceAfter: toAmount(entry.balanceAfter),
        description: entry.description,
        createdAt: entry.createdAt,
        metadata: entry.metadata,
        message: entry.message,
      })),
    };
  }

  async handleStripeWebhook(payload: string, signatureHeader: string | undefined) {
    const event = await stripeService.verifyWebhookEvent(payload, signatureHeader);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as unknown as StripeCheckoutSession;
      const metadata = session.metadata ?? {};
      const organizationId = metadata.organizationId;

      if (organizationId && metadata.purpose === 'wallet_topup') {
        await this.applyWalletTopUpSession(organizationId, session);
        await this.releaseHeldInboundMessages(organizationId);
        return { handled: true, eventType: event.type, purpose: metadata.purpose };
      }

      if (organizationId && metadata.purpose === 'saved_payment_method_setup') {
        await this.completePaymentMethodSetup(organizationId, session.id);
        return { handled: true, eventType: event.type, purpose: metadata.purpose };
      }
    }

    return { handled: false, eventType: event.type };
  }
}

export const walletBillingService = new WalletBillingService();
