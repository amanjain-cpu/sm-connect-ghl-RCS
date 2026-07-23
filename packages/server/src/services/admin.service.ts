// ===========================================
// Admin Service
// ===========================================

import { Prisma, type BillingAccountStatus, type BillingPricingTier } from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { redis } from '../config/redis.js';
import { encrypt, decrypt, hashPassword, verifyPassword } from '../utils/crypto.js';
import { generateTokens, verifyAdminRefreshToken } from '../utils/jwt.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { integrationService } from './integration.service.js';
import { walletBillingService } from './wallet-billing.service.js';

// Settings keys
export const SETTINGS_KEYS = {
  SIGNALMASH_API_KEY: 'signalmash_api_key',
  SIGNALMASH_API_URL: 'signalmash_api_url',
  SIGNALMASH_WEBHOOK_SECRET: 'signalmash_webhook_secret',
  STRIPE_SECRET_KEY: 'stripe_secret_key',
  STRIPE_WEBHOOK_SECRET: 'stripe_webhook_secret',
  STRIPE_PRICE_STARTER_MONTHLY: 'stripe_price_starter_monthly',
  STRIPE_PRICE_GROWTH_MONTHLY: 'stripe_price_growth_monthly',
  STRIPE_PRICE_SCALE_MONTHLY: 'stripe_price_scale_monthly',
  GHL_APP_CLIENT_ID: 'ghl_app_client_id',
  GHL_APP_CLIENT_SECRET: 'ghl_app_client_secret',
  GHL_APP_SSO_KEY: 'ghl_app_sso_key',
  GHL_APP_CUSTOM_PAGE_LINK_ID: 'ghl_app_custom_page_link_id',
  APP_NAME: 'app_name',
  SUPPORT_EMAIL: 'support_email',
} as const;

// Cache TTL (5 minutes)
const SETTINGS_CACHE_TTL = 300;

type AdminActionContext = {
  ipAddress?: string;
  userAgent?: string;
};

function toAmount(value: Prisma.Decimal | string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  return Number(value);
}

export class AdminService {
  // ===========================================
  // Settings Utility (Database-first with env fallback)
  // ===========================================

  /**
   * Get a setting value from database first, falling back to env var
   * This allows runtime configuration via admin portal while supporting
   * initial setup via environment variables
   */
  async getSettingWithFallback(
    key: string,
    envFallback: string | undefined
  ): Promise<string> {
    const dbValue = await this.getSetting(key);
    if (dbValue && dbValue.trim() !== '') {
      return dbValue;
    }
    return envFallback || '';
  }

  // ===========================================
  // Super Admin Authentication
  // ===========================================

  async createSuperAdmin(data: {
    email: string;
    password: string;
    name: string;
  }) {
    const existing = await prisma.superAdmin.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new AppError('Admin with this email already exists', 'ADMIN_EXISTS', 400);
    }

    const passwordHash = await hashPassword(data.password);

    const admin = await prisma.superAdmin.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        createdAt: true,
      },
    });

    logger.info({ adminId: admin.id }, 'Super admin created');
    return admin;
  }

  async loginSuperAdmin(email: string, password: string) {
    const admin = await prisma.superAdmin.findUnique({
      where: { email },
    });

    if (!admin) {
      throw new AppError('Invalid credentials', 'INVALID_CREDENTIALS', 401);
    }

    if (!admin.isActive) {
      throw new AppError('Admin account is disabled', 'ADMIN_DISABLED', 403);
    }

    const isValid = await verifyPassword(password, admin.passwordHash);
    if (!isValid) {
      throw new AppError('Invalid credentials', 'INVALID_CREDENTIALS', 401);
    }

    // Generate tokens
    const tokens = await generateTokens({
      adminId: admin.id,
      email: admin.email,
    });

    // Store refresh token
    await prisma.superAdminRefreshToken.create({
      data: {
        adminId: admin.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Update last login
    await prisma.superAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
      },
      tokens,
    };
  }

  async refreshAdminToken(refreshToken: string) {
    let payload;
    try {
      payload = await verifyAdminRefreshToken(refreshToken);
    } catch {
      throw new AppError('Invalid refresh token', 'INVALID_TOKEN', 401);
    }

    const storedToken = await prisma.superAdminRefreshToken.findUnique({
      where: { token: refreshToken },
      include: { admin: true },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw new AppError('Refresh token expired', 'TOKEN_EXPIRED', 401);
    }

    if (!storedToken.admin.isActive) {
      throw new AppError('Admin account is disabled', 'ADMIN_DISABLED', 403);
    }

    // Delete old token
    await prisma.superAdminRefreshToken.delete({
      where: { id: storedToken.id },
    });

    // Generate new tokens
    const tokens = await generateTokens({
      adminId: storedToken.admin.id,
      email: storedToken.admin.email,
    });

    // Store new refresh token
    await prisma.superAdminRefreshToken.create({
      data: {
        adminId: storedToken.admin.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return tokens;
  }

  async logoutAdmin(refreshToken: string) {
    await prisma.superAdminRefreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  // ===========================================
  // App Settings Management
  // ===========================================

  async getSetting(key: string): Promise<string | null> {
    // Check cache first
    const cacheKey = `setting:${key}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return cached;
    }

    const setting = await prisma.appSettings.findUnique({
      where: { key },
    });

    if (!setting) {
      return null;
    }

    // Decrypt if encrypted
    const value = setting.isEncrypted ? decrypt(setting.value) : setting.value;

    // Cache the value
    await redis.setex(cacheKey, SETTINGS_CACHE_TTL, value);

    return value;
  }

  async getAllSettings(adminId: string) {
    const settings = await prisma.appSettings.findMany({
      orderBy: { key: 'asc' },
    });

    // Log access
    await this.logAuditAction(adminId, 'VIEW_SETTINGS', 'app_settings');

    // Return with masked sensitive values
    return settings.map((s) => ({
      id: s.id,
      key: s.key,
      value: s.isEncrypted ? this.maskValue(decrypt(s.value)) : s.value,
      description: s.description,
      isEncrypted: s.isEncrypted,
      updatedAt: s.updatedAt,
    }));
  }

  async setSetting(
    adminId: string,
    key: string,
    value: string,
    options: { description?: string; isEncrypted?: boolean } = {}
  ) {
    const isEncrypted = options.isEncrypted ?? this.shouldEncrypt(key);
    const storedValue = isEncrypted ? encrypt(value) : value;

    const setting = await prisma.appSettings.upsert({
      where: { key },
      create: {
        key,
        value: storedValue,
        description: options.description,
        isEncrypted,
        updatedBy: adminId,
      },
      update: {
        value: storedValue,
        description: options.description,
        isEncrypted,
        updatedBy: adminId,
      },
    });

    // Invalidate cache
    await redis.del(`setting:${key}`);

    // Log action
    await this.logAuditAction(adminId, 'UPDATE_SETTING', 'app_settings', setting.id, {
      key,
      isEncrypted,
    });

    logger.info({ key, adminId }, 'App setting updated');

    return {
      id: setting.id,
      key: setting.key,
      value: isEncrypted ? this.maskValue(value) : value,
      description: setting.description,
      isEncrypted: setting.isEncrypted,
      updatedAt: setting.updatedAt,
    };
  }

  async deleteSetting(adminId: string, key: string) {
    const setting = await prisma.appSettings.delete({
      where: { key },
    });

    // Invalidate cache
    await redis.del(`setting:${key}`);

    // Log action
    await this.logAuditAction(adminId, 'DELETE_SETTING', 'app_settings', setting.id, { key });

    logger.info({ key, adminId }, 'App setting deleted');
  }

  async initializeDefaultSettings() {
    const defaults = [
      {
        key: SETTINGS_KEYS.SIGNALMASH_API_URL,
        value: process.env.SIGNALMASH_API_URL || 'https://api.signalmash.com',
        description: 'Signalmash API base URL',
        isEncrypted: false,
      },
      {
        key: SETTINGS_KEYS.SIGNALMASH_API_KEY,
        value: process.env.SIGNALMASH_API_KEY || '',
        description: 'Signalmash API key for authentication',
        isEncrypted: true,
      },
      {
        key: SETTINGS_KEYS.STRIPE_SECRET_KEY,
        value: process.env.STRIPE_SECRET_KEY || '',
        description: 'Stripe secret API key for billing and checkout operations',
        isEncrypted: true,
      },
      {
        key: SETTINGS_KEYS.STRIPE_WEBHOOK_SECRET,
        value: process.env.STRIPE_WEBHOOK_SECRET || '',
        description: 'Stripe webhook signing secret',
        isEncrypted: true,
      },
      {
        key: SETTINGS_KEYS.STRIPE_PRICE_STARTER_MONTHLY,
        value: process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
        description: 'Stripe recurring monthly Price ID for the Starter plan',
        isEncrypted: false,
      },
      {
        key: SETTINGS_KEYS.STRIPE_PRICE_GROWTH_MONTHLY,
        value: process.env.STRIPE_PRICE_GROWTH_MONTHLY || '',
        description: 'Stripe recurring monthly Price ID for the Growth plan',
        isEncrypted: false,
      },
      {
        key: SETTINGS_KEYS.STRIPE_PRICE_SCALE_MONTHLY,
        value: process.env.STRIPE_PRICE_SCALE_MONTHLY || '',
        description: 'Stripe recurring monthly Price ID for the Scale plan',
        isEncrypted: false,
      },
      {
        key: SETTINGS_KEYS.GHL_APP_CLIENT_ID,
        value: process.env.GHL_APP_CLIENT_ID || '',
        description: 'Platform OAuth client ID',
        isEncrypted: false,
      },
      {
        key: SETTINGS_KEYS.GHL_APP_CLIENT_SECRET,
        value: process.env.GHL_APP_CLIENT_SECRET || '',
        description: 'Platform OAuth client secret',
        isEncrypted: true,
      },
      {
        key: SETTINGS_KEYS.GHL_APP_SSO_KEY,
        value: process.env.GHL_APP_SSO_KEY || '',
        description: 'Embedded SSO shared secret used to decrypt platform user context. Multiple secrets can be stored separated by commas or new lines during app version transitions.',
        isEncrypted: true,
      },
      {
        key: SETTINGS_KEYS.GHL_APP_CUSTOM_PAGE_LINK_ID,
        value: process.env.CRM_APP_CUSTOM_PAGE_LINK_ID || process.env.GHL_APP_CUSTOM_PAGE_LINK_ID || '',
        description: 'Marketplace custom page link ID used to open the embedded app inside a workspace after install.',
        isEncrypted: false,
      },
      {
        key: SETTINGS_KEYS.APP_NAME,
        value: 'SignalMash Connect',
        description: 'Application display name',
        isEncrypted: false,
      },
    ];

    for (const setting of defaults) {
      const existing = await prisma.appSettings.findUnique({
        where: { key: setting.key },
      });

      if (!existing && setting.value) {
        await prisma.appSettings.create({
          data: {
            key: setting.key,
            value: setting.isEncrypted ? encrypt(setting.value) : setting.value,
            description: setting.description,
            isEncrypted: setting.isEncrypted,
          },
        });
        logger.info({ key: setting.key }, 'Default setting initialized');
      }
    }
  }

  // ===========================================
  // Dashboard Stats (Admin)
  // ===========================================

  async getDashboardStats(adminId: string) {
    const [
      totalOrganizations,
      totalUsers,
      totalBrands,
      totalCampaigns,
      totalMessages,
      recentMessages,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.brand.count(),
      prisma.campaign.count(),
      prisma.message.count(),
      prisma.message.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    await this.logAuditAction(adminId, 'VIEW_DASHBOARD', 'dashboard');

    return {
      totalOrganizations,
      totalUsers,
      totalBrands,
      totalCampaigns,
      totalMessages,
      messagesLast24h: recentMessages,
    };
  }

  async getOrganizations(adminId: string, params: { page?: number; limit?: number }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const [organizations, total] = await Promise.all([
      prisma.organization.findMany({
        skip,
        take: limit,
        include: {
          billingAccount: {
            select: {
              status: true,
              pricingTier: true,
              walletBalance: true,
              suspensionReason: true,
            },
          },
          _count: {
            select: {
              users: true,
              brands: true,
              campaigns: true,
              phoneNumbers: true,
              messages: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.organization.count(),
    ]);

    await this.logAuditAction(adminId, 'VIEW_ORGANIZATIONS', 'organizations');

    return {
      data: organizations,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOrganizationOnboarding(adminId: string, organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        _count: {
          select: {
            users: true,
            brands: true,
            campaigns: true,
            phoneNumbers: true,
            messages: true,
          },
        },
      },
    });

    if (!organization) {
      throw new AppError('Organization not found', 'ORGANIZATION_NOT_FOUND', 404);
    }

    const [connections, installations, brands, campaigns, phoneNumbers, externalMappings, recentProviderOperations, subscriptionSummary] =
      await Promise.all([
        prisma.platformConnection.findMany({
          where: { organizationId },
          select: {
            id: true,
            platform: true,
            platformAccountId: true,
            platformAccountName: true,
            tokenExpiresAt: true,
            scopes: true,
            webhookUrl: true,
            status: true,
            metadata: true,
            lastSyncAt: true,
            createdAt: true,
            updatedAt: true,
            installationId: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        integrationService.getInstallationOverview(organizationId),
        prisma.brand.findMany({
          where: { organizationId },
          include: {
            campaigns: {
              include: {
                phoneNumbers: {
                  select: {
                    id: true,
                    phoneNumber: true,
                    formattedNumber: true,
                    status: true,
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.campaign.findMany({
          where: { organizationId },
          include: {
            brand: {
              select: {
                id: true,
                legalName: true,
                displayName: true,
                status: true,
              },
            },
            phoneNumbers: {
              select: {
                id: true,
                phoneNumber: true,
                formattedNumber: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.phoneNumber.findMany({
          where: { organizationId },
          include: {
            campaign: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.externalResourceMapping.findMany({
          where: { organizationId },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        }),
        prisma.providerOperationLog.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        walletBillingService.getWalletSummary(organizationId),
      ]);

    await this.logAuditAction(adminId, 'VIEW_ORGANIZATION_ONBOARDING', 'organizations', organizationId);

    return {
      organization,
      connections,
      installations,
      brands,
      campaigns,
      phoneNumbers,
      subscriptionSummary,
      externalMappings,
      recentProviderOperations,
    };
  }

  private async buildOrganizationBillingDetail(organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        website: true,
        logoUrl: true,
        status: true,
        suspendedAt: true,
        suspensionReason: true,
        createdAt: true,
        updatedAt: true,
        billingAccount: {
          select: {
            id: true,
            status: true,
            pricingTier: true,
            walletBalance: true,
            stripeCustomerId: true,
            stripeDefaultPaymentMethodId: true,
            suspensionReason: true,
            suspendedAt: true,
            mrcNextRunAt: true,
            setupFeeChargedAt: true,
            updatedAt: true,
          },
        },
        _count: {
          select: {
            users: true,
            brands: true,
            campaigns: true,
            phoneNumbers: true,
            messages: true,
          },
        },
      },
    });

    if (!organization) {
      throw new AppError('Organization not found', 'ORGANIZATION_NOT_FOUND', 404);
    }

    const [walletSummary, recentLedgerEntries, recentCharges, recentBillingEvents, recentAuditLogs] =
      await Promise.all([
        walletBillingService.getWalletSummary(organizationId),
        prisma.billingLedgerEntry.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            message: {
              select: {
                id: true,
                direction: true,
                type: true,
                from: true,
                to: true,
                status: true,
                createdAt: true,
              },
            },
          },
        }),
        prisma.billingCharge.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        prisma.billingEvent.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            message: {
              select: {
                id: true,
                direction: true,
                type: true,
                from: true,
                to: true,
                status: true,
                createdAt: true,
              },
            },
          },
        }),
        prisma.adminAuditLog.findMany({
          where: {
            resource: 'organization_billing',
            resourceId: organizationId,
          },
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: {
            admin: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        }),
      ]);

    return {
      organization: {
        ...organization,
        billingAccount: organization.billingAccount
          ? {
              id: organization.billingAccount.id,
              status: organization.billingAccount.status,
              pricingTier: organization.billingAccount.pricingTier,
              walletBalance: toAmount(organization.billingAccount.walletBalance),
              suspensionReason: organization.billingAccount.suspensionReason,
              suspendedAt: organization.billingAccount.suspendedAt,
              mrcNextRunAt: organization.billingAccount.mrcNextRunAt,
              setupFeeChargedAt: organization.billingAccount.setupFeeChargedAt,
              updatedAt: organization.billingAccount.updatedAt,
              hasStripeCustomer: Boolean(organization.billingAccount.stripeCustomerId),
              hasSavedPaymentMethod: Boolean(organization.billingAccount.stripeDefaultPaymentMethodId),
            }
          : null,
      },
      walletSummary,
      recentLedgerEntries: recentLedgerEntries.map((entry) => ({
        ...entry,
        amount: toAmount(entry.amount),
        balanceAfter: toAmount(entry.balanceAfter),
      })),
      recentCharges: recentCharges.map((charge) => ({
        ...charge,
        amount: toAmount(charge.amount),
      })),
      recentBillingEvents,
      recentAuditLogs,
    };
  }

  async getOrganizationBilling(
    adminId: string,
    organizationId: string,
    context?: AdminActionContext
  ) {
    const detail = await this.buildOrganizationBillingDetail(organizationId);

    await this.logAuditAction(
      adminId,
      'VIEW_ORGANIZATION_BILLING',
      'organization_billing',
      organizationId,
      {
        organizationId,
      },
      context
    );

    return detail;
  }

  async applyOrganizationWalletAdjustment(input: {
    adminId: string;
    adminEmail: string;
    organizationId: string;
    type: 'credit' | 'debit';
    amount: number;
    reason: string;
    idempotencyKey?: string;
    context?: AdminActionContext;
  }) {
    const before = await walletBillingService.getWalletSummary(input.organizationId);
    const adjustment = await walletBillingService.applyAdminWalletAdjustment({
      organizationId: input.organizationId,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      adminId: input.adminId,
      adminEmail: input.adminEmail,
      idempotencyKey: input.idempotencyKey,
    });
    const billing = await this.buildOrganizationBillingDetail(input.organizationId);

    await this.logAuditAction(
      input.adminId,
      'ADMIN_BILLING_WALLET_ADJUSTMENT',
      'organization_billing',
      input.organizationId,
      {
        organizationId: input.organizationId,
        type: input.type,
        amount: adjustment.amount,
        reason: input.reason,
        previousValues: {
          walletBalance: before.account.walletBalance,
          billingStatus: before.account.status,
        },
        newValues: {
          walletBalance: adjustment.walletBalance,
          billingStatus: billing.walletSummary.account.status,
        },
        affectedLedgerEntryId: adjustment.ledgerEntry.id,
        affectedLedgerKey: adjustment.ledgerEntry.ledgerKey,
        affectedChargeId: adjustment.charge.id,
        affectedChargeKey: adjustment.charge.chargeKey,
        idempotentReplay: adjustment.idempotentReplay,
      },
      input.context
    );

    return {
      adjustment: {
        ledgerEntry: adjustment.ledgerEntry,
        charge: adjustment.charge,
        previousBalance: adjustment.previousBalance,
        walletBalance: adjustment.walletBalance,
        amount: adjustment.amount,
        type: adjustment.type,
        reason: adjustment.reason,
        idempotentReplay: adjustment.idempotentReplay,
      },
      billing,
    };
  }

  async updateOrganizationBillingAccount(input: {
    adminId: string;
    organizationId: string;
    status?: BillingAccountStatus;
    suspensionReason?: string;
    pricingTier?: BillingPricingTier;
    context?: AdminActionContext;
  }) {
    const result = await walletBillingService.updateAdminBillingAccount({
      organizationId: input.organizationId,
      status: input.status,
      suspensionReason: input.suspensionReason,
      pricingTier: input.pricingTier,
    });
    const billing = await this.buildOrganizationBillingDetail(input.organizationId);

    await this.logAuditAction(
      input.adminId,
      'ADMIN_BILLING_ACCOUNT_UPDATE',
      'organization_billing',
      input.organizationId,
      {
        organizationId: input.organizationId,
        reason: input.suspensionReason,
        previousValues: {
          status: result.previousAccount.status,
          pricingTier: result.previousAccount.pricingTier,
          suspensionReason: result.previousAccount.suspensionReason,
          suspendedAt: result.previousAccount.suspendedAt,
        },
        newValues: {
          status: result.account.status,
          pricingTier: result.account.pricingTier,
          suspensionReason: result.account.suspensionReason,
          suspendedAt: result.account.suspendedAt,
        },
      },
      input.context
    );

    return {
      account: result.account,
      billing,
    };
  }

  async createOrganizationBillingPortal(input: {
    adminId: string;
    organizationId: string;
    context?: AdminActionContext;
  }) {
    const before = await walletBillingService.getWalletSummary(input.organizationId);
    const portal = await walletBillingService.createBillingPortalSession(input.organizationId, {
      returnUrl: `${config.webUrl}/admin/organizations`,
    });
    const billing = await this.buildOrganizationBillingDetail(input.organizationId);

    await this.logAuditAction(
      input.adminId,
      'ADMIN_BILLING_PORTAL_SESSION',
      'organization_billing',
      input.organizationId,
      {
        organizationId: input.organizationId,
        previousValues: {
          hasStripeCustomer: before.account.hasStripeCustomer,
        },
        newValues: {
          hasStripeCustomer: billing.walletSummary.account.hasStripeCustomer,
        },
        portalSessionCreated: true,
      },
      input.context
    );

    return {
      portal,
      billing,
    };
  }

  async releaseOrganizationHeldInbound(input: {
    adminId: string;
    organizationId: string;
    context?: AdminActionContext;
  }) {
    const before = await walletBillingService.getWalletSummary(input.organizationId);
    const result = await walletBillingService.releaseHeldInboundMessages(input.organizationId);
    const billing = await this.buildOrganizationBillingDetail(input.organizationId);

    await this.logAuditAction(
      input.adminId,
      'ADMIN_BILLING_RELEASE_HELD_INBOUND',
      'organization_billing',
      input.organizationId,
      {
        organizationId: input.organizationId,
        previousValues: {
          heldInboundCount: before.usage.heldInboundCount,
          walletBalance: before.account.walletBalance,
        },
        newValues: {
          heldInboundCount: billing.walletSummary.usage.heldInboundCount,
          walletBalance: billing.walletSummary.account.walletBalance,
        },
        result,
      },
      input.context
    );

    return {
      result,
      billing,
    };
  }

  async processOrganizationMrc(input: {
    adminId: string;
    organizationId: string;
    context?: AdminActionContext;
  }) {
    const before = await walletBillingService.getWalletSummary(input.organizationId);
    await walletBillingService.getOrCreateAccount(input.organizationId);
    const result = await walletBillingService.processMonthlyRecurringCharges({
      organizationId: input.organizationId,
    });
    const billing = await this.buildOrganizationBillingDetail(input.organizationId);

    await this.logAuditAction(
      input.adminId,
      'ADMIN_BILLING_PROCESS_MRC',
      'organization_billing',
      input.organizationId,
      {
        organizationId: input.organizationId,
        previousValues: {
          billingStatus: before.account.status,
          walletBalance: before.account.walletBalance,
          mrcNextRunAt: before.account.mrcNextRunAt,
        },
        newValues: {
          billingStatus: billing.walletSummary.account.status,
          walletBalance: billing.walletSummary.account.walletBalance,
          mrcNextRunAt: billing.walletSummary.account.mrcNextRunAt,
        },
        result,
      },
      input.context
    );

    return {
      result,
      billing,
    };
  }

  // ===========================================
  // Audit Logging
  // ===========================================

  async logAuditAction(
    adminId: string,
    action: string,
    resource: string,
    resourceId?: string,
    details?: Record<string, unknown>,
    context?: { ipAddress?: string; userAgent?: string }
  ) {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        resource,
        resourceId,
        details: (details || undefined) as any,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      },
    });
  }

  async getAuditLogs(adminId: string, params: { page?: number; limit?: number }) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        skip,
        take: limit,
        include: {
          admin: {
            select: { id: true, email: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.adminAuditLog.count(),
    ]);

    await this.logAuditAction(adminId, 'VIEW_AUDIT_LOGS', 'admin_audit_logs');

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ===========================================
  // Helper Methods
  // ===========================================

  private shouldEncrypt(key: string): boolean {
    const sensitiveKeys = [
      SETTINGS_KEYS.SIGNALMASH_API_KEY,
      SETTINGS_KEYS.SIGNALMASH_WEBHOOK_SECRET,
      SETTINGS_KEYS.STRIPE_SECRET_KEY,
      SETTINGS_KEYS.STRIPE_WEBHOOK_SECRET,
      SETTINGS_KEYS.GHL_APP_CLIENT_SECRET,
      SETTINGS_KEYS.GHL_APP_SSO_KEY,
    ];
    return sensitiveKeys.includes(key as any);
  }

  private maskValue(value: string): string {
    if (value.length <= 8) {
      return '••••••••';
    }
    return `${value.slice(0, 4)}${'•'.repeat(value.length - 8)}${value.slice(-4)}`;
  }
}

export const adminService = new AdminService();
