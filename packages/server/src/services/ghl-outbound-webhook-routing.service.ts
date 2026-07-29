import type { ParsedOutboundMessage } from '@signalmash-connect/shared';

export interface CrmOutboundConnectionSnapshot {
  id: string;
  platformAccountId: string;
}

export interface CrmOutboundQueuePayload {
  connectionId: string;
  providerMessageId: string;
  conversationId?: string;
  contactId?: string;
  to?: string;
  from?: string;
  body: string;
  mediaUrls?: string[];
}

interface EnqueueCrmOutboundWebhookInput {
  parsed: ParsedOutboundMessage;
  contactPhone?: string;
}

interface EnqueueCrmOutboundWebhookDependencies {
  getConnectionByLocation: (locationId: string) => Promise<CrmOutboundConnectionSnapshot | null>;
  enqueueOutboundMessage: (payload: CrmOutboundQueuePayload) => Promise<unknown>;
}

export type EnqueueCrmOutboundWebhookResult =
  | {
      queued: true;
      connectionId: string;
      providerMessageId: string;
    }
  | {
      queued: false;
      warning: 'location_not_configured';
      locationId: string;
      providerMessageId: string;
    };

export async function enqueueCrmOutboundWebhookForExactLocation(
  input: EnqueueCrmOutboundWebhookInput,
  dependencies: EnqueueCrmOutboundWebhookDependencies
): Promise<EnqueueCrmOutboundWebhookResult> {
  const connection = await dependencies.getConnectionByLocation(input.parsed.accountId);

  if (!connection) {
    return {
      queued: false,
      warning: 'location_not_configured',
      locationId: input.parsed.accountId,
      providerMessageId: input.parsed.providerMessageId,
    };
  }

  await dependencies.enqueueOutboundMessage({
    connectionId: connection.id,
    providerMessageId: input.parsed.providerMessageId,
    conversationId: input.parsed.conversationId,
    contactId: input.parsed.contactId,
    to: input.contactPhone || input.parsed.to,
    from: input.parsed.from,
    body: input.parsed.body,
    mediaUrls: input.parsed.mediaUrls,
  });

  return {
    queued: true,
    connectionId: connection.id,
    providerMessageId: input.parsed.providerMessageId,
  };
}
