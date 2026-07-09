import crypto from 'node:crypto';
import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validation.js';
import { BadRequestError } from '../utils/errors.js';

const router: RouterType = Router();

const sessionSchema = z.object({
  page: z.string().max(200).optional(),
  appStep: z.string().max(80).optional(),
  fieldFocus: z.string().max(80).optional(),
  onboardingStatus: z.string().max(80).optional(),
});

router.use(authenticate);

router.post(
  '/session',
  validate({ body: sessionSchema }),
  asyncHandler(async (req, res) => {
    if (!config.supportAgentApiUrl || !config.supportAgentWidgetUrl || !config.supportAgentAdminApiKey) {
      throw new BadRequestError('Support agent is not configured');
    }

    const response = await fetch(`${trimSlash(config.supportAgentApiUrl)}/api/embed/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-api-key': config.supportAgentAdminApiKey,
      },
      body: JSON.stringify({
        projectId: 'sm-connect',
        mode: 'support',
        tenantId: hashIdentifier(req.user!.organizationId),
        userId: hashIdentifier(req.user!.id),
        page: req.body.page ?? '/help',
        appStep: req.body.appStep,
        fieldFocus: req.body.fieldFocus,
        onboardingStatus: req.body.onboardingStatus,
        ttlSeconds: 900,
      }),
    });

    if (!response.ok) {
      throw new BadRequestError('Support agent session could not be created');
    }

    const data = await response.json() as { token: string; expiresAt: string };

    res.json({
      success: true,
      data: {
        apiBaseUrl: trimSlash(config.supportAgentApiUrl),
        widgetAssetBaseUrl: trimSlash(config.supportAgentWidgetUrl),
        token: data.token,
        expiresAt: data.expiresAt,
      },
    });
  })
);

function hashIdentifier(value: string): string {
  return crypto
    .createHmac('sha256', config.jwtSecret)
    .update(value)
    .digest('hex')
    .slice(0, 32);
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export { router as supportAgentRoutes };
