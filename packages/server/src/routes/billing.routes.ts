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
import { walletBillingService } from '../services/wallet-billing.service.js';
import { AppError } from '../utils/errors.js';

const router: RouterType = Router();
const crmPlatformId = `${'lead'}connector` as const;
const crmPublicPlatformId = 'crm' as const;

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

const walletTopupSchema = z.object({
  amountDollars: z.coerce.number().min(250).max(100000),
});

const onboardingCheckoutSchema = z.object({
  topUpAmount: z.coerce.number().min(250).max(100000),
  includeEnhancedVetting: z.boolean().optional(),
  includeCampaignExpedite: z.boolean().optional(),
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
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const signature = req.headers['stripe-signature'] as string | undefined;
    const walletResult = await walletBillingService.handleStripeWebhook(rawBody, signature);
    const result = walletResult.handled
      ? walletResult
      : await subscriptionBillingService.handleStripeWebhook(rawBody, signature);

    res.json({ success: true, data: result });
  })
);

router.post(
  `/${crmPublicPlatformId}/install/authorize`,
  validate({ body: authorizeMarketplaceBillingSchema }),
  asyncHandler(async (req, res) => {
    const result = await externalBillingBridgeService.authorizeInstallation(req.body);
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
  '/wallet',
  asyncHandler(async (req, res) => {
    const summary = await walletBillingService.getWalletSummary(req.user!.organizationId);
    res.json({ success: true, data: summary });
  })
);

router.post(
  '/wallet/top-ups/checkout',
  validate({ body: walletTopupSchema }),
  asyncHandler(async (req, res) => {
    const result = await walletBillingService.createWalletTopUpCheckout({
      organizationId: req.user!.organizationId,
      amountDollars: req.body.amountDollars,
    });
    res.json({ success: true, data: result });
  })
);

router.post(
  '/wallet/top-ups/checkout/complete',
  validate({ body: completeCheckoutSchema }),
  asyncHandler(async (req, res) => {
    const summary = await walletBillingService.completeWalletTopUpCheckout(
      req.user!.organizationId,
      req.body.sessionId
    );
    res.json({ success: true, data: summary });
  })
);

router.post(
  '/wallet/onboarding/checkout',
  validate({ body: onboardingCheckoutSchema }),
  asyncHandler(async (req, res) => {
    const result = await walletBillingService.createOnboardingCheckout({
      organizationId: req.user!.organizationId,
      topUpAmount: req.body.topUpAmount,
      includeEnhancedVetting: req.body.includeEnhancedVetting,
      includeCampaignExpedite: req.body.includeCampaignExpedite,
    });
    res.json({ success: true, data: result });
  })
);

router.post(
  '/wallet/onboarding/checkout/complete',
  validate({ body: completeCheckoutSchema }),
  asyncHandler(async (req, res) => {
    const summary = await walletBillingService.completeOnboardingCheckout(
      req.user!.organizationId,
      req.body.sessionId
    );
    res.json({ success: true, data: summary });
  })
);

router.post(
  '/wallet/payment-method/setup',
  asyncHandler(async (req, res) => {
    const result = await walletBillingService.createPaymentMethodSetupSession(
      req.user!.organizationId
    );
    res.json({ success: true, data: result });
  })
);

router.post(
  '/wallet/payment-method/setup/complete',
  validate({ body: completeCheckoutSchema }),
  asyncHandler(async (req, res) => {
    const summary = await walletBillingService.completePaymentMethodSetup(
      req.user!.organizationId,
      req.body.sessionId
    );
    res.json({ success: true, data: summary });
  })
);

router.post(
  '/wallet/portal',
  asyncHandler(async (req, res) => {
    const portal = await walletBillingService.createBillingPortalSession(
      req.user!.organizationId
    );
    res.json({ success: true, data: portal });
  })
);

router.post(
  '/wallet/release-held',
  asyncHandler(async (req, res) => {
    const result = await walletBillingService.releaseHeldInboundMessages(
      req.user!.organizationId
    );
    res.json({ success: true, data: result });
  })
);

router.post(
  '/wallet/mrc/process',
  asyncHandler(async (req, res) => {
    const result = await walletBillingService.processMonthlyRecurringCharges({
      organizationId: req.user!.organizationId,
    });
    res.json({ success: true, data: result });
  })
);

router.get(
  '/subscription',
  asyncHandler(async (req, res) => {
    const summary = await walletBillingService.getWalletSummary(req.user!.organizationId);
    res.json({ success: true, data: summary });
  })
);

router.post(
  '/subscription/checkout',
  validate({ body: checkoutPlanSchema }),
  asyncHandler(async () => {
    throw new AppError(
      'Subscription plans have been replaced by prepaid wallet top-ups.',
      'SUBSCRIPTION_CHECKOUT_DISABLED',
      410
    );
  })
);

router.post(
  '/subscription/checkout/complete',
  validate({ body: completeCheckoutSchema }),
  asyncHandler(async () => {
    throw new AppError(
      'Subscription checkout completion is disabled after the prepaid wallet migration.',
      'SUBSCRIPTION_CHECKOUT_DISABLED',
      410
    );
  })
);

router.post(
  '/subscription/portal',
  asyncHandler(async (req, res) => {
    const portal = await walletBillingService.createBillingPortalSession(
      req.user!.organizationId
    );
    res.json({ success: true, data: portal });
  })
);

router.post(
  '/message-credits/checkout',
  validate({ body: walletTopupSchema }),
  asyncHandler(async (req, res) => {
    const result = await walletBillingService.createWalletTopUpCheckout({
      organizationId: req.user!.organizationId,
      amountDollars: req.body.amountDollars,
    });
    res.json({ success: true, data: result });
  })
);

router.post(
  '/message-credits/checkout/complete',
  validate({ body: completeCheckoutSchema }),
  asyncHandler(async (req, res) => {
    const summary = await walletBillingService.completeWalletTopUpCheckout(
      req.user!.organizationId,
      req.body.sessionId
    );
    res.json({ success: true, data: summary });
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
