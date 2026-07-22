import type { PlatformStatus } from '@prisma/client';

export interface LeadconnectorConnectionSnapshot {
  id: string;
  organizationId: string;
  platformAccountId: string;
  platformAccountName?: string | null;
  status: PlatformStatus;
  metadata?: unknown;
}

export interface LeadconnectorInstallationSnapshot {
  id: string;
  organizationId: string;
  externalAccountId: string;
  status: PlatformStatus;
  metadata?: unknown;
}

interface ReconcileLeadconnectorInstallInput {
  locationId?: string;
  companyId?: string;
  appId?: string;
  payload?: unknown;
  receivedAt?: Date;
}

interface ReconcileLeadconnectorInstallDependencies {
  findConnectionByLocation: (locationId: string) => Promise<LeadconnectorConnectionSnapshot | null>;
  findConnectionsByCompanyId: (companyId: string) => Promise<LeadconnectorConnectionSnapshot[]>;
  syncInstallationFromConnection: (
    connection: LeadconnectorConnectionSnapshot
  ) => Promise<LeadconnectorInstallationSnapshot>;
  updateInstallationMetadata: (
    installationId: string,
    metadata: Record<string, unknown>
  ) => Promise<LeadconnectorInstallationSnapshot>;
  upsertPendingLocationInstallation: (input: {
    organizationId: string;
    locationId: string;
    metadata: Record<string, unknown>;
  }) => Promise<LeadconnectorInstallationSnapshot>;
}

export type ReconcileLeadconnectorInstallResult =
  | {
      status: 'ignored';
      reason: 'missing_location';
      companyId?: string;
      appId?: string;
    }
  | {
      status: 'deferred';
      reason: 'organization_not_found';
      locationId: string;
      companyId?: string;
      appId?: string;
    }
  | {
      status: 'reconciled';
      action: 'synced_existing_connection' | 'upserted_pending_installation';
      locationId: string;
      companyId?: string;
      appId?: string;
      organizationId: string;
      installationId: string;
      connectionId?: string;
    };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function leadconnectorConnectionMatchesCompany(
  connection: Pick<LeadconnectorConnectionSnapshot, 'platformAccountId' | 'metadata'>,
  companyId: string
): boolean {
  if (connection.platformAccountId === companyId) {
    return true;
  }

  const metadata = asRecord(connection.metadata);
  return metadata.companyId === companyId || metadata.ghlTokenCompanyId === companyId;
}

export function buildLeadconnectorInstallMetadata(
  existingMetadata: unknown,
  input: ReconcileLeadconnectorInstallInput
): Record<string, unknown> {
  const receivedAt = input.receivedAt ?? new Date();

  return {
    ...asRecord(existingMetadata),
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.appId ? { appId: input.appId } : {}),
    lastInstallWebhookAt: receivedAt.toISOString(),
    lastInstallWebhookLocationId: input.locationId ?? null,
    lastInstallWebhookCompanyId: input.companyId ?? null,
    lastInstallWebhookAppId: input.appId ?? null,
  };
}

export async function reconcileLeadconnectorInstallWebhook(
  input: ReconcileLeadconnectorInstallInput,
  dependencies: ReconcileLeadconnectorInstallDependencies
): Promise<ReconcileLeadconnectorInstallResult> {
  if (!input.locationId) {
    return {
      status: 'ignored',
      reason: 'missing_location',
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.appId ? { appId: input.appId } : {}),
    };
  }

  const existingConnection = await dependencies.findConnectionByLocation(input.locationId);
  if (existingConnection) {
    const installation = await dependencies.syncInstallationFromConnection(existingConnection);
    const metadata = buildLeadconnectorInstallMetadata(installation.metadata, input);
    const updatedInstallation = await dependencies.updateInstallationMetadata(installation.id, metadata);

    return {
      status: 'reconciled',
      action: 'synced_existing_connection',
      locationId: input.locationId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.appId ? { appId: input.appId } : {}),
      organizationId: updatedInstallation.organizationId,
      installationId: updatedInstallation.id,
      connectionId: existingConnection.id,
    };
  }

  const companyConnections = input.companyId
    ? await dependencies.findConnectionsByCompanyId(input.companyId)
    : [];
  const organizationAnchor = companyConnections[0];

  if (!organizationAnchor) {
    return {
      status: 'deferred',
      reason: 'organization_not_found',
      locationId: input.locationId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.appId ? { appId: input.appId } : {}),
    };
  }

  const installation = await dependencies.upsertPendingLocationInstallation({
    organizationId: organizationAnchor.organizationId,
    locationId: input.locationId,
    metadata: buildLeadconnectorInstallMetadata({}, input),
  });

  return {
    status: 'reconciled',
    action: 'upserted_pending_installation',
    locationId: input.locationId,
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.appId ? { appId: input.appId } : {}),
    organizationId: installation.organizationId,
    installationId: installation.id,
  };
}
