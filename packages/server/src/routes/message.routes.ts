// ===========================================
// Message Routes
// ===========================================

import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { messageService } from '../services/message.service.js';
import { validate, idParamSchema, phoneSchema, paginationSchema } from '../middleware/validation.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { organizationRuntimeService } from '../services/organization-runtime.service.js';

const router: RouterType = Router();

// Validation schemas
const sendMessageSchema = z.object({
  campaignId: z.string().uuid().optional(),
  phoneNumberId: z.string().uuid().optional(),
  from: phoneSchema,
  to: phoneSchema,
  body: z.string().min(1, 'Message body is required').max(1600),
  mediaUrls: z.array(z.string().url()).max(10).optional(),
});

const listMessagesQuerySchema = paginationSchema.extend({
  platformConnectionId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  status: z
    .enum(['queued', 'sending', 'sent', 'delivered', 'failed', 'undelivered', 'received'])
    .optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

const statsQuerySchema = z.object({
  campaignId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

/**
 * GET /messages
 * List messages with filters
 */
router.get(
  '/',
  authenticate,
  validate({ query: listMessagesQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await messageService.list({
      organizationId: req.user!.organizationId,
      platformConnectionId: req.query.platformConnectionId as string | undefined,
      campaignId: req.query.campaignId as string | undefined,
      direction: req.query.direction as any,
      status: req.query.status as any,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      startDate: req.query.startDate as Date | undefined,
      endDate: req.query.endDate as Date | undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
    });

    res.json({
      success: true,
      data: result.messages,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  })
);

/**
 * POST /messages
 * Send a new message
 */
router.post(
  '/',
  authenticate,
  validate({ body: sendMessageSchema }),
  asyncHandler(async (req, res) => {
    await organizationRuntimeService.assertActionAllowed(
      req.user!.organizationId,
      'send messages'
    );
    const message = await messageService.send({
      organizationId: req.user!.organizationId,
      ...req.body,
    });

    res.status(201).json({
      success: true,
      data: message,
    });
  })
);

/**
 * GET /messages/stats
 * Get message statistics
 */
router.get(
  '/stats',
  authenticate,
  validate({ query: statsQuerySchema }),
  asyncHandler(async (req, res) => {
    const stats = await messageService.getStats(req.user!.organizationId, {
      campaignId: req.query.campaignId as string | undefined,
      startDate: req.query.startDate as Date | undefined,
      endDate: req.query.endDate as Date | undefined,
    });

    res.json({
      success: true,
      data: stats,
    });
  })
);

/**
 * GET /messages/:id
 * Get message details
 */
router.get(
  '/:id',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const message = await messageService.getById(
      req.params.id,
      req.user!.organizationId
    );

    res.json({
      success: true,
      data: message,
    });
  })
);

export { router as messageRoutes };
