import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveMessageMappingContext } from '../src/services/message-mapping-routing.service.js';

test('message mapping uses the installation from an exact platform connection', () => {
  assert.deepEqual(
    resolveMessageMappingContext({
      hasPlatformConnectionId: true,
      connectionInfo: {
        installationId: 'installation-sWmK39aPQAVSVxqGib0Z',
        platform: 'leadconnector',
      },
      primaryInstallation: {
        id: 'installation-CLBg8jI3yo9qaPyQw4h8',
        platform: 'leadconnector',
      },
    }),
    {
      installationId: 'installation-sWmK39aPQAVSVxqGib0Z',
      platform: 'leadconnector',
    }
  );
});

test('message mapping does not fall back to primary installation when a platform connection was supplied but is unresolved', () => {
  assert.deepEqual(
    resolveMessageMappingContext({
      hasPlatformConnectionId: true,
      connectionInfo: null,
      primaryInstallation: {
        id: 'installation-CLBg8jI3yo9qaPyQw4h8',
        platform: 'leadconnector',
      },
    }),
    {
      installationId: undefined,
      platform: 'leadconnector',
    }
  );
});

test('message mapping keeps primary-installation fallback for organization-scoped sends', () => {
  assert.deepEqual(
    resolveMessageMappingContext({
      hasPlatformConnectionId: false,
      primaryInstallation: {
        id: 'installation-primary',
        platform: 'leadconnector',
      },
    }),
    {
      installationId: 'installation-primary',
      platform: 'leadconnector',
    }
  );
});
