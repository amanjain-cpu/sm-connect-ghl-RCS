// ===========================================
// Billing Routes
// ===========================================

import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { billingService } from '../services/billing.service.js';
import { validate, idParamSchema } from '../middleware/validation.js';
import { subscriptionBillingService } from '../services/subscription-billing.service.js';
import { externalBillingBridgeService } from '../services/external-billing-bridge.service.js';

const router: RouterType = Router();
const crmPlatformId = `${'lead'}connector` as const;

const processBillingSchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const updateBillingStatusSchema = z.object({
  status: z.enum(['posted', 'failed', 'ignored']),
  reason: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const checkoutPlanSchema = z.object({
  plan: z.enum(['starter', 'growth', 'scale']),
});

const completeCheckoutSchema = z.object({
  sessionId: z.string().min(8),
});

const authorizeMarketplaceBillingSchema = z.object({
  clientId: z.string().min(8),
  installType: z.string().min(1),
  locationId: z.string().optional(),
  companyId: z.string().optional(),
});

router.post(
  '/webhook/stripe',
  asyncHandler(async (req, res) => {
    const result = await subscriptionBillingService.handleStripeWebhook(
      req.rawBody ?? JSON.stringify(req.body ?? {}),
      req.headers['stripe-signature'] as string | undefined
    );

    res.json({ success: true, data: result });
  })
);

router.post(
  `/${crmPlatformId}/install/authorize`,
  validate({ body: authorizeMarketplaceBillingSchema }),
  asyncHandler(async (req, res) => {
    const result = await externalBillingBridgeService.authorizeInstallation(req.body);
    res.json({ success: true, data: result });
  })
);

router.use(authenticate);

router.get(
  '/subscription',
  asyncHandler(async (req, res) => {
    const summary = await subscriptionBillingService.getSubscriptionSummary(req.user!.organizationId);
    res.json({ success: true, data: summary });
  })
);

router.post(
  '/subscription/checkout',
  validate({ body: checkoutPlanSchema }),
  asyncHandler(async (req, res) => {
    const result = await subscriptionBillingService.createOrUpdateSubscriptionCheckout(
      req.user!.organizationId,
      req.body.plan
    );
    res.json({ success: true, data: result });
  })
);

router.post(
  '/subscription/checkout/complete',
  validate({ body: completeCheckoutSchema }),
  asyncHandler(async (req, res) => {
    const summary = await subscriptionBillingService.completeSubscriptionCheckout(
      req.user!.organizationId,
      req.body.sessionId
    );
    res.json({ success: true, data: summary });
  })
);

router.post(
  '/subscription/portal',
  asyncHandler(async (req, res) => {
    const portal = await subscriptionBillingService.createBillingPortalSession(
      req.user!.organizationId
    );
    res.json({ success: true, data: portal });
  })
);

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const summary = await billingService.getSummary(req.user!.organizationId);
    res.json({ success: true, data: summary });
  })
);

router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const events = await billingService.listEvents(req.user!.organizationId);
    res.json({ success: true, data: events });
  })
);

router.post(
  '/process',
  validate({ body: processBillingSchema }),
  asyncHandler(async (req, res) => {
    const result = await billingService.processPendingEvents(
      req.user!.organizationId,
      req.body
    );
    res.json({ success: true, data: result });
  })
);

router.patch(
  '/events/:id/status',
  validate({ params: idParamSchema, body: updateBillingStatusSchema }),
  asyncHandler(async (req, res) => {
    const event = await billingService.updateEventStatus(
      req.user!.organizationId,
      req.params.id,
      req.body
    );
    res.json({ success: true, data: event });
  })
);

export { router as billingRoutes };
