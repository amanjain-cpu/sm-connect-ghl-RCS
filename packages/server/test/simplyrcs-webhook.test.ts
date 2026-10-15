import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { normalizeSimplyRcsWebhook, mapSimplyRcsStatus } from '../src/services/simplyrcs-webhook.service.js';
import { verifySimplyRcsSignature } from '../src/services/simplyrcs-webhook.service.js';

test('verifies the HMAC-SHA256 signature over the raw body', () => {
  const body = JSON.stringify({ event: 'message.status', data: { messageId: 'm1', status: 'DELIVERED' } });
  const good = createHmac('sha256', 'secret').update(body).digest('hex');
  assert.equal(verifySimplyRcsSignature(body, good, 'secret'), true);
  assert.equal(verifySimplyRcsSignature(body, `sha256=${good.toUpperCase()}`, 'secret'), true);
  assert.equal(verifySimplyRcsSignature(body, good, 'other'), false);
  assert.equal(verifySimplyRcsSignature(body.replace('m1', 'm2'), good, 'secret'), false);
  assert.equal(verifySimplyRcsSignature(body, undefined, 'secret'), false);
  assert.equal(verifySimplyRcsSignature(body, good, ''), false);
});

test('maps provider statuses to ours', () => {
  assert.equal(mapSimplyRcsStatus('QUEUED'), 'sent');
  assert.equal(mapSimplyRcsStatus('DELIVERED'), 'delivered');
  assert.equal(mapSimplyRcsStatus('SEEN'), 'read');
  assert.equal(mapSimplyRcsStatus('CANCELED'), 'failed');
  assert.equal(mapSimplyRcsStatus('weird'), null);
});

test('turns message.received into an inbound event', () => {
  const events = normalizeSimplyRcsWebhook({
    event: 'message.received',
    timestamp: '2026-10-07T10:00:00.000Z',
    orgId: 'org_123',
    data: { messageId: 'msg_1', conversationId: 'conv_1', contactId: 'ct_1', senderIdId: 'sid_1', from: '+15125550100', channelType: 'RCS', contentJson: { type: 'text', text: 'Yes please' } },
  });
  assert.deepEqual(events, [{ type: 'inbound', data: { rcsMessageId: 'msg_1', rcsConversationId: 'conv_1', senderIdId: 'sid_1', organizationId: null, from: '+15125550100', body: 'Yes please', mediaUrls: undefined } }]);
});

test('turns a button tap into an inbound event carrying the button text', () => {
  const events = normalizeSimplyRcsWebhook({ event: 'button.clicked', data: { eventId: 'tap_9', messageId: 'msg_1', contactId: 'ct_1', senderIdId: 'sid_1', from: '+15125550100', buttonLabel: 'Reschedule', buttonPayload: '{"event":"reschedule"}' } });
  assert.equal(events[0]?.type, 'inbound');
  assert.equal(events[0]?.type === 'inbound' && events[0].data.body, 'Reschedule');
  assert.equal(events[0]?.type === 'inbound' && events[0].data.rcsMessageId, 'tap_9');
});

test('turns status events into status updates, including the dedicated delivered/read/failed events', () => {
  assert.deepEqual(normalizeSimplyRcsWebhook({ event: 'message.status', data: { messageId: 'm', status: 'SENT', previousStatus: 'QUEUED' } }), [{ type: 'status', data: { rcsMessageId: 'm', status: 'sent', errorCode: undefined, errorMessage: undefined } }]);
  assert.equal(normalizeSimplyRcsWebhook({ event: 'message.read', data: { messageId: 'm' } })[0]?.type === 'status' && (normalizeSimplyRcsWebhook({ event: 'message.read', data: { messageId: 'm' } })[0] as { data: { status: string } }).data.status, 'read');
  const failed = normalizeSimplyRcsWebhook({ event: 'message.failed', data: { messageId: 'm', error: { code: 'E1', message: 'Blocked' } } });
  assert.deepEqual(failed, [{ type: 'status', data: { rcsMessageId: 'm', status: 'failed', errorCode: 'E1', errorMessage: 'Blocked' } }]);
});

test('ignores events it does not handle and malformed payloads', () => {
  assert.deepEqual(normalizeSimplyRcsWebhook({ event: 'blast.completed', data: {} }), [{ type: 'ignored', event: 'blast.completed' }]);
  assert.deepEqual(normalizeSimplyRcsWebhook({ event: 'message.received', data: { messageId: 'x' } }), [{ type: 'ignored', event: 'message.received' }]);
  assert.deepEqual(normalizeSimplyRcsWebhook('nope'), []);
  assert.equal(normalizeSimplyRcsWebhook([{ event: 'message.read', data: { messageId: 'a' } }, { event: 'message.read', data: { messageId: 'b' } }]).length, 2);
});
