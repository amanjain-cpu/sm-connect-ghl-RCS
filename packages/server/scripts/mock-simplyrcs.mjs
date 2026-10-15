#!/usr/bin/env node
// Local SimplyRCS sandbox for development and demos. Mirrors the endpoints the app uses, with the
// response shapes from the public OpenAPI spec, and plays the provider's side: agent review,
// capability answers, delivery receipts, and customer replies. Not a real network; nothing leaves
// this machine.
//
//   SIMPLYRCS_API_KEY=mock MOCK_RCS_WEBHOOK_URL=http://127.0.0.1:3001/api/webhooks/simplyrcs \
//   MOCK_RCS_WEBHOOK_SECRET=mock-secret node scripts/mock-simplyrcs.mjs
//
// Sandbox-only helpers:
//   POST /sandbox/reset                 start clean
//   POST /sandbox/approve-agent         move every agent to LIVE at once
//   POST /sandbox/reply {from, text}    the customer replies (fires message.received)
//   POST /sandbox/tap {from, label}     the customer taps a suggestion (fires button.clicked)
//   GET  /sandbox/state

import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = Number(process.env.MOCK_RCS_PORT ?? 4020);
const API_KEY = process.env.SIMPLYRCS_API_KEY ?? 'mock';
const WEBHOOK_URL = process.env.MOCK_RCS_WEBHOOK_URL ?? '';
const WEBHOOK_SECRET = process.env.MOCK_RCS_WEBHOOK_SECRET ?? 'mock-secret';
const APPROVAL_MS = Number(process.env.MOCK_RCS_APPROVAL_SECONDS ?? 20) * 1000;
const STATE_FILE = process.env.MOCK_RCS_STATE_FILE ?? '.mock-simplyrcs/state.json';
// Phones whose last digit is even are RCS-capable, so both routes can be demoed with chosen numbers.
const capableRule = (phone) => (Number(phone.replace(/\D/g, '').slice(-1)) % 2 === 0);

let state = { channels: [{ id: 'chan_rcs_1', orgId: 'org_mock', type: 'RCS', provider: 'INFOBIP', status: 'ACTIVE', createdAt: new Date().toISOString() }], agents: [], senderIds: [], contacts: [], messages: [], endpoints: [], tapCounter: 0 };
if (existsSync(STATE_FILE)) { try { state = { ...state, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; } catch { /* fresh */ } }
const persist = () => { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); };
const id = (prefix) => `${prefix}_${randomBytes(6).toString('hex')}`;
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const e164 = (value) => { const d = String(value ?? '').replace(/\D/g, ''); return d.length === 10 ? `+1${d}` : d.startsWith('1') && d.length === 11 ? `+${d}` : `+${d}`; };

function agentStatus(agent) {
  if (agent.forcedStatus) return agent.forcedStatus;
  const age = Date.now() - agent.createdAt;
  if (age < APPROVAL_MS) return 'READY_FOR_TESTING';
  if (!agent.launchRequestedAt) return agent.testDevices.length ? 'IN_TESTING' : 'READY_FOR_TESTING';
  return Date.now() - agent.launchRequestedAt < APPROVAL_MS ? 'PENDING_LAUNCH' : 'LIVE';
}
const publicAgent = (a) => ({ senderName: a.senderName, status: agentStatus(a), senderStatus: agentStatus(a), brand: a.brand, displayName: a.displayName, description: a.description, logoUrl: a.logoUrl, bannerUrl: a.bannerUrl, color: a.color, billingCategory: a.billingCategory, useCase: a.useCase, phone: a.phone, email: a.email, website: a.website, privacyUrl: a.privacyUrl, termsOfServiceUrl: a.termsOfServiceUrl });
const publicSenderId = (s) => { const agent = state.agents.find((a) => a.senderName === s.identifier); return { ...s, status: agent && agentStatus(agent) === 'LIVE' ? 'ACTIVE' : s.status, registrationStatus: agent ? (agentStatus(agent) === 'LIVE' ? 'APPROVED' : 'IN_REVIEW') : s.registrationStatus, protocols: [{ id: `${s.id}_p`, type: 'RCS_RICH', enabled: true, createdAt: s.createdAt }] }; };

async function deliver(event, data) {
  if (!WEBHOOK_URL) { log('no webhook url; event dropped', event); return; }
  const body = JSON.stringify({ event, data, timestamp: new Date().toISOString(), orgId: 'org_mock' });
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  try {
    const res = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': signature }, body });
    log('->', event, res.status);
  } catch (error) { log('webhook delivery failed', event, String(error)); }
}

function scheduleReceipts(message) {
  const steps = message.content?.type === 'text' && /fail/i.test(message.content.text ?? '')
    ? [['message.status', 'SENT', 800], ['message.failed', 'FAILED', 2500]]
    : [['message.status', 'SENT', 800], ['message.delivered', 'DELIVERED', 2500], ['message.read', 'SEEN', 6000]];
  for (const [event, status, delay] of steps) {
    setTimeout(() => {
      message.status = status;
      deliver(event, { messageId: message.id, conversationId: message.conversationId, contactId: message.contactId, senderIdId: message.senderIdId, status, previousStatus: message.previousStatus ?? 'QUEUED', channelType: 'RCS', ...(status === 'FAILED' ? { errorCode: 'MOCK_FAIL', errorMessage: 'Body contained the word fail' } : {}) });
      message.previousStatus = status;
    }, delay);
  }
}

const json = (res, status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
const fail = (res, status, error, message) => json(res, status, { error, message });

const routes = {
  'GET /health': () => ({ status: 200, body: { status: 'ok' } }),
  'GET /v1/channels': () => ({ status: 200, body: { data: state.channels } }),
  'GET /v1/sender-ids': (q) => ({ status: 200, body: { data: state.senderIds.filter((s) => !q.type || s.type === q.type).map(publicSenderId) } }),
  'POST /v1/contacts': (q, b) => {
    const phone = e164(b.phone); if (!phone || phone.length < 8) return { status: 400, body: { error: 'VALIDATION', message: 'phone is required' } };
    const existing = state.contacts.find((c) => c.phone === phone); if (existing) return { status: 201, body: existing };
    const contact = { id: id('ct'), orgId: 'org_mock', phone, name: b.name ?? null, rcsCap: capableRule(phone), lifecycleStatus: 'PARTICIPANT', attributes: null, tags: [], subscriptions: [], createdAt: new Date().toISOString() };
    state.contacts.push(contact); return { status: 201, body: contact };
  },
  'GET /v1/contacts': (q) => { const digits = String(q.search ?? '').replace(/\D/g, ''); return { status: 200, body: { data: state.contacts.filter((c) => !digits || c.phone.replace(/\D/g, '').includes(digits)).slice(0, Number(q.limit ?? 20)) } }; },
  'POST /v1/messages/send': (q, b, headers) => {
    const key = headers['idempotency-key']; if (!key) return { status: 400, body: { error: 'VALIDATION', message: 'Idempotency-Key header is required' } };
    const dup = state.messages.find((m) => m.idempotencyKey === key); if (dup) return { status: 200, body: dup.response };
    const senderId = state.senderIds.find((s) => s.id === b.senderIdId); if (!senderId) return { status: 400, body: { error: 'VALIDATION', message: 'Unknown senderIdId' } };
    const agent = state.agents.find((a) => a.senderName === senderId.identifier); if (!agent || agentStatus(agent) !== 'LIVE') return { status: 400, body: { error: 'SENDER_NOT_LIVE', message: `Sender ${senderId.identifier} is ${agent ? agentStatus(agent) : 'missing'}` } };
    let contact = b.contactId ? state.contacts.find((c) => c.id === b.contactId) : state.contacts.find((c) => c.phone === e164(b.to));
    if (!contact && b.to) { contact = { id: id('ct'), orgId: 'org_mock', phone: e164(b.to), name: null, rcsCap: capableRule(e164(b.to)), lifecycleStatus: 'PARTICIPANT', attributes: null, tags: [], subscriptions: [], createdAt: new Date().toISOString() }; state.contacts.push(contact); }
    if (!contact) return { status: 400, body: { error: 'VALIDATION', message: 'to or contactId is required' } };
    if (!contact.rcsCap) return { status: 400, body: { error: 'RCS_NOT_SUPPORTED', message: 'Recipient device does not support RCS' } };
    if (!b.content?.type) return { status: 400, body: { error: 'VALIDATION', message: 'content.type is required' } };
    const conversationId = state.messages.find((m) => m.contactId === contact.id)?.conversationId ?? id('conv');
    const message = { id: id('msg'), idempotencyKey: key, contactId: contact.id, conversationId, senderIdId: senderId.id, content: b.content, status: 'QUEUED', direction: 'outbound', createdAt: new Date().toISOString() };
    message.response = { messageId: message.id, contactId: contact.id, conversationId, status: 'QUEUED', billingType: 'RCS_RICH', providerMessageId: id('ib') };
    state.messages.push(message); scheduleReceipts(message);
    log('RCS message accepted', message.id, 'to', contact.phone, b.content.type);
    return { status: 200, body: message.response };
  },
  'GET /v1/webhook-endpoints': () => ({ status: 200, body: { data: state.endpoints.map(({ secret, ...rest }) => rest) } }),
  'POST /v1/webhook-endpoints': (q, b) => { const endpoint = { id: id('wh'), url: b.url, events: b.events ?? [], isActive: true, consecutiveFailures: 0, lastSuccessAt: null, lastFailAt: null, createdAt: new Date().toISOString(), secret: WEBHOOK_SECRET }; state.endpoints.push(endpoint); return { status: 201, body: endpoint }; },
  'POST /sandbox/reset': () => { state = { ...state, agents: [], senderIds: [], contacts: [], messages: [], endpoints: [] }; return { status: 200, body: { ok: true } }; },
  'POST /sandbox/approve-agent': () => { for (const a of state.agents) a.forcedStatus = 'LIVE'; return { status: 200, body: { live: state.agents.length } }; },
  'POST /sandbox/reply': async (q, b) => {
    const contact = state.contacts.find((c) => c.phone === e164(b.from)) ?? state.contacts[0]; if (!contact) return { status: 404, body: { error: 'NOT_FOUND', message: 'No such contact' } };
    const last = [...state.messages].reverse().find((m) => m.contactId === contact.id);
    const message = { id: id('msg'), contactId: contact.id, conversationId: last?.conversationId ?? id('conv'), senderIdId: last?.senderIdId ?? state.senderIds[0]?.id, direction: 'inbound', status: 'DELIVERED', createdAt: new Date().toISOString() };
    state.messages.push(message);
    await deliver('message.received', { messageId: message.id, conversationId: message.conversationId, contactId: contact.id, senderIdId: message.senderIdId, from: contact.phone, channelType: 'RCS', contentJson: { type: 'text', text: String(b.text ?? 'Thanks!') } });
    return { status: 200, body: { ok: true, messageId: message.id } };
  },
  'POST /sandbox/tap': async (q, b) => {
    const contact = state.contacts.find((c) => c.phone === e164(b.from)) ?? state.contacts[0]; if (!contact) return { status: 404, body: { error: 'NOT_FOUND', message: 'No such contact' } };
    const last = [...state.messages].reverse().find((m) => m.contactId === contact.id && m.direction === 'outbound');
    state.tapCounter += 1;
    await deliver('button.clicked', { eventId: `tap_${state.tapCounter}`, messageId: last?.id ?? null, conversationId: last?.conversationId ?? null, contactId: contact.id, senderIdId: last?.senderIdId ?? state.senderIds[0]?.id, from: contact.phone, buttonLabel: String(b.label ?? 'Yes'), buttonPayload: String(b.payload ?? b.label ?? 'Yes') });
    return { status: 200, body: { ok: true } };
  },
  'GET /sandbox/state': () => ({ status: 200, body: { agents: state.agents.map(publicAgent), senderIds: state.senderIds.map(publicSenderId), contacts: state.contacts.map((c) => ({ phone: c.phone, rcsCap: c.rcsCap })), messages: state.messages.length, endpoints: state.endpoints.length } }),
};

function dynamic(method, path, q, b) {
  let m;
  if ((m = path.match(/^\/v1\/channels\/([^/]+)\/rcs\/senders$/))) {
    const channel = state.channels.find((c) => c.id === decodeURIComponent(m[1])); if (!channel) return { status: 404, body: { error: 'NOT_FOUND', message: 'Channel not found' } };
    if (method === 'GET') return { status: 200, body: { data: state.agents.map(publicAgent) } };
    if (method === 'POST') {
      for (const f of ['senderName', 'brand', 'displayName', 'description', 'logoUrl', 'bannerUrl', 'color', 'billingCategory', 'useCase']) if (!b[f]) return { status: 400, body: { error: 'VALIDATION', message: `${f} is required` } };
      if (state.agents.some((a) => a.senderName === b.senderName)) return { status: 400, body: { error: 'CONFLICT', message: 'senderName already exists' } };
      const agent = { ...b, createdAt: Date.now(), testDevices: [], launchRequestedAt: null };
      state.agents.push(agent);
      state.senderIds.push({ id: id('sid'), orgId: 'org_mock', type: 'RCS_AGENT', identifier: agent.senderName, status: 'PENDING', provider: 'INFOBIP', channelId: channel.id, registrationStatus: 'SUBMITTED', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      log('agent created', agent.senderName);
      return { status: 201, body: publicAgent(agent) };
    }
  }
  if ((m = path.match(/^\/v1\/channels\/([^/]+)\/rcs\/senders\/([^/]+)$/)) && method === 'GET') {
    const agent = state.agents.find((a) => a.senderName === decodeURIComponent(m[2])); return agent ? { status: 200, body: publicAgent(agent) } : { status: 404, body: { error: 'NOT_FOUND', message: 'Sender not found' } };
  }
  if ((m = path.match(/^\/v1\/channels\/([^/]+)\/rcs\/senders\/([^/]+)\/test-devices$/))) {
    const agent = state.agents.find((a) => a.senderName === decodeURIComponent(m[2])); if (!agent) return { status: 404, body: { error: 'NOT_FOUND', message: 'Sender not found' } };
    if (method === 'GET') return { status: 200, body: { data: agent.testDevices } };
    const device = { phoneNumber: e164(b.phoneNumber), status: 'WAITING_FOR_TESTER_ACCEPTANCE', requestStatus: 'SENT', updatedAt: new Date().toISOString() };
    agent.testDevices.push(device); setTimeout(() => { device.status = 'ACCEPTED'; persist(); }, 5000);
    return { status: 201, body: device };
  }
  if ((m = path.match(/^\/v1\/sender-ids\/([^/]+)\/(submit|launch|refresh-status)$/)) && method === 'POST') {
    const senderId = state.senderIds.find((s) => s.id === decodeURIComponent(m[1])); if (!senderId) return { status: 404, body: { error: 'NOT_FOUND', message: 'Sender id not found' } };
    const agent = state.agents.find((a) => a.senderName === senderId.identifier);
    if (m[2] === 'launch') { if (agent) agent.launchRequestedAt = Date.now(); return { status: 200, body: { senderId: publicSenderId(senderId), launch: { status: 'LAUNCH_PENDING' } } }; }
    if (m[2] === 'submit') return { status: 200, body: { senderId: publicSenderId(senderId), submission: { status: 'SUBMITTED' } } };
    return { status: 200, body: { data: { status: agent ? agentStatus(agent) : 'UNKNOWN' } } };
  }
  if ((m = path.match(/^\/v1\/sender-ids\/([^/]+)$/)) && method === 'GET') { const s = state.senderIds.find((x) => x.id === decodeURIComponent(m[1])); return s ? { status: 200, body: publicSenderId(s) } : { status: 404, body: { error: 'NOT_FOUND', message: 'Sender id not found' } }; }
  if ((m = path.match(/^\/v1\/contacts\/([^/]+)\/rcs-check$/)) && method === 'GET') {
    const contact = state.contacts.find((c) => c.id === decodeURIComponent(m[1])); if (!contact) return { status: 404, body: { error: 'NOT_FOUND', message: 'Contact not found' } };
    return { status: 200, body: { contactId: contact.id, phone: contact.phone, isRcsCapable: contact.rcsCap, provider: 'INFOBIP', checkedAt: new Date().toISOString(), cached: false } };
  }
  if ((m = path.match(/^\/v1\/webhook-endpoints\/([^/]+)\/test$/)) && method === 'POST') return { status: 200, body: { statusCode: 200, responseTime: 12, success: true } };
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { return fail(res, 400, 'VALIDATION', 'Body must be JSON'); }
  const query = Object.fromEntries(url.searchParams.entries());
  if (!url.pathname.startsWith('/sandbox') && url.pathname !== '/health') {
    const auth = req.headers['authorization'] ?? ''; const key = req.headers['x-api-key'];
    if (auth !== `Bearer ${API_KEY}` && key !== API_KEY) return fail(res, 401, 'UNAUTHORIZED', 'Invalid API key');
  }
  const handler = routes[`${req.method} ${url.pathname}`];
  const result = handler ? await handler(query, body, req.headers) : dynamic(req.method, url.pathname, query, body);
  if (!result) return fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${url.pathname}`);
  persist();
  log(req.method, url.pathname, result.status);
  json(res, result.status, result.body);
}).listen(PORT, () => log(`SimplyRCS sandbox listening on http://localhost:${PORT} (approval after ${APPROVAL_MS / 1000}s; even last digit = RCS-capable)`));
