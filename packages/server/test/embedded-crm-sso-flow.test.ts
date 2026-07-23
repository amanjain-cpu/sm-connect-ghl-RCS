import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addEmbeddedReconnectCompletionParams,
  buildEmbeddedCrmReconnectRequiredResult,
  isEmbeddedReconnectOAuthState,
} from '../src/services/embedded-crm-sso-flow.service.js';

test('embedded SSO reconnect returns an explicit action result pinned to the requested location', () => {
  assert.deepEqual(
    buildEmbeddedCrmReconnectRequiredResult({
      authUrl: 'https://marketplace.example/oauth/chooselocation?state=state-1',
      locationId: 'sWmK39aPQAVSVxqGib0Z',
      installationId: 'installation-swm',
      message: 'Reconnect this workspace.',
    }),
    {
      action: 'reconnect_required',
      authUrl: 'https://marketplace.example/oauth/chooselocation?state=state-1',
      locationId: 'sWmK39aPQAVSVxqGib0Z',
      installationId: 'installation-swm',
      message: 'Reconnect this workspace.',
    }
  );
});

test('embedded reconnect OAuth states use marketplace completion handling', () => {
  const successUrl = new URL('https://app.example/auth/callback?success=true');

  addEmbeddedReconnectCompletionParams({
    successUrl,
    storedEmbeddedLocationId: 'sWmK39aPQAVSVxqGib0Z',
  });

  assert.equal(isEmbeddedReconnectOAuthState('sWmK39aPQAVSVxqGib0Z'), true);
  assert.equal(successUrl.searchParams.get('marketplaceInstall'), 'true');
  assert.equal(successUrl.searchParams.get('embeddedReconnect'), 'true');
});

test('standard OAuth states do not get embedded reconnect completion flags', () => {
  const successUrl = new URL('https://app.example/auth/callback?success=true');

  addEmbeddedReconnectCompletionParams({
    successUrl,
    storedEmbeddedLocationId: null,
  });

  assert.equal(isEmbeddedReconnectOAuthState(null), false);
  assert.equal(successUrl.searchParams.get('marketplaceInstall'), null);
  assert.equal(successUrl.searchParams.get('embeddedReconnect'), null);
});
