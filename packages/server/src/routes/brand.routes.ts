// ===========================================
// Brand Routes
// ===========================================

import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import {
  SIGNALMASH_PROVIDER_VERTICALS,
  SIGNALMASH_PROVIDER_VERTICAL_TO_BUSINESS_VERTICAL,
} from '@signalmash-connect/shared';
import { brandService } from '../services/brand.service.js';
import { validate, idParamSchema, einSchema, urlSchema, phoneSchema, emailSchema } from '../middleware/validation.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { organizationRuntimeService } from '../services/organization-runtime.service.js';

const router: RouterType = Router();

const providerEntityTypeToInternal = {
  PRIVATE_PROFIT: 'corporation',
  PUBLIC_PROFIT: 'corporation',
  NON_PROFIT: 'non_profit',
  GOVERNMENT: 'government',
  SOLE_PROPRIETOR: 'sole_proprietor',
  PARTNERSHIP: 'partnership',
  LLC: 'llc',
} as const;

const providerVerticalToInternal = SIGNALMASH_PROVIDER_VERTICAL_TO_BUSINESS_VERTICAL;

// Validation schemas
const createBrandSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required').max(100),
  displayName: z.string().min(1, 'Display name is required').max(100),
  ein: einSchema.optional(),
  entityType: z.enum([
    'sole_proprietor',
    'partnership',
    'corporation',
    'llc',
    'non_profit',
    'government',
  ]),
  vertical: z.enum([
    'retail',
    'healthcare',
    'financial',
    'education',
    'hospitality',
    'real_estate',
    'technology',
    'professional_services',
    'other',
  ]),
  streetAddress: z.string().min(1, 'Street address is required').max(200),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(2, 'State is required').max(2),
  postalCode: z.string().min(5, 'Postal code is required').max(10),
  country: z.string().default('US'),
  website: urlSchema,
  phone: phoneSchema,
  email: emailSchema,
});

const updateBrandSchema = createBrandSchema.extend({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  einIssuingCountry: z.string().min(2).max(2).optional(),
  providerEntityType: z.enum(['PRIVATE_PROFIT', 'PUBLIC_PROFIT', 'NON_PROFIT', 'GOVERNMENT', 'SOLE_PROPRIETOR', 'PARTNERSHIP', 'LLC']).optional(),
  providerVertical: z.enum(SIGNALMASH_PROVIDER_VERTICALS).optional(),
  brandRelationship: z.enum(['BASIC_ACCOUNT', 'SMALL_ACCOUNT', 'MEDIUM_ACCOUNT', 'LARGE_ACCOUNT', 'KEY_ACCOUNT']).optional(),
  mobilePhone: z.string().optional(),
  businessContactEmail: emailSchema.optional(),
  stockSymbol: z.string().optional(),
  stockExchange: z.string().optional(),
  ipAddress: z.string().optional(),
  altBusinessId: z.string().optional(),
  altBusinessIdType: z.string().optional(),
  referenceId: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).partial();

const createBrandProviderSchema = z.object({
  entityType: z.enum(['PRIVATE_PROFIT', 'PUBLIC_PROFIT', 'NON_PROFIT', 'GOVERNMENT', 'SOLE_PROPRIETOR', 'PARTNERSHIP', 'LLC']),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  displayName: z.string().min(1, 'Display name is required').max(100),
  companyName: z.string().min(1, 'Company name is required').max(150),
  ein: z.string().optional(),
  einIssuingCountry: z.string().min(2).max(2).default('US'),
  phone: z.string().min(7, 'Phone is required').max(20),
  street: z.string().min(1, 'Street is required').max(200),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(2, 'State is required').max(100),
  postalCode: z.string().min(1, 'Postal code is required').max(20),
  country: z.string().min(2).max(2).default('US'),
  email: emailSchema,
  stockSymbol: z.string().optional().default('NONE'),
  stockExchange: z.string().optional().default('NONE'),
  ipAddress: z.string().optional().default(''),
  brandRelationship: z.enum(['BASIC_ACCOUNT', 'SMALL_ACCOUNT', 'MEDIUM_ACCOUNT', 'LARGE_ACCOUNT', 'KEY_ACCOUNT']).default('BASIC_ACCOUNT'),
  website: urlSchema,
  vertical: z.enum(SIGNALMASH_PROVIDER_VERTICALS),
  altBusinessId: z.string().optional().default('NONE'),
  altBusinessIdType: z.string().optional().default('NONE'),
  referenceId: z.string().optional().default('NONE'),
  tag: z.array(z.string()).optional().default([]),
  mobilePhone: z.string().optional().default('NONE'),
  businessContactEmail: emailSchema,
});

const createBrandRequestSchema = z.union([createBrandSchema, createBrandProviderSchema]);

function normalizeCreateBrandPayload(body: unknown): Omit<Parameters<typeof brandService.create>[0], 'organizationId'> {
  const providerParsed = createBrandProviderSchema.safeParse(body);
  if (providerParsed.success) {
    const data = providerParsed.data;

    return {
      legalName: data.companyName,
      displayName: data.displayName,
      firstName: data.firstName?.trim() || undefined,
      lastName: data.lastName?.trim() || undefined,
      ein: data.ein?.trim() || undefined,
      einIssuingCountry: data.einIssuingCountry,
      entityType: providerEntityTypeToInternal[data.entityType],
      providerEntityType: data.entityType,
      vertical: providerVerticalToInternal[data.vertical] as Omit<Parameters<typeof brandService.create>[0], 'organizationId'>['vertical'],
      providerVertical: data.vertical,
      brandRelationship: data.brandRelationship,
      streetAddress: data.street,
      city: data.city,
      state: data.state.trim().toUpperCase(),
      postalCode: data.postalCode,
      country: data.country,
      website: data.website,
      phone: data.phone,
      mobilePhone: data.mobilePhone === 'NONE' ? undefined : data.mobilePhone,
      email: data.email,
      businessContactEmail: data.businessContactEmail,
      stockSymbol: data.stockSymbol === 'NONE' ? undefined : data.stockSymbol,
      stockExchange: data.stockExchange === 'NONE' ? undefined : data.stockExchange,
      ipAddress: data.ipAddress || undefined,
      altBusinessId: data.altBusinessId === 'NONE' ? undefined : data.altBusinessId,
      altBusinessIdType: data.altBusinessIdType === 'NONE' ? undefined : data.altBusinessIdType,
      referenceId: data.referenceId === 'NONE' ? undefined : data.referenceId,
      tags: data.tag,
    };
  }

  return createBrandSchema.parse(body);
}

/**
 * GET /brands
 * List all brands for the organization
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const brands = await brandService.getByOrganization(req.user!.organizationId);

    res.json({
      success: true,
      data: brands,
    });
  })
);

/**
 * POST /brands
 * Create a new brand
 */
router.post(
  '/',
  authenticate,
  validate({ body: createBrandRequestSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'create brands'
    );
    const brand = await brandService.create({
      ...normalizeCreateBrandPayload(req.body),
      organizationId: req.user!.organizationId,
    });

    res.status(201).json({
      success: true,
      data: brand,
    });
  })
);

/**
 * GET /brands/:id
 * Get brand details
 */
router.get(
  '/:id',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const brand = await brandService.getWithCampaigns(
      req.params.id,
      req.user!.organizationId
    );

    res.json({
      success: true,
      data: brand,
    });
  })
);

/**
 * PUT /brands/:id
 * Update brand
 */
router.put(
  '/:id',
  authenticate,
  validate({ params: idParamSchema, body: updateBrandSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'update brands'
    );
    const brand = await brandService.update(
      req.params.id,
      req.user!.organizationId,
      req.body
    );

    res.json({
      success: true,
      data: brand,
    });
  })
);

/**
 * POST /brands/:id/submit
 * Submit brand for verification
 */
router.post(
  '/:id/submit',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'submit brands'
    );
    const brand = await brandService.submitForVerification(
      req.params.id,
      req.user!.organizationId
    );

    res.json({
      success: true,
      data: brand,
      message: 'Brand submitted for verification',
    });
  })
);

/**
 * POST /brands/:id/refresh-status
 * Refresh brand verification status from Signalmash
 */
router.post(
  '/:id/refresh-status',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'refresh brand status'
    );
    const brand = await brandService.refreshVerificationStatus(
      req.params.id,
      req.user!.organizationId
    );

    res.json({
      success: true,
      data: brand,
      message: 'Brand status refreshed',
    });
  })
);

/**
 * DELETE /brands/:id
 * Delete draft brand
 */
router.delete(
  '/:id',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'delete brands'
    );
    await brandService.delete(req.params.id, req.user!.organizationId);

    res.json({
      success: true,
      message: 'Brand deleted successfully',
    });
  })
);

export { router as brandRoutes };
