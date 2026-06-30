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

const router: RouterType = Router();

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
    const diagnostic = await signalmashService.runConnectionDiagnostic();

    await adminService.logAuditAction(
      req.admin!.id,
      'TEST_SIGNALMASH_CONNECTION',
      'signalmash_connectivity',
      undefined,
      diagnostic as unknown as Record<string, unknown>,
      {
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || undefined,
      }
    );

    res.json({
      success: true,
      data: diagnostic,
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
        phoneNumberId: linked.phoneNumber.id,
        signalmashBrandId: data.signalmashBrandId,
        signalmashCampaignId: data.signalmashCampaignId,
        signalmashNumberId: data.signalmashNumberId,
        phoneNumber: data.phoneNumber,
        webhookConfigured: linked.webhookConfigured,
        webhookError: linked.webhookError,
      },
      {
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || undefined,
      }
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
      {
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || undefined,
      }
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
      {
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || undefined,
      }
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
      {
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || undefined,
      }
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
      {
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || undefined,
      }
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
