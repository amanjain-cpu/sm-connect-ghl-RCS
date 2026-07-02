// ===========================================
// Organization Service
// ===========================================

import { prisma } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import type { Organization, User } from '@prisma/client';

interface UpdateOrganizationInput {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  logoUrl?: string;
}

interface AddUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role?: 'admin' | 'member';
  passwordHash: string;
}

export class OrganizationService {
  private createUtcDayStart(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private addUtcDays(date: Date, days: number) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  private formatUtcDay(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Get organization by ID
   */
  async getById(id: string): Promise<Organization> {
    const organization = await prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    return organization;
  }

  /**
   * Get organization with all related data
   */
  async getWithDetails(id: string): Promise<Organization & {
    users: User[];
    _count: {
      brands: number;
      campaigns: number;
      platformConnections: number;
      phoneNumbers: number;
      messages: number;
    };
  }> {
    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            avatarUrl: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            organizationId: true,
            emailVerified: true,
            passwordHash: true,
          },
        },
        _count: {
          select: {
            brands: true,
            campaigns: true,
            platformConnections: true,
            phoneNumbers: true,
            messages: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    return organization as Organization & {
      users: User[];
      _count: {
        brands: number;
        campaigns: number;
        platformConnections: number;
        phoneNumbers: number;
        messages: number;
      };
    };
  }

  /**
   * Update organization
   */
  async update(id: string, data: UpdateOrganizationInput): Promise<Organization> {
    const organization = await prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    return prisma.organization.update({
      where: { id },
      data,
    });
  }

  async suspend(id: string, reason?: string): Promise<Organization> {
    const organization = await this.getById(id);

    if (organization.status === 'suspended') {
      return organization;
    }

    return prisma.organization.update({
      where: { id },
      data: {
        status: 'suspended',
        suspendedAt: new Date(),
        suspensionReason: reason?.trim() || null,
      },
    });
  }

  async unsuspend(id: string): Promise<Organization> {
    await this.getById(id);

    return prisma.organization.update({
      where: { id },
      data: {
        status: 'active',
        suspendedAt: null,
        suspensionReason: null,
      },
    });
  }

  /**
   * Get organization users
   */
  async getUsers(organizationId: string): Promise<Omit<User, 'passwordHash'>[]> {
    const users = await prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatarUrl: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users as Omit<User, 'passwordHash'>[];
  }

  /**
   * Add user to organization
   */
  async addUser(organizationId: string, data: AddUserInput): Promise<User> {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundError('Organization not found');
    }

    return prisma.user.create({
      data: {
        ...data,
        organizationId,
        role: data.role ?? 'member',
      },
    });
  }

  /**
   * Remove user from organization
   */
  async removeUser(organizationId: string, userId: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found in organization');
    }

    if (user.role === 'owner') {
      throw new Error('Cannot remove the organization owner');
    }

    await prisma.user.delete({
      where: { id: userId },
    });
  }

  /**
   * Update user role
   */
  async updateUserRole(
    organizationId: string,
    userId: string,
    role: 'admin' | 'member'
  ): Promise<User> {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found in organization');
    }

    if (user.role === 'owner') {
      throw new Error('Cannot change the role of the organization owner');
    }

    return prisma.user.update({
      where: { id: userId },
      data: { role },
    });
  }

  /**
   * Get organization statistics
   */
  async getStats(organizationId: string): Promise<{
    totalMessages: number;
    messagesSent: number;
    messagesDelivered: number;
    messagesFailed: number;
    connectedPlatforms: number;
    activeCampaigns: number;
    verifiedBrands: number;
  }> {
    const [
      messageStats,
      platformCount,
      campaignCount,
      brandCount,
    ] = await Promise.all([
      prisma.message.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: true,
      }),
      prisma.platformConnection.count({
        where: {
          organizationId,
          status: 'connected',
        },
      }),
      prisma.campaign.count({
        where: {
          organizationId,
          status: 'approved',
        },
      }),
      prisma.brand.count({
        where: {
          organizationId,
          status: 'verified',
        },
      }),
    ]);

    const stats = {
      totalMessages: 0,
      messagesSent: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      connectedPlatforms: platformCount,
      activeCampaigns: campaignCount,
      verifiedBrands: brandCount,
    };

    for (const stat of messageStats) {
      stats.totalMessages += stat._count;
      if (stat.status === 'sent' || stat.status === 'delivered') {
        stats.messagesSent += stat._count;
      }
      if (stat.status === 'delivered') {
        stats.messagesDelivered += stat._count;
      }
      if (stat.status === 'failed' || stat.status === 'undelivered') {
        stats.messagesFailed += stat._count;
      }
    }

    return stats;
  }

  async getDashboardSummary(organizationId: string) {
    const today = this.createUtcDayStart(new Date());
    const tomorrow = this.addUtcDays(today, 1);
    const sevenDaysAgo = this.addUtcDays(today, -6);
    const fourteenDaysAgo = this.addUtcDays(today, -13);
    const thirtyDaysAgo = this.addUtcDays(today, -29);

    const [recentMessages, connectedPlatforms, activeCampaigns, verifiedBrands] = await Promise.all([
      prisma.message.findMany({
        where: {
          organizationId,
          createdAt: {
            gte: thirtyDaysAgo,
            lt: tomorrow,
          },
        },
        select: {
          createdAt: true,
          direction: true,
          status: true,
        },
      }),
      prisma.platformConnection.count({
        where: {
          organizationId,
          status: 'connected',
        },
      }),
      prisma.campaign.count({
        where: {
          organizationId,
          status: 'approved',
        },
      }),
      prisma.brand.count({
        where: {
          organizationId,
          status: 'verified',
        },
      }),
    ]);

    const createWindowStats = () => ({
      sent: 0,
      delivered: 0,
      failed: 0,
      inbound: 0,
    });

    const currentWindow = createWindowStats();
    const previousWindow = createWindowStats();
    const seriesMap = new Map<string, { date: string; sent: number; delivered: number; failed: number; inbound: number }>();

    for (let offset = 0; offset < 30; offset += 1) {
      const day = this.addUtcDays(thirtyDaysAgo, offset);
      const key = this.formatUtcDay(day);
      seriesMap.set(key, {
        date: key,
        sent: 0,
        delivered: 0,
        failed: 0,
        inbound: 0,
      });
    }

    for (const message of recentMessages) {
      const createdAt = new Date(message.createdAt);
      const dayKey = this.formatUtcDay(this.createUtcDayStart(createdAt));
      const point = seriesMap.get(dayKey);

      const isOutbound = message.direction === 'outbound';
      const isCurrentWindow = createdAt >= sevenDaysAgo;
      const isPreviousWindow = createdAt >= fourteenDaysAgo && createdAt < sevenDaysAgo;

      const applyToWindow = (windowStats: ReturnType<typeof createWindowStats>) => {
        if (!isOutbound) {
          windowStats.inbound += 1;
          return;
        }

        if (message.status === 'sent' || message.status === 'delivered') {
          windowStats.sent += 1;
        }
        if (message.status === 'delivered') {
          windowStats.delivered += 1;
        }
        if (message.status === 'failed' || message.status === 'undelivered') {
          windowStats.failed += 1;
        }
      };

      if (isCurrentWindow) {
        applyToWindow(currentWindow);
      } else if (isPreviousWindow) {
        applyToWindow(previousWindow);
      }

      if (!point) {
        continue;
      }

      if (!isOutbound) {
        point.inbound += 1;
        continue;
      }

      if (message.status === 'sent' || message.status === 'delivered') {
        point.sent += 1;
      }
      if (message.status === 'delivered') {
        point.delivered += 1;
      }
      if (message.status === 'failed' || message.status === 'undelivered') {
        point.failed += 1;
      }
    }

    const percentChange = (current: number, previous: number) => {
      if (previous === 0) {
        return current === 0 ? 0 : 100;
      }

      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const deliveryRate = currentWindow.sent > 0
      ? Number(((currentWindow.delivered / currentWindow.sent) * 100).toFixed(2))
      : 0;
    const previousDeliveryRate = previousWindow.sent > 0
      ? Number(((previousWindow.delivered / previousWindow.sent) * 100).toFixed(2))
      : 0;

    return {
      range: {
        currentStart: sevenDaysAgo.toISOString(),
        currentEnd: tomorrow.toISOString(),
        previousStart: fourteenDaysAgo.toISOString(),
        previousEnd: sevenDaysAgo.toISOString(),
        seriesStart: thirtyDaysAgo.toISOString(),
        seriesEnd: tomorrow.toISOString(),
      },
      kpis: {
        sent: {
          value: currentWindow.sent,
          previous: previousWindow.sent,
          changePercent: percentChange(currentWindow.sent, previousWindow.sent),
        },
        delivered: {
          value: currentWindow.delivered,
          previous: previousWindow.delivered,
          changePercent: percentChange(currentWindow.delivered, previousWindow.delivered),
        },
        failed: {
          value: currentWindow.failed,
          previous: previousWindow.failed,
          changePercent: percentChange(currentWindow.failed, previousWindow.failed),
        },
        deliveryRate: {
          value: deliveryRate,
          previous: previousDeliveryRate,
          changePercent: Number((deliveryRate - previousDeliveryRate).toFixed(2)),
        },
      },
      totals: {
        connectedPlatforms,
        activeCampaigns,
        verifiedBrands,
        inbound: currentWindow.inbound,
      },
      series: Array.from(seriesMap.values()),
    };
  }
}

export const organizationService = new OrganizationService();
