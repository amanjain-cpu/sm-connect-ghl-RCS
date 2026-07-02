// ===========================================
// Message Service
// ===========================================

import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { signalmashService } from './signalmash.service.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatPhoneE164 } from '@signalmash-connect/shared';
import type { Message, MessageStatus, MessageDirection, MessageType } from '@prisma/client';
import { integrationService } from './integration.service.js';
import { complianceService } from './compliance.service.js';
import { billingService } from './billing.service.js';
import { subscriptionBillingService } from './subscription-billing.service.js';

interface SendMessageInput {
  organizationId: string;
  platformConnectionId?: string;
  campaignId?: string;
  phoneNumberId?: string;
  platformMessageId?: string;
  platformConversationId?: string;
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
}

interface ListMessagesOptions {
  organizationId: string;
  platformConnectionId?: string;
  campaignId?: string;
  direction?: MessageDirection;
  status?: MessageStatus;
  from?: string;
  to?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export class MessageService {
  private getSignalmashWebhookUrl(): string {
    return `${config.apiUrl}/api/webhooks/signalmash`;
  }

  private async resolveApprovedSenderContext(input: {
    organizationId: string;
    from: string;
    phoneNumberId?: string;
    campaignId?: string;
  }) {
    const formattedFrom = formatPhoneE164(input.from);
    const senderNumber = await prisma.phoneNumber.findFirst({
      where: {
        organizationId: input.organizationId,
        status: 'active',
        ...(input.phoneNumberId ? { id: input.phoneNumberId } : { phoneNumber: formattedFrom }),
      },
      select: {
        id: true,
        phoneNumber: true,
        campaignId: true,
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    if (!senderNumber) {
      throw new BadRequestError(
        input.phoneNumberId
          ? 'Selected sender number is not active for this organization'
          : 'The selected from number is not an active sender for this organization'
      );
    }

    if (input.phoneNumberId && senderNumber.phoneNumber !== formattedFrom) {
      throw new BadRequestError('The selected sender number does not match the from number');
    }

    if (!senderNumber.campaignId || !senderNumber.campaign) {
      throw new BadRequestError('Sender number must be linked to an approved campaign before sending');
    }

    if (senderNumber.campaign.status !== 'approved') {
      throw new BadRequestError('This sender number is linked to a campaign that is not approved yet');
    }

    if (input.campaignId && senderNumber.campaignId !== input.campaignId) {
      throw new BadRequestError('Selected sender number is not linked to the specified campaign');
    }

    return {
      formattedFrom,
      phoneNumberId: senderNumber.id,
      campaignId: senderNumber.campaignId,
    };
  }

  /**
   * Send an outbound message
   */
  async send(input: SendMessageInput): Promise<Message> {
    const {
      organizationId,
      platformConnectionId,
      campaignId,
      phoneNumberId,
      platformMessageId,
      platformConversationId,
      from,
      to,
      body,
      mediaUrls,
    } = input;

    // Format phone numbers
    const formattedTo = formatPhoneE164(to);

    if (await complianceService.isSuppressed(organizationId, formattedTo)) {
      throw new BadRequestError('Recipient has opted out from messaging');
    }

    const senderContext = await this.resolveApprovedSenderContext({
      organizationId,
      from,
      phoneNumberId,
      campaignId,
    });

    await subscriptionBillingService.assertCanSendMessage(
      organizationId,
      mediaUrls && mediaUrls.length > 0 ? 'mms' : 'sms'
    );

    // Create message record (queued status)
    const message = await prisma.message.create({
      data: {
        organizationId,
        platformConnectionId,
        campaignId: senderContext.campaignId,
        phoneNumberId: senderContext.phoneNumberId,
        direction: 'outbound',
        type: mediaUrls && mediaUrls.length > 0 ? 'mms' : 'sms',
        from: senderContext.formattedFrom,
        to: formattedTo,
        body,
        mediaUrls,
        platformMessageId,
        platformConversationId,
        status: 'queued',
      },
    });

    try {
      // Update status to sending
      await prisma.message.update({
        where: { id: message.id },
        data: { status: 'sending' },
      });

      // Send via Signalmash
      const result = await signalmashService.sendMessage({
        from: senderContext.formattedFrom,
        to: formattedTo,
        body,
        mediaUrls,
        webhookUrl: this.getSignalmashWebhookUrl(),
      });

      // Update with Signalmash message ID
      const updatedMessage = await prisma.message.update({
        where: { id: message.id },
        data: {
          signalmashMessageId: result.messageId ?? null,
          status: 'sent',
          sentAt: new Date(),
        },
      });

      logger.info(
        { messageId: message.id, signalmashMessageId: result.messageId },
        'Message sent successfully'
      );

      await billingService.recordMessageAcceptance({
        organizationId,
        messageId: updatedMessage.id,
        direction: 'outbound',
        unit: mediaUrls && mediaUrls.length > 0 ? 'mms' : 'sms',
        source: 'signalmash_acceptance',
        billingKey: `msg:${updatedMessage.id}:outbound`,
      });

      await integrationService.syncMessageMapping(updatedMessage);

      return updatedMessage;
    } catch (error) {
      // Update message as failed
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      logger.error({ messageId: message.id, error }, 'Failed to send message');
      throw error;
    }
  }

  async getByPlatformMessageId(
    organizationId: string,
    platformConnectionId: string,
    platformMessageId: string
  ): Promise<Message | null> {
    return prisma.message.findFirst({
      where: {
        organizationId,
        platformConnectionId,
        platformMessageId,
      },
    });
  }

  async createQueuedPlatformMessage(input: SendMessageInput): Promise<Message> {
    const existing =
      input.platformMessageId && input.platformConnectionId
        ? await this.getByPlatformMessageId(
            input.organizationId,
            input.platformConnectionId,
            input.platformMessageId
          )
        : null;

    if (existing) {
      return existing;
    }

    const formattedFrom = formatPhoneE164(input.from);
    const formattedTo = formatPhoneE164(input.to);

    if (await complianceService.isSuppressed(input.organizationId, formattedTo)) {
      throw new BadRequestError('Recipient has opted out from messaging');
    }

    const senderContext = await this.resolveApprovedSenderContext({
      organizationId: input.organizationId,
      from: input.from,
      phoneNumberId: input.phoneNumberId,
      campaignId: input.campaignId,
    });

    return prisma.message.create({
      data: {
        organizationId: input.organizationId,
        platformConnectionId: input.platformConnectionId,
        campaignId: senderContext.campaignId,
        phoneNumberId: senderContext.phoneNumberId,
        platformMessageId: input.platformMessageId,
        platformConversationId: input.platformConversationId,
        direction: 'outbound',
        type: input.mediaUrls && input.mediaUrls.length > 0 ? 'mms' : 'sms',
        from: formattedFrom,
        to: formattedTo,
        body: input.body,
        mediaUrls: input.mediaUrls,
        status: 'queued',
      },
    });
  }

  async dispatchQueuedMessage(messageId: string): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    if (message.signalmashMessageId && (message.status === 'sent' || message.status === 'delivered')) {
      return message;
    }

    try {
      if (await complianceService.isSuppressed(message.organizationId, message.to)) {
        throw new BadRequestError('Recipient has opted out from messaging');
      }

      const senderContext = await this.resolveApprovedSenderContext({
        organizationId: message.organizationId,
        from: message.from,
        phoneNumberId: message.phoneNumberId ?? undefined,
        campaignId: message.campaignId ?? undefined,
      });

      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: 'sending',
          campaignId: senderContext.campaignId,
          phoneNumberId: senderContext.phoneNumberId,
          from: senderContext.formattedFrom,
        },
      });

      await subscriptionBillingService.assertCanSendMessage(
        message.organizationId,
        message.type === 'mms' ? 'mms' : 'sms'
      );

      const result = await signalmashService.sendMessage({
        from: senderContext.formattedFrom,
        to: message.to,
        body: message.body,
        mediaUrls: Array.isArray(message.mediaUrls) ? message.mediaUrls as string[] : undefined,
        webhookUrl: this.getSignalmashWebhookUrl(),
      });

      const updatedMessage = await prisma.message.update({
        where: { id: message.id },
        data: {
          signalmashMessageId: result.messageId ?? null,
          status: 'sent',
          sentAt: new Date(),
        },
      });

      await billingService.recordMessageAcceptance({
        organizationId: updatedMessage.organizationId,
        messageId: updatedMessage.id,
        direction: 'outbound',
        unit: updatedMessage.type === 'mms' ? 'mms' : 'sms',
        source: 'signalmash_acceptance',
        billingKey: `msg:${updatedMessage.id}:outbound`,
      });

      await integrationService.syncMessageMapping(updatedMessage);

      return updatedMessage;
    } catch (error) {
      await this.markFailed(
        message.id,
        error instanceof Error ? error.message : 'Unknown error'
      );

      throw error;
    }
  }

  async markFailed(messageId: string, errorMessage: string): Promise<Message> {
    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        status: 'failed',
        errorMessage,
      },
    });

    await integrationService.syncMessageMapping(updatedMessage);

    return updatedMessage;
  }

  /**
   * Handle inbound message from Signalmash webhook
   */
  async handleInbound(data: {
    signalmashMessageId: string;
    from: string;
    to: string;
    body: string;
    mediaUrls?: string[];
  }): Promise<Message> {
    const existingMessage = await prisma.message.findFirst({
      where: {
        signalmashMessageId: data.signalmashMessageId,
      },
    });

    if (existingMessage) {
      return existingMessage;
    }

    // Find the phone number to determine organization
    const phoneNumber = await prisma.phoneNumber.findFirst({
      where: {
        phoneNumber: formatPhoneE164(data.to),
        status: 'active',
      },
    });

    if (!phoneNumber) {
      logger.warn({ to: data.to }, 'Received message for unknown phone number');
      throw new NotFoundError('Phone number not found');
    }

    // Create inbound message record
    const message = await prisma.message.create({
      data: {
        organizationId: phoneNumber.organizationId,
        campaignId: phoneNumber.campaignId,
        phoneNumberId: phoneNumber.id,
        direction: 'inbound',
        type: data.mediaUrls && data.mediaUrls.length > 0 ? 'mms' : 'sms',
        from: formatPhoneE164(data.from),
        to: formatPhoneE164(data.to),
        body: data.body,
        mediaUrls: data.mediaUrls,
        signalmashMessageId: data.signalmashMessageId,
        status: 'received',
      },
    });

    logger.info(
      { messageId: message.id, from: data.from, to: data.to },
      'Inbound message received'
    );

    await billingService.recordMessageAcceptance({
      organizationId: message.organizationId,
      messageId: message.id,
      direction: 'inbound',
      unit: data.mediaUrls && data.mediaUrls.length > 0 ? 'mms' : 'sms',
      source: 'signalmash_inbound',
      billingKey: `msg:${message.id}:inbound`,
    });

    await integrationService.syncMessageMapping(message);

    return message;
  }

  /**
   * Handle message status update from Signalmash webhook
   */
  async handleStatusUpdate(
    signalmashMessageId: string,
    status: 'sent' | 'delivered' | 'failed' | 'undelivered',
    errorCode?: string,
    errorMessage?: string,
    correlation?: {
      from?: string;
      to?: string;
      body?: string;
      direction?: string;
    }
  ): Promise<Message | null> {
    let message = await prisma.message.findFirst({
      where: { signalmashMessageId },
    });

    if (!message && correlation) {
      const normalizedFrom = correlation.from ? formatPhoneE164(correlation.from) : undefined;
      const normalizedTo = correlation.to ? formatPhoneE164(correlation.to) : undefined;
      const normalizedDirection =
        correlation.direction?.toLowerCase() === 'inbound' ? 'inbound' : 'outbound';

      const candidates = await prisma.message.findMany({
        where: {
          signalmashMessageId: null,
          direction: normalizedDirection,
          ...(normalizedFrom ? { from: normalizedFrom } : {}),
          ...(normalizedTo ? { to: normalizedTo } : {}),
          ...(correlation.body ? { body: correlation.body } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      const fallbackMatch = candidates[0] ?? null;
      if (fallbackMatch) {
        message = await prisma.message.update({
          where: { id: fallbackMatch.id },
          data: { signalmashMessageId },
        });

        logger.info(
          { messageId: message.id, signalmashMessageId, matchedBy: 'fallback_correlation' },
          'Recovered missing Signalmash message ID from status webhook'
        );
      }
    }

    if (!message) {
      logger.warn({ signalmashMessageId }, 'Received status update for unknown message');
      return null;
    }

    const updateData: Partial<Message> = { status };

    if (status === 'delivered') {
      updateData.deliveredAt = new Date();
    }

    if (status === 'failed' || status === 'undelivered') {
      if (errorCode) {
        updateData.errorCode = errorCode;
      }

      if (errorMessage) {
        updateData.errorMessage = errorMessage;
      }
    } else {
      updateData.errorCode = null;
      updateData.errorMessage = null;
    }

    const updatedMessage = await prisma.message.update({
      where: { id: message.id },
      data: updateData as any,
    });

    logger.info(
      { messageId: message.id, status },
      'Message status updated'
    );

    await integrationService.syncMessageMapping(updatedMessage);

    return updatedMessage;
  }

  /**
   * Get message by ID
   */
  async getById(id: string, organizationId: string): Promise<Message> {
    const message = await prisma.message.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    return message;
  }

  /**
   * List messages with filters
   */
  async list(options: ListMessagesOptions): Promise<{
    messages: Message[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const {
      organizationId,
      platformConnectionId,
      campaignId,
      direction,
      status,
      from,
      to,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = options;

    const where: any = {
      organizationId,
      ...(platformConnectionId && { platformConnectionId }),
      ...(campaignId && { campaignId }),
      ...(direction && { direction }),
      ...(status && { status }),
      ...(from && { from: formatPhoneE164(from) }),
      ...(to && { to: formatPhoneE164(to) }),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate && { gte: startDate }),
              ...(endDate && { lte: endDate }),
            },
          }
        : {}),
    };

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.message.count({ where }),
    ]);

    return {
      messages,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get message statistics
   */
  async getStats(
    organizationId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      campaignId?: string;
    }
  ): Promise<{
    total: number;
    sent: number;
    delivered: number;
    failed: number;
    received: number;
    deliveryRate: number;
  }> {
    const where: any = {
      organizationId,
      ...(options?.campaignId && { campaignId: options.campaignId }),
      ...(options?.startDate || options?.endDate
        ? {
            createdAt: {
              ...(options?.startDate && { gte: options.startDate }),
              ...(options?.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const stats = await prisma.message.groupBy({
      by: ['status', 'direction'],
      where,
      _count: true,
    });

    let total = 0;
    let sent = 0;
    let delivered = 0;
    let failed = 0;
    let received = 0;

    for (const stat of stats) {
      total += stat._count;

      if (stat.direction === 'inbound') {
        received += stat._count;
      } else {
        if (stat.status === 'sent' || stat.status === 'delivered') {
          sent += stat._count;
        }
        if (stat.status === 'delivered') {
          delivered += stat._count;
        }
        if (stat.status === 'failed' || stat.status === 'undelivered') {
          failed += stat._count;
        }
      }
    }

    const deliveryRate = sent > 0 ? (delivered / sent) * 100 : 0;

    return {
      total,
      sent,
      delivered,
      failed,
      received,
      deliveryRate: Math.round(deliveryRate * 100) / 100,
    };
  }
}

export const messageService = new MessageService();
