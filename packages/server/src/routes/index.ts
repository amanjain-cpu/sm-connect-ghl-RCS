// ===========================================
// API Routes Index
// ===========================================

import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { authRoutes } from './auth.routes.js';
import { organizationRoutes } from './organization.routes.js';
import { brandRoutes } from './brand.routes.js';
import { campaignRoutes } from './campaign.routes.js';
import { messageRoutes } from './message.routes.js';
import { phoneNumberRoutes } from './phoneNumber.routes.js';
import { platformRoutes } from './platform.routes.js';
import { webhookRoutes } from './webhook.routes.js';
import { billingRoutes } from './billing.routes.js';
import { portOrderRoutes } from './port-order.routes.js';
import { operationsRoutes } from './operations.routes.js';
import { supportAgentRoutes } from './support-agent.routes.js';
import adminRoutes from './admin.routes.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { handleCrmAppWebhook } from './webhook.routes.js';

const router: RouterType = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Signalmash Connect API is running',
    timestamp: new Date().toISOString(),
  });
});

// Direct webhook endpoint for marketplace compatibility
router.get('/webhook', (req, res) => {
  res.status(200).json({ success: true });
});

router.get('/webhook/ghl', (req, res) => {
  res.status(200).json({ success: true });
});

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    return handleCrmAppWebhook(req, res, { requireSignature: false });
  })
);

router.post(
  '/webhook/ghl',
  asyncHandler(async (req, res) => {
    return handleCrmAppWebhook(req, res, { requireSignature: false });
  })
);

// API Routes
router.use('/auth', authRoutes);
router.use('/organization', organizationRoutes);
router.use('/brands', brandRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/messages', messageRoutes);
router.use('/phone-numbers', phoneNumberRoutes);
router.use('/port-orders', portOrderRoutes);
router.use('/platforms', platformRoutes);
router.use('/billing', billingRoutes);
router.use('/operations', operationsRoutes);
router.use('/support-agent', supportAgentRoutes);
router.use('/webhooks', webhookRoutes);

// Admin Routes (separate namespace)
router.use('/admin', adminRoutes);

export { router as apiRoutes };
