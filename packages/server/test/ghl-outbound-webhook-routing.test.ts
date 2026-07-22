import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enqueueCrmOutboundWebhookForExactLocation } from '../src/services/ghl-outbound-webhook-routing.service.js';

const parsedOutbound = {
  providerMessageId: 'msg-1',
  accountId: 'sWmK39aPQAVSVxqGib0Z',
  conversationId: 'conversation-1',
  contactId: 'contact-1',
  to: '+15551234567',
  from: '+15557654321',
  body: 'Hello',
  rawPayload: {},
};

test('native outbound from a known location enqueues against the exact location connection', async () => {
  const queued: unknown[] = [];

  const result = await enqueueCrmOutboundWebhookForExactLocation(
    {
      parsed: parsedOutbound,
    },
    {
      getConnectionByLocation: async (locationId) => {
        assert.equal(locationId, 'sWmK39aPQAVSVxqGib0Z');
        return {
          id: 'connection-new-location',
          platformAccountId: locationId,
        };
      },
      enqueueOutboundMessage: async (payload) => {
        queued.push(payload);
      },
    }
  );

  assert.equal(result.queued, true);
  assert.deepEqual(queued, [
    {
      connectionId: 'connection-new-location',
      providerMessageId: 'msg-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      to: '+15551234567',
      from: '+15557654321',
      body: 'Hello',
      mediaUrls: undefined,
    },
  ]);
});

test('native outbound from an unknown location does not enqueue through another location', async () => {
  let enqueueCalls = 0;

  const result = await enqueueCrmOutboundWebhookForExactLocation(
    {
      parsed: parsedOutbound,
    },
    {
      getConnectionByLocation: async (locationId) => {
        assert.equal(locationId, 'sWmK39aPQAVSVxqGib0Z');
        return null;
      },
      enqueueOutboundMessage: async () => {
        enqueueCalls += 1;
      },
    }
  );

  assert.deepEqual(result, {
    queued: false,
    warning: 'location_not_configured',
    locationId: 'sWmK39aPQAVSVxqGib0Z',
    providerMessageId: 'msg-1',
  });
  assert.equal(enqueueCalls, 0);
});
