// ===========================================
// Webhook Routes
// ===========================================

import crypto from 'node:crypto';
import { Router } from 'express';
import type { Router as RouterType, Request, Response } from 'express';
import { config } from '../config/index.js';
import { prisma } from '../config/database.js';
import { messageService } from '../services/message.service.js';
import { brandService } from '../services/brand.service.js';
import { campaignService } from '../services/campaign.service.js';
import { platformService } from '../services/platform.service.js';
import { platformAdapterRegistry } from '../services/platform-adapter-registry.service.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import type { CrmPlatformAdapter } from '../adapters/crm-platform.adapter.js';
import { enqueueGhlOutboundMessage } from '../queues/outbound-message.queue.js';
import { enqueueIncomingInboundEvent, enqueueIncomingStatusEvent, enqueueRcsInboundEvent, enqueueRcsStatusEvent } from '../queues/incoming-events.queue.js';
import { simplyRcsService, verifySimplyRcsSignature } from '../services/simplyrcs.service.js';
import { normalizeSimplyRcsWebhook } from '../services/simplyrcs-webhook.service.js';
import { enqueueCrmOutboundWebhookForExactLocation } from '../services/ghl-outbound-webhook-routing.service.js';

const router: RouterType = Router();
const crmPlatformId = `${'lead'}connector` as const;
const crmBaseWebhookPath = `/${crmPlatformId}`;
const crmInboundWebhookPath = `${crmBaseWebhookPath}/inbound`;
const crmPlatformAdapter = platformAdapterRegistry.get(crmPlatformId) as CrmPlatformAdapter;
const crmSharedSecretHeaderNames = [
  'x-ghl-webhook-secret',
  'x-crm-webhook-secret',
  'x-signalmash-webhook-secret',
  'x-webhook-secret',
] as const;
const unsignedCrmAppWebhookEventTypes = new Set(['INSTALL']);

interface CrmWebhookSignatures {
  xPlatformSignature?: string;
  xWhSignature?: string;
}

interface CrmWebhookAuthResult {
  authenticated: boolean;
  rejectResponse?: {
    status: number;
    body: { error: string };
  };
}

type NormalizedSignalmashEvent =
  | {
      type: 'message.inbound';
      data: {
        message_id: string;
        from: string;
        to: string;
        body: string;
        media_urls?: string[];
      };
    }
  | {
      type: 'message.status';
      data: {
        message_id: string;
        status: 'sent' | 'delivered' | 'failed' | 'undelivered';
        error_code?: string;
        error_message?: string;
        from?: string;
        to?: string;
        body?: string;
        direction?: string;
      };
    }
  | {
      type: 'brand.status' | 'campaign.status';
      data: Record<string, unknown>;
    }
  | {
      type: string;
      data: Record<string, unknown>;
    };

function normalizeSignalmashStatus(rawStatus: unknown, rawNetworkDesc: unknown) {
  const normalized = String(rawNetworkDesc ?? rawStatus ?? '')
    .trim()
    .toUpperCase();

  if (['DELIVRD', 'DELIVERED'].includes(normalized)) {
    return 'delivered' as const;
  }

  if (['UNDELIV', 'UNDELIVERED'].includes(normalized)) {
    return 'undelivered' as const;
  }

  if (['FAILED', 'FAILURE', 'REJECTED', 'EXPIRED'].includes(normalized)) {
    return 'failed' as const;
  }

  return 'sent' as const;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function pickSmsEnablementCampaignId(...values: unknown[]) {
  for (const value of values) {
    const candidate = pickString(value);
    if (candidate && /^C[A-Za-z0-9]{6}$/.test(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function pickNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function pickHeader(headers: Request['headers'], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.find((entry) => entry.trim().length > 0)?.trim();
  }

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function safeCompareSecret(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return candidateBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function verifyCrmSharedSecret(req: Request): boolean {
  if (!config.ghlWebhookSecret) {
    return false;
  }

  const providedSecret = crmSharedSecretHeaderNames
    .map((headerName) => pickHeader(req.headers, headerName))
    .find(Boolean);

  return providedSecret ? safeCompareSecret(providedSecret, config.ghlWebhookSecret) : false;
}

function hasCrmWebhookSignature(signatures: CrmWebhookSignatures): boolean {
  return Boolean(signatures.xPlatformSignature || signatures.xWhSignature);
}

function authenticateCrmWebhook(
  req: Request,
  rawBody: string,
  signatures: CrmWebhookSignatures,
  requireSignature: boolean
): CrmWebhookAuthResult {
  const hasSignature = hasCrmWebhookSignature(signatures);
  const hasValidSignature = hasSignature &&
    Boolean(crmPlatformAdapter.verifyWebhookSignature?.(rawBody, signatures));

  if (requireSignature && !hasValidSignature) {
    logger.warn('Invalid CRM webhook signature');
    return {
      authenticated: false,
      rejectResponse: { status: 401, body: { error: 'Invalid signature' } },
    };
  }

  if (!requireSignature && hasSignature && !hasValidSignature) {
    logger.warn('Invalid optional CRM webhook signature');
    return {
      authenticated: false,
      rejectResponse: { status: 401, body: { error: 'Invalid signature' } },
    };
  }

  return {
    authenticated: hasValidSignature || verifyCrmSharedSecret(req),
  };
}

function redactWebhookHeaders(headers: Request['headers']) {
  const sensitiveHeaders = new Set<string>([
    'authorization',
    'cookie',
    'x-api-key',
    ...crmSharedSecretHeaderNames,
  ]);
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      sensitiveHeaders.has(key.toLowerCase()) ? '[redacted]' : value,
    ])
  );
}

function isUnsignedCrmAppWebhookEventAllowed(type: unknown): boolean {
  return typeof type === 'string' && unsignedCrmAppWebhookEventTypes.has(type);
}

function normalizeSignalmashWebhookPayload(payload: unknown): NormalizedSignalmashEvent {
  const body = (payload ?? {}) as Record<string, unknown>;
  const type = typeof body.type === 'string' ? body.type : null;
  const data =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? body.data as Record<string, unknown>
      : null;

  if (type && data) {
    return { type, data };
  }

  const origin = typeof body.origin === 'string' ? body.origin.toUpperCase() : '';
  const messageSid =
    typeof body.MessageSid === 'string'
      ? body.MessageSid
      : typeof body.messageSid === 'string'
        ? body.messageSid
        : typeof body.message_id === 'string'
          ? body.message_id
          : typeof body.idmdr === 'number' || typeof body.idmdr === 'string'
            ? String(body.idmdr)
            : '';

  if (origin === 'SMS_MO' && typeof body.from === 'string' && typeof body.to === 'string' && typeof body.message === 'string') {
    return {
      type: 'message.inbound',
      data: {
        message_id: messageSid || `sm-inbound-${body.from}-${body.to}-${Date.now()}`,
        from: body.from,
        to: body.to,
        body: body.message,
      },
    };
  }

  if (messageSid) {
    return {
      type: 'message.status',
      data: {
        message_id: messageSid,
        status: normalizeSignalmashStatus(body.Status ?? body.status, body.Network_Desc ?? body.network_desc),
        error_code:
          typeof body.Network_Code === 'string'
            ? body.Network_Code
            : typeof body.error_code === 'string'
              ? body.error_code
              : undefined,
        error_message:
          typeof body.Network_Desc === 'string'
            ? body.Network_Desc
            : typeof body.error_message === 'string'
              ? body.error_message
              : undefined,
        from:
          typeof body.From === 'string'
            ? body.From
            : typeof body.from === 'string'
              ? body.from
              : undefined,
        to:
          typeof body.To === 'string'
            ? body.To
            : typeof body.to === 'string'
              ? body.to
              : undefined,
        body:
          typeof body.Message === 'string'
            ? body.Message
            : typeof body.message === 'string'
              ? body.message
              : undefined,
        direction:
          typeof body.Direction === 'string'
            ? body.Direction
            : typeof body.direction === 'string'
              ? body.direction
              : undefined,
      },
    };
  }

  const nestedBrand = asRecord(body.brand);
  const nestedCampaign = asRecord(body.campaign);
  const brandId = pickString(
    body.brand_id,
    body.brandId,
    nestedBrand?.brand_id,
    nestedBrand?.brandId,
    data?.brand_id,
    data?.brandId
  );
  const campaignId = pickString(
    body.sm_reference_no,
    body.campaign_key,
    nestedCampaign?.sm_reference_no,
    nestedCampaign?.campaign_key,
    data?.sm_reference_no,
    data?.campaign_key,
    body.campaign_id,
    body.campaignId,
    nestedCampaign?.campaign_id,
    nestedCampaign?.campaignId,
    data?.campaign_id,
    data?.campaignId
  );

  if (brandId) {
    const brandStatus = pickString(
      body.identityStatus,
      body.identity_status,
      body.status,
      nestedBrand?.identityStatus,
      nestedBrand?.identity_status,
      nestedBrand?.status,
      data?.identityStatus,
      data?.identity_status,
      data?.status
    );

    if (brandStatus) {
      return {
        type: 'brand.status',
        data: {
          brand_id: brandId,
          status: brandStatus,
          verification_score: pickNumber(
            body.verification_score,
            body.verificationScore,
            nestedBrand?.verification_score,
            nestedBrand?.verificationScore,
            data?.verification_score,
            data?.verificationScore
          ),
          rejection_reason: pickString(
            body.rejection_reason,
            body.rejectionReason,
            nestedBrand?.rejection_reason,
            nestedBrand?.rejectionReason,
            data?.rejection_reason,
            data?.rejectionReason
          ),
          tcr_brand_id: pickString(
            body.tcr_brand_id,
            body.tcrBrandId,
            nestedBrand?.tcr_brand_id,
            nestedBrand?.tcrBrandId,
            data?.tcr_brand_id,
            data?.tcrBrandId
          ),
        },
      };
    }
  }

  if (campaignId) {
    const campaignStatus = pickString(
      body.campaignStatus,
      body.campaign_status,
      body.approvalStatus,
      body.approval_status,
      body.status,
      nestedCampaign?.campaignStatus,
      nestedCampaign?.campaign_status,
      nestedCampaign?.approvalStatus,
      nestedCampaign?.approval_status,
      nestedCampaign?.status,
      data?.campaignStatus,
      data?.campaign_status,
      data?.approvalStatus,
      data?.approval_status,
      data?.status
    );

    if (campaignStatus) {
      return {
        type: 'campaign.status',
        data: {
          campaign_id: campaignId,
          status: campaignStatus,
          rejection_reason: pickString(
            body.rejection_reason,
            body.rejectionReason,
            nestedCampaign?.rejection_reason,
            nestedCampaign?.rejectionReason,
            data?.rejection_reason,
            data?.rejectionReason
          ),
          daily_message_limit: pickNumber(
            body.daily_message_limit,
            body.dailyMessageLimit,
            nestedCampaign?.daily_message_limit,
            nestedCampaign?.dailyMessageLimit,
            data?.daily_message_limit,
            data?.dailyMessageLimit
          ),
          messages_per_second: pickNumber(
            body.messages_per_second,
            body.messagesPerSecond,
            nestedCampaign?.messages_per_second,
            nestedCampaign?.messagesPerSecond,
            data?.messages_per_second,
            data?.messagesPerSecond
          ),
          tcr_campaign_id: pickSmsEnablementCampaignId(
            body.tcr_campaign_id,
            body.tcrCampaignId,
            nestedCampaign?.tcr_campaign_id,
            nestedCampaign?.tcrCampaignId,
            data?.tcr_campaign_id,
            data?.tcrCampaignId,
            body.signalmashCampaignId,
            nestedCampaign?.signalmashCampaignId,
            data?.signalmashCampaignId,
            body.campaign_id,
            body.campaignId,
            nestedCampaign?.campaign_id,
            nestedCampaign?.campaignId,
            data?.campaign_id,
            data?.campaignId
          ),
        },
      };
    }
  }

  return {
    type: type ?? 'unknown',
    data: body,
  };
}

async function handleCrmOutboundWebhook(req: Request, res: Response, options?: { requireSignature?: boolean }) {
  const rawBody = req.rawBody ?? JSON.stringify(req.body);
  const signatures = {
    xPlatformSignature: req.headers['x-ghl-signature'] as string | undefined,
    xWhSignature: req.headers['x-wh-signature'] as string | undefined,
  };
  const requireSignature = options?.requireSignature ?? true;
  const authResult = authenticateCrmWebhook(req, rawBody, signatures, requireSignature);

  if (authResult.rejectResponse) {
    return res.status(authResult.rejectResponse.status).json(authResult.rejectResponse.body);
  }

  if (!authResult.authenticated) {
    logger.warn('Rejected unsigned CRM outbound webhook');
    return res.status(401).json({ error: 'Webhook authentication required' });
  }

  const parsed = crmPlatformAdapter.parseOutboundWebhook?.(req.body);
  if (!parsed) {
    logger.warn({ payload: req.body }, 'Unable to parse CRM outbound webhook');
    return res.status(202).json({ success: false, message: 'Unsupported webhook payload' });
  }

  const enqueueResult = await enqueueCrmOutboundWebhookForExactLocation(
    {
      parsed,
      contactPhone: req.body.contactPhone as string | undefined,
    },
    {
      getConnectionByLocation: (locationId) =>
        platformService.getByPlatformAccount(crmPlatformId, locationId),
      enqueueOutboundMessage: enqueueGhlOutboundMessage,
    }
  );

  if (!enqueueResult.queued) {
    logger.warn(
      {
        locationId: enqueueResult.locationId,
        providerMessageId: enqueueResult.providerMessageId,
      },
      'CRM outbound webhook for an unknown location; reconnect this CRM workspace before sending native SMS'
    );
    return res.status(200).json({ success: true, warning: 'Location not configured' });
  }

  res.status(200).json({
    success: true,
    queued: true,
    providerMessageId: enqueueResult.providerMessageId,
  });
}

function isCrmOutboundPayload(payload: unknown): boolean {
  const data = payload as Record<string, unknown> | null;
  const type = data?.type;

  return type === 'OutboundMessage' || type === 'SMS' || Boolean(crmPlatformAdapter.parseOutboundWebhook?.(payload));
}

export async function handleCrmAppWebhook(
  req: Request,
  res: Response,
  options?: { requireSignature?: boolean }
) {
  const rawBody = req.rawBody ?? JSON.stringify(req.body);
  const signatures = {
    xPlatformSignature: req.headers['x-ghl-signature'] as string | undefined,
    xWhSignature: req.headers['x-wh-signature'] as string | undefined,
  };
  const requireSignature = options?.requireSignature ?? true;
  const authResult = authenticateCrmWebhook(req, rawBody, signatures, requireSignature);

  if (authResult.rejectResponse) {
    return res.status(authResult.rejectResponse.status).json(authResult.rejectResponse.body);
  }

  const { type, locationId, companyId, appId } = req.body || {};

  if (!type && !locationId && !companyId) {
    logger.info('Received webhook validation/test request');
    return res.status(200).json({ success: true });
  }

  if (isCrmOutboundPayload(req.body) && !authResult.authenticated) {
    logger.warn({ type, locationId }, 'Rejected unsigned CRM outbound webhook');
    return res.status(401).json({ error: 'Webhook authentication required' });
  }

  if (type === 'UNINSTALL' && !authResult.authenticated) {
    logger.warn({ locationId, companyId, appId }, 'Rejected unsigned CRM uninstall webhook');
    return res.status(401).json({ error: 'Webhook authentication required' });
  }

  if (!authResult.authenticated && !isUnsignedCrmAppWebhookEventAllowed(type)) {
    logger.warn({ type, locationId, companyId }, 'Ignored unsigned CRM app webhook type');
    return res.status(202).json({
      success: false,
      message: 'Unsigned webhook type ignored',
    });
  }

  await prisma.webhookEvent.create({
    data: {
      platform: crmPlatformId,
      eventType: typeof type === 'string' ? type : 'unknown',
      payload: req.body,
      headers: redactWebhookHeaders(req.headers) as any,
    },
  });

  logger.info({ type, locationId, companyId, appId }, 'Received CRM app webhook');

  if (isCrmOutboundPayload(req.body)) {
    return handleCrmOutboundWebhook(req, res, options);
  }

  switch (type) {
    case 'INSTALL': {
      const result = await platformService.handleLeadconnectorInstall({
        locationId: typeof locationId === 'string' ? locationId : undefined,
        companyId: typeof companyId === 'string' ? companyId : undefined,
        appId: typeof appId === 'string' ? appId : undefined,
        payload: req.body,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    }

    case 'UNINSTALL': {
      const result = await platformService.handleLeadconnectorUninstall({
        locationId: typeof locationId === 'string' ? locationId : undefined,
        companyId: typeof companyId === 'string' ? companyId : undefined,
        appId: typeof appId === 'string' ? appId : undefined,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    }

    default:
      logger.info({ type }, 'Unhandled CRM webhook type');
      return res.status(200).json({ success: true });
  }
}

/**
 * POST /api/webhooks/signalmash
 * Handle Signalmash webhooks (inbound messages, status updates, brand/campaign status)
 */
router.post(
  '/signalmash',
  asyncHandler(async (req: Request, res: Response) => {
    const normalizedEvent = normalizeSignalmashWebhookPayload(req.body);
    const { type, data } = normalizedEvent;

    // Log webhook for debugging
    await prisma.webhookEvent.create({
      data: {
        platform: crmPlatformId, // Reuse the CRM platform enum slot for billing and messaging events
        eventType: type,
        payload: req.body,
        headers: redactWebhookHeaders(req.headers) as any,
      },
    });

    logger.info({ type }, 'Received Signalmash webhook');

    switch (type) {
      case 'message.inbound': {
        const inboundData = data as Extract<NormalizedSignalmashEvent, { type: 'message.inbound' }>['data'];
        await enqueueIncomingInboundEvent({
          signalmashMessageId: inboundData.message_id,
          from: inboundData.from,
          to: inboundData.to,
          body: inboundData.body,
          mediaUrls: inboundData.media_urls,
        });
        break;
      }

      case 'message.status': {
        const statusData = data as Extract<NormalizedSignalmashEvent, { type: 'message.status' }>['data'];
        await enqueueIncomingStatusEvent({
          signalmashMessageId: statusData.message_id,
          status: statusData.status,
          errorCode: statusData.error_code,
          errorMessage: statusData.error_message,
          from: statusData.from,
          to: statusData.to,
          body: statusData.body,
          direction: statusData.direction,
        });
        break;
      }

      case 'brand.status': {
        const brandData = data as Record<string, any>;
        await brandService.handleVerificationResult(
          brandData.brand_id,
          brandData.status,
          brandData.verification_score,
          brandData.rejection_reason,
          brandData.tcr_brand_id
        );
        break;
      }

      case 'campaign.status': {
        const campaignData = data as Record<string, any>;
        await campaignService.handleApprovalResult(
          campaignData.campaign_id,
          campaignData.status,
          campaignData.rejection_reason,
          {
            dailyMessageLimit: campaignData.daily_message_limit,
            messagesPerSecond: campaignData.messages_per_second,
          },
          campaignData.tcr_campaign_id
        );
        break;
      }

      default:
        logger.warn({ type }, 'Unknown Signalmash webhook type');
    }

    // Mark webhook as processed
    await prisma.webhookEvent.updateMany({
      where: {
        eventType: type,
        processed: false,
      },
      data: {
        processed: true,
        processedAt: new Date(),
      },
    });

    res.json({ success: true });
  })
);

/**
 * SimplyRCS webhooks: inbound RCS messages, button taps, and delivery states.
 * Signed with HMAC-SHA256 over the raw body (X-Signature); the secret is the one SimplyRCS
 * returned when the endpoint was registered, stored in runtime settings.
 */
router.post(
  '/simplyrcs',
  asyncHandler(async (req: Request, res: Response) => {
    const { webhookSecret } = await simplyRcsService.getConfig();
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const signature = req.get('x-signature') ?? req.get('x-simplyrcs-signature');
    if (webhookSecret) {
      if (!verifySimplyRcsSignature(rawBody, signature, webhookSecret)) {
        logger.warn({ hasSignature: Boolean(signature) }, 'Rejected SimplyRCS webhook with a bad signature');
        res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } });
        return;
      }
    } else if (config.nodeEnv === 'production') {
      res.status(503).json({ success: false, error: { code: 'WEBHOOK_SECRET_MISSING', message: 'SimplyRCS webhook secret is not configured' } });
      return;
    } else {
      logger.warn('Accepting an unsigned SimplyRCS webhook because no secret is configured (non-production only)');
    }

    const events = normalizeSimplyRcsWebhook(req.body);
    await prisma.webhookEvent.create({
      data: {
        platform: crmPlatformId,
        eventType: `simplyrcs.${String((req.body as { event?: string })?.event ?? 'unknown')}`,
        payload: req.body,
        headers: redactWebhookHeaders(req.headers) as any,
      },
    });

    for (const event of events) {
      if (event.type === 'inbound') {
        await enqueueRcsInboundEvent(event.data);
      } else if (event.type === 'status') {
        await enqueueRcsStatusEvent(event.data);
      }
    }

    res.json({ success: true, accepted: events.length });
  })
);

/**
 * Webhook URL validation endpoint for the CRM marketplace
 */
router.get(crmBaseWebhookPath, (req: Request, res: Response) => {
  res.status(200).json({ success: true, message: 'Webhook endpoint is active' });
});

/**
 * GET /webhooks/crm
 * Webhook URL validation endpoint for the CRM marketplace (alternative path)
 */
router.get('/crm', (req: Request, res: Response) => {
  res.status(200).json({ success: true });
});

/**
 * GET /webhooks/incoming
 * Generic webhook validation endpoint
 */
router.get('/incoming', (req: Request, res: Response) => {
  res.status(200).json({ success: true });
});

/**
 * POST /webhooks/incoming
 * Generic webhook handler for the CRM marketplace
 */
router.post('/incoming', (req: Request, res: Response) => {
  // Always return success for validation and test requests
  res.status(200).json({ success: true });
});

/**
 * POST /webhooks/crm
 * Handle CRM webhooks for outbound messaging
 * Alternative path that avoids platform-specific naming
 */
router.post(
  '/crm',
  asyncHandler(async (req: Request, res: Response) => {
    return handleCrmAppWebhook(req, res, { requireSignature: false });
  })
);

/**
 * Handle CRM webhooks for outbound messaging
 */
router.post(
  crmBaseWebhookPath,
  asyncHandler(async (req: Request, res: Response) => {
    return handleCrmAppWebhook(req, res, { requireSignature: true });
  })
);

/**
 * Handle inbound messages from Signalmash and forward them to the CRM platform
 * This is called by our internal message handler
 */
router.post(
  crmInboundWebhookPath,
  asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, from, to, body, mediaUrls } = req.body;

    // Find the CRM platform connection for this organization.
    const connections = await platformService.getByOrganization(organizationId, crmPlatformId);

    if (connections.length === 0) {
      logger.warn({ organizationId }, 'No platform connection for inbound message');
      return res.status(404).json({ error: 'No platform connection' });
    }

    const connection = connections[0]!;

    try {
      // Find or create the CRM contact.
      let contact = await crmPlatformAdapter.getContactByPhone?.(connection, from);

      if (!contact) {
        const newContact = await crmPlatformAdapter.createContact?.(connection, {
          phone: from,
        });
        if (!newContact) {
          throw new Error('Failed to create contact');
        }
        contact = { id: newContact.id };
      }

      // Get or create conversation
      const conversationId = await crmPlatformAdapter.getOrCreateConversation?.(
        connection,
        contact.id
      );

      if (!conversationId) {
        throw new Error('Failed to resolve conversation');
      }

      // Add the inbound message to the CRM conversation.
      await crmPlatformAdapter.addInboundMessage?.(connection, {
        externalMessageId: req.body.messageId ?? `${organizationId}:${Date.now()}`,
        body,
        from,
        to,
        mediaUrls,
        occurredAt: new Date(),
        contactId: contact.id,
        conversationId,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error({ error, organizationId, from }, 'Failed to forward inbound message to the CRM platform');
      res.status(500).json({ error: 'Failed to forward message' });
    }
  })
);

export { router as webhookRoutes };
