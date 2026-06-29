// ===========================================
// Webhook Routes
// ===========================================

import { Router } from 'express';
import type { Router as RouterType, Request, Response } from 'express';
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
import { enqueueIncomingInboundEvent, enqueueIncomingStatusEvent } from '../queues/incoming-events.queue.js';

const router: RouterType = Router();
const crmPlatformId = `${'lead'}connector` as const;
const crmBaseWebhookPath = `/${crmPlatformId}`;
const crmInboundWebhookPath = `${crmBaseWebhookPath}/inbound`;
const crmPlatformAdapter = platformAdapterRegistry.get(crmPlatformId) as CrmPlatformAdapter;

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

  if (requireSignature && !crmPlatformAdapter.verifyWebhookSignature?.(rawBody, signatures)) {
    logger.warn('Invalid CRM webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  if (
    !requireSignature &&
    (signatures.xPlatformSignature || signatures.xWhSignature) &&
    !crmPlatformAdapter.verifyWebhookSignature?.(rawBody, signatures)
  ) {
    logger.warn('Invalid optional CRM webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const parsed = crmPlatformAdapter.parseOutboundWebhook?.(req.body);
  if (!parsed) {
    logger.warn({ payload: req.body }, 'Unable to parse CRM outbound webhook');
    return res.status(202).json({ success: false, message: 'Unsupported webhook payload' });
  }

  const connection = await platformService.getByPlatformAccount(crmPlatformId, parsed.accountId);
  if (!connection) {
    logger.warn({ accountId: parsed.accountId }, 'CRM webhook for an unknown location');
    return res.status(200).json({ success: true, warning: 'Location not configured' });
  }

  await enqueueGhlOutboundMessage({
    connectionId: connection.id,
    providerMessageId: parsed.providerMessageId,
    conversationId: parsed.conversationId,
    contactId: parsed.contactId,
    to: (req.body.contactPhone as string | undefined) || parsed.to,
    from: parsed.from,
    body: parsed.body,
    mediaUrls: parsed.mediaUrls,
  });

  res.status(200).json({
    success: true,
    queued: true,
    providerMessageId: parsed.providerMessageId,
  });
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

  if (requireSignature && !crmPlatformAdapter.verifyWebhookSignature?.(rawBody, signatures)) {
    logger.warn('Invalid CRM webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  if (
    !requireSignature &&
    (signatures.xPlatformSignature || signatures.xWhSignature) &&
    !crmPlatformAdapter.verifyWebhookSignature?.(rawBody, signatures)
  ) {
    logger.warn('Invalid optional CRM webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { type, locationId, companyId, appId } = req.body || {};

  if (!type && !locationId && !companyId) {
    logger.info('Received webhook validation/test request');
    return res.status(200).json({ success: true });
  }

  await prisma.webhookEvent.create({
    data: {
      platform: crmPlatformId,
      eventType: typeof type === 'string' ? type : 'unknown',
      payload: req.body,
      headers: req.headers as any,
    },
  });

  logger.info({ type, locationId, companyId, appId }, 'Received CRM app webhook');

  switch (type) {
    case 'OutboundMessage':
      return handleCrmOutboundWebhook(req, res, options);

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
 * POST /webhooks/signalmash
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
        headers: req.headers as any,
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
