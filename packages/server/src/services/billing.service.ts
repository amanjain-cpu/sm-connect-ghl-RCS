// ===========================================
// Billing Service
// ===========================================

import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { subscriptionBillingService } from './subscription-billing.service.js';

type BillingDirection = 'inbound' | 'outbound';
type BillingUnit = 'sms' | 'mms' | 'phone_number';

function getCycleMonth(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class BillingService {
  async recordMessageAcceptance(input: {
    organizationId: string;
    messageId: string;
    direction: BillingDirection;
    unit: BillingUnit;
    source: string;
    billingKey: string;
    quantity?: number;
    metadata?: Record<string, unknown>;
  }) {
    const existing = await prisma.billingEvent.findUnique({
      where: { billingKey: input.billingKey },
    });

    const mergedMetadata = {
      ...this.asRecord(existing?.metadata),
      ...(input.metadata ?? {}),
    };

    const event = existing
      ? await prisma.billingEvent.update({
          where: { id: existing.id },
          data: {
            status: 'pending',
            quantity: input.quantity ?? 1,
            metadata: mergedMetadata as Prisma.InputJsonValue,
          },
        })
      : await prisma.billingEvent.create({
          data: {
            organizationId: input.organizationId,
            messageId: input.messageId,
            direction: input.direction,
            unit: input.unit,
            quantity: input.quantity ?? 1,
            source: input.source,
            billingKey: input.billingKey,
            cycleMonth: getCycleMonth(),
            metadata: mergedMetadata as Prisma.InputJsonValue | undefined,
          },
        });

    await subscriptionBillingService.processMeteredEvent(event.id);

    return event;
  }

  async updateEventStatus(
    organizationId: string,
    billingEventId: string,
    input: {
      status: 'posted' | 'failed' | 'ignored';
      reason?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    const event = await prisma.billingEvent.findFirst({
      where: {
        id: billingEventId,
        organizationId,
      },
    });

    if (!event) {
      throw new NotFoundError('Billing event not found');
    }

    if (event.status === 'posted' && input.status !== 'posted') {
      throw new BadRequestError('Posted billing events cannot be moved back to a non-posted state');
    }

    const mergedMetadata = {
      ...this.asRecord(event.metadata),
      ...(input.metadata ?? {}),
      statusReason: input.reason ?? this.asRecord(event.metadata).statusReason ?? null,
      statusUpdatedAt: new Date().toISOString(),
    };

    return prisma.billingEvent.update({
      where: { id: event.id },
      data: {
        status: input.status,
        metadata: mergedMetadata as Prisma.InputJsonValue,
      },
      include: {
        message: {
          select: {
            id: true,
            from: true,
            to: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async processPendingEvents(
    organizationId: string,
    options?: {
      limit?: number;
    }
  ) {
    const limit = options?.limit ?? 100;
    const pendingEvents = await prisma.billingEvent.findMany({
      where: {
        organizationId,
        status: 'pending',
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        message: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    let posted = 0;
    let ignored = 0;
    let failed = 0;

    for (const event of pendingEvents) {
      const messageStatus = event.message?.status ?? null;

      try {
        if (event.unit === 'phone_number') {
          await this.updateEventStatus(organizationId, event.id, {
            status: 'ignored',
            reason: 'Phone number metering is not automated yet',
          });
          ignored += 1;
          continue;
        }

        if (event.direction === 'outbound' && messageStatus === 'failed') {
          await this.updateEventStatus(organizationId, event.id, {
            status: 'failed',
            reason: 'Associated outbound message failed before bill-post processing',
          });
          failed += 1;
          continue;
        }

        await this.updateEventStatus(organizationId, event.id, {
          status: 'posted',
          reason: 'Locally processed as billable provider acceptance event',
        });
        posted += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      processed: pendingEvents.length,
      posted,
      ignored,
      failed,
    };
  }

  async getSummary(organizationId: string) {
    const cycleMonth = getCycleMonth();
    const events = await prisma.billingEvent.findMany({
      where: {
        organizationId,
        cycleMonth,
      },
    });

    const summary = {
      cycleMonth,
      smsOutbound: 0,
      smsInbound: 0,
      mmsOutbound: 0,
      mmsInbound: 0,
      pending: 0,
      posted: 0,
      failed: 0,
      ignored: 0,
      totalBillableEvents: events.length,
    };

    for (const event of events) {
      if (event.unit === 'sms' && event.direction === 'outbound') summary.smsOutbound += event.quantity;
      if (event.unit === 'sms' && event.direction === 'inbound') summary.smsInbound += event.quantity;
      if (event.unit === 'mms' && event.direction === 'outbound') summary.mmsOutbound += event.quantity;
      if (event.unit === 'mms' && event.direction === 'inbound') summary.mmsInbound += event.quantity;
      if (event.status === 'pending') summary.pending += event.quantity;
      if (event.status === 'posted') summary.posted += event.quantity;
      if (event.status === 'failed') summary.failed += event.quantity;
      if (event.status === 'ignored') summary.ignored += event.quantity;
    }

    return summary;
  }

  async listEvents(organizationId: string, limit = 50) {
    return prisma.billingEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        message: {
          select: {
            id: true,
            from: true,
            to: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
  }

  private asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}

export const billingService = new BillingService();
