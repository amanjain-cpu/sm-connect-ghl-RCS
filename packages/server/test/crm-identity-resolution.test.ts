import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveLeadconnectorOrganizationIdentity,
  type LeadconnectorIdentityConnectionSnapshot,
  type LeadconnectorIdentityInstallationSnapshot,
  type LeadconnectorOrganizationResourceSummary,
} from '../src/services/crm-identity-resolution.service.js';

function deps(input: {
  locationConnections?: LeadconnectorIdentityConnectionSnapshot[];
  locationInstallations?: LeadconnectorIdentityInstallationSnapshot[];
  companyConnections?: LeadconnectorIdentityConnectionSnapshot[];
  companyInstallations?: LeadconnectorIdentityInstallationSnapshot[];
  resources?: LeadconnectorOrganizationResourceSummary[];
}) {
  return {
    findConnectionsByLocation: async () => input.locationConnections ?? [],
    findInstallationsByLocation: async () => input.locationInstallations ?? [],
    findConnectionsByCompanyId: async () => input.companyConnections ?? [],
    findInstallationsByCompanyId: async () => input.companyInstallations ?? [],
    getOrganizationResourceSummaries: async () => input.resources ?? [],
  };
}

test('canonical CRM identity prefers non-blank company organization over exact blank duplicate location', async () => {
  const result = await resolveLeadconnectorOrganizationIdentity(
    {
      locationId: 'loc-1',
      companyId: 'company-1',
      storedOrganizationId: 'org-blank',
    },
    deps({
      locationConnections: [
        {
          id: 'conn-blank-location',
          organizationId: 'org-blank',
          platformAccountId: 'loc-1',
          status: 'connected',
          metadata: { companyId: 'company-1' },
        },
      ],
      companyConnections: [
        {
          id: 'conn-blank-location',
          organizationId: 'org-blank',
          platformAccountId: 'loc-1',
          status: 'connected',
          metadata: { companyId: 'company-1' },
        },
        {
          id: 'conn-canonical-company',
          organizationId: 'org-canonical',
          platformAccountId: 'company-1',
          status: 'connected',
          metadata: { companyId: 'company-1', ghlAuthClass: 'Company' },
        },
      ],
      resources: [
        { organizationId: 'org-blank', brands: 0, campaigns: 0, phoneNumbers: 0, messages: 0 },
        { organizationId: 'org-canonical', brands: 1, campaigns: 2, phoneNumbers: 1, messages: 25 },
      ],
    })
  );

  assert.equal(result.organizationId, 'org-canonical');
  assert.equal(result.resolutionSource, 'company_connection');
  assert.equal(result.duplicateCandidateCounts.locationOrganizations, 1);
  assert.equal(result.duplicateCandidateCounts.companyOrganizations, 2);
});

test('stored OAuth state is corrected when CRM company/location points to another canonical organization', async () => {
  const result = await resolveLeadconnectorOrganizationIdentity(
    {
      locationId: 'loc-1',
      companyId: 'company-1',
      storedOrganizationId: 'org-stale-state',
    },
    deps({
      locationInstallations: [
        {
          id: 'install-canonical-location',
          organizationId: 'org-canonical',
          externalAccountId: 'loc-1',
          status: 'connected',
          metadata: { companyId: 'company-1' },
        },
      ],
      resources: [
        { organizationId: 'org-canonical', brands: 1 },
      ],
    })
  );

  assert.equal(result.organizationId, 'org-canonical');
  assert.equal(result.resolutionSource, 'location_installation');
  assert.equal(result.staleStoredOrganizationId, 'org-stale-state');
  assert.equal(result.duplicateCandidateCounts.staleStoredOrganization, true);
});

test('OAuth callback without state still resolves existing company anchor instead of creating a new org', async () => {
  const result = await resolveLeadconnectorOrganizationIdentity(
    {
      locationId: 'loc-new-browser',
      companyId: 'company-1',
    },
    deps({
      companyConnections: [
        {
          id: 'conn-existing-company',
          organizationId: 'org-canonical',
          platformAccountId: 'company-1',
          status: 'connected',
          metadata: { companyId: 'company-1' },
        },
      ],
    })
  );

  assert.equal(result.organizationId, 'org-canonical');
  assert.equal(result.resolutionSource, 'company_connection');
});

test('first-time app-initiated CRM OAuth can use stored org when no CRM anchor exists yet', async () => {
  const result = await resolveLeadconnectorOrganizationIdentity(
    {
      locationId: 'loc-first',
      companyId: 'company-first',
      storedOrganizationId: 'org-existing-user',
      allowUnanchoredStoredOrganization: true,
    },
    deps({})
  );

  assert.equal(result.organizationId, 'org-existing-user');
  assert.equal(result.resolutionSource, 'stored_state_unanchored');
});
