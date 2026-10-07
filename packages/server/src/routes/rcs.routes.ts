// ===========================================
// RCS routes: the organization's agent, capability checks, and channel stats
// ===========================================

import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { validate, phoneSchema } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { rcsAgentService } from '../services/rcs-agent.service.js';
import { messageService } from '../services/message.service.js';
import { simplyRcsService } from '../services/simplyrcs.service.js';
import { organizationRuntimeService } from '../services/organization-runtime.service.js';

const router: RouterType = Router();
router.use(authenticate);

const agentSchema = z.object({
  senderName: z.string().trim().min(2).max(60),
  displayName: z.string().trim().min(2).max(100),
  description: z.string().trim().min(20).max(1000),
  logoUrl: z.string().url(),
  bannerUrl: z.string().url(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  billingCategory: z.enum(['NON_CONVERSATIONAL', 'CONVERSATIONAL']).optional(),
  useCase: z.enum(['OTP', 'TRANSACTIONAL', 'PROMOTIONAL', 'MULTI_USE']).optional(),
  phone: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  website: z.string().trim().url().optional().nullable().or(z.literal('')),
  privacyUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
  termsUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
});

/** GET /rcs/agent: the agent plus whether SimplyRCS is configured at all. */
router.get('/agent', asyncHandler(async (req, res) => {
  const [agent, configured] = await Promise.all([
    rcsAgentService.getForOrganization(req.user!.organizationId),
    simplyRcsService.isConfigured(),
  ]);
  res.json({ success: true, data: { agent, providerConfigured: configured } });
}));

router.put('/agent', validate({ body: agentSchema }), asyncHandler(async (req, res) => {
  const agent = await rcsAgentService.saveDraft(req.user!.organizationId, req.body);
  res.json({ success: true, data: agent, message: 'RCS agent saved' });
}));

router.post('/agent/submit', asyncHandler(async (req, res) => {
  await organizationRuntimeService.assertActionAllowed(req.user!.organizationId, 'submit the RCS agent');
  const agent = await rcsAgentService.submit(req.user!.organizationId);
  res.json({ success: true, data: agent, message: 'RCS agent submitted for review' });
}));

router.post('/agent/refresh', asyncHandler(async (req, res) => {
  const agent = await rcsAgentService.refreshStatus(req.user!.organizationId);
  res.json({ success: true, data: agent, message: 'RCS agent status refreshed' });
}));

router.post('/agent/test-devices', validate({ body: z.object({ phoneNumber: phoneSchema }) }), asyncHandler(async (req, res) => {
  const agent = await rcsAgentService.addTestDevice(req.user!.organizationId, req.body.phoneNumber);
  res.json({ success: true, data: agent, message: 'Test device invited' });
}));

router.post('/agent/launch', asyncHandler(async (req, res) => {
  const agent = await rcsAgentService.launch(req.user!.organizationId);
  res.json({ success: true, data: agent, message: 'Launch requested' });
}));

/** GET /rcs/capability?phone=...: can this phone receive RCS from us right now? */
router.get('/capability', validate({ query: z.object({ phone: phoneSchema }) }), asyncHandler(async (req, res) => {
  const result = await messageService.checkRecipientCapability(req.user!.organizationId, String(req.query['phone']));
  res.json({ success: true, data: result });
}));

/** GET /rcs/stats: how traffic split between RCS and SMS fallback in the last 30 days. */
router.get('/stats', asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const organizationId = req.user!.organizationId;
  const rows = await prisma.message.groupBy({
    by: ['deliveryChannel', 'status'],
    where: { organizationId, direction: 'outbound', createdAt: { gte: since } },
    _count: { _all: true },
  });
  const count = (channel: 'rcs' | 'sms' | 'mms' | null, statuses?: string[]) =>
    rows.filter((row) => row.deliveryChannel === channel && (!statuses || statuses.includes(row.status))).reduce((sum, row) => sum + row._count._all, 0);
  const fallbackReasons = await prisma.message.groupBy({
    by: ['fallbackReason'],
    where: { organizationId, direction: 'outbound', createdAt: { gte: since }, fallbackReason: { not: null } },
    _count: { _all: true },
  });
  const capable = await prisma.rcsCapability.count({ where: { organizationId, isRcsCapable: true } });
  const checked = await prisma.rcsCapability.count({ where: { organizationId } });
  res.json({
    success: true,
    data: {
      since: since.toISOString(),
      rcs: { sent: count('rcs'), delivered: count('rcs', ['delivered', 'read']), read: count('rcs', ['read']), failed: count('rcs', ['failed', 'undelivered']) },
      sms: { sent: count('sms') + count('mms'), delivered: count('sms', ['delivered']) + count('mms', ['delivered']), failed: count('sms', ['failed', 'undelivered']) + count('mms', ['failed', 'undelivered']) },
      fallbackReasons: fallbackReasons.map((row) => ({ reason: String(row.fallbackReason).split(':')[0], count: row._count._all })),
      capability: { checked, capable },
    },
  });
}));

export { router as rcsRoutes };
