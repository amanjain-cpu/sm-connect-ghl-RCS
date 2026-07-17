// ===========================================
// Outbound Message Queue
// ===========================================

import { Queue, UnrecoverableError, Worker } from 'bullmq';
import type { JobsOptions } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { platformService } from '../services/platform.service.js';
import { messageService } from '../services/message.service.js';
import { senderRoutingService } from '../services/sender-routing.service.js';
import { platformAdapterRegistry } from '../services/platform-adapter-registry.service.js';
import { toPlatformAdapterConnection } from '../adapters/base.adapter.js';
import { AppError, BadRequestError, NotFoundError } from '../utils/errors.js';
import { deadLetterService } from '../services/dead-letter.service.js';

const OUTBOUND_QUEUE_NAME = 'outbound-platform-messages';

export interface GhlOutboundJobData {
  connectionId: string;
  providerMessageId: string;
  conversationId?: string;
  contactId?: string;
  to?: string;
  from?: string;
  body: string;
  mediaUrls?: string[];
}

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  removeOnComplete: 100,
  removeOnFail: 1000,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
};

export const outboundMessageQueue = new Queue<GhlOutboundJobData>(OUTBOUND_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

let outboundMessageWorker: Worker<GhlOutboundJobData> | null = null;

export async function enqueueGhlOutboundMessage(data: GhlOutboundJobData) {
  const jobId = `crm:${data.connectionId}:${data.providerMessageId}`;

  return outboundMessageQueue.add('platform-outbound', data, {
    jobId,
  });
}

function isTerminalOutboundError(error: unknown): boolean {
  if (error instanceof BadRequestError || error instanceof NotFoundError) {
    return true;
  }

  if (
    error instanceof AppError &&
    [
      'WALLET_FUNDS_REQUIRED',
      'SAVED_PAYMENT_METHOD_REQUIRED',
      'BILLING_SUSPENDED',
      'ORGANIZATION_SUSPENDED',
    ].includes(error.code)
  ) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.toLowerCase();
  return (
    normalizedMessage.includes('opted out') ||
    normalizedMessage.includes('missing sender') ||
    normalizedMessage.includes('destination number') ||
    normalizedMessage.includes('not configured') ||
    normalizedMessage.includes('connection is not connected') ||
    normalizedMessage.includes('authclass type is not allowed to access this scope') ||
    normalizedMessage.includes('location-scoped token required')
  );
}

function isAuthClassScopeMismatchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.toLowerCase();
  return (
    normalizedMessage.includes('authclass type is not allowed to access this scope') ||
    normalizedMessage.includes('location-scoped token required')
  );
}

function getConnectionMetadata(connection: Awaited<ReturnType<typeof platformService.getByIdUnsafe>>) {
  if (
    connection.metadata &&
    typeof connection.metadata === 'object' &&
    !Array.isArray(connection.metadata)
  ) {
    return connection.metadata as Record<string, unknown>;
  }

  return {};
}

async function markConnectionAuthClassError(connectionId: string, error: unknown) {
  const connection = await platformService.getByIdUnsafe(connectionId);
  const existingMetadata = getConnectionMetadata(connection);
  const errorMessage = error instanceof Error ? error.message : 'Platform auth class scope mismatch';

  await platformService.updateConnection(connection.id, {
    status: 'error',
    metadata: {
      ...existingMetadata,
      lastAuthClassScopeErrorAt: new Date().toISOString(),
      lastAuthClassScopeError: errorMessage,
      lastAuthClassScopeStage: 'outbound',
      lastAuthClassScopeMismatch: true,
    },
  });
}

export function startOutboundMessageWorker() {
  if (outboundMessageWorker) {
    return outboundMessageWorker;
  }

  outboundMessageWorker = new Worker<GhlOutboundJobData>(
    OUTBOUND_QUEUE_NAME,
    async (job) => {
      const data = job.data;
      const connection = await platformService.getByIdUnsafe(data.connectionId).catch(async () => null);

      if (!connection) {
        throw new Error(`Platform connection not found for job ${job.id}`);
      }

      if (connection.status !== 'connected') {
        throw new UnrecoverableError(
          `Platform connection is not connected (status=${connection.status})`
        );
      }

      const existingMessage = await messageService.getByPlatformMessageId(
        connection.organizationId,
        connection.id,
        data.providerMessageId
      );

      if (existingMessage?.signalmashMessageId || existingMessage?.status === 'sent' || existingMessage?.status === 'delivered') {
        logger.info({ jobId: job.id, messageId: existingMessage.id }, 'Skipping duplicate outbound send');
        return existingMessage;
      }

      const resolvedFrom = data.from || await senderRoutingService.resolveDefaultSenderForConnection(connection.id);
      const resolvedTo = data.to;

      if (!resolvedTo) {
        throw new Error('Outbound webhook payload did not include a destination number');
      }

      const queuedMessage =
        existingMessage ??
        await messageService.createQueuedPlatformMessage({
          organizationId: connection.organizationId,
          platformConnectionId: connection.id,
          platformMessageId: data.providerMessageId,
          platformConversationId: data.conversationId,
          from: resolvedFrom,
          to: resolvedTo,
          body: data.body,
          mediaUrls: data.mediaUrls,
        });

      let sentMessage;
      try {
        sentMessage = await messageService.dispatchQueuedMessage(queuedMessage.id);
      } catch (error) {
        if (isTerminalOutboundError(error)) {
          throw new UnrecoverableError(
            error instanceof Error ? error.message : 'Outbound send cannot be retried'
          );
        }

        throw error;
      }

      try {
        await platformAdapterRegistry.get('leadconnector').updateMessageStatus?.(
          toPlatformAdapterConnection(connection),
          data.providerMessageId,
          'sent'
        );
      } catch (error) {
        if (isAuthClassScopeMismatchError(error)) {
          await markConnectionAuthClassError(connection.id, error);
          throw new UnrecoverableError(
            error instanceof Error ? error.message : 'Platform auth class scope mismatch'
          );
        }

        throw error;
      }

      return sentMessage;
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
    }
  );

  outboundMessageWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Outbound message job completed');
  });

  outboundMessageWorker.on('failed', async (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        err: error,
      },
      'Outbound message job failed'
    );

    const data = job?.data;
    if (!data) {
      return;
    }

    try {
      const connection = await platformService.getByIdUnsafe(data.connectionId);
      const existingMessage = await messageService.getByPlatformMessageId(
        connection.organizationId,
        connection.id,
        data.providerMessageId
      );

       await deadLetterService.record({
        queueName: OUTBOUND_QUEUE_NAME,
        jobName: job?.name ?? 'platform-outbound',
        jobKey: String(job?.id ?? data.providerMessageId),
        payload: data as unknown as Record<string, unknown>,
        error: error instanceof Error ? error.message : 'Outbound queue failure',
        organizationId: connection.organizationId,
        metadata: {
          platformConnectionId: connection.id,
          attemptsMade: job?.attemptsMade ?? 0,
        },
      });

      if (existingMessage && (isTerminalOutboundError(error) || error instanceof UnrecoverableError)) {
        await messageService.markFailed(existingMessage.id, error instanceof Error ? error.message : 'Outbound send failed');
      }

      if (connection.status !== 'connected') {
        logger.warn(
          { connectionId: connection.id, status: connection.status, jobId: job?.id },
          'Skipping failed status push to platform because connection is not connected'
        );
        return;
      }

      await platformAdapterRegistry.get('leadconnector').updateMessageStatus?.(
        toPlatformAdapterConnection(connection),
        data.providerMessageId,
        'failed'
      );
    } catch (statusError) {
      logger.error({ err: statusError, jobId: job?.id }, 'Failed to push failed status back to the CRM platform');
    }
  });

  return outboundMessageWorker;
}

export async function stopOutboundMessageWorker() {
  if (!outboundMessageWorker) {
    return;
  }

  await outboundMessageWorker.close();
  outboundMessageWorker = null;
}
