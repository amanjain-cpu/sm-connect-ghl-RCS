import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideChannel, sendWithFallback, rcsContentFor, CAPABILITY_TTL_MS } from '../src/services/rcs-routing.service.js';
import type { RoutingPorts, SendPorts } from '../src/services/rcs-routing.service.js';
import { SimplyRcsRejectedError } from '../src/services/simplyrcs-errors.js';
import { ExternalServiceError } from '../src/utils/errors.js';

const liveAgent = { id: 'agent_1', senderIdId: 'sid_1' };

function ports(overrides: Partial<RoutingPorts> = {}): RoutingPorts & { saved: unknown[]; checks: string[] } {
  const saved: unknown[] = [];
  const checks: string[] = [];
  return {
    saved,
    checks,
    getLiveAgent: async () => liveAgent,
    getCachedCapability: async () => null,
    checkCapability: async (phone) => { checks.push(phone); return { isRcsCapable: true, contactId: 'ct_1', provider: 'INFOBIP' }; },
    saveCapability: async (_org, phone, record) => { saved.push({ phone, ...record }); },
    ...overrides,
  };
}

test('routes to SMS when the organization has no live agent', async () => {
  const decision = await decideChannel(ports({ getLiveAgent: async () => null }), { organizationId: 'org', to: '+15125550100' });
  assert.deepEqual(decision, { channel: 'sms', reason: 'no_live_agent' });
});

test('routes to SMS when RCS is switched off for the message', async () => {
  const decision = await decideChannel(ports(), { organizationId: 'org', to: '+15125550100', rcsEnabled: false });
  assert.deepEqual(decision, { channel: 'sms', reason: 'rcs_disabled' });
});

test('checks capability once, caches it, and routes a capable phone to RCS', async () => {
  const p = ports();
  const decision = await decideChannel(p, { organizationId: 'org', to: '+15125550100' });
  assert.deepEqual(decision, { channel: 'rcs', agent: liveAgent, contactId: 'ct_1' });
  assert.deepEqual(p.checks, ['+15125550100']);
  assert.deepEqual(p.saved, [{ phone: '+15125550100', isRcsCapable: true, rcsContactId: 'ct_1', provider: 'INFOBIP' }]);
});

test('uses a fresh cached answer without asking the provider again', async () => {
  const p = ports({ getCachedCapability: async () => ({ isRcsCapable: false, rcsContactId: 'ct_2', checkedAt: new Date() }) });
  const decision = await decideChannel(p, { organizationId: 'org', to: '+15125550101' });
  assert.deepEqual(decision, { channel: 'sms', reason: 'recipient_not_rcs_capable' });
  assert.equal(p.checks.length, 0);
});

test('re-checks a stale cached answer', async () => {
  const stale = new Date(Date.now() - CAPABILITY_TTL_MS - 1000);
  const p = ports({ getCachedCapability: async () => ({ isRcsCapable: false, rcsContactId: 'ct_2', checkedAt: stale }) });
  const decision = await decideChannel(p, { organizationId: 'org', to: '+15125550101' });
  assert.equal(decision.channel, 'rcs');
  assert.equal(p.checks.length, 1);
});

test('a failed capability check never blocks the message: it goes as SMS', async () => {
  const p = ports({ checkCapability: async () => { throw new Error('provider down'); } });
  const decision = await decideChannel(p, { organizationId: 'org', to: '+15125550100' });
  assert.equal(decision.channel, 'sms');
  assert.equal(decision.channel === 'sms' && decision.reason, 'capability_check_failed');
});

function sendPorts(behaviour: { rcs?: 'ok' | 'reject' | 'uncertain' }) {
  const calls: string[] = [];
  const p: SendPorts & { calls: string[] } = {
    calls,
    sendRcs: async () => {
      calls.push('rcs');
      if (behaviour.rcs === 'reject') throw new SimplyRcsRejectedError(400, '400: Recipient device does not support RCS', 'RCS_NOT_SUPPORTED');
      if (behaviour.rcs === 'uncertain') throw new ExternalServiceError('SimplyRCS', 'Uncertain acceptance (502)');
      return { messageId: 'msg_rcs', conversationId: 'conv_1', status: 'QUEUED', providerMessageId: 'ib_1' };
    },
    sendSms: async () => { calls.push('sms'); return { messageId: 'sm_1', status: 'sent' }; },
  };
  return p;
}

const base = { from: '+12542236348', to: '+15125550100', body: 'Hello', idempotencyKey: 'msg:1' };

test('sends on RCS when the decision is RCS', async () => {
  const p = sendPorts({ rcs: 'ok' });
  const outcome = await sendWithFallback(p, { ...base, decision: { channel: 'rcs', agent: liveAgent, contactId: 'ct_1' } });
  assert.deepEqual(outcome, { channel: 'rcs', rcsMessageId: 'msg_rcs', rcsConversationId: 'conv_1', fallbackReason: null });
  assert.deepEqual(p.calls, ['rcs']);
});

test('falls back to SMS in the same call when SimplyRCS definitively rejects', async () => {
  const p = sendPorts({ rcs: 'reject' });
  const outcome = await sendWithFallback(p, { ...base, decision: { channel: 'rcs', agent: liveAgent, contactId: 'ct_1' } });
  assert.equal(outcome.channel, 'sms');
  assert.equal(outcome.channel === 'sms' && outcome.fallbackReason, 'rcs_rejected');
  assert.deepEqual(p.calls, ['rcs', 'sms']);
});

test('does not send twice when the RCS outcome is uncertain', async () => {
  const p = sendPorts({ rcs: 'uncertain' });
  await assert.rejects(sendWithFallback(p, { ...base, decision: { channel: 'rcs', agent: liveAgent, contactId: 'ct_1' } }), /Uncertain acceptance/);
  assert.deepEqual(p.calls, ['rcs']);
});

test('sends straight to SMS, keeping the reason, when the decision was SMS', async () => {
  const p = sendPorts({});
  const outcome = await sendWithFallback(p, { ...base, decision: { channel: 'sms', reason: 'no_live_agent' } });
  assert.deepEqual(outcome, { channel: 'sms', signalmashMessageId: 'sm_1', fallbackReason: 'no_live_agent', detail: undefined });
  assert.deepEqual(p.calls, ['sms']);
});

test('reports MMS as the channel when media goes out over Signalmash', async () => {
  const p = sendPorts({});
  const outcome = await sendWithFallback(p, { ...base, mediaUrls: ['https://cdn.example.com/a.jpg'], decision: { channel: 'sms', reason: 'recipient_not_rcs_capable' } });
  assert.equal(outcome.channel, 'mms');
});

test('builds RCS content: text, media card, bare media, or the composed rich content', () => {
  assert.deepEqual(rcsContentFor({ body: 'Hi there' }), { type: 'text', text: 'Hi there' });
  assert.deepEqual(rcsContentFor({ body: 'Your order', mediaUrls: ['https://cdn.example.com/a.png'] }), { type: 'card', card: { title: 'Your order', description: undefined, media: { type: 'image', url: 'https://cdn.example.com/a.png' } } });
  assert.deepEqual(rcsContentFor({ body: '', mediaUrls: ['https://cdn.example.com/a.mp4'] }), { type: 'media', media: { type: 'video', url: 'https://cdn.example.com/a.mp4' } });
  const rich = { type: 'card' as const, card: { title: 'Pick one', actions: [{ type: 'reply' as const, label: 'Yes', value: 'yes' }] } };
  assert.equal(rcsContentFor({ body: 'ignored', rcsContent: rich }), rich);
});
