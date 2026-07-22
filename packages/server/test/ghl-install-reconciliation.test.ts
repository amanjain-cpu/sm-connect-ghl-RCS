import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  leadconnectorConnectionMatchesCompany,
  reconcileLeadconnectorInstallWebhook,
  type LeadconnectorConnectionSnapshot,
  type LeadconnectorInstallationSnapshot,
} from '../src/services/ghl-install-reconciliation.service.js';

test('LeadConnector company matching accepts location metadata and agency account ids', () => {
  assert.equal(
    leadconnectorConnectionMatchesCompany(
      {
        platformAccountId: 'location-1',
        metadata: { companyId: 'company-1' },
      },
      'company-1'
    ),
    true
  );
  assert.equal(
    leadconnectorConnectionMatchesCompany(
      {
        platformAccountId: 'company-1',
        metadata: { ghlAuthClass: 'Company' },
      },
      'company-1'
    ),
    true
  );
});

test('INSTALL webhook for a new location creates a pending location installation for the company organization', async () => {
  const upserts: Array<{ organizationId: string; locationId: string; metadata: Record<string, unknown> }> = [];
  const companyConnection: LeadconnectorConnectionSnapshot = {
    id: 'connection-existing-location',
    organizationId: 'org-mash',
    platformAccountId: 'CLBg8jI3yo9qaPyQw4h8',
    platformAccountName: 'Mash Technologies',
    status: 'connected',
    metadata: { companyId: 'company-mash' },
  };

  const result = await reconcileLeadconnectorInstallWebhook(
    {
      locationId: 'sWmK39aPQAVSVxqGib0Z',
      companyId: 'company-mash',
      appId: 'app-1',
      receivedAt: new Date('2026-07-22T12:00:00.000Z'),
    },
    {
      findConnectionByLocation: async () => null,
      findConnectionsByCompanyId: async () => [companyConnection],
      syncInstallationFromConnection: async () => {
        throw new Error('should not sync an unrelated location connection');
      },
      updateInstallationMetadata: async () => {
        throw new Error('should not update an existing installation');
      },
      upsertPendingLocationInstallation: async (input): Promise<LeadconnectorInstallationSnapshot> => {
        upserts.push(input);
        return {
          id: 'installation-new-location',
          organizationId: input.organizationId,
          externalAccountId: input.locationId,
          status: 'pending',
          metadata: input.metadata,
        };
      },
    }
  );

  assert.equal(result.status, 'reconciled');
  assert.equal(result.action, 'upserted_pending_installation');
  assert.equal(result.organizationId, 'org-mash');
  assert.equal(result.installationId, 'installation-new-location');
  assert.deepEqual(upserts, [
    {
      organizationId: 'org-mash',
      locationId: 'sWmK39aPQAVSVxqGib0Z',
      metadata: {
        companyId: 'company-mash',
        appId: 'app-1',
        lastInstallWebhookAt: '2026-07-22T12:00:00.000Z',
        lastInstallWebhookLocationId: 'sWmK39aPQAVSVxqGib0Z',
        lastInstallWebhookCompanyId: 'company-mash',
        lastInstallWebhookAppId: 'app-1',
      },
    },
  ]);
});

test('INSTALL webhook for an existing location refreshes installation metadata', async () => {
  const existingConnection: LeadconnectorConnectionSnapshot = {
    id: 'connection-new-location',
    organizationId: 'org-mash',
    platformAccountId: 'sWmK39aPQAVSVxqGib0Z',
    platformAccountName: 'Mash Technologies',
    status: 'connected',
    metadata: { companyId: 'company-mash' },
  };
  const metadataUpdates: Record<string, unknown>[] = [];

  const result = await reconcileLeadconnectorInstallWebhook(
    {
      locationId: 'sWmK39aPQAVSVxqGib0Z',
      companyId: 'company-mash',
      appId: 'app-1',
      receivedAt: new Date('2026-07-22T12:05:00.000Z'),
    },
    {
      findConnectionByLocation: async () => existingConnection,
      findConnectionsByCompanyId: async () => {
        throw new Error('should not search company anchors when exact location connection exists');
      },
      syncInstallationFromConnection: async (): Promise<LeadconnectorInstallationSnapshot> => ({
        id: 'installation-new-location',
        organizationId: 'org-mash',
        externalAccountId: 'sWmK39aPQAVSVxqGib0Z',
        status: 'connected',
        metadata: { existing: true },
      }),
      updateInstallationMetadata: async (installationId, metadata): Promise<LeadconnectorInstallationSnapshot> => {
        assert.equal(installationId, 'installation-new-location');
        metadataUpdates.push(metadata);
        return {
          id: installationId,
          organizationId: 'org-mash',
          externalAccountId: 'sWmK39aPQAVSVxqGib0Z',
          status: 'connected',
          metadata,
        };
      },
      upsertPendingLocationInstallation: async () => {
        throw new Error('should not create a pending installation for an exact connection');
      },
    }
  );

  assert.equal(result.status, 'reconciled');
  assert.equal(result.action, 'synced_existing_connection');
  assert.equal(result.connectionId, 'connection-new-location');
  assert.deepEqual(metadataUpdates, [
    {
      existing: true,
      companyId: 'company-mash',
      appId: 'app-1',
      lastInstallWebhookAt: '2026-07-22T12:05:00.000Z',
      lastInstallWebhookLocationId: 'sWmK39aPQAVSVxqGib0Z',
      lastInstallWebhookCompanyId: 'company-mash',
      lastInstallWebhookAppId: 'app-1',
    },
  ]);
});
