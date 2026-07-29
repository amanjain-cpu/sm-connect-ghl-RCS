import type { PlatformStatus } from '@prisma/client';
import { leadconnectorConnectionMatchesCompany } from './ghl-install-reconciliation.service.js';

export interface LeadconnectorIdentityConnectionSnapshot {
  id: string;
  organizationId: string;
  platformAccountId: string;
  status: PlatformStatus;
  metadata?: unknown;
  updatedAt?: Date;
  createdAt?: Date;
}

export interface LeadconnectorIdentityInstallationSnapshot {
  id: string;
  organizationId: string;
  externalAccountId: string;
  status: PlatformStatus;
  metadata?: unknown;
  updatedAt?: Date;
  createdAt?: Date;
}

export interface LeadconnectorOrganizationResourceSummary {
  organizationId: string;
  brands?: number;
  campaigns?: number;
  phoneNumbers?: number;
  messages?: number;
  billingLedgerEntries?: number;
  walletBalance?: number | string | null;
}

export type LeadconnectorIdentityResolutionSource =
  | 'location_connection'
  | 'location_installation'
  | 'company_connection'
  | 'company_installation'
  | 'stored_state'
  | 'stored_state_unanchored'
  | 'requested_organization_unanchored';

export interface LeadconnectorIdentityDuplicateCounts {
  locationConnections: number;
  locationInstallations: number;
  locationOrganizations: number;
  companyConnections: number;
  companyInstallations: number;
  companyOrganizations: number;
  candidateOrganizations: number;
  staleStoredOrganization: boolean;
}

export interface LeadconnectorIdentityResolutionResult {
  organizationId: string | null;
  resolutionSource: LeadconnectorIdentityResolutionSource | 'none';
  duplicateCandidateCounts: LeadconnectorIdentityDuplicateCounts;
  candidateOrganizationIds: string[];
  staleStoredOrganizationId?: string;
  resourceSummaries: LeadconnectorOrganizationResourceSummary[];
  businessResourceScore: number;
}

export interface ResolveLeadconnectorOrganizationIdentityInput {
  locationId?: string | null;
  companyId?: string | null;
  storedOrganizationId?: string | null;
  requestedOrganizationId?: string | null;
  allowUnanchoredStoredOrganization?: boolean;
  allowUnanchoredRequestedOrganization?: boolean;
}

export interface ResolveLeadconnectorOrganizationIdentityDependencies {
  findConnectionsByLocation: (locationId: string) => Promise<LeadconnectorIdentityConnectionSnapshot[]>;
  findInstallationsByLocation: (locationId: string) => Promise<LeadconnectorIdentityInstallationSnapshot[]>;
  findConnectionsByCompanyId: (companyId: string) => Promise<LeadconnectorIdentityConnectionSnapshot[]>;
  findInstallationsByCompanyId: (companyId: string) => Promise<LeadconnectorIdentityInstallationSnapshot[]>;
  getOrganizationResourceSummaries?: (
    organizationIds: string[]
  ) => Promise<LeadconnectorOrganizationResourceSummary[]>;
}

interface Candidate {
  organizationId: string;
  source: LeadconnectorIdentityResolutionSource;
  sourcePriority: number;
  statusRank: number;
  updatedAtMs: number;
  anchored: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function statusRank(status: PlatformStatus): number {
  switch (status) {
    case 'connected':
      return 4;
    case 'pending':
      return 3;
    case 'error':
      return 2;
    case 'disconnected':
      return 1;
    default:
      return 0;
  }
}

function dateToMs(value?: Date): number {
  return value instanceof Date ? value.getTime() : 0;
}

function numeric(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function leadconnectorInstallationMatchesCompany(
  installation: Pick<LeadconnectorIdentityInstallationSnapshot, 'externalAccountId' | 'metadata'>,
  companyId: string
): boolean {
  if (installation.externalAccountId === companyId) {
    return true;
  }

  const metadata = asRecord(installation.metadata);
  return (
    getString(metadata.companyId) === companyId ||
    getString(metadata.ghlTokenCompanyId) === companyId ||
    getString(metadata.lastInstallWebhookCompanyId) === companyId ||
    getString(metadata.lastEmbeddedSsoCompanyId) === companyId
  );
}

export function scoreLeadconnectorOrganizationResources(
  summary: LeadconnectorOrganizationResourceSummary | undefined
): number {
  if (!summary) {
    return 0;
  }

  const walletBalance = numeric(summary.walletBalance);

  return (
    numeric(summary.brands) * 1000 +
    numeric(summary.campaigns) * 800 +
    numeric(summary.phoneNumbers) * 600 +
    numeric(summary.messages) * 10 +
    numeric(summary.billingLedgerEntries) * 50 +
    (walletBalance > 0 ? 5000 : 0)
  );
}

function pushConnectionCandidates(
  candidates: Candidate[],
  connections: LeadconnectorIdentityConnectionSnapshot[],
  source: 'location_connection' | 'company_connection',
  sourcePriority: number
) {
  for (const connection of connections) {
    candidates.push({
      organizationId: connection.organizationId,
      source,
      sourcePriority,
      statusRank: statusRank(connection.status),
      updatedAtMs: Math.max(dateToMs(connection.updatedAt), dateToMs(connection.createdAt)),
      anchored: true,
    });
  }
}

function pushInstallationCandidates(
  candidates: Candidate[],
  installations: LeadconnectorIdentityInstallationSnapshot[],
  source: 'location_installation' | 'company_installation',
  sourcePriority: number
) {
  for (const installation of installations) {
    candidates.push({
      organizationId: installation.organizationId,
      source,
      sourcePriority,
      statusRank: statusRank(installation.status),
      updatedAtMs: Math.max(dateToMs(installation.updatedAt), dateToMs(installation.createdAt)),
      anchored: true,
    });
  }
}

function uniqueOrganizationIds(candidates: Candidate[]): string[] {
  return Array.from(new Set(candidates.map((candidate) => candidate.organizationId)));
}

export async function resolveLeadconnectorOrganizationIdentity(
  input: ResolveLeadconnectorOrganizationIdentityInput,
  dependencies: ResolveLeadconnectorOrganizationIdentityDependencies
): Promise<LeadconnectorIdentityResolutionResult> {
  const locationId = input.locationId ?? undefined;
  const companyId = input.companyId ?? undefined;
  const locationConnections = locationId
    ? await dependencies.findConnectionsByLocation(locationId)
    : [];
  const locationInstallations = locationId
    ? await dependencies.findInstallationsByLocation(locationId)
    : [];
  const companyConnections = companyId
    ? await dependencies.findConnectionsByCompanyId(companyId)
    : [];
  const companyInstallations = companyId
    ? await dependencies.findInstallationsByCompanyId(companyId)
    : [];

  const candidates: Candidate[] = [];
  pushConnectionCandidates(candidates, locationConnections, 'location_connection', 500);
  pushInstallationCandidates(candidates, locationInstallations, 'location_installation', 450);
  pushConnectionCandidates(candidates, companyConnections, 'company_connection', 350);
  pushInstallationCandidates(candidates, companyInstallations, 'company_installation', 300);

  const anchoredOrganizationIds = new Set(uniqueOrganizationIds(candidates));
  let staleStoredOrganizationId: string | undefined;

  if (input.storedOrganizationId) {
    if (anchoredOrganizationIds.has(input.storedOrganizationId)) {
      candidates.push({
        organizationId: input.storedOrganizationId,
        source: 'stored_state',
        sourcePriority: 425,
        statusRank: 0,
        updatedAtMs: 0,
        anchored: true,
      });
    } else if (
      candidates.length === 0 &&
      input.allowUnanchoredStoredOrganization !== false
    ) {
      candidates.push({
        organizationId: input.storedOrganizationId,
        source: 'stored_state_unanchored',
        sourcePriority: 100,
        statusRank: 0,
        updatedAtMs: 0,
        anchored: false,
      });
    } else {
      staleStoredOrganizationId = input.storedOrganizationId;
    }
  }

  if (
    candidates.length === 0 &&
    input.requestedOrganizationId &&
    input.allowUnanchoredRequestedOrganization
  ) {
    candidates.push({
      organizationId: input.requestedOrganizationId,
      source: 'requested_organization_unanchored',
      sourcePriority: 90,
      statusRank: 0,
      updatedAtMs: 0,
      anchored: false,
    });
  }

  const candidateOrganizationIds = uniqueOrganizationIds(candidates);
  const resourceSummaries = dependencies.getOrganizationResourceSummaries && candidateOrganizationIds.length > 0
    ? await dependencies.getOrganizationResourceSummaries(candidateOrganizationIds)
    : [];
  const resourceSummaryByOrg = new Map(resourceSummaries.map((summary) => [summary.organizationId, summary]));

  const bestByOrganization = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const current = bestByOrganization.get(candidate.organizationId);
    if (
      !current ||
      candidate.sourcePriority > current.sourcePriority ||
      (
        candidate.sourcePriority === current.sourcePriority &&
        candidate.statusRank > current.statusRank
      ) ||
      (
        candidate.sourcePriority === current.sourcePriority &&
        candidate.statusRank === current.statusRank &&
        candidate.updatedAtMs > current.updatedAtMs
      )
    ) {
      bestByOrganization.set(candidate.organizationId, candidate);
    }
  }

  const rankedOrganizations = Array.from(bestByOrganization.values())
    .map((candidate) => ({
      ...candidate,
      businessResourceScore: scoreLeadconnectorOrganizationResources(
        resourceSummaryByOrg.get(candidate.organizationId)
      ),
    }))
    .sort((a, b) =>
      b.businessResourceScore - a.businessResourceScore ||
      b.sourcePriority - a.sourcePriority ||
      b.statusRank - a.statusRank ||
      b.updatedAtMs - a.updatedAtMs ||
      a.organizationId.localeCompare(b.organizationId)
    );

  const selected = rankedOrganizations[0];
  const locationOrganizationIds = new Set([
    ...locationConnections.map((connection) => connection.organizationId),
    ...locationInstallations.map((installation) => installation.organizationId),
  ]);
  const companyOrganizationIds = new Set([
    ...companyConnections.map((connection) => connection.organizationId),
    ...companyInstallations.map((installation) => installation.organizationId),
  ]);

  return {
    organizationId: selected?.organizationId ?? null,
    resolutionSource: selected?.source ?? 'none',
    duplicateCandidateCounts: {
      locationConnections: locationConnections.length,
      locationInstallations: locationInstallations.length,
      locationOrganizations: locationOrganizationIds.size,
      companyConnections: companyConnections.length,
      companyInstallations: companyInstallations.length,
      companyOrganizations: companyOrganizationIds.size,
      candidateOrganizations: candidateOrganizationIds.length,
      staleStoredOrganization: Boolean(staleStoredOrganizationId),
    },
    candidateOrganizationIds,
    ...(staleStoredOrganizationId ? { staleStoredOrganizationId } : {}),
    resourceSummaries,
    businessResourceScore: selected?.businessResourceScore ?? 0,
  };
}

export function filterLeadconnectorConnectionsByCompanyId(
  connections: LeadconnectorIdentityConnectionSnapshot[],
  companyId: string
): LeadconnectorIdentityConnectionSnapshot[] {
  return connections.filter((connection) =>
    leadconnectorConnectionMatchesCompany(connection, companyId)
  );
}

export function filterLeadconnectorInstallationsByCompanyId(
  installations: LeadconnectorIdentityInstallationSnapshot[],
  companyId: string
): LeadconnectorIdentityInstallationSnapshot[] {
  return installations.filter((installation) =>
    leadconnectorInstallationMatchesCompany(installation, companyId)
  );
}
