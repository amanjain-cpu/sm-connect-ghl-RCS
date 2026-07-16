// ===========================================
// Phone Number (DID) Routes
// ===========================================

import { Router } from 'express';
import type { Router as RouterType, Request, Response } from 'express';
import { z } from 'zod';
import { phoneNumberService } from '../services/phoneNumber.service.js';
import { validate, paginationSchema, idParamSchema } from '../middleware/validation.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/errors.js';
import { subscriptionBillingService } from '../services/subscription-billing.service.js';
import { organizationRuntimeService } from '../services/organization-runtime.service.js';

const router: RouterType = Router();

// All routes require authentication
router.use(authenticate);

// ===========================================
// Search Available Numbers
// ===========================================

const searchQuerySchema = z.object({
  areaCode: z.string().length(3).optional(),
  contains: z.string().max(10).optional(),
  state: z.string().length(2).optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

router.get(
  '/available',
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'search number inventory'
    );
    const { areaCode, contains, state, limit } = req.query as unknown as z.infer<typeof searchQuerySchema>;

    const numbers = await phoneNumberService.searchAvailableNumbers({
      areaCode,
      contains,
      state,
      limit,
    });

    res.json({
      success: true,
      data: numbers,
    });
  })
);

// ===========================================
// Get Phone Number Stats
// ===========================================

router.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const stats = await phoneNumberService.getStats(req.user!.organizationId);

    res.json({
      success: true,
      data: stats,
    });
  })
);

// ===========================================
// Get Organization's Phone Numbers
// ===========================================

const listQuerySchema = z.object({
  status: z.enum(['active', 'pending', 'suspended', 'released']).optional(),
  campaignId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

router.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { status, campaignId, page, limit } = req.query as unknown as z.infer<typeof listQuerySchema>;

    const result = await phoneNumberService.getOrganizationNumbers(
      req.user!.organizationId,
      {
        status: status as any,
        campaignId,
        page,
        limit,
        installationId: req.user!.embeddedInstallationId ?? null,
      }
    );

    res.json({
      success: true,
      ...result,
    });
  })
);

// ===========================================
// Get Single Phone Number
// ===========================================

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const number = await phoneNumberService.getNumber(
      req.user!.organizationId,
      req.params.id
    );

    res.json({
      success: true,
      data: number,
    });
  })
);

// ===========================================
// Purchase Phone Number
// ===========================================

const purchaseBodySchema = z.object({
  phoneNumber: z.string().min(10).max(15),
  campaignId: z.string().uuid(),
  friendlyName: z.string().max(100).optional(),
});

async function savePendingNumberPurchaseIntent(input: {
  organizationId: string;
  campaignId: string;
  phoneNumber: string;
  friendlyName?: string;
  error: AppError;
}) {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: input.campaignId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      status: true,
      signalmashCampaignId: true,
    },
  });

  if (campaign?.status !== 'pending_approval' || !campaign.signalmashCampaignId) {
    return null;
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      numberLinkIntent: {
        mode: 'buy_new',
        phoneNumber: input.phoneNumber,
        makeDefaultSender: true,
        ...(input.friendlyName ? { friendlyName: input.friendlyName } : {}),
      } as any,
      numberLinkStatus: 'requested',
      numberLinkError: input.error.message,
      numberLinkAttemptedAt: new Date(),
      numberLinkCompletedAt: null,
    },
  });

  return {
    pending: true,
    campaignId: campaign.id,
    phoneNumber: input.phoneNumber,
    message: 'Number selection saved. Signalmash did not provision the DID yet, so the app will retry after campaign approval.',
  };
}

router.post(
  '/checkout',
  validate({ body: purchaseBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'start number checkout'
    );
    const { phoneNumber, campaignId, friendlyName } = req.body as z.infer<typeof purchaseBodySchema>;

    await phoneNumberService.assertCampaignReadyForNumberProvisioning(
      req.user!.organizationId,
      campaignId
    );

    const result = await subscriptionBillingService.preparePhoneNumberCheckout({
      organizationId: req.user!.organizationId,
      phoneNumber,
      campaignId,
      friendlyName,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  })
);

const completeCheckoutBodySchema = z.object({
  sessionId: z.string().min(8),
});

router.post(
  '/checkout/complete',
  validate({ body: completeCheckoutBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'complete number checkout'
    );
    const { sessionId } = req.body as z.infer<typeof completeCheckoutBodySchema>;
    const metadata = await subscriptionBillingService.completePhoneNumberCheckout(
      req.user!.organizationId,
      sessionId
    );

    try {
      const number = await phoneNumberService.purchaseNumber(
        req.user!.organizationId,
        metadata.phoneNumber,
        {
          campaignId: metadata.campaignId,
          friendlyName: metadata.friendlyName || undefined,
        }
      );

      res.status(201).json({
        success: true,
        data: number,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'NUMBER_ALREADY_OWNED') {
        const existing = await prisma.phoneNumber.findUnique({
          where: { phoneNumber: metadata.phoneNumber },
          include: {
            campaign: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
        });

        if (existing?.organizationId === req.user!.organizationId) {
          res.status(200).json({
            success: true,
            data: existing,
          });
          return;
        }
      }

      if (error instanceof AppError && error.code === 'PROVIDER_NUMBER_PROVISIONING_UNAVAILABLE') {
        const pendingIntent = await savePendingNumberPurchaseIntent({
          organizationId: req.user!.organizationId,
          campaignId: metadata.campaignId,
          phoneNumber: metadata.phoneNumber,
          friendlyName: metadata.friendlyName || undefined,
          error,
        });

        if (pendingIntent) {
          res.status(202).json({
            success: true,
            data: {
              ...pendingIntent,
              message: 'Payment completed. Signalmash did not provision the DID yet, so the app will retry after campaign approval.',
            },
          });
          return;
        }
      }

      throw error;
    }
  })
);

router.post(
  '/purchase',
  validate({ body: purchaseBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'purchase numbers'
    );
    const { phoneNumber, campaignId, friendlyName } = req.body as z.infer<typeof purchaseBodySchema>;

    const subscription = await subscriptionBillingService.assertCanProvisionPhoneNumber(
      req.user!.organizationId
    );
    const activePhoneNumbers = await prisma.phoneNumber.count({
      where: {
        organizationId: req.user!.organizationId,
        status: 'active',
      },
    });

    if (activePhoneNumbers >= subscription.phoneNumbersIncluded) {
      throw new AppError(
        'This purchase requires the extra phone-number checkout flow first.',
        'PHONE_NUMBER_OVERAGE_PAYMENT_REQUIRED',
        402,
        true,
        {
          activePhoneNumbers,
          includedPhoneNumbers: subscription.phoneNumbersIncluded,
        }
      );
    }

    try {
      const number = await phoneNumberService.purchaseNumber(
        req.user!.organizationId,
        phoneNumber,
        { campaignId, friendlyName }
      );

      res.status(201).json({
        success: true,
        data: number,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'PROVIDER_NUMBER_PROVISIONING_UNAVAILABLE') {
        const pendingIntent = await savePendingNumberPurchaseIntent({
          organizationId: req.user!.organizationId,
          campaignId,
          phoneNumber,
          friendlyName,
          error,
        });

        if (pendingIntent) {
          res.status(202).json({
            success: true,
            data: pendingIntent,
          });
          return;
        }
      }

      throw error;
    }
  })
);

// ===========================================
// Update Phone Number
// ===========================================

const updateBodySchema = z.object({
  friendlyName: z.string().max(100).optional(),
  campaignId: z.string().uuid().nullable().optional(),
  makeDefault: z.boolean().optional(),
  confirmReassignment: z.boolean().optional(),
});

router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'update number assignments'
    );
    const number = await phoneNumberService.updateNumber(
      req.user!.organizationId,
      req.params.id,
      req.body,
      { installationId: req.user!.embeddedInstallationId ?? null }
    );

    res.json({
      success: true,
      data: number,
    });
  })
);

// ===========================================
// Release Phone Number
// ===========================================

router.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'release numbers'
    );
    await phoneNumberService.releaseNumber(
      req.user!.organizationId,
      req.params.id
    );

    res.json({
      success: true,
      message: 'Phone number released successfully',
    });
  })
);

export { router as phoneNumberRoutes };
