// ===========================================
// Admin Routes
// ===========================================

import { Router, Request, Response, NextFunction } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { adminService, SETTINGS_KEYS } from '../services/admin.service.js';
import { AppError } from '../utils/errors.js';
import { verifyAdminAccessToken } from '../utils/jwt.js';
import { prisma } from '../config/database.js';
import { signalmashService } from '../services/signalmash.service.js';
import { phoneNumberService } from '../services/phoneNumber.service.js';
import { brandService } from '../services/brand.service.js';
import { campaignService } from '../services/campaign.service.js';
import { organizationService } from '../services/organization.service.js';

const router: RouterType = Router();

const ASSIGNABLE_BRAND_PROVIDER_STATUSES = new Set(['VERIFIED', 'APPROVED', 'ACTIVE']);
const ASSIGNABLE_CAMPAIGN_PROVIDER_STATUSES = new Set(['APPROVED', 'ACTIVE']);

const normalizeProviderLifecycleStatus = (status?: string | null) =>
  status?.trim().replace(/[\s-]+/g, '_').toUpperCase() || undefined;

const isAssignableBrandProviderStatus = (status?: string | null) =>
  !!normalizeProviderLifecycleStatus(status) &&
  ASSIGNABLE_BRAND_PROVIDER_STATUSES.has(normalizeProviderLifecycleStatus(status)!);

const isAssignableCampaignProviderStatus = (status?: string | null) =>
  !!normalizeProviderLifecycleStatus(status) &&
  ASSIGNABLE_CAMPAIGN_PROVIDER_STATUSES.has(normalizeProviderLifecycleStatus(status)!);

// ===========================================
// Admin Auth Middleware
// ===========================================

interface AdminRequest extends Request {
  admin?: {
    id: string;
    email: string;
    role: string;
  };
}

const requireSuperAdmin = async (
  req: AdminRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('No token provided', 'UNAUTHORIZED', 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyAdminAccessToken(token);

    req.admin = {
      id: payload.adminId,
      email: payload.email,
      role: 'superadmin',
    };

    next();
  } catch (error) {
    next(error);
  }
};

const getAdminContext = (req: AdminRequest) => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent') || undefined,
});

// ===========================================
// Auth Routes
// ===========================================

// Login
router.post('/auth/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });

    const data = schema.parse(req.body);
    const result = await adminService.loginSuperAdmin(data.email, data.password);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post('/auth/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      refreshToken: z.string(),
    });

    const { refreshToken } = schema.parse(req.body);
    const tokens = await adminService.refreshAdminToken(refreshToken);

    res.json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    next(error);
  }
});

// Logout
router.post('/auth/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      refreshToken: z.string(),
    });

    const { refreshToken } = schema.parse(req.body);
    await adminService.logoutAdmin(refreshToken);

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Protected Admin Routes
// ===========================================

// Get current admin
router.get('/me', requireSuperAdmin, async (req: AdminRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      admin: req.admin,
    },
  });
});

// ===========================================
// Settings Routes
// ===========================================

// Get all settings
router.get('/settings', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const settings = await adminService.getAllSettings(req.admin!.id);

    res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
});

// Update a setting
router.put('/settings/:key', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      value: z.string(),
      description: z.string().optional(),
    });

    const { key } = req.params;
    const data = schema.parse(req.body);

    const setting = await adminService.setSetting(
      req.admin!.id,
      key,
      data.value,
      { description: data.description }
    );

    res.json({
      success: true,
      data: setting,
    });
  } catch (error) {
    next(error);
  }
});

// Batch update settings
router.put('/settings', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      settings: z.array(z.object({
        key: z.string(),
        value: z.string(),
        description: z.string().optional(),
      })),
    });

    const { settings } = schema.parse(req.body);
    const results: Awaited<ReturnType<typeof adminService.setSetting>>[] = [];

    for (const setting of settings) {
      const result = await adminService.setSetting(
        req.admin!.id,
        setting.key,
        setting.value,
        { description: setting.description }
      );
      results.push(result);
    }

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    next(error);
  }
});

// Delete a setting
router.delete('/settings/:key', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    await adminService.deleteSetting(req.admin!.id, key);

    res.json({
      success: true,
      message: 'Setting deleted',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/settings/signalmash/diagnostic', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const latest = await prisma.adminAuditLog.findFirst({
      where: {
        action: 'TEST_SIGNALMASH_CONNECTION',
        resource: 'signalmash_connectivity',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        details: true,
      },
    });

    res.json({
      success: true,
      data: latest
        ? {
            id: latest.id,
            createdAt: latest.createdAt,
            ...(latest.details as Record<string, unknown> | null ?? {}),
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/settings/signalmash/test-connection', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      brandId: z.string().trim().optional(),
      campaignId: z.string().trim().optional(),
    }).parse(req.body ?? {});
    const diagnostic = await signalmashService.runConnectionDiagnostic(data);

    await adminService.logAuditAction(
      req.admin!.id,
      'TEST_SIGNALMASH_CONNECTION',
      'signalmash_connectivity',
      undefined,
      diagnostic as unknown as Record<string, unknown>,
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: diagnostic,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/settings/signalmash/brands', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const brands = await signalmashService.listBrands();

    res.json({
      success: true,
      data: brands
        .map((brand) => ({
          ...brand,
          assignable: isAssignableBrandProviderStatus(brand.status),
        }))
        .sort((left, right) => {
          if (left.assignable !== right.assignable) {
            return left.assignable ? -1 : 1;
          }

          return (left.displayName ?? left.brandId).localeCompare(right.displayName ?? right.brandId);
        }),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/settings/signalmash/brands/:brandId/campaigns', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = z.object({
      brandId: z.string().trim().min(1),
    }).parse(req.params);

    const listedCampaigns = await signalmashService.listCampaigns();
    const candidates = listedCampaigns.filter((campaign) =>
      !campaign.brandId || campaign.brandId === params.brandId
    );

    const campaigns = await Promise.all(
      candidates.map(async (campaign) => {
        try {
          const detail = await signalmashService.getCampaignStatus(campaign.campaignId);
          const resolvedBrandId = detail.brandId ?? campaign.brandId;

          if (!resolvedBrandId || resolvedBrandId !== params.brandId) {
            return null;
          }

          return {
            campaignId: campaign.campaignId,
            brandId: resolvedBrandId,
            name: detail.name ?? campaign.name,
            status: detail.status ?? campaign.status,
            tcrCampaignId: detail.tcrCampaignId,
            providerMessage: detail.providerMessage,
            assignable: isAssignableCampaignProviderStatus(detail.status ?? campaign.status),
          };
        } catch (error) {
          if (!campaign.brandId || campaign.brandId !== params.brandId) {
            return null;
          }

          return {
            campaignId: campaign.campaignId,
            brandId: campaign.brandId,
            name: campaign.name,
            status: campaign.status ?? 'UNKNOWN',
            providerMessage: error instanceof Error ? error.message : 'Unable to load campaign details',
            assignable: isAssignableCampaignProviderStatus(campaign.status),
          };
        }
      })
    );
    const visibleCampaigns = campaigns.filter((campaign) => campaign !== null);

    res.json({
      success: true,
      data: visibleCampaigns
        .sort((left, right) => {
          if (left.assignable !== right.assignable) {
            return left.assignable ? -1 : 1;
          }

          return (left.name ?? left.campaignId).localeCompare(right.name ?? right.campaignId);
        }),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/settings/signalmash/assign-brand-campaign', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      organizationId: z.string().uuid(),
      signalmashBrandId: z.string().trim().min(1),
      signalmashCampaignId: z.string().trim().min(1),
    }).parse(req.body ?? {});
    const linked = await phoneNumberService.linkVerifiedBrandCampaignFromProvider(data);

    await adminService.logAuditAction(
      req.admin!.id,
      'ASSIGN_SIGNALMASH_BRAND_CAMPAIGN',
      'organization',
      data.organizationId,
      {
        brandId: linked.brand.id,
        campaignId: linked.campaign.id,
        signalmashBrandId: data.signalmashBrandId,
        signalmashCampaignId: data.signalmashCampaignId,
        providerBrandStatus: linked.providerBrandStatus,
        providerCampaignStatus: linked.providerCampaignStatus,
      },
      getAdminContext(req)
    );

    res.status(201).json({
      success: true,
      data: linked,
      message: 'Verified Signalmash brand and campaign assigned to organization',
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Dashboard Routes
// ===========================================

// Get dashboard stats
router.get('/dashboard', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const stats = await adminService.getDashboardStats(req.admin!.id);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

// Get organizations
router.get('/organizations', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await adminService.getOrganizations(req.admin!.id, { page, limit });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/organizations/:id/onboarding', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const detail = await adminService.getOrganizationOnboarding(req.admin!.id, req.params.id);

    res.json({
      success: true,
      data: detail,
    });
  } catch (error) {
    next(error);
  }
});

const organizationBillingParamsSchema = z.object({
  organizationId: z.string().uuid(),
});

const walletAdjustmentSchema = z.object({
  type: z.enum(['credit', 'debit']),
  amount: z.coerce.number().positive().max(1000000),
  reason: z.string().trim().min(1).max(1000),
});

const billingAccountPatchSchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  suspensionReason: z.string().trim().max(1000).optional().transform((value) => value || undefined),
  pricingTier: z.enum(['tier_250', 'tier_500', 'tier_1400']).optional(),
}).superRefine((value, ctx) => {
  if (!value.status && !value.suspensionReason && !value.pricingTier) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one billing account field must be provided.',
    });
  }

  if (value.status === 'suspended' && !value.suspensionReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['suspensionReason'],
      message: 'Suspension reason is required when suspending billing.',
    });
  }
});

router.get('/organizations/:organizationId/billing', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = organizationBillingParamsSchema.parse(req.params);
    const detail = await adminService.getOrganizationBilling(
      req.admin!.id,
      params.organizationId,
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: detail,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/billing/wallet-adjustments', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = organizationBillingParamsSchema.parse(req.params);
    const data = walletAdjustmentSchema.parse(req.body ?? {});
    const idempotencyKey =
      req.get('idempotency-key') || req.get('x-idempotency-key') || undefined;

    const result = await adminService.applyOrganizationWalletAdjustment({
      adminId: req.admin!.id,
      adminEmail: req.admin!.email,
      organizationId: params.organizationId,
      type: data.type,
      amount: data.amount,
      reason: data.reason,
      idempotencyKey,
      context: getAdminContext(req),
    });

    res.status(201).json({
      success: true,
      data: result,
      message: data.type === 'credit' ? 'Wallet credited' : 'Wallet debited',
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/organizations/:organizationId/billing/account', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = organizationBillingParamsSchema.parse(req.params);
    const data = billingAccountPatchSchema.parse(req.body ?? {});
    const result = await adminService.updateOrganizationBillingAccount({
      adminId: req.admin!.id,
      organizationId: params.organizationId,
      status: data.status,
      suspensionReason: data.suspensionReason,
      pricingTier: data.pricingTier,
      context: getAdminContext(req),
    });

    res.json({
      success: true,
      data: result,
      message: 'Billing account updated',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/billing/portal', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = organizationBillingParamsSchema.parse(req.params);
    const result = await adminService.createOrganizationBillingPortal({
      adminId: req.admin!.id,
      organizationId: params.organizationId,
      context: getAdminContext(req),
    });

    res.json({
      success: true,
      data: {
        url: result.portal.url,
        billing: result.billing,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/billing/release-held', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = organizationBillingParamsSchema.parse(req.params);
    const result = await adminService.releaseOrganizationHeldInbound({
      adminId: req.admin!.id,
      organizationId: params.organizationId,
      context: getAdminContext(req),
    });

    res.json({
      success: true,
      data: result,
      message: 'Held inbound release processed',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/billing/mrc/process', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = organizationBillingParamsSchema.parse(req.params);
    const result = await adminService.processOrganizationMrc({
      adminId: req.admin!.id,
      organizationId: params.organizationId,
      context: getAdminContext(req),
    });

    res.json({
      success: true,
      data: result,
      message: 'Monthly recurring charge processing finished',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:id/suspend', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = z.object({
      id: z.string().uuid(),
    }).parse(req.params);
    const body = z.object({
      reason: z.string().trim().max(500).optional().transform((value) => value || undefined),
    }).parse(req.body ?? {});

    const organization = await organizationService.suspend(params.id, body.reason);

    await adminService.logAuditAction(
      req.admin!.id,
      'ADMIN_SUSPEND_ORGANIZATION',
      'organization',
      params.id,
      {
        status: organization.status,
        reason: organization.suspensionReason,
      },
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: organization,
      message: 'Organization suspended',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:id/unsuspend', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = z.object({
      id: z.string().uuid(),
    }).parse(req.params);
    const organization = await organizationService.unsuspend(params.id);

    await adminService.logAuditAction(
      req.admin!.id,
      'ADMIN_UNSUSPEND_ORGANIZATION',
      'organization',
      params.id,
      {
        status: organization.status,
      },
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: organization,
      message: 'Organization unsuspended',
    });
  } catch (error) {
    next(error);
  }
});

const linkExistingAssetsSchema = z.object({
  organizationId: z.string().uuid(),
  brandName: z.string().min(1).max(150),
  signalmashBrandId: z.string().min(1).max(150),
  tcrBrandId: z.string().max(150).optional().transform((value) => value?.trim() || undefined),
  campaignName: z.string().min(1).max(150),
  signalmashCampaignId: z.string().min(1).max(150),
  tcrCampaignId: z.string().max(150).optional().transform((value) => value?.trim() || undefined),
  phoneNumber: z.string().min(10).max(20),
  signalmashNumberId: z.string().max(150).optional().transform((value) => value?.trim() || undefined),
  friendlyName: z.string().max(100).optional().transform((value) => value?.trim() || undefined),
  configureWebhook: z.boolean().optional(),
  makeDefaultSender: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.configureWebhook && !value.signalmashNumberId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signalmashNumberId'],
      message: 'Signalmash Number ID is required when configuring the inbound webhook.',
    });
  }
});

router.post('/organizations/link-existing-assets', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const data = linkExistingAssetsSchema.parse(req.body);
    const linked = await phoneNumberService.linkExistingAssets(data);

    await adminService.logAuditAction(
      req.admin!.id,
      'LINK_EXISTING_SIGNALMASH_ASSETS',
      'organization',
      data.organizationId,
      {
        brandId: linked.brand.id,
        campaignId: linked.campaign.id,
        phoneNumberId: linked.phoneNumber?.id,
        signalmashBrandId: data.signalmashBrandId,
        signalmashCampaignId: data.signalmashCampaignId,
        signalmashNumberId: data.signalmashNumberId,
        phoneNumber: data.phoneNumber,
        webhookConfigured: linked.webhookConfigured,
        webhookError: linked.webhookError,
      },
      getAdminContext(req)
    );

    res.status(201).json({
      success: true,
      data: linked,
      message: linked.webhookError
        ? 'Existing assets linked, but webhook configuration needs review'
        : 'Existing Signalmash assets linked',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/brands/:brandId/submit', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = z.object({
      organizationId: z.string().uuid(),
      brandId: z.string().uuid(),
    }).parse(req.params);
    const brand = await brandService.submitForVerification(params.brandId, params.organizationId);

    await adminService.logAuditAction(
      req.admin!.id,
      'ADMIN_SUBMIT_BRAND',
      'brand',
      params.brandId,
      { organizationId: params.organizationId, status: brand.status },
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: brand,
      message: 'Brand submitted for verification',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/brands/:brandId/refresh-status', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = z.object({
      organizationId: z.string().uuid(),
      brandId: z.string().uuid(),
    }).parse(req.params);
    const brand = await brandService.refreshVerificationStatus(params.brandId, params.organizationId);

    await adminService.logAuditAction(
      req.admin!.id,
      'ADMIN_REFRESH_BRAND_STATUS',
      'brand',
      params.brandId,
      { organizationId: params.organizationId, status: brand.status },
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: brand,
      message: 'Brand status refreshed',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/brands/:brandId/manual-status', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = z.object({
      organizationId: z.string().uuid(),
      brandId: z.string().uuid(),
    }).parse(req.params);
    const data = z.object({
      status: z.enum(['verified', 'rejected']),
      reason: z.string().trim().max(500).optional().transform((value) => value || undefined),
    }).parse(req.body ?? {});
    const existingBrand = await brandService.getById(params.brandId, params.organizationId);
    const brand = await brandService.setManualVerificationStatus(
      params.brandId,
      params.organizationId,
      data.status,
      data.reason
    );

    await adminService.logAuditAction(
      req.admin!.id,
      'ADMIN_SET_BRAND_STATUS',
      'brand',
      params.brandId,
      {
        organizationId: params.organizationId,
        previousStatus: existingBrand.status,
        status: brand.status,
        providerStatus: brand.providerStatus,
        reason: data.reason,
      },
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: brand,
      message: data.status === 'verified' ? 'Brand marked approved locally' : 'Brand marked rejected locally',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/campaigns/:campaignId/submit', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = z.object({
      organizationId: z.string().uuid(),
      campaignId: z.string().uuid(),
    }).parse(req.params);
    const campaign = await campaignService.submitForApproval(params.campaignId, params.organizationId);

    await adminService.logAuditAction(
      req.admin!.id,
      'ADMIN_SUBMIT_CAMPAIGN',
      'campaign',
      params.campaignId,
      { organizationId: params.organizationId, status: campaign.status },
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: campaign,
      message: 'Campaign submitted for approval',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/campaigns/:campaignId/refresh-status', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = z.object({
      organizationId: z.string().uuid(),
      campaignId: z.string().uuid(),
    }).parse(req.params);
    const campaign = await campaignService.refreshApprovalStatus(params.campaignId, params.organizationId);

    await adminService.logAuditAction(
      req.admin!.id,
      'ADMIN_REFRESH_CAMPAIGN_STATUS',
      'campaign',
      params.campaignId,
      { organizationId: params.organizationId, status: campaign.status },
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: campaign,
      message: 'Campaign status refreshed',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:organizationId/campaigns/:campaignId/manual-status', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const params = z.object({
      organizationId: z.string().uuid(),
      campaignId: z.string().uuid(),
    }).parse(req.params);
    const data = z.object({
      status: z.enum(['approved', 'rejected']),
      reason: z.string().trim().max(500).optional().transform((value) => value || undefined),
    }).parse(req.body ?? {});
    const existingCampaign = await campaignService.getById(params.campaignId, params.organizationId);
    const campaign = await campaignService.setManualApprovalStatus(
      params.campaignId,
      params.organizationId,
      data.status,
      data.reason
    );

    await adminService.logAuditAction(
      req.admin!.id,
      'ADMIN_SET_CAMPAIGN_STATUS',
      'campaign',
      params.campaignId,
      {
        organizationId: params.organizationId,
        previousStatus: existingCampaign.status,
        status: campaign.status,
        providerStatus: campaign.providerStatus,
        reason: data.reason,
      },
      getAdminContext(req)
    );

    res.json({
      success: true,
      data: campaign,
      message: data.status === 'approved' ? 'Campaign marked approved locally' : 'Campaign marked rejected locally',
    });
  } catch (error) {
    next(error);
  }
});

// Get audit logs
router.get('/audit-logs', requireSuperAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await adminService.getAuditLogs(req.admin!.id, { page, limit });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Setup Route (Create first admin - only works once)
// ===========================================

router.post('/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check if any admin exists
    const existingAdmin = await adminService.getDashboardStats('setup').catch(() => null);
    const adminCount = await prisma.superAdmin.count();

    if (adminCount > 0) {
      throw new AppError('Setup already completed', 'SETUP_COMPLETE', 400);
    }

    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(1),
      signalmashApiKey: z.string().optional(),
      signalmashApiUrl: z.string().url().optional(),
    });

    const data = schema.parse(req.body);

    // Create admin
    const admin = await adminService.createSuperAdmin({
      email: data.email,
      password: data.password,
      name: data.name,
    });

    // Initialize default settings
    await adminService.initializeDefaultSettings();

    // Set Signalmash settings if provided
    if (data.signalmashApiKey) {
      await adminService.setSetting(admin.id, SETTINGS_KEYS.SIGNALMASH_API_KEY, data.signalmashApiKey);
    }
    if (data.signalmashApiUrl) {
      await adminService.setSetting(admin.id, SETTINGS_KEYS.SIGNALMASH_API_URL, data.signalmashApiUrl);
    }

    // Auto-login
    const result = await adminService.loginSuperAdmin(data.email, data.password);

    res.json({
      success: true,
      data: result,
      message: 'Admin setup completed successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
