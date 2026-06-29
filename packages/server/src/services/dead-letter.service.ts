// ===========================================
// Dead Letter Service
// ===========================================

import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { enqueueGhlOutboundMessage } from '../queues/outbound-message.queue.js';
import { enqueueIncomingInboundEvent, enqueueIncomingStatusEvent } from '../queues/incoming-events.queue.js';

export class DeadLetterService {
  private buildReplayJobId(prefix: string, deadLetterId: string) {
    return `${prefix}-replay-${deadLetterId}-${Date.now()}`;
  }

  private async enqueueIncomingReplay(deadLetterId: string, payload: Record<string, unknown>) {
    if (payload['kind'] === 'signalmash-inbound') {
      await enqueueIncomingInboundEvent(
        {
          signalmashMessageId: String(payload['signalmashMessageId']),
          from: String(payload['from']),
          to: String(payload['to']),
          body: String(payload['body']),
          mediaUrls: Array.isArray(payload['mediaUrls']) ? payload['mediaUrls'] as string[] : undefined,
        },
        { jobId: this.buildReplayJobId('sm-inbound', deadLetterId) }
      );
      return;
    }

    await enqueueIncomingStatusEvent(
      {
        signalmashMessageId: String(payload['signalmashMessageId']),
        status: payload['status'] as Parameters<typeof enqueueIncomingStatusEvent>[0]['status'],
        errorCode: payload['errorCode'] ? String(payload['errorCode']) : undefined,
        errorMessage: payload['errorMessage'] ? String(payload['errorMessage']) : undefined,
      },
      { jobId: this.buildReplayJobId('sm-status', deadLetterId) }
    );
  }

  async record(input: {
    queueName: string;
    jobName: string;
    jobKey: string;
    payload: Record<string, unknown>;
    error: string;
    organizationId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return prisma.deadLetterJob.upsert({
      where: {
        queueName_jobKey: {
          queueName: input.queueName,
          jobKey: input.jobKey,
        },
      },
      create: {
        queueName: input.queueName,
        jobName: input.jobName,
        jobKey: input.jobKey,
        payload: input.payload as Prisma.InputJsonValue,
        error: input.error,
        organizationId: input.organizationId,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
      update: {
        error: input.error,
        status: 'pending',
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async list(organizationId: string) {
    return prisma.deadLetterJob.findMany({
      where: {
        OR: [
          { organizationId },
          { organizationId: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async replay(organizationId: string, deadLetterId: string) {
    const deadLetter = await prisma.deadLetterJob.findFirst({
      where: {
        id: deadLetterId,
        OR: [
          { organizationId },
          { organizationId: null },
        ],
      },
    });

    if (!deadLetter) {
      throw new NotFoundError('Dead letter job not found');
    }

    const payload = deadLetter.payload as Record<string, unknown>;

    if (deadLetter.queueName === 'outbound-platform-messages') {
      await enqueueGhlOutboundMessage(payload as unknown as Parameters<typeof enqueueGhlOutboundMessage>[0]);
    } else if (deadLetter.queueName === 'incoming-platform-events') {
      await this.enqueueIncomingReplay(deadLetter.id, payload);
    }

    return prisma.deadLetterJob.update({
      where: { id: deadLetter.id },
      data: {
        status: 'replayed',
        replayedAt: new Date(),
      },
    });
  }

  async replayPendingInboundForOrganization(organizationId: string, limit = 100) {
    const candidates = await prisma.deadLetterJob.findMany({
      where: {
        queueName: 'incoming-platform-events',
        status: 'pending',
        OR: [
          { organizationId },
          { organizationId: null },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let attempted = 0;
    let replayed = 0;
    let skipped = 0;
    let failed = 0;

    for (const deadLetter of candidates) {
      const payload = deadLetter.payload as Record<string, unknown>;
      if (payload['kind'] !== 'signalmash-inbound') {
        skipped += 1;
        continue;
      }

      const signalmashMessageId =
        typeof payload['signalmashMessageId'] === 'string' ? payload['signalmashMessageId'] : null;
      if (!signalmashMessageId) {
        skipped += 1;
        continue;
      }

      const message = await prisma.message.findFirst({
        where: { signalmashMessageId },
        select: {
          organizationId: true,
          platformMessageId: true,
        },
      });

      if (!message || message.organizationId !== organizationId) {
        skipped += 1;
        continue;
      }

      const metadata =
        deadLetter.metadata && typeof deadLetter.metadata === 'object' && !Array.isArray(deadLetter.metadata)
          ? deadLetter.metadata as Record<string, unknown>
          : {};
      const reason = typeof metadata['reason'] === 'string' ? metadata['reason'].toLowerCase() : '';
      const normalizedError = deadLetter.error.toLowerCase();
      const autoReplayEligible =
        reason === 'connection_unavailable' ||
        normalizedError.includes('authclass type is not allowed to access this scope') ||
        normalizedError.includes('location-scoped token required');

      if (!autoReplayEligible) {
        skipped += 1;
        continue;
      }

      if (message.platformMessageId) {
        await prisma.deadLetterJob.update({
          where: { id: deadLetter.id },
          data: {
            status: 'replayed',
            replayedAt: new Date(),
            metadata: {
              ...metadata,
              autoReplaySkippedReason: 'already_synced',
              autoReplayAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        skipped += 1;
        continue;
      }

      attempted += 1;

      try {
        await this.enqueueIncomingReplay(deadLetter.id, payload);

        await prisma.deadLetterJob.update({
          where: { id: deadLetter.id },
          data: {
            status: 'replayed',
            replayedAt: new Date(),
            metadata: {
              ...metadata,
              autoReplayedAfterReconnect: true,
              autoReplayAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });

        replayed += 1;
      } catch (error) {
        failed += 1;
        logger.warn(
          {
            deadLetterId: deadLetter.id,
            signalmashMessageId,
            err: error,
          },
          'Failed to auto-replay deferred inbound dead-letter job'
        );
      }
    }

    return {
      scanned: candidates.length,
      attempted,
      replayed,
      skipped,
      failed,
    };
  }
}

export const deadLetterService = new DeadLetterService();
