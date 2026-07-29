import type { Message, SuppressionAction } from '@prisma/client';
import { prisma } from '../config/database.js';
import { toPlatformAdapterConnection } from '../adapters/base.adapter.js';
import { logger } from '../utils/logger.js';
import { integrationService } from './integration.service.js';
import { platformAdapterRegistry } from './platform-adapter-registry.service.js';
import { platformService } from './platform.service.js';

export class InboundMessageSyncService {
  async syncToPlatform(
    message: Message,
    options?: {
      mediaUrls?: string[];
      complianceAction?: SuppressionAction;
    }
  ) {
    if (message.heldForPayment || !message.visible) {
      logger.info(
        { messageId: message.id, organizationId: message.organizationId },
        'Skipping CRM sync for inbound message held for wallet funding'
      );
      return null;
    }

    if (message.platformConnectionId && message.platformMessageId) {
      logger.info(
        { messageId: message.id, platformMessageId: message.platformMessageId },
        'Skipping CRM sync for inbound message already synced to platform'
      );
      return message;
    }

    const connections = await platformService.getByOrganization(
      message.organizationId,
      'leadconnector'
    );

    const connection = connections.find((item) => item.status === 'connected');
    if (!connection) {
      throw new Error('No active platform connection for inbound message');
    }

    let contact = await platformAdapterRegistry.get('leadconnector').getContactByPhone?.(
      toPlatformAdapterConnection(connection),
      message.from
    );

    if (!contact) {
      const createdContact = await platformAdapterRegistry.get('leadconnector').createContact?.(
        toPlatformAdapterConnection(connection),
        { phone: message.from }
      );

      if (!createdContact) {
        throw new Error('Failed to create contact for inbound message');
      }

      contact = { id: createdContact.id };
    }

    const conversationId = await platformAdapterRegistry.get('leadconnector').getOrCreateConversation?.(
      toPlatformAdapterConnection(connection),
      contact.id
    );

    if (!conversationId) {
      throw new Error('Failed to resolve conversation for inbound message');
    }

    if (options?.complianceAction && contact.id) {
      try {
        await platformAdapterRegistry.get('leadconnector').updateContactPreferences?.(
          toPlatformAdapterConnection(connection),
          contact.id,
          {
            dnd: options.complianceAction === 'opt_out',
          }
        );
      } catch (error) {
        logger.warn({ err: error, contactId: contact.id }, 'Failed to sync contact DND state to the CRM platform');
      }
    }

    const mediaUrls =
      options?.mediaUrls ??
      (Array.isArray(message.mediaUrls) ? message.mediaUrls as string[] : undefined);

    const inboundResult = await platformAdapterRegistry.get('leadconnector').addInboundMessage?.(
      toPlatformAdapterConnection(connection),
      {
        externalMessageId: message.signalmashMessageId ?? message.id,
        from: message.from,
        to: message.to,
        body: message.body,
        mediaUrls,
        occurredAt: message.createdAt,
        contactId: contact.id,
        conversationId,
      }
    );

    const updatedMessage = await prisma.message.update({
      where: { id: message.id },
      data: {
        platformConnectionId: connection.id,
        platformConversationId: conversationId,
        platformMessageId: inboundResult?.externalMessageId ?? message.platformMessageId,
      },
    });

    await integrationService.syncMessageMapping(updatedMessage);

    return updatedMessage;
  }
}

export const inboundMessageSyncService = new InboundMessageSyncService();
