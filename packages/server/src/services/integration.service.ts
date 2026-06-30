// ===========================================
// Integration Architecture Service
// ===========================================

import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { Prisma } from '@prisma/client';
import type {
  Brand,
  Campaign,
  ExternalResourceStatus,
  IntegrationLifecycleState,
  Message,
  PhoneNumber,
  Platform,
  PlatformConnection,
} from '@prisma/client';

export class IntegrationService {
  async getPrimaryInstallationForOrganization(
    organizationId: string,
    platform?: Platform
  ) {
    return this.getPrimaryInstallation(organizationId, platform);
  }

  async setPrimaryOnboardingResources(
    organizationId: string,
    input: {
      platform?: Platform;
      installationId?: string | null;
      brandId?: string | null;
      campaignId?: string | null;
    }
  ) {
    const installation = input.installationId
      ? await prisma.platformInstallation.findUnique({ where: { id: input.installationId } })
      : await this.getPrimaryInstallation(organizationId, input.platform);

    if (!installation) {
      return null;
    }

    const metadata = this.asRecord(installation.metadata);
    const nextMetadata: Record<string, unknown> = { ...metadata };

    if (input.brandId !== undefined) {
      nextMetadata.primaryBrandId = input.brandId;
      nextMetadata.primaryBrandPinnedAt = new Date().toISOString();
    }

    if (input.campaignId !== undefined) {
      nextMetadata.primaryCampaignId = input.campaignId;
      nextMetadata.primaryCampaignPinnedAt = new Date().toISOString();
    }

    return prisma.platformInstallation.update({
      where: { id: installation.id },
      data: {
        metadata: nextMetadata as Prisma.InputJsonValue,
      },
    });
  }

  async getInstallationReadiness(
    organizationId: string,
    platform?: Platform,
    installationId?: string | null
  ) {
    const installation = installationId
      ? await prisma.platformInstallation.findFirst({
          where: {
            id: installationId,
            organizationId,
            ...(platform ? { platform } : {}),
          },
        })
      : await this.getPrimaryInstallation(organizationId, platform);

    if (!installation) {
      return null;
    }

    const resourceCounts = await this.getResourceCounts(organizationId);
    const providerActivation = this.getProviderActivationState(installation, resourceCounts);
    const lifecycleState = this.deriveLifecycleState(resourceCounts, providerActivation);

    if (installation.lifecycleState !== lifecycleState) {
      await prisma.platformInstallation.update({
        where: { id: installation.id },
        data: { lifecycleState },
      });
    }

    return {
      id: installation.id,
      lifecycleState,
      providerActivation,
      resourceCounts,
      checklist: this.buildChecklist(resourceCounts, providerActivation, lifecycleState),
    };
  }

  async markProviderActivated(
    organizationId: string,
    connectionId: string,
    input?: { source?: 'manual_confirmation' | 'test_send' }
  ) {
    const connection = await prisma.platformConnection.findFirst({
      where: {
        id: connectionId,
        organizationId,
      },
    });

    if (!connection) {
      return null;
    }

    const installation = connection.installationId
      ? await prisma.platformInstallation.findUnique({ where: { id: connection.installationId } })
      : await this.getPrimaryInstallation(organizationId, connection.platform);

    if (!installation) {
      return null;
    }

    const metadata = this.asRecord(installation.metadata);
    const nextMetadata = {
      ...metadata,
      providerActivatedAt: new Date().toISOString(),
      providerActivationSource: input?.source ?? 'manual_confirmation',
    };

    await prisma.platformInstallation.update({
      where: { id: installation.id },
      data: {
        metadata: nextMetadata as Prisma.InputJsonValue,
      },
    });

    return this.getInstallationReadiness(organizationId, connection.platform, installation.id);
  }

  async syncInstallationFromConnection(connection: PlatformConnection) {
    const installation = await prisma.platformInstallation.upsert({
      where: {
        organizationId_platform_externalAccountId: {
          organizationId: connection.organizationId,
          platform: connection.platform,
          externalAccountId: connection.platformAccountId,
        },
      },
      create: {
        organizationId: connection.organizationId,
        platform: connection.platform,
        externalAccountId: connection.platformAccountId,
        externalAccountName: connection.platformAccountName,
        status: connection.status,
        connectedAt: connection.status === 'connected' ? new Date() : null,
        lastSyncAt: connection.lastSyncAt,
        metadata: connection.metadata ?? undefined,
      },
      update: {
        externalAccountName: connection.platformAccountName,
        status: connection.status,
        connectedAt: connection.status === 'connected' ? new Date() : undefined,
        lastSyncAt: connection.lastSyncAt,
        metadata: connection.metadata ?? undefined,
      },
    });

    if (connection.installationId !== installation.id) {
      await prisma.platformConnection.update({
        where: { id: connection.id },
        data: { installationId: installation.id },
      });
    }

    await this.upsertExternalResourceMapping({
      organizationId: connection.organizationId,
      installationId: installation.id,
      platform: connection.platform,
      kind: 'platform_installation',
      localResourceType: 'PlatformConnection',
      localResourceId: connection.id,
      externalId: connection.platformAccountId,
      status: connection.status === 'connected' ? 'active' : this.mapConnectionStatus(connection.status),
      metadata: {
        platformAccountName: connection.platformAccountName,
        scopes: connection.scopes,
      },
    });

    await this.reconcileLifecycleState(connection.organizationId, connection.platform, installation.id);

    return installation;
  }

  async syncBrandMapping(brand: Brand) {
    if (!brand.signalmashBrandId) {
      return null;
    }

    const installation = await this.getPrimaryInstallation(brand.organizationId);

    const result = await this.upsertExternalResourceMapping({
      organizationId: brand.organizationId,
      installationId: installation?.id,
      platform: installation?.platform ?? 'leadconnector',
      kind: 'brand',
      localResourceType: 'Brand',
      localResourceId: brand.id,
      externalId: brand.signalmashBrandId,
      secondaryExternalId: brand.tcrBrandId ?? undefined,
      status: this.mapBrandStatus(brand.status),
      metadata: {
        legalName: brand.legalName,
        displayName: brand.displayName,
        verificationScore: brand.verificationScore,
      },
    });

    await this.reconcileLifecycleState(brand.organizationId, installation?.platform, installation?.id);

    return result;
  }

  async syncCampaignMapping(campaign: Campaign) {
    if (!campaign.signalmashCampaignId) {
      return null;
    }

    const installation = await this.getPrimaryInstallation(campaign.organizationId);

    const result = await this.upsertExternalResourceMapping({
      organizationId: campaign.organizationId,
      installationId: installation?.id,
      platform: installation?.platform ?? 'leadconnector',
      kind: 'campaign',
      localResourceType: 'Campaign',
      localResourceId: campaign.id,
      localParentId: campaign.brandId,
      externalId: campaign.signalmashCampaignId,
      secondaryExternalId: campaign.tcrCampaignId ?? undefined,
      status: this.mapCampaignStatus(campaign.status),
      metadata: {
        name: campaign.name,
        useCase: campaign.useCase,
        dailyMessageLimit: campaign.dailyMessageLimit,
        messagesPerSecond: campaign.messagesPerSecond,
      },
    });

    await this.reconcileLifecycleState(campaign.organizationId, installation?.platform, installation?.id);

    return result;
  }

  async syncPhoneNumberMapping(number: PhoneNumber) {
    if (!number.signalmashNumberId) {
      return null;
    }

    const installation = await this.getPrimaryInstallation(number.organizationId);

    await this.upsertExternalResourceMapping({
      organizationId: number.organizationId,
      installationId: installation?.id,
      platform: installation?.platform ?? 'leadconnector',
      kind: 'phone_number',
      localResourceType: 'PhoneNumber',
      localResourceId: number.id,
      localParentId: number.campaignId ?? undefined,
      externalId: number.signalmashNumberId,
      status: this.mapPhoneNumberStatus(number.status),
      metadata: {
        phoneNumber: number.phoneNumber,
        formattedNumber: number.formattedNumber,
      },
    });

    if (installation) {
      await this.syncDefaultSenderProfile(installation.id, number);
    }

    await this.reconcileLifecycleState(number.organizationId, installation?.platform, installation?.id);

    return true;
  }

  async syncMessageMapping(message: Message) {
    if (!message.signalmashMessageId) {
      return null;
    }

    const connectionInfo = message.platformConnectionId
      ? await prisma.platformConnection.findUnique({
          where: { id: message.platformConnectionId },
          select: { installationId: true, platform: true },
        })
      : null;

    const primaryInstallation = connectionInfo
      ? null
      : await this.getPrimaryInstallation(message.organizationId);

    const installationId = connectionInfo?.installationId ?? primaryInstallation?.id;
    const platform = connectionInfo?.platform ?? primaryInstallation?.platform ?? 'leadconnector';

    const result = await this.upsertExternalResourceMapping({
      organizationId: message.organizationId,
      installationId,
      platform,
      kind: 'message',
      localResourceType: 'Message',
      localResourceId: message.id,
      localParentId: message.campaignId ?? undefined,
      externalId: message.signalmashMessageId,
      secondaryExternalId: message.platformMessageId ?? undefined,
      status: this.mapMessageStatus(message.status),
      metadata: {
        direction: message.direction,
        from: message.from,
        to: message.to,
      },
    });

    await this.reconcileLifecycleState(message.organizationId, platform, installationId);

    return result;
  }

  async updateLifecycleState(
    organizationId: string,
    state: IntegrationLifecycleState,
    platform?: Platform
  ) {
    const installation = await this.getPrimaryInstallation(organizationId, platform);

    if (!installation) {
      logger.debug({ organizationId, state, platform }, 'Skipping lifecycle update without installation');
      return null;
    }

    return prisma.platformInstallation.update({
      where: { id: installation.id },
      data: { lifecycleState: state },
    });
  }

  async getInstallationOverview(
    organizationId: string,
    platform?: Platform
  ) {
    const installations = await prisma.platformInstallation.findMany({
      where: {
        organizationId,
        ...(platform ? { platform } : {}),
      },
      orderBy: [
        { connectedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return Promise.all(
      installations.map(async (installation) => {
        const resourceCounts = await this.getResourceCounts(organizationId);
        const providerActivation = this.getProviderActivationState(installation, resourceCounts);
        const lifecycleState = this.deriveLifecycleState(resourceCounts, providerActivation);

        if (installation.lifecycleState !== lifecycleState) {
          await prisma.platformInstallation.update({
            where: { id: installation.id },
            data: { lifecycleState },
          });
        }

        return {
          ...installation,
          lifecycleState,
          providerActivation,
          resourceCounts,
          checklist: this.buildChecklist(resourceCounts, providerActivation, lifecycleState),
        };
      })
    );
  }

  async markPhoneNumberReleased(phoneNumberId: string) {
    await prisma.externalResourceMapping.updateMany({
      where: {
        localResourceType: 'PhoneNumber',
        localResourceId: phoneNumberId,
        kind: 'phone_number',
      },
      data: {
        status: 'archived',
      },
    });
  }

  async reconcileLifecycleState(
    organizationId: string,
    platform?: Platform,
    installationId?: string | null
  ) {
    const installation = installationId
      ? await prisma.platformInstallation.findUnique({ where: { id: installationId } })
      : await this.getPrimaryInstallation(organizationId, platform);

    if (!installation) {
      return null;
    }

    const resourceCounts = await this.getResourceCounts(organizationId);
    const providerActivation = this.getProviderActivationState(installation, resourceCounts);
    const lifecycleState = this.deriveLifecycleState(resourceCounts, providerActivation);

    return prisma.platformInstallation.update({
      where: { id: installation.id },
      data: { lifecycleState },
    });
  }

  private async getPrimaryInstallation(organizationId: string, platform?: Platform) {
    return prisma.platformInstallation.findFirst({
      where: {
        organizationId,
        ...(platform ? { platform } : {}),
      },
      orderBy: [
        { connectedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  private async getResourceCounts(organizationId: string) {
    const [
      totalBrands,
      pendingBrands,
      rejectedBrands,
      totalCampaigns,
      pendingCampaigns,
      rejectedCampaigns,
      approvedCampaigns,
      activeNumbers,
      outboundMessages,
      activePortOrders,
    ] = await Promise.all([
      prisma.brand.count({ where: { organizationId } }),
      prisma.brand.count({
        where: {
          organizationId,
          status: { in: ['pending_verification', 'unverified'] },
        },
      }),
      prisma.brand.count({
        where: {
          organizationId,
          status: { in: ['rejected', 'suspended'] },
        },
      }),
      prisma.campaign.count({ where: { organizationId } }),
      prisma.campaign.count({
        where: {
          organizationId,
          status: { in: ['draft', 'pending_approval'] },
        },
      }),
      prisma.campaign.count({
        where: {
          organizationId,
          status: { in: ['rejected', 'suspended', 'expired'] },
        },
      }),
      prisma.campaign.count({
        where: {
          organizationId,
          status: 'approved',
        },
      }),
      prisma.phoneNumber.count({
        where: {
          organizationId,
          status: 'active',
        },
      }),
      prisma.message.count({
        where: {
          organizationId,
          direction: 'outbound',
          status: { in: ['sent', 'delivered', 'received'] },
        },
      }),
      prisma.portOrder.count({
        where: {
          organizationId,
          status: { in: ['submitted', 'awaiting_documents', 'in_progress'] },
        },
      }),
    ]);

    return {
      totalBrands,
      pendingBrands,
      rejectedBrands,
      totalCampaigns,
      pendingCampaigns,
      rejectedCampaigns,
      approvedCampaigns,
      activeNumbers,
      outboundMessages,
      activePortOrders,
    };
  }

  private deriveLifecycleState(resourceCounts: {
    totalBrands: number;
    pendingBrands: number;
    rejectedBrands: number;
    totalCampaigns: number;
    pendingCampaigns: number;
    rejectedCampaigns: number;
    approvedCampaigns: number;
    activeNumbers: number;
    outboundMessages: number;
    activePortOrders: number;
  }, providerActivation: {
    activatedAt: string | null;
    source: string | null;
    isActivated: boolean;
  }): IntegrationLifecycleState {
    if (resourceCounts.rejectedBrands > 0 || resourceCounts.rejectedCampaigns > 0) {
      return 'error_attention_required';
    }

    if (resourceCounts.totalBrands === 0) {
      return 'business_details_needed';
    }

    if (resourceCounts.pendingBrands > 0) {
      return 'brand_pending';
    }

    if (resourceCounts.totalCampaigns === 0 || resourceCounts.pendingCampaigns > 0) {
      return 'campaign_pending';
    }

    if (resourceCounts.approvedCampaigns === 0) {
      return 'campaign_pending';
    }

    if (resourceCounts.activePortOrders > 0) {
      return 'port_in_progress';
    }

    if (resourceCounts.activeNumbers === 0) {
      return 'number_setup_required';
    }

    if (!providerActivation.isActivated) {
      return 'provider_not_activated';
    }

    return 'ready';
  }

  private buildChecklist(
    resourceCounts: {
      totalBrands: number;
      pendingBrands: number;
      rejectedBrands: number;
      totalCampaigns: number;
      pendingCampaigns: number;
      rejectedCampaigns: number;
      approvedCampaigns: number;
      activeNumbers: number;
      outboundMessages: number;
      activePortOrders: number;
    },
    providerActivation: {
      activatedAt: string | null;
      source: string | null;
      isActivated: boolean;
    },
    lifecycleState: IntegrationLifecycleState
  ) {
    return [
      {
        key: 'business_details',
        label: 'Brand linked or created',
        complete: resourceCounts.totalBrands > 0,
        helper: resourceCounts.totalBrands > 0
          ? 'A brand record is linked to this organization and ready for campaign assignment.'
          : 'Create a brand record with your business details to begin 10DLC onboarding.',
      },
      {
        key: 'brand',
        label: 'Brand ready',
        complete: resourceCounts.totalBrands > 0 && resourceCounts.pendingBrands === 0 && resourceCounts.rejectedBrands === 0,
        helper: resourceCounts.rejectedBrands > 0
          ? 'At least one brand is rejected or suspended and needs correction.'
          : resourceCounts.pendingBrands > 0
            ? 'Brand registration is still pending verification.'
            : 'A verified brand is ready for campaign registration.',
      },
      {
        key: 'campaign',
        label: 'Campaign ready',
        complete: resourceCounts.approvedCampaigns > 0 && resourceCounts.rejectedCampaigns === 0,
        helper: resourceCounts.rejectedCampaigns > 0
          ? 'A rejected or suspended campaign is blocking the install.'
          : resourceCounts.approvedCampaigns > 0
            ? 'At least one approved campaign is ready for traffic.'
            : 'Create and submit your primary campaign after the brand is verified.',
      },
      {
        key: 'numbers',
        label: 'Sender numbers ready',
        complete: resourceCounts.activeNumbers > 0 && resourceCounts.activePortOrders === 0,
        helper: resourceCounts.activePortOrders > 0
          ? 'A port order is still active, so the install is waiting on number readiness.'
          : resourceCounts.activeNumbers > 0
            ? 'At least one active sender number is attached to the install.'
            : 'Purchase or attach a sender number to the approved campaign before going live.',
      },
      {
        key: 'provider_activation',
        label: 'Sender routing ready',
        complete: providerActivation.isActivated || resourceCounts.activeNumbers > 0,
        helper: providerActivation.isActivated
          ? `Sender routing was confirmed${providerActivation.activatedAt ? ` on ${providerActivation.activatedAt}` : ''}.`
          : resourceCounts.activeNumbers > 0
            ? 'An active sender number is linked. Use embedded messaging to validate the send flow.'
            : 'Link an active sender number before testing outbound traffic.',
      },
      {
        key: 'traffic_validation',
        label: 'Embedded outbound traffic validated',
        complete: resourceCounts.outboundMessages > 0,
        helper: resourceCounts.outboundMessages > 0
          ? 'This organization has already sent outbound traffic through Signalmash Connect.'
          : lifecycleState === 'ready'
            ? 'Sender routing is ready, but no outbound message has been observed yet.'
            : 'After the campaign and sender are ready, send a test SMS from the embedded app to validate the live flow.',
      },
    ];
  }

  private getProviderActivationState(
    installation: {
      metadata: Prisma.JsonValue | null;
    },
    resourceCounts: {
      outboundMessages: number;
    }
  ) {
    const metadata = this.asRecord(installation.metadata);
    const activatedAt = typeof metadata.providerActivatedAt === 'string'
      ? metadata.providerActivatedAt
      : null;
    const source = typeof metadata.providerActivationSource === 'string'
      ? metadata.providerActivationSource
      : null;

    return {
      activatedAt,
      source,
      isActivated: Boolean(activatedAt) || resourceCounts.outboundMessages > 0,
    };
  }

  private asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private async syncDefaultSenderProfile(installationId: string, number: PhoneNumber) {
    const existingDefault = await prisma.senderProfile.findFirst({
      where: {
        installationId,
        isDefault: true,
      },
    });

    await prisma.senderProfile.upsert({
      where: {
        installationId_phoneNumberId: {
          installationId,
          phoneNumberId: number.id,
        },
      },
      create: {
        organizationId: number.organizationId,
        installationId,
        phoneNumberId: number.id,
        platform: 'leadconnector',
        senderKey: number.phoneNumber,
        senderLabel: number.friendlyName ?? number.formattedNumber,
        isDefault: !existingDefault,
        metadata: {
          signalmashNumberId: number.signalmashNumberId,
          campaignId: number.campaignId,
        },
      },
      update: {
        senderKey: number.phoneNumber,
        senderLabel: number.friendlyName ?? number.formattedNumber,
        metadata: {
          signalmashNumberId: number.signalmashNumberId,
          campaignId: number.campaignId,
        },
      },
    });
  }

  private async upsertExternalResourceMapping(input: {
    organizationId: string;
    installationId?: string | null;
    platform: Platform;
    kind: 'platform_installation' | 'brand' | 'campaign' | 'phone_number' | 'message';
    localResourceType: string;
    localResourceId?: string;
    localParentId?: string;
    externalId: string;
    secondaryExternalId?: string;
    status: ExternalResourceStatus;
    metadata?: Record<string, unknown>;
  }) {
    return prisma.externalResourceMapping.upsert({
      where: {
        provider_kind_externalId: {
          provider: 'signalmash',
          kind: input.kind,
          externalId: input.externalId,
        },
      },
      create: {
        organizationId: input.organizationId,
        installationId: input.installationId,
        platform: input.platform,
        kind: input.kind,
        localResourceType: input.localResourceType,
        localResourceId: input.localResourceId,
        localParentId: input.localParentId,
        externalId: input.externalId,
        secondaryExternalId: input.secondaryExternalId,
        status: input.status,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
      update: {
        installationId: input.installationId,
        platform: input.platform,
        localResourceType: input.localResourceType,
        localResourceId: input.localResourceId,
        localParentId: input.localParentId,
        secondaryExternalId: input.secondaryExternalId,
        status: input.status,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private mapConnectionStatus(status: PlatformConnection['status']): ExternalResourceStatus {
    switch (status) {
      case 'connected':
        return 'active';
      case 'disconnected':
        return 'disabled';
      case 'error':
        return 'failed';
      default:
        return 'pending';
    }
  }

  private mapBrandStatus(status: Brand['status']): ExternalResourceStatus {
    switch (status) {
      case 'verified':
        return 'active';
      case 'rejected':
        return 'failed';
      case 'suspended':
        return 'disabled';
      default:
        return 'pending';
    }
  }

  private mapCampaignStatus(status: Campaign['status']): ExternalResourceStatus {
    switch (status) {
      case 'approved':
        return 'active';
      case 'rejected':
      case 'expired':
        return 'failed';
      case 'suspended':
        return 'disabled';
      default:
        return 'pending';
    }
  }

  private mapPhoneNumberStatus(status: PhoneNumber['status']): ExternalResourceStatus {
    switch (status) {
      case 'active':
        return 'active';
      case 'released':
        return 'archived';
      case 'suspended':
        return 'disabled';
      default:
        return 'pending';
    }
  }

  private mapMessageStatus(status: Message['status']): ExternalResourceStatus {
    switch (status) {
      case 'sent':
      case 'delivered':
      case 'received':
        return 'active';
      case 'failed':
      case 'undelivered':
        return 'failed';
      default:
        return 'pending';
    }
  }
}

export const integrationService = new IntegrationService();
