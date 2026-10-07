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
const allowedAssetFiles = new Set([
  'signalmash-support-widget.iife.js',
  'widget.css',
]);

const sessionSchema = z.object({
  page: z.string().max(200).optional(),
  appStep: z.string().max(80).optional(),
  fieldFocus: z.string().max(80).optional(),
  onboardingStatus: z.string().max(80).optional(),
});

router.get(
  '/assets/:file',
  asyncHandler(async (req, res) => {
    if (!config.supportAgentWidgetUrl) {
      throw new BadRequestError('Support agent widget is not configured');
    }

    const file = req.params.file;
    if (!allowedAssetFiles.has(file)) {
      return res.status(404).json({ success: false, error: { message: 'Asset not found' } });
    }

    const response = await fetch(`${trimSlash(config.supportAgentWidgetUrl)}/${file}`);
    if (!response.ok) {
      throw new BadRequestError('Support agent asset could not be loaded');
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.type(contentType);
    }

    const body = Buffer.from(await response.arrayBuffer());
    res.send(body);
  })
);

router.all(
  '/proxy/api/:target(chat|faq|feedback)',
  asyncHandler(async (req, res) => {
    if (!config.supportAgentApiUrl) {
      throw new BadRequestError('Support agent API is not configured');
    }

    const authorization = req.headers.authorization;
    if (!authorization) {
      return res.status(401).json({ error: 'Missing support-agent token' });
    }

    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const response = await fetch(`${trimSlash(config.supportAgentApiUrl)}/api/${req.params.target}${query}`, {
      method: req.method,
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body ?? {}),
    });

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.type(contentType);
    }

    res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  })
);

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
        apiBaseUrl: '/api/support-agent/proxy',
        widgetAssetBaseUrl: '/api/support-agent/assets',
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
