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
import { walletBillingService } from './wallet-billing.service.js';
import { evaluateInstallationSenderPolicy } from './message-installation-routing.service.js';
import { simplyRcsService, type RcsContent } from './simplyrcs.service.js';
import { rcsAgentService } from './rcs-agent.service.js';
import { decideChannel, sendWithFallback, type RoutingPorts, type SendPorts, type SendOutcome , type RouteDecision } from './rcs-routing.service.js';

interface SendMessageInput {
  organizationId: string;
  platformConnectionId?: string;
  installationId?: string | null;
  campaignId?: string;
  phoneNumberId?: string;
  platformMessageId?: string;
  platformConversationId?: string;
  /** Sender number. Optional when the recipient can receive RCS: the message then goes out from the RCS agent. */
  from?: string;
  to: string;
  body: string;
  mediaUrls?: string[];
  /** Rich RCS content (card, carousel, media, suggestions) composed in this app. Ignored on SMS. */
  rcsContent?: RcsContent | null;
  /** Set false to force SMS for this message. */
  preferRcs?: boolean;
  messageType?: 'MARKETING' | 'TRANSACTIONAL' | 'SERVICE';
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

  // ---------------------------------------------------------------------------------
  // RCS-first routing. The decision and the send are pure functions in
  // rcs-routing.service.ts; these ports connect them to the database and the providers.
  // ---------------------------------------------------------------------------------

  private routingPorts(): RoutingPorts {
    return {
      getLiveAgent: (organizationId, recipient) => rcsAgentService.getLiveAgent(organizationId, recipient),
      getCachedCapability: async (organizationId, phone) => {
        const row = await prisma.rcsCapability.findUnique({ where: { organizationId_phoneNumber: { organizationId, phoneNumber: phone } } });
        return row ? { isRcsCapable: row.isRcsCapable, rcsContactId: row.rcsContactId, checkedAt: row.checkedAt } : null;
      },
      checkCapability: async (phone) => {
        const contact = await simplyRcsService.ensureContact(phone);
        const check = await simplyRcsService.checkCapability(contact.id);
        return { isRcsCapable: check.isRcsCapable, contactId: contact.id, provider: check.provider };
      },
      saveCapability: async (organizationId, phone, record) => {
        await prisma.rcsCapability.upsert({
          where: { organizationId_phoneNumber: { organizationId, phoneNumber: phone } },
          create: { organizationId, phoneNumber: phone, isRcsCapable: record.isRcsCapable, rcsContactId: record.rcsContactId, provider: record.provider ?? null },
          update: { isRcsCapable: record.isRcsCapable, rcsContactId: record.rcsContactId, provider: record.provider ?? null, checkedAt: new Date() },
        });
      },
    };
  }

  private sendPorts(): SendPorts {
    return {
      sendRcs: (input) => simplyRcsService.sendMessage({
        senderIdId: input.senderIdId,
        to: input.contactId ? undefined : input.to,
        contactId: input.contactId ?? undefined,
        messageType: input.messageType,
        content: input.content,
        idempotencyKey: input.idempotencyKey,
      }),
      sendSms: (input) => signalmashService.sendMessage({
        from: input.from,
        to: input.to,
        body: input.body,
        mediaUrls: input.mediaUrls,
        webhookUrl: this.getSignalmashWebhookUrl(),
      }),
    };
  }

  /** Column values for a message after it was handed to a provider. */
  private sentUpdate(outcome: SendOutcome) {
    if (outcome.channel === 'rcs') {
      return {
        type: 'rcs' as const,
        deliveryChannel: 'rcs' as const,
        rcsMessageId: outcome.rcsMessageId,
        rcsConversationId: outcome.rcsConversationId,
        fallbackReason: null,
        status: 'sent' as const,
        sentAt: new Date(),
      };
    }
    return {
      type: outcome.channel,
      deliveryChannel: outcome.channel,
      signalmashMessageId: outcome.signalmashMessageId,
      fallbackReason: outcome.fallbackReason ? `${outcome.fallbackReason}${outcome.detail ? `: ${outcome.detail.slice(0, 300)}` : ''}` : null,
      status: 'sent' as const,
      sentAt: new Date(),
    };
  }

  /** Check whether a phone can receive RCS from this organization (used by the UI). */
  async checkRecipientCapability(organizationId: string, phone: string) {
    const ports = this.routingPorts();
    const decision = await decideChannel(ports, { organizationId, to: formatPhoneE164(phone) });
    const cached = await ports.getCachedCapability(organizationId, formatPhoneE164(phone));
    return { channel: decision.channel, reason: decision.channel === 'sms' ? decision.reason : null, isRcsCapable: cached?.isRcsCapable ?? null, checkedAt: cached?.checkedAt ?? null };
  }

  private async resolveMessagePlatformContext(input: {
    organizationId: string;
    platformConnectionId?: string | null;
    installationId?: string | null;
  }): Promise<{
    platformConnectionId?: string;
    installationId?: string | null;
  }> {
    if (input.installationId) {
      const installation = await prisma.platformInstallation.findFirst({
        where: {
          id: input.installationId,
          organizationId: input.organizationId,
          platform: 'leadconnector',
        },
        select: {
          id: true,
          externalAccountId: true,
          status: true,
        },
      });

      if (!installation || installation.status !== 'connected') {
        throw new BadRequestError(
          'This connected CRM workspace is not active. Reconnect this workspace before sending.'
        );
      }

      if (input.platformConnectionId) {
        const requestedConnection = await prisma.platformConnection.findFirst({
          where: {
            id: input.platformConnectionId,
            organizationId: input.organizationId,
            platform: 'leadconnector',
            status: 'connected',
          },
          select: {
            id: true,
            installationId: true,
            platformAccountId: true,
          },
        });

        if (
          !requestedConnection ||
          (
            requestedConnection.installationId !== installation.id &&
            requestedConnection.platformAccountId !== installation.externalAccountId
          )
        ) {
          throw new BadRequestError(
            'The selected CRM connection does not match the active embedded workspace.'
          );
        }

        if (requestedConnection.installationId !== installation.id) {
          await prisma.platformConnection.update({
            where: { id: requestedConnection.id },
            data: { installationId: installation.id },
          });
        }

        return {
          platformConnectionId: requestedConnection.id,
          installationId: installation.id,
        };
      }

      const connection = await prisma.platformConnection.findFirst({
        where: {
          organizationId: input.organizationId,
          platform: 'leadconnector',
          status: 'connected',
          OR: [
            { installationId: installation.id },
            { platformAccountId: installation.externalAccountId },
          ],
        },
        orderBy: [
          { updatedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          installationId: true,
        },
      });

      if (!connection) {
        throw new BadRequestError(
          'This CRM workspace does not have a connected sender connection. Reconnect this workspace before sending.'
        );
      }

      if (connection.installationId !== installation.id) {
        await prisma.platformConnection.update({
          where: { id: connection.id },
          data: { installationId: installation.id },
        });
      }

      return {
        platformConnectionId: connection.id,
        installationId: installation.id,
      };
    }

    if (!input.platformConnectionId) {
      return {};
    }

    const connection = await prisma.platformConnection.findFirst({
      where: {
        id: input.platformConnectionId,
        organizationId: input.organizationId,
      },
    });

    if (!connection) {
      throw new BadRequestError('Platform connection not found for this organization');
    }

    if (connection.platform !== 'leadconnector') {
      return {
        platformConnectionId: connection.id,
        installationId: null,
      };
    }

    if (connection.status !== 'connected') {
      throw new BadRequestError(
        'The CRM connection for this message is not active. Reconnect this workspace before sending.'
      );
    }

    if (connection.installationId) {
      return {
        platformConnectionId: connection.id,
        installationId: connection.installationId,
      };
    }

    let installation = await prisma.platformInstallation.findFirst({
      where: {
        organizationId: input.organizationId,
        platform: 'leadconnector',
        externalAccountId: connection.platformAccountId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!installation || installation.status !== 'connected') {
      const syncedInstallation = await integrationService.syncInstallationFromConnection(connection);
      installation = {
        id: syncedInstallation.id,
        status: syncedInstallation.status,
      };
    }

    if (installation.status !== 'connected') {
      throw new BadRequestError(
        'The CRM installation for this message is not active. Reconnect this workspace before sending.'
      );
    }

    await prisma.platformConnection.update({
      where: { id: connection.id },
      data: { installationId: installation.id },
    });

    return {
      platformConnectionId: connection.id,
      installationId: installation.id,
    };
  }

  private async resolveApprovedSenderContext(input: {
    organizationId: string;
    from: string;
    phoneNumberId?: string;
    campaignId?: string;
    installationId?: string | null;
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

    if (input.installationId) {
      const senderProfiles = await prisma.senderProfile.findMany({
        where: {
          organizationId: input.organizationId,
          platform: 'leadconnector',
          installationId: input.installationId,
        },
        select: {
          id: true,
          phoneNumberId: true,
          senderKey: true,
          phoneNumber: {
            select: {
              status: true,
            },
          },
        },
      });

      const senderPolicy = evaluateInstallationSenderPolicy({
        installationId: input.installationId,
        selectedPhoneNumberId: senderNumber.id,
        selectedSenderKey: senderNumber.phoneNumber,
        senderProfiles: senderProfiles.map((profile) => ({
          id: profile.id,
          phoneNumberId: profile.phoneNumberId,
          senderKey: profile.senderKey,
          phoneNumberActive: profile.phoneNumber
            ? profile.phoneNumber.status === 'active'
            : undefined,
        })),
      });

      if (!senderPolicy.allowed) {
        throw new BadRequestError(senderPolicy.message);
      }
    }

    return {
      formattedFrom,
      phoneNumberId: senderNumber.id,
      campaignId: senderNumber.campaignId,
    };
  }

  /**
   * Sender for this message. SMS needs an active 10DLC number on an approved campaign. RCS goes
   * out from the organization's agent, so it works before any number exists; such a message
   * cannot fall back to SMS.
   */
  private async resolveSenderContext(input: {
    organizationId: string;
    from?: string | null;
    phoneNumberId?: string;
    campaignId?: string;
    installationId?: string | null;
    decision: RouteDecision;
  }): Promise<{ formattedFrom: string; phoneNumberId: string | null; campaignId: string | null; smsFallbackAvailable: boolean }> {
    const from = input.from?.trim() ?? '';
    const hasNumber = from.length > 0 && !from.startsWith('rcs:');
    if (hasNumber) {
      try {
        const context = await this.resolveApprovedSenderContext({
          organizationId: input.organizationId,
          from,
          phoneNumberId: input.phoneNumberId,
          campaignId: input.campaignId,
          installationId: input.installationId,
        });
        return { ...context, smsFallbackAvailable: true };
      } catch (error) {
        if (input.decision.channel !== 'rcs') throw error;
      }
    } else if (input.decision.channel !== 'rcs') {
      const reason = input.decision.channel === 'sms' ? input.decision.reason : null;
      throw new BadRequestError(
        reason
          ? `This recipient gets SMS (${reason.replace(/_/g, ' ')}), which needs an active sender number on an approved campaign.`
          : 'Choose an active sender number.'
      );
    }
    const agent = await rcsAgentService.getForOrganization(input.organizationId);
    if (!agent) throw new BadRequestError('No RCS agent is set up for this organization.');
    return { formattedFrom: `rcs:${agent.senderName}`, phoneNumberId: null, campaignId: null, smsFallbackAvailable: false };
  }

  /**
   * Send an outbound message
   */
  async send(input: SendMessageInput): Promise<Message> {
    const {
      organizationId,
      platformConnectionId,
      installationId,
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

    const platformContext = await this.resolveMessagePlatformContext({
      organizationId,
      platformConnectionId,
      installationId,
    });

    const decision = await decideChannel(this.routingPorts(), { organizationId, to: formattedTo, rcsEnabled: input.preferRcs !== false });

    const senderContext = await this.resolveSenderContext({
      organizationId,
      from,
      phoneNumberId,
      campaignId,
      installationId: platformContext.installationId,
      decision,
    });

    const billingEstimate = await walletBillingService.assertCanSendMessage({
      organizationId,
      body,
      mediaUrls,
      channel: decision.channel === 'rcs' ? 'rcs' : undefined,
    });

    // Create message record (queued status)
    const message = await prisma.message.create({
      data: {
        organizationId,
        platformConnectionId: platformContext.platformConnectionId,
        campaignId: senderContext.campaignId,
        phoneNumberId: senderContext.phoneNumberId,
        direction: 'outbound',
        type: decision.channel === 'rcs' ? 'rcs' : mediaUrls && mediaUrls.length > 0 ? 'mms' : 'sms',
        from: senderContext.formattedFrom,
        to: formattedTo,
        body,
        mediaUrls,
        rcsContent: (input.rcsContent ?? undefined) as any,
        billingEstimate: billingEstimate as any,
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

      // RCS first when possible, Signalmash SMS otherwise or on a definite RCS rejection
      const outcome = await sendWithFallback(this.sendPorts(), {
        decision,
        from: senderContext.formattedFrom,
        to: formattedTo,
        body,
        mediaUrls,
        rcsContent: input.rcsContent ?? null,
        idempotencyKey: `msg:${message.id}`,
        messageType: input.messageType,
        smsFallbackAvailable: senderContext.smsFallbackAvailable,
      });

      // A fallback changes what is billed
      const finalEstimate = outcome.channel === (decision.channel === 'rcs' ? 'rcs' : billingEstimate.unit)
        ? billingEstimate
        : await walletBillingService.estimateForChannel({ organizationId, body, mediaUrls, channel: outcome.channel });

      const updatedMessage = await prisma.message.update({
        where: { id: message.id },
        data: { ...this.sentUpdate(outcome), billingEstimate: finalEstimate as any },
      });

      logger.info(
        { messageId: message.id, channel: outcome.channel, fallbackReason: outcome.fallbackReason },
        'Message sent successfully'
      );

      await walletBillingService.recordOutboundMessageDebit(updatedMessage);

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

    if (!input.from) {
      throw new BadRequestError('A sender number is required for queued messages');
    }
    const formattedFrom = formatPhoneE164(input.from);
    const formattedTo = formatPhoneE164(input.to);

    if (await complianceService.isSuppressed(input.organizationId, formattedTo)) {
      throw new BadRequestError('Recipient has opted out from messaging');
    }

    const platformContext = await this.resolveMessagePlatformContext({
      organizationId: input.organizationId,
      platformConnectionId: input.platformConnectionId,
      installationId: input.installationId,
    });

    const senderContext = await this.resolveApprovedSenderContext({
      organizationId: input.organizationId,
      from: formattedFrom,
      phoneNumberId: input.phoneNumberId,
      campaignId: input.campaignId,
      installationId: platformContext.installationId,
    });

    return prisma.message.create({
      data: {
        organizationId: input.organizationId,
        platformConnectionId: platformContext.platformConnectionId,
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

    if ((message.signalmashMessageId || message.rcsMessageId) && (message.status === 'sent' || message.status === 'delivered' || message.status === 'read')) {
      return message;
    }

    try {
      if (await complianceService.isSuppressed(message.organizationId, message.to)) {
        throw new BadRequestError('Recipient has opted out from messaging');
      }

      const platformContext = await this.resolveMessagePlatformContext({
        organizationId: message.organizationId,
        platformConnectionId: message.platformConnectionId,
      });

      const mediaUrls = Array.isArray(message.mediaUrls) ? message.mediaUrls as string[] : undefined;
      const decision = await decideChannel(this.routingPorts(), { organizationId: message.organizationId, to: message.to });

      const senderContext = await this.resolveSenderContext({
        organizationId: message.organizationId,
        from: message.from,
        phoneNumberId: message.phoneNumberId ?? undefined,
        campaignId: message.campaignId ?? undefined,
        installationId: platformContext.installationId,
        decision,
      });

      const billingEstimate = await walletBillingService.assertCanSendMessage({
        organizationId: message.organizationId,
        body: message.body,
        mediaUrls,
        channel: decision.channel === 'rcs' ? 'rcs' : undefined,
      });

      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: 'sending',
          campaignId: senderContext.campaignId,
          phoneNumberId: senderContext.phoneNumberId,
          from: senderContext.formattedFrom,
          billingEstimate: billingEstimate as any,
        },
      });

      const outcome = await sendWithFallback(this.sendPorts(), {
        decision,
        from: senderContext.formattedFrom,
        to: message.to,
        body: message.body,
        mediaUrls,
        rcsContent: (message.rcsContent as RcsContent | null) ?? null,
        idempotencyKey: `msg:${message.id}`,
        smsFallbackAvailable: senderContext.smsFallbackAvailable,
      });

      const finalEstimate = outcome.channel === (decision.channel === 'rcs' ? 'rcs' : billingEstimate.unit)
        ? billingEstimate
        : await walletBillingService.estimateForChannel({ organizationId: message.organizationId, body: message.body, mediaUrls, channel: outcome.channel });

      const updatedMessage = await prisma.message.update({
        where: { id: message.id },
        data: { ...this.sentUpdate(outcome), billingEstimate: finalEstimate as any },
      });

      await walletBillingService.recordOutboundMessageDebit(updatedMessage);

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

    await walletBillingService.recordInboundMessageBilling(message);

    return prisma.message.findUniqueOrThrow({
      where: { id: message.id },
    });
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
   * Inbound RCS message or button tap from a SimplyRCS webhook. The organization is the one whose
   * agent received it; the row is shaped like an SMS inbound so the CRM sync and keyword handling
   * (STOP/START/HELP) work unchanged.
   */
  async handleRcsInbound(data: {
    rcsMessageId: string;
    rcsConversationId?: string | null;
    senderIdId?: string | null;
    organizationId?: string | null;
    from: string;
    body: string;
    mediaUrls?: string[];
  }): Promise<Message> {
    const existing = await prisma.message.findFirst({ where: { rcsMessageId: data.rcsMessageId } });
    if (existing) return existing;

    let agent = data.senderIdId ? await rcsAgentService.findBySenderIdId(data.senderIdId) : null;
    if (!agent && data.organizationId) agent = await rcsAgentService.getForOrganization(data.organizationId);
    if (!agent && data.rcsConversationId) {
      const previous = await prisma.message.findFirst({ where: { rcsConversationId: data.rcsConversationId }, orderBy: { createdAt: 'desc' } });
      if (previous) agent = await rcsAgentService.getForOrganization(previous.organizationId);
    }
    if (!agent) {
      logger.warn({ senderIdId: data.senderIdId, rcsMessageId: data.rcsMessageId }, 'Received RCS message for unknown agent');
      throw new NotFoundError('RCS agent not found');
    }

    // The reply is addressed to the agent; use the default sender number as "to" so conversation
    // grouping in the CRM lines up with the SMS side of the same customer.
    const defaultNumber = await prisma.phoneNumber.findFirst({ where: { organizationId: agent.organizationId, status: 'active' }, orderBy: { createdAt: 'asc' } });
    const message = await prisma.message.create({
      data: {
        organizationId: agent.organizationId,
        phoneNumberId: defaultNumber?.id ?? null,
        campaignId: defaultNumber?.campaignId ?? null,
        direction: 'inbound',
        type: 'rcs',
        deliveryChannel: 'rcs',
        from: formatPhoneE164(data.from),
        to: defaultNumber?.phoneNumber ?? `rcs:${agent.senderName}`,
        body: data.body,
        mediaUrls: data.mediaUrls,
        rcsMessageId: data.rcsMessageId,
        rcsConversationId: data.rcsConversationId ?? null,
        status: 'received',
      },
    });

    logger.info({ messageId: message.id, from: data.from, agent: agent.senderName }, 'Inbound RCS message received');
    await walletBillingService.recordInboundMessageBilling(message);
    return prisma.message.findUniqueOrThrow({ where: { id: message.id } });
  }

  /** Delivery state of an RCS message from a SimplyRCS webhook. */
  async handleRcsStatusUpdate(
    rcsMessageId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    errorCode?: string,
    errorMessage?: string
  ): Promise<Message | null> {
    const message = await prisma.message.findFirst({ where: { rcsMessageId } });
    if (!message) {
      logger.warn({ rcsMessageId }, 'Received RCS status update for unknown message');
      return null;
    }
    // Never move a message backwards (a late "delivered" after "read").
    const order: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5, undelivered: 5 };
    if ((order[message.status] ?? 0) > (order[status] ?? 0) && status !== 'failed') return message;

    const updated = await prisma.message.update({
      where: { id: message.id },
      data: {
        status,
        deliveredAt: status === 'delivered' || status === 'read' ? message.deliveredAt ?? new Date() : message.deliveredAt,
        readAt: status === 'read' ? new Date() : message.readAt,
        errorCode: status === 'failed' ? errorCode ?? null : null,
        errorMessage: status === 'failed' ? errorMessage ?? null : null,
      },
    });
    await integrationService.syncMessageMapping(updated);
    return updated;
  }

  /**
   * Get message by ID
   */
  async getById(id: string, organizationId: string): Promise<Message> {
    const message = await prisma.message.findFirst({
      where: {
        id,
        organizationId,
        visible: true,
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
      visible: true,
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
      visible: true,
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
