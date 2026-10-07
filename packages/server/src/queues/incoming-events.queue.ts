// ===========================================
// Incoming Events Queue
// ===========================================

import { Queue, UnrecoverableError, Worker } from 'bullmq';
import type { JobsOptions } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { messageService } from '../services/message.service.js';
import { platformService } from '../services/platform.service.js';
import { complianceService } from '../services/compliance.service.js';
import { deadLetterService } from '../services/dead-letter.service.js';
import { inboundMessageSyncService } from '../services/inbound-message-sync.service.js';
import { platformAdapterRegistry } from '../services/platform-adapter-registry.service.js';
import { toPlatformAdapterConnection } from '../adapters/base.adapter.js';

const INCOMING_QUEUE_NAME = 'incoming-platform-events';

type IncomingInboundJobData = {
  kind: 'signalmash-inbound';
  signalmashMessageId: string;
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
};

type IncomingStatusJobData = {
  kind: 'signalmash-status';
  signalmashMessageId: string;
  status: 'sent' | 'delivered' | 'failed' | 'undelivered';
  errorCode?: string;
  errorMessage?: string;
  from?: string;
  to?: string;
  body?: string;
  direction?: string;
};

type RcsInboundJobData = {
  kind: 'rcs-inbound';
  rcsMessageId: string;
  rcsConversationId?: string | null;
  senderIdId?: string | null;
  organizationId?: string | null;
  from: string;
  body: string;
  mediaUrls?: string[];
};

type RcsStatusJobData = {
  kind: 'rcs-status';
  rcsMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode?: string;
  errorMessage?: string;
};

type IncomingEventJobData = IncomingInboundJobData | IncomingStatusJobData | RcsInboundJobData | RcsStatusJobData;

type IncomingEnqueueOptions = {
  jobId?: string;
};

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  removeOnComplete: 100,
  removeOnFail: 1000,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
};

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

async function resolveOrganizationIdFromJobData(data: IncomingEventJobData): Promise<string | undefined> {
  if (data.kind === 'rcs-inbound' && data.organizationId) return data.organizationId;
  const message = await prisma.message.findFirst({
    where: data.kind === 'rcs-inbound' || data.kind === 'rcs-status'
      ? { rcsMessageId: data.rcsMessageId }
      : { signalmashMessageId: data.signalmashMessageId },
    select: {
      organizationId: true,
    },
  });

  return message?.organizationId;
}

async function markConnectionAuthClassError(
  connectionId: string,
  stage: 'inbound' | 'status',
  error: unknown
) {
  const connection = await platformService.getByIdUnsafe(connectionId);
  const existingMetadata = getConnectionMetadata(connection);
  const errorMessage = error instanceof Error ? error.message : 'Platform auth class scope mismatch';

  await platformService.updateConnection(connection.id, {
    status: 'error',
    metadata: {
      ...existingMetadata,
      lastAuthClassScopeErrorAt: new Date().toISOString(),
      lastAuthClassScopeError: errorMessage,
      lastAuthClassScopeStage: stage,
      lastAuthClassScopeMismatch: true,
    },
  });
}

export const incomingEventsQueue = new Queue<IncomingEventJobData>(INCOMING_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions,
});

let incomingEventsWorker: Worker<IncomingEventJobData> | null = null;

export async function enqueueIncomingInboundEvent(
  data: Omit<IncomingInboundJobData, 'kind'>,
  options?: IncomingEnqueueOptions
) {
  return incomingEventsQueue.add(
    'signalmash-inbound',
    { kind: 'signalmash-inbound', ...data },
    { jobId: options?.jobId ?? `sm-inbound-${data.signalmashMessageId}` }
  );
}

export async function enqueueIncomingStatusEvent(
  data: Omit<IncomingStatusJobData, 'kind'>,
  options?: IncomingEnqueueOptions
) {
  return incomingEventsQueue.add(
    'signalmash-status',
    { kind: 'signalmash-status', ...data },
    { jobId: options?.jobId ?? `sm-status-${data.signalmashMessageId}-${data.status}` }
  );
}

export async function enqueueRcsInboundEvent(data: Omit<RcsInboundJobData, 'kind'>) {
  return incomingEventsQueue.add('rcs-inbound', { kind: 'rcs-inbound', ...data }, { jobId: `rcs-inbound-${data.rcsMessageId}` });
}

export async function enqueueRcsStatusEvent(data: Omit<RcsStatusJobData, 'kind'>) {
  return incomingEventsQueue.add('rcs-status', { kind: 'rcs-status', ...data }, { jobId: `rcs-status-${data.rcsMessageId}-${data.status}` });
}

/** Pushes an inbound message into the CRM, parking it in the dead-letter queue when no connection is live. */
async function syncInboundToCrm(
  job: { name: string; data: IncomingEventJobData },
  message: Awaited<ReturnType<typeof messageService.handleInbound>>,
  options: { mediaUrls?: string[]; complianceAction?: Parameters<typeof inboundMessageSyncService.syncToPlatform>[1] extends infer O ? (O extends { complianceAction?: infer A } ? A : never) : never; externalId: string }
) {
  try {
    await inboundMessageSyncService.syncToPlatform(message, { mediaUrls: options.mediaUrls, complianceAction: options.complianceAction });
  } catch (error) {
    if (error instanceof Error && error.message === 'No active platform connection for inbound message') {
      logger.warn({ organizationId: message.organizationId, externalId: options.externalId }, 'No active platform connection for inbound message');
      await deadLetterService.record({
        queueName: INCOMING_QUEUE_NAME,
        jobName: job.name,
        jobKey: `deferred-${options.externalId}`,
        payload: job.data as unknown as Record<string, unknown>,
        error: 'No active platform connection for inbound message',
        organizationId: message.organizationId,
        metadata: { reason: 'connection_unavailable', deferredAt: new Date().toISOString() },
      });
      return;
    }
    if (isAuthClassScopeMismatchError(error)) {
      const connections = await platformService.getByOrganization(message.organizationId, 'leadconnector');
      const connection = connections.find((item) => item.status === 'connected');
      if (connection) await markConnectionAuthClassError(connection.id, 'inbound', error);
      throw new UnrecoverableError(error instanceof Error ? error.message : 'Platform auth class scope mismatch');
    }
    throw error;
  }
}

export function startIncomingEventsWorker() {
  if (incomingEventsWorker) {
    return incomingEventsWorker;
  }

  incomingEventsWorker = new Worker<IncomingEventJobData>(
    INCOMING_QUEUE_NAME,
    async (job) => {
      if (job.data.kind === 'rcs-inbound') {
        const message = await messageService.handleRcsInbound({
          rcsMessageId: job.data.rcsMessageId,
          rcsConversationId: job.data.rcsConversationId,
          senderIdId: job.data.senderIdId,
          organizationId: job.data.organizationId,
          from: job.data.from,
          body: job.data.body,
          mediaUrls: job.data.mediaUrls,
        });
        const complianceEvent = await complianceService.handleInboundKeyword({
          organizationId: message.organizationId,
          from: message.from,
          body: message.body,
        });
        if (message.heldForPayment || !message.visible) {
          logger.info({ messageId: message.id, organizationId: message.organizationId }, 'Inbound RCS message stored and held from CRM sync pending wallet funding');
          return message;
        }
        await syncInboundToCrm(job, message, { mediaUrls: job.data.mediaUrls, complianceAction: complianceEvent?.action, externalId: job.data.rcsMessageId });
        return message;
      }

      if (job.data.kind === 'rcs-status') {
        const message = await messageService.handleRcsStatusUpdate(job.data.rcsMessageId, job.data.status, job.data.errorCode, job.data.errorMessage);
        if (!message) throw new UnrecoverableError(`RCS message ${job.data.rcsMessageId} not found`);
        if (message.platformConnectionId && message.platformMessageId) {
          const connection = await platformService.getByIdUnsafe(message.platformConnectionId);
          if (connection.status !== 'connected') return message;
          try {
            await platformAdapterRegistry.get('leadconnector').updateMessageStatus?.(toPlatformAdapterConnection(connection), message.platformMessageId, message.status);
          } catch (error) {
            if (isAuthClassScopeMismatchError(error)) {
              await markConnectionAuthClassError(connection.id, 'status', error);
              throw new UnrecoverableError(error instanceof Error ? error.message : 'Platform auth class scope mismatch');
            }
            throw error;
          }
        }
        return message;
      }

      if (job.data.kind === 'signalmash-inbound') {
        const message = await messageService.handleInbound({
          signalmashMessageId: job.data.signalmashMessageId,
          from: job.data.from,
          to: job.data.to,
          body: job.data.body,
          mediaUrls: job.data.mediaUrls,
        });

        const complianceEvent = await complianceService.handleInboundKeyword({
          organizationId: message.organizationId,
          from: message.from,
          body: message.body,
        });

        if (message.heldForPayment || !message.visible) {
          logger.info(
            {
              messageId: message.id,
              organizationId: message.organizationId,
              signalmashMessageId: job.data.signalmashMessageId,
            },
            'Inbound message stored and held from CRM sync pending wallet funding'
          );

          return message;
        }

        try {
          await inboundMessageSyncService.syncToPlatform(message, {
            mediaUrls: job.data.mediaUrls,
            complianceAction: complianceEvent?.action,
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'No active platform connection for inbound message') {
            logger.warn(
              {
                organizationId: message.organizationId,
                signalmashMessageId: job.data.signalmashMessageId,
              },
              'No active platform connection for inbound message'
            );

            await deadLetterService.record({
              queueName: INCOMING_QUEUE_NAME,
              jobName: job.name,
              jobKey: `deferred-${job.data.signalmashMessageId}`,
              payload: job.data as unknown as Record<string, unknown>,
              error: 'No active platform connection for inbound message',
              organizationId: message.organizationId,
              metadata: {
                reason: 'connection_unavailable',
                deferredAt: new Date().toISOString(),
              },
            });

            return message;
          }

          if (isAuthClassScopeMismatchError(error)) {
            const connections = await platformService.getByOrganization(
              message.organizationId,
              'leadconnector'
            );
            const connection = connections.find((item) => item.status === 'connected');
            if (connection) {
              await markConnectionAuthClassError(connection.id, 'inbound', error);
            }
            throw new UnrecoverableError(
              error instanceof Error ? error.message : 'Platform auth class scope mismatch'
            );
          }

          throw error;
        }

        return message;
      }

      if (job.data.kind === 'signalmash-status') {
        const message = await messageService.handleStatusUpdate(
          job.data.signalmashMessageId,
          job.data.status,
          job.data.errorCode,
          job.data.errorMessage,
          {
            from: job.data.from,
            to: job.data.to,
            body: job.data.body,
            direction: job.data.direction,
          }
        );

        if (!message) {
          throw new UnrecoverableError(`Message ${job.data.signalmashMessageId} not found`);
        }

        if (message.platformConnectionId && message.platformMessageId) {
          const connection = await platformService.getByIdUnsafe(message.platformConnectionId);

          if (connection.status !== 'connected') {
            logger.warn(
              {
                connectionId: connection.id,
                status: connection.status,
                signalmashMessageId: job.data.signalmashMessageId,
              },
              'Skipping platform status sync because connection is not connected'
            );
            return message;
          }

          try {
            await platformAdapterRegistry.get('leadconnector').updateMessageStatus?.(
              toPlatformAdapterConnection(connection),
              message.platformMessageId,
              message.status
            );
          } catch (error) {
            if (isAuthClassScopeMismatchError(error)) {
              await markConnectionAuthClassError(connection.id, 'status', error);
              throw new UnrecoverableError(
                error instanceof Error ? error.message : 'Platform auth class scope mismatch'
              );
            }

            throw error;
          }
        }

        return message;
      }

      throw new UnrecoverableError(`Unsupported incoming job kind ${(job.data as any).kind}`);
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
    }
  );

  incomingEventsWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Incoming event job completed');
  });

  incomingEventsWorker.on('failed', async (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        err: error,
      },
      'Incoming event job failed'
    );

    const data = job?.data;
    if (!data) {
      return;
    }

    const organizationId = await resolveOrganizationIdFromJobData(data);
    const terminal =
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? defaultJobOptions.attempts ?? 1);

    if (!terminal) {
      return;
    }

    await deadLetterService.record({
      queueName: INCOMING_QUEUE_NAME,
      jobName: job.name,
      jobKey: job.id ?? `${job.name}:${Date.now()}`,
      payload: data as unknown as Record<string, unknown>,
      error: error instanceof Error ? error.message : 'Unknown incoming event processing error',
      organizationId,
      metadata: {
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        failedAt: new Date().toISOString(),
      },
    });
  });

  return incomingEventsWorker;
}

export async function stopIncomingEventsWorker() {
  if (!incomingEventsWorker) {
    return;
  }

  await incomingEventsWorker.close();
  incomingEventsWorker = null;
}
