import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCrmOAuthLocation } from '../src/services/ghl-oauth-location-resolution.service.js';

const logger = {
  info: () => undefined,
  warn: () => undefined,
};

test('recent install webhook wins over stale token and installedLocations fallback', async () => {
  const events: string[] = [];
  let signalReads = 0;

  const result = await resolveCrmOAuthLocation({
    companyId: 'company-1',
    tokenLocationId: 'CLBg8jI3yo9qaPyQw4h8',
    userId: 'user-1',
    appId: 'app-1',
    maxInstallSignalAttempts: 3,
    installSignalRetryDelayMs: 1,
    readRecentInstallWebhookSignals: async () => {
      signalReads += 1;
      events.push(`signals:${signalReads}`);

      return signalReads < 2
        ? []
        : [
            {
              payload: {
                type: 'INSTALL',
                companyId: 'company-1',
                locationId: 'new-location',
                userId: 'user-1',
                appId: 'app-1',
              },
              createdAt: new Date('2026-07-22T12:00:00.000Z'),
            },
          ];
    },
    readInstalledLocations: async () => {
      events.push('installedLocations');
      return [{ id: 'old-location' }];
    },
    wait: async () => {
      events.push('wait');
    },
    logger,
  });

  assert.equal(result.locationId, 'new-location');
  assert.equal(result.source, 'install_webhook');
  assert.deepEqual(events, ['signals:1', 'wait', 'signals:2']);
});

test('current request location wins immediately over stale token context', async () => {
  const events: string[] = [];

  const result = await resolveCrmOAuthLocation({
    companyId: 'company-1',
    currentRequestLocationId: 'sWmK39aPQAVSVxqGib0Z',
    tokenLocationId: 'CLBg8jI3yo9qaPyQw4h8',
    maxInstallSignalAttempts: 2,
    installSignalRetryDelayMs: 1,
    readRecentInstallWebhookSignals: async () => {
      events.push('signals');
      return [];
    },
    readInstalledLocations: async () => {
      events.push('installedLocations');
      return [{ id: 'old-location' }];
    },
    wait: async () => {
      events.push('wait');
    },
    logger,
  });

  assert.equal(result.locationId, 'sWmK39aPQAVSVxqGib0Z');
  assert.equal(result.source, 'current_request');
  assert.deepEqual(events, []);
});

test('installedLocations fallback only runs after the install-signal retry window expires', async () => {
  const events: string[] = [];

  const result = await resolveCrmOAuthLocation({
    companyId: 'company-1',
    appId: 'app-1',
    maxInstallSignalAttempts: 2,
    installSignalRetryDelayMs: 1,
    readRecentInstallWebhookSignals: async () => {
      events.push('signals');
      return [];
    },
    readInstalledLocations: async (restrictToUserLocations) => {
      events.push(`installedLocations:${restrictToUserLocations}`);
      return restrictToUserLocations ? [{ id: 'fallback-location' }] : [];
    },
    wait: async () => {
      events.push('wait');
    },
    logger,
  });

  assert.equal(result.locationId, 'fallback-location');
  assert.equal(result.source, 'installed_locations');
  assert.deepEqual(events, ['signals', 'wait', 'signals', 'installedLocations:true']);
});

test('token location fallback only runs after install-signal and installed-location fallbacks are exhausted', async () => {
  const events: string[] = [];

  const result = await resolveCrmOAuthLocation({
    companyId: 'company-1',
    tokenLocationId: 'CLBg8jI3yo9qaPyQw4h8',
    appId: 'app-1',
    maxInstallSignalAttempts: 2,
    installSignalRetryDelayMs: 1,
    readRecentInstallWebhookSignals: async () => {
      events.push('signals');
      return [];
    },
    readInstalledLocations: async (restrictToUserLocations) => {
      events.push(`installedLocations:${restrictToUserLocations}`);
      return [];
    },
    wait: async () => {
      events.push('wait');
    },
    logger,
  });

  assert.equal(result.locationId, 'CLBg8jI3yo9qaPyQw4h8');
  assert.equal(result.source, 'token');
  assert.deepEqual(events, [
    'signals',
    'wait',
    'signals',
    'installedLocations:true',
    'installedLocations:false',
  ]);
});
