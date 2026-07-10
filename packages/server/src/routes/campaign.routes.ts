// ===========================================
// Campaign Routes
// ===========================================

import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import {
  CAMPAIGN_SUB_USE_CASE_VALUES,
  CAMPAIGN_USE_CASE_VALUES,
} from '@signalmash-connect/shared';
import { campaignService } from '../services/campaign.service.js';
import { validate, idParamSchema } from '../middleware/validation.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { organizationRuntimeService } from '../services/organization-runtime.service.js';

const router: RouterType = Router();

// Validation schemas
const createCampaignSchema = z.object({
  brandId: z.string().uuid('Invalid brand ID'),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().min(10, 'Description must be at least 10 characters').max(1000),
  useCase: z.enum(CAMPAIGN_USE_CASE_VALUES),
  subUsecases: z.array(z.enum(CAMPAIGN_SUB_USE_CASE_VALUES)).optional(),
  embeddedLink: z.boolean().optional(),
  embeddedPhone: z.boolean().optional(),
  affiliateMarketing: z.boolean().optional(),
  termsAndConditions: z.boolean().optional(),
  numberPool: z.boolean().optional(),
  ageGated: z.boolean().optional(),
  directLending: z.boolean().optional(),
  subscriberOptin: z.boolean().optional(),
  subscriberOptout: z.boolean().optional(),
  subscriberHelp: z.boolean().optional(),
  sampleMessages: z
    .array(z.string().min(10).max(320))
    .min(1, 'At least one sample message is required')
    .max(5, 'Maximum 5 sample messages'),
  messageFlow: z.string().min(10).max(1000).optional(),
  mnoIds: z.array(z.string()).optional(),
  referenceId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  autoRenewal: z.boolean().optional(),
  optInKeywords: z.array(z.string()).optional(),
  optOutKeywords: z.array(z.string()).optional(),
  helpKeywords: z.array(z.string()).optional(),
  optInMessage: z.string().max(320).optional(),
  optOutMessage: z.string().max(320).optional(),
  helpMessage: z.string().max(320).optional(),
  privacyPolicyLink: z.string().url().optional().or(z.literal('')),
  termsAndConditionsLink: z.string().url().optional().or(z.literal('')),
  embeddedLinkSample: z.string().optional(),
});

const updateCampaignSchema = createCampaignSchema.omit({ brandId: true }).partial();
const numberLinkIntentSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('existing'),
    phoneNumberId: z.string().uuid('Invalid phone number ID'),
    friendlyName: z.string().max(100).optional(),
    confirmReassignment: z.boolean().optional(),
    makeDefaultSender: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal('buy_new'),
    phoneNumber: z.string().min(10).max(20),
    friendlyName: z.string().max(100).optional(),
    makeDefaultSender: z.boolean().optional(),
  }),
]);
const submitCampaignSchema = z.object({
  numberLinkIntent: numberLinkIntentSchema.optional(),
}).default({});

const listCampaignsQuerySchema = z.object({
  brandId: z.string().uuid().optional(),
  status: z
    .enum(['draft', 'pending_approval', 'approved', 'rejected', 'suspended', 'expired'])
    .optional(),
});

/**
 * GET /campaigns
 * List all campaigns for the organization
 */
router.get(
  '/',
  authenticate,
  validate({ query: listCampaignsQuerySchema }),
  asyncHandler(async (req, res) => {
    const campaigns = await campaignService.getByOrganization(
      req.user!.organizationId,
      {
        brandId: req.query.brandId as string | undefined,
        status: req.query.status as any,
      }
    );

    res.json({
      success: true,
      data: campaigns,
    });
  })
);

/**
 * POST /campaigns
 * Create a new campaign
 */
router.post(
  '/',
  authenticate,
  validate({ body: createCampaignSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'create campaigns'
    );
    const campaign = await campaignService.create({
      ...req.body,
      organizationId: req.user!.organizationId,
    });

    res.status(201).json({
      success: true,
      data: campaign,
    });
  })
);

/**
 * GET /campaigns/:id
 * Get campaign details
 */
router.get(
  '/:id',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const campaign = await campaignService.getWithPhoneNumbers(
      req.params.id,
      req.user!.organizationId
    );

    res.json({
      success: true,
      data: campaign,
    });
  })
);

/**
 * PUT /campaigns/:id
 * Update campaign
 */
router.put(
  '/:id',
  authenticate,
  validate({ params: idParamSchema, body: updateCampaignSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'update campaigns'
    );
    const campaign = await campaignService.update(
      req.params.id,
      req.user!.organizationId,
      req.body
    );

    res.json({
      success: true,
      data: campaign,
    });
  })
);

/**
 * POST /campaigns/:id/submit
 * Submit campaign for approval
 */
router.post(
  '/:id/submit',
  authenticate,
  validate({ params: idParamSchema, body: submitCampaignSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'submit campaigns'
    );
    const campaign = await campaignService.submitForApproval(
      req.params.id,
      req.user!.organizationId,
      req.body
    );

    res.json({
      success: true,
      data: campaign,
      message: 'Campaign submitted for approval',
    });
  })
);

router.post(
  '/:id/link-number',
  authenticate,
  validate({ params: idParamSchema, body: numberLinkIntentSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'link campaign phone numbers'
    );
    const campaign = await campaignService.linkPhoneNumber(
      req.params.id,
      req.user!.organizationId,
      req.body
    );

    res.json({
      success: true,
      data: campaign,
      message: 'Campaign phone-number link updated',
    });
  })
);

/**
 * POST /campaigns/:id/refresh-status
 * Refresh campaign approval status from Signalmash
 */
router.post(
  '/:id/refresh-status',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'refresh campaign status'
    );
    const campaign = await campaignService.refreshApprovalStatus(
      req.params.id,
      req.user!.organizationId
    );

    res.json({
      success: true,
      data: campaign,
      message: 'Campaign status refreshed',
    });
  })
);

/**
 * DELETE /campaigns/:id
 * Delete draft campaign
 */
router.delete(
  '/:id',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'delete campaigns'
    );
    await campaignService.delete(req.params.id, req.user!.organizationId);

    res.json({
      success: true,
      message: 'Campaign deleted successfully',
    });
  })
);

export { router as campaignRoutes };
