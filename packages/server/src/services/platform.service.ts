// ===========================================
// Platform Connection Service
// ===========================================

import { prisma } from '../config/database.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { PlatformConnection, Platform, PlatformStatus } from '@prisma/client';
import { integrationService } from './integration.service.js';
import {
  leadconnectorConnectionMatchesCompany,
  reconcileLeadconnectorInstallWebhook,
} from './ghl-install-reconciliation.service.js';
import {
  filterLeadconnectorInstallationsByCompanyId,
  resolveLeadconnectorOrganizationIdentity,
  scoreLeadconnectorOrganizationResources,
  type LeadconnectorIdentityResolutionResult,
  type LeadconnectorOrganizationResourceSummary,
} from './crm-identity-resolution.service.js';

interface CreateConnectionInput {
  organizationId: string;
  platform: Platform;
  platformAccountId: string;
  platformAccountName?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes: string[];
  status?: PlatformStatus;
  metadata?: Record<string, unknown>;
}

interface UpdateConnectionInput {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes?: string[];
  status?: PlatformStatus;
  metadata?: Record<string, unknown>;
  lastSyncAt?: Date;
}

interface LeadconnectorIdentityInput {
  locationId?: string | null;
  companyId?: string | null;
  storedOrganizationId?: string | null;
  requestedOrganizationId?: string | null;
  allowUnanchoredStoredOrganization?: boolean;
  allowUnanchoredRequestedOrganization?: boolean;
  logContext?: string;
}

export class PlatformService {
  private getConnectionMetadata(connection: Pick<PlatformConnection, 'metadata'>): Record<string, unknown> {
    if (!connection.metadata || typeof connection.metadata !== 'object' || Array.isArray(connection.metadata)) {
      return {};
    }

    return connection.metadata as Record<string, unknown>;
  }

  private getStringMetadataValue(
    metadata: Record<string, unknown>,
    key: string
  ): string | null {
    const value = metadata[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private getLeadconnectorCompanyIdFromConnectionInput(data: {
    platformAccountId: string;
    metadata?: Record<string, unknown>;
  }): string | null {
    const metadata = data.metadata ?? {};
    return (
      this.getStringMetadataValue(metadata, 'companyId') ??
      this.getStringMetadataValue(metadata, 'ghlTokenCompanyId') ??
      null
    );
  }

  private getLeadconnectorLocationIdFromConnectionInput(data: {
    platformAccountId: string;
    metadata?: Record<string, unknown>;
  }): string | null {
    const metadata = data.metadata ?? {};
    const tokenLocationId = this.getStringMetadataValue(metadata, 'ghlTokenLocationId');
    if (tokenLocationId) {
      return tokenLocationId;
    }

    const companyId = this.getLeadconnectorCompanyIdFromConnectionInput(data);
    const authClass = this.getStringMetadataValue(metadata, 'ghlAuthClass')?.toLowerCase();
    if (authClass === 'company' && companyId === data.platformAccountId) {
      return null;
    }

    return data.platformAccountId;
  }

  private async getLeadconnectorInstallationsByCompanyId(companyId: string) {
    const installations = await prisma.platformInstallation.findMany({
      where: {
        platform: 'leadconnector',
      },
      orderBy: [
        { status: 'asc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return filterLeadconnectorInstallationsByCompanyId(installations, companyId);
  }

  private async getLeadconnectorOrganizationResourceSummaries(
    organizationIds: string[]
  ): Promise<LeadconnectorOrganizationResourceSummary[]> {
    const uniqueOrganizationIds = Array.from(new Set(organizationIds));

    return Promise.all(
      uniqueOrganizationIds.map(async (organizationId) => {
        const [
          brands,
          campaigns,
          phoneNumbers,
          messages,
          billingLedgerEntries,
          billingAccount,
        ] = await Promise.all([
          prisma.brand.count({ where: { organizationId } }),
          prisma.campaign.count({ where: { organizationId } }),
          prisma.phoneNumber.count({ where: { organizationId } }),
          prisma.message.count({ where: { organizationId } }),
          prisma.billingLedgerEntry.count({ where: { organizationId } }),
          prisma.billingAccount.findUnique({
            where: { organizationId },
            select: { walletBalance: true },
          }),
        ]);

        return {
          organizationId,
          brands,
          campaigns,
          phoneNumbers,
          messages,
          billingLedgerEntries,
          walletBalance: billingAccount?.walletBalance?.toString() ?? '0',
        };
      })
    );
  }

  private logLeadconnectorIdentityResolution(
    input: LeadconnectorIdentityInput,
    result: LeadconnectorIdentityResolutionResult
  ) {
    logger.info(
      {
        context: input.logContext,
        locationId: input.locationId ?? null,
        companyId: input.companyId ?? null,
        storedOrganizationId: input.storedOrganizationId ?? null,
        requestedOrganizationId: input.requestedOrganizationId ?? null,
        resolvedOrganizationId: result.organizationId,
        resolutionSource: result.resolutionSource,
        duplicateCandidateCounts: result.duplicateCandidateCounts,
        staleStoredOrganizationId: result.staleStoredOrganizationId ?? null,
        businessResourceScore: result.businessResourceScore,
      },
      'Resolved canonical CRM organization identity'
    );
  }

  async resolveLeadconnectorOrganizationIdentity(
    input: LeadconnectorIdentityInput
  ): Promise<LeadconnectorIdentityResolutionResult> {
    const result = await resolveLeadconnectorOrganizationIdentity(input, {
      findConnectionsByLocation: async (locationId) =>
        prisma.platformConnection.findMany({
          where: {
            platform: 'leadconnector',
            platformAccountId: locationId,
          },
          orderBy: [
            { status: 'asc' },
            { updatedAt: 'desc' },
            { createdAt: 'desc' },
          ],
        }),
      findInstallationsByLocation: async (locationId) =>
        prisma.platformInstallation.findMany({
          where: {
            platform: 'leadconnector',
            externalAccountId: locationId,
          },
          orderBy: [
            { status: 'asc' },
            { updatedAt: 'desc' },
            { createdAt: 'desc' },
          ],
        }),
      findConnectionsByCompanyId: async (companyId) =>
        this.findLeadconnectorConnectionsByCompanyId(companyId),
      findInstallationsByCompanyId: async (companyId) =>
        this.getLeadconnectorInstallationsByCompanyId(companyId),
      getOrganizationResourceSummaries: async (organizationIds) =>
        this.getLeadconnectorOrganizationResourceSummaries(organizationIds),
    });

    this.logLeadconnectorIdentityResolution(input, result);
    return result;
  }

  async getLeadconnectorConnectionByLocationForOrganization(
    organizationId: string,
    locationId: string
  ): Promise<PlatformConnection | null> {
    return prisma.platformConnection.findFirst({
      where: {
        organizationId,
        platform: 'leadconnector',
        platformAccountId: locationId,
      },
      orderBy: [
        { status: 'asc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async getLeadconnectorInstallationByLocationForOrganization(
    organizationId: string,
    locationId: string
  ) {
    return prisma.platformInstallation.findFirst({
      where: {
        organizationId,
        platform: 'leadconnector',
        externalAccountId: locationId,
      },
      orderBy: [
        { status: 'asc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  private async maybeReassignBlankLeadconnectorLocationAnchors(input: {
    canonicalOrganizationId: string;
    locationId: string;
  }) {
    const [connections, installations] = await Promise.all([
      prisma.platformConnection.findMany({
        where: {
          platform: 'leadconnector',
          platformAccountId: input.locationId,
          organizationId: { not: input.canonicalOrganizationId },
        },
      }),
      prisma.platformInstallation.findMany({
        where: {
          platform: 'leadconnector',
          externalAccountId: input.locationId,
          organizationId: { not: input.canonicalOrganizationId },
        },
      }),
    ]);

    const duplicateOrganizationIds = Array.from(new Set([
      ...connections.map((connection) => connection.organizationId),
      ...installations.map((installation) => installation.organizationId),
    ]));

    if (duplicateOrganizationIds.length === 0) {
      return;
    }

    const summaries = await this.getLeadconnectorOrganizationResourceSummaries(duplicateOrganizationIds);
    const blankDuplicateOrganizationIds = new Set(
      summaries
        .filter((summary) => scoreLeadconnectorOrganizationResources(summary) === 0)
        .map((summary) => summary.organizationId)
    );

    if (blankDuplicateOrganizationIds.size === 0) {
      logger.warn(
        {
          locationId: input.locationId,
          canonicalOrganizationId: input.canonicalOrganizationId,
          duplicateOrganizationIds,
        },
        'Detected non-blank duplicate CRM location anchors; leaving rows in place for reviewed repair'
      );
      return;
    }

    const canonicalConnection = await this.getLeadconnectorConnectionByLocationForOrganization(
      input.canonicalOrganizationId,
      input.locationId
    );
    const canonicalInstallation = await this.getLeadconnectorInstallationByLocationForOrganization(
      input.canonicalOrganizationId,
      input.locationId
    );

    const movableConnections = connections.filter((connection) =>
      blankDuplicateOrganizationIds.has(connection.organizationId)
    );
    const movableInstallations = installations.filter((installation) =>
      blankDuplicateOrganizationIds.has(installation.organizationId)
    );

    if (!canonicalConnection && movableConnections.length > 0) {
      const [connectionToMove, ...connectionsToDisconnect] = movableConnections;
      await prisma.platformConnection.update({
        where: { id: connectionToMove.id },
        data: { organizationId: input.canonicalOrganizationId },
      });

      if (connectionsToDisconnect.length > 0) {
        await prisma.platformConnection.updateMany({
          where: { id: { in: connectionsToDisconnect.map((connection) => connection.id) } },
          data: { status: 'disconnected' },
        });
      }
    } else if (movableConnections.length > 0) {
      await prisma.platformConnection.updateMany({
        where: { id: { in: movableConnections.map((connection) => connection.id) } },
        data: { status: 'disconnected' },
      });
    }

    if (!canonicalInstallation && movableInstallations.length > 0) {
      const [installationToMove, ...installationsToDisconnect] = movableInstallations;
      await prisma.platformInstallation.update({
        where: { id: installationToMove.id },
        data: { organizationId: input.canonicalOrganizationId },
      });

      if (installationsToDisconnect.length > 0) {
        await prisma.platformInstallation.updateMany({
          where: { id: { in: installationsToDisconnect.map((installation) => installation.id) } },
          data: { status: 'disconnected' },
        });
      }
    } else if (movableInstallations.length > 0) {
      await prisma.platformInstallation.updateMany({
        where: { id: { in: movableInstallations.map((installation) => installation.id) } },
        data: { status: 'disconnected' },
      });
    }

    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          organizationId: {
            in: Array.from(blankDuplicateOrganizationIds),
          },
        },
      },
    });

    logger.warn(
      {
        locationId: input.locationId,
        canonicalOrganizationId: input.canonicalOrganizationId,
        reassignedBlankDuplicateOrganizationIds: Array.from(blankDuplicateOrganizationIds),
        movedConnection: !canonicalConnection && movableConnections.length > 0,
        movedInstallation: !canonicalInstallation && movableInstallations.length > 0,
      },
      'Reassigned or disconnected blank duplicate CRM location anchors'
    );
  }

  private async findLeadconnectorConnectionsByCompanyId(
    companyId: string
  ) {
    const connections = await prisma.platformConnection.findMany({
      where: {
        platform: 'leadconnector',
      },
      orderBy: [
        { status: 'asc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return connections.filter((connection) =>
      leadconnectorConnectionMatchesCompany(connection, companyId)
    );
  }

  private async findLeadconnectorConnectionsForUninstall(input: {
    locationId?: string;
    companyId?: string;
  }) {
    if (input.locationId) {
      return prisma.platformConnection.findMany({
        where: {
          platform: 'leadconnector',
          platformAccountId: input.locationId,
        },
        select: {
          id: true,
          organizationId: true,
          installationId: true,
          platformAccountId: true,
          metadata: true,
        },
      });
    }

    if (!input.companyId) {
      return [];
    }

    const connections = await this.findLeadconnectorConnectionsByCompanyId(input.companyId);

    return connections.map((connection) => ({
      id: connection.id,
      organizationId: connection.organizationId,
      installationId: connection.installationId,
      platformAccountId: connection.platformAccountId,
      metadata: connection.metadata,
    }));
  }

  /**
   * Create a new platform connection
   */
  async createConnection(data: CreateConnectionInput): Promise<PlatformConnection> {
    let organizationId = data.organizationId;
    const metadata = data.metadata ?? {};
    const leadconnectorLocationId = data.platform === 'leadconnector'
      ? this.getLeadconnectorLocationIdFromConnectionInput({
          platformAccountId: data.platformAccountId,
          metadata,
        })
      : null;
    const leadconnectorCompanyId = data.platform === 'leadconnector'
      ? this.getLeadconnectorCompanyIdFromConnectionInput({
          platformAccountId: data.platformAccountId,
          metadata,
        })
      : null;

    if (data.platform === 'leadconnector') {
      const identity = await this.resolveLeadconnectorOrganizationIdentity({
        locationId: leadconnectorLocationId,
        companyId: leadconnectorCompanyId,
        requestedOrganizationId: data.organizationId,
        allowUnanchoredRequestedOrganization: true,
        logContext: 'create_connection',
      });

      if (identity.organizationId) {
        organizationId = identity.organizationId;
      }

      if (leadconnectorLocationId && organizationId) {
        await this.maybeReassignBlankLeadconnectorLocationAnchors({
          canonicalOrganizationId: organizationId,
          locationId: leadconnectorLocationId,
        });
      }
    }

    // Check if connection already exists
    const existing = await prisma.platformConnection.findFirst({
      where: {
        organizationId,
        platform: data.platform,
        platformAccountId: data.platformAccountId,
      },
    });

    if (existing) {
      // Update existing connection instead
      return this.updateConnection(existing.id, {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        scopes: data.scopes,
        status: data.status ?? 'connected',
        metadata: data.metadata,
      });
    }

    // Encrypt tokens before storing
    const encryptedAccessToken = encrypt(data.accessToken);
    const encryptedRefreshToken = data.refreshToken ? encrypt(data.refreshToken) : null;

    const connection = await prisma.platformConnection.create({
      data: {
        organizationId,
        platform: data.platform,
        platformAccountId: data.platformAccountId,
        platformAccountName: data.platformAccountName,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        scopes: data.scopes,
        status: data.status ?? 'connected',
        metadata: (data.metadata ?? {}) as any,
      },
    });

    logger.info(
      {
        connectionId: connection.id,
        platform: data.platform,
        organizationId,
        requestedOrganizationId: data.organizationId,
        locationId: leadconnectorLocationId,
        companyId: leadconnectorCompanyId,
      },
      'Platform connection created'
    );

    await integrationService.syncInstallationFromConnection(connection);

    return prisma.platformConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
  }

  /**
   * Get connection by ID
   */
  async getById(id: string, organizationId: string): Promise<PlatformConnection> {
    const connection = await prisma.platformConnection.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!connection) {
      throw new NotFoundError('Platform connection not found');
    }

    return connection;
  }

  async getByIdUnsafe(id: string): Promise<PlatformConnection> {
    const connection = await prisma.platformConnection.findUnique({
      where: { id },
    });

    if (!connection) {
      throw new NotFoundError('Platform connection not found');
    }

    return connection;
  }

  /**
   * Get connection by platform and account ID
   */
  async getByPlatformAccount(
    platform: Platform,
    platformAccountId: string
  ): Promise<PlatformConnection | null> {
    return prisma.platformConnection.findFirst({
      where: {
        platform,
        platformAccountId,
      },
    });
  }

  /**
   * Get all connections for an organization
   */
  async getByOrganization(
    organizationId: string,
    platform?: Platform
  ): Promise<PlatformConnection[]> {
    return prisma.platformConnection.findMany({
      where: {
        organizationId,
        ...(platform && { platform }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLeadconnectorAgencyConnectionByCompanyId(
    companyId: string,
    organizationId?: string
  ): Promise<PlatformConnection | null> {
    const exactMatches = await prisma.platformConnection.findMany({
      where: {
        platform: 'leadconnector',
        platformAccountId: companyId,
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: [
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    if (exactMatches.length === 0) {
      return null;
    }

    return exactMatches.find((exactMatch) => {
      const metadata = this.getConnectionMetadata(exactMatch);
      const metadataCompanyId =
        typeof metadata.companyId === 'string' ? metadata.companyId : null;
      const authClass =
        typeof metadata.ghlAuthClass === 'string' ? metadata.ghlAuthClass.toLowerCase() : null;
      const tokenLocationId =
        typeof metadata.ghlTokenLocationId === 'string' ? metadata.ghlTokenLocationId : null;

      return metadataCompanyId === companyId && authClass === 'company' && !tokenLocationId;
    }) ?? null;
  }

  async handleLeadconnectorInstall(input: {
    locationId?: string;
    companyId?: string;
    appId?: string;
    payload?: unknown;
  }) {
    const result = await reconcileLeadconnectorInstallWebhook(input, {
      resolveCanonicalOrganization: async ({ locationId, companyId }) =>
        this.resolveLeadconnectorOrganizationIdentity({
          locationId,
          companyId,
          logContext: 'install_webhook',
          allowUnanchoredStoredOrganization: false,
          allowUnanchoredRequestedOrganization: false,
        }),
      findConnectionByLocation: async (locationId, organizationId) =>
        organizationId
          ? this.getLeadconnectorConnectionByLocationForOrganization(organizationId, locationId)
          : prisma.platformConnection.findFirst({
              where: {
                platform: 'leadconnector',
                platformAccountId: locationId,
              },
            }),
      findConnectionsByCompanyId: async (companyId) =>
        this.findLeadconnectorConnectionsByCompanyId(companyId),
      syncInstallationFromConnection: async (connection) =>
        integrationService.syncInstallationFromConnection(connection as PlatformConnection),
      updateInstallationMetadata: async (installationId, metadata) =>
        prisma.platformInstallation.update({
          where: { id: installationId },
          data: { metadata: metadata as any },
        }),
      upsertPendingLocationInstallation: async ({ organizationId, locationId, metadata }) =>
        prisma.platformInstallation.upsert({
          where: {
            organizationId_platform_externalAccountId: {
              organizationId,
              platform: 'leadconnector',
              externalAccountId: locationId,
            },
          },
          create: {
            organizationId,
            platform: 'leadconnector',
            externalAccountId: locationId,
            status: 'pending',
            metadata: metadata as any,
          },
          update: {
            status: 'pending',
            metadata: metadata as any,
          },
        }),
    });

    if (result.status === 'deferred') {
      logger.info(
        {
          locationId: result.locationId,
          companyId: result.companyId,
          appId: result.appId,
        },
        'Received CRM install webhook before the organization was known; OAuth callback will reconcile it'
      );
    } else if (result.status === 'reconciled') {
      logger.info(
        {
          locationId: result.locationId,
          companyId: result.companyId,
          appId: result.appId,
          organizationId: result.organizationId,
          installationId: result.installationId,
          action: result.action,
        },
        'Reconciled CRM install webhook into platform installation state'
      );
    }

    return result;
  }

  async getConnectionSummaries(
    organizationId: string,
    platform?: Platform
  ) {
    const [connections, installations] = await Promise.all([
      prisma.platformConnection.findMany({
        where: {
          organizationId,
          ...(platform && { platform }),
        },
        orderBy: { createdAt: 'desc' },
      }),
      integrationService.getInstallationOverview(organizationId, platform),
    ]);

    const installationById = new Map(installations.map((installation) => [installation.id, installation]));
    const installationByAccount = new Map(
      installations.map((installation) => [`${installation.platform}:${installation.externalAccountId}`, installation])
    );

    return connections.map((connection) => {
      const installation =
        (connection.installationId ? installationById.get(connection.installationId) : undefined) ??
        installationByAccount.get(`${connection.platform}:${connection.platformAccountId}`);

      return {
        ...connection,
        metadata: connection.metadata,
        installation: installation
          ? {
              id: installation.id,
              lifecycleState: installation.lifecycleState,
              connectedAt: installation.connectedAt,
              lastSyncAt: installation.lastSyncAt,
              providerActivation: installation.providerActivation,
              resourceCounts: installation.resourceCounts,
              checklist: installation.checklist,
            }
          : null,
      };
    });
  }

  /**
   * Update connection
   */
  async updateConnection(
    id: string,
    data: UpdateConnectionInput
  ): Promise<PlatformConnection> {
    const updateData: any = { ...data };

    // Encrypt new tokens if provided
    if (data.accessToken) {
      updateData.accessToken = encrypt(data.accessToken);
    }
    if (data.refreshToken) {
      updateData.refreshToken = encrypt(data.refreshToken);
    }

    const connection = await prisma.platformConnection.update({
      where: { id },
      data: updateData,
    });

    logger.info({ connectionId: id }, 'Platform connection updated');

    await integrationService.syncInstallationFromConnection(connection);

    return prisma.platformConnection.findUniqueOrThrow({
      where: { id },
    });
  }

  /**
   * Get decrypted tokens for a connection
   */
  async getDecryptedTokens(connectionId: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
  }> {
    const connection = await prisma.platformConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundError('Platform connection not found');
    }

    return {
      accessToken: decrypt(connection.accessToken),
      refreshToken: connection.refreshToken ? decrypt(connection.refreshToken) : null,
    };
  }

  /**
   * Check if token needs refresh
   */
  async needsTokenRefresh(connectionId: string): Promise<boolean> {
    const connection = await prisma.platformConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundError('Platform connection not found');
    }

    if (!connection.tokenExpiresAt) {
      return false;
    }

    // Refresh if token expires in less than 5 minutes
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return connection.tokenExpiresAt < fiveMinutesFromNow;
  }

  /**
   * Disconnect platform
   */
  async disconnect(id: string, organizationId: string): Promise<void> {
    const connection = await this.getById(id, organizationId);

    await prisma.platformConnection.update({
      where: { id: connection.id },
      data: {
        status: 'disconnected',
        accessToken: '',
        refreshToken: null,
      },
    });

    logger.info({ connectionId: id }, 'Platform disconnected');
  }

  async handleLeadconnectorUninstall(input: {
    locationId?: string;
    companyId?: string;
    appId?: string;
  }): Promise<{
    disconnectedConnections: number;
    removedInstallations: number;
    revokedRefreshTokens: number;
    purgedOAuthStates: number;
    unlinkedMessages: number;
    locationId?: string;
    companyId?: string;
  }> {
    const matches = await this.findLeadconnectorConnectionsForUninstall({
      locationId: input.locationId,
      companyId: input.companyId,
    });

    if (matches.length === 0) {
      logger.info(
        { locationId: input.locationId, companyId: input.companyId, appId: input.appId },
        'Received marketplace uninstall webhook with no matching connection'
      );

      return {
        disconnectedConnections: 0,
        removedInstallations: 0,
        revokedRefreshTokens: 0,
        purgedOAuthStates: 0,
        unlinkedMessages: 0,
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(input.companyId ? { companyId: input.companyId } : {}),
      };
    }

    const connectionIds = matches.map((connection) => connection.id);
    const organizationIds = Array.from(new Set(matches.map((connection) => connection.organizationId)));
    const installationIds = Array.from(
      new Set(
        matches
          .map((connection) => connection.installationId)
          .filter((value): value is string => Boolean(value))
      )
    );

    const cleanupSummary = await prisma.$transaction(async (tx) => {
      let unlinkedMessages = 0;
      let revokedRefreshTokens = 0;
      let purgedOAuthStates = 0;

      if (connectionIds.length > 0) {
        const unlinkResult = await tx.message.updateMany({
          where: {
            platformConnectionId: { in: connectionIds },
          },
          data: {
            platformConnectionId: null,
            platformMessageId: null,
            platformConversationId: null,
          },
        });
        unlinkedMessages = unlinkResult.count;
      }

      if (installationIds.length > 0) {
        await tx.senderProfile.deleteMany({
          where: {
            installationId: { in: installationIds },
          },
        });

        await tx.externalResourceMapping.deleteMany({
          where: {
            installationId: { in: installationIds },
          },
        });
      }

      if (organizationIds.length > 0) {
        const refreshTokenDeleteResult = await tx.refreshToken.deleteMany({
          where: {
            user: {
              organizationId: {
                in: organizationIds,
              },
            },
          },
        });
        revokedRefreshTokens = refreshTokenDeleteResult.count;

        const oauthStateDeleteResult = await tx.oAuthState.deleteMany({
          where: {
            platform: 'leadconnector',
            organizationId: {
              in: organizationIds,
            },
          },
        });
        purgedOAuthStates = oauthStateDeleteResult.count;
      }

      await tx.platformConnection.deleteMany({
        where: {
          id: { in: connectionIds },
        },
      });

      if (installationIds.length > 0) {
        await tx.platformInstallation.deleteMany({
          where: {
            id: { in: installationIds },
          },
        });
      }

      return {
        unlinkedMessages,
        revokedRefreshTokens,
        purgedOAuthStates,
      };
    });

    logger.info(
      {
        locationId: input.locationId,
        companyId: input.companyId,
        appId: input.appId,
        connectionIds,
        installationIds,
        organizationIds,
        cleanupSummary,
      },
      'Disconnected CRM marketplace installation after uninstall webhook'
    );

    return {
      disconnectedConnections: connectionIds.length,
      removedInstallations: installationIds.length,
      revokedRefreshTokens: cleanupSummary.revokedRefreshTokens,
      purgedOAuthStates: cleanupSummary.purgedOAuthStates,
      unlinkedMessages: cleanupSummary.unlinkedMessages,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
    };
  }

  /**
   * Delete connection
   */
  async delete(id: string, organizationId: string): Promise<void> {
    const connection = await this.getById(id, organizationId);

    await prisma.platformConnection.delete({
      where: { id: connection.id },
    });

    logger.info({ connectionId: id }, 'Platform connection deleted');
  }

  /**
   * Find or create organization from platform connection
   * Used during OAuth when a new user connects
   */
  async findOrCreateOrganization(
    platform: Platform,
    platformAccountId: string,
    accountInfo: {
      name: string;
      email: string;
      phone?: string;
      website?: string;
    },
    options?: {
      companyId?: string;
    }
  ): Promise<{ organizationId: string; isNew: boolean }> {
    if (platform === 'leadconnector') {
      const companyId = options?.companyId;
      const identity = await this.resolveLeadconnectorOrganizationIdentity({
        locationId: companyId === platformAccountId ? null : platformAccountId,
        companyId,
        logContext: 'find_or_create_organization',
        allowUnanchoredStoredOrganization: false,
        allowUnanchoredRequestedOrganization: false,
      });

      if (identity.organizationId) {
        return {
          organizationId: identity.organizationId,
          isNew: false,
        };
      }
    }

    // Check if this platform account is already connected
    const existingConnection = await this.getByPlatformAccount(platform, platformAccountId);

    if (existingConnection) {
      return {
        organizationId: existingConnection.organizationId,
        isNew: false,
      };
    }

    if (platform === 'leadconnector' && options?.companyId) {
      const companyConnections = await this.findLeadconnectorConnectionsByCompanyId(options.companyId);
      const organizationAnchor = companyConnections[0];

      if (organizationAnchor) {
        logger.info(
          {
            platform,
            platformAccountId,
            companyId: options.companyId,
            organizationId: organizationAnchor.organizationId,
            anchorConnectionId: organizationAnchor.id,
          },
          'Resolved organization for CRM location connection from company-level install history'
        );

        return {
          organizationId: organizationAnchor.organizationId,
          isNew: false,
        };
      }
    }

    // Check if organization exists by email
    const existingOrg = await prisma.organization.findFirst({
      where: { email: accountInfo.email.toLowerCase() },
    });

    if (existingOrg) {
      return {
        organizationId: existingOrg.id,
        isNew: false,
      };
    }

    // Create new organization
    const newOrg = await prisma.organization.create({
      data: {
        name: accountInfo.name,
        email: accountInfo.email.toLowerCase(),
        phone: accountInfo.phone,
        website: accountInfo.website,
      },
    });

    logger.info(
      { organizationId: newOrg.id, platform, platformAccountId },
      'New organization created from platform connection'
    );

    return {
      organizationId: newOrg.id,
      isNew: true,
    };
  }
}

export const platformService = new PlatformService();
