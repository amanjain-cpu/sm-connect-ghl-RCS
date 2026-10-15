// ===========================================
// SimplyRCS API client (RCS messaging)
// ===========================================
//
// Built from the SimplyRCS customer OpenAPI spec (https://simplyrcs.signalmash.com/api/openapi/customer).
// SimplyRCS carries RCS only; SMS/MMS fallback stays on Signalmash (see rcs-routing.service.ts).

import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { decrypt } from '../utils/crypto.js';
import { ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { SETTINGS_KEYS } from './admin.service.js';

const SETTINGS_CACHE_TTL = 300;

export type RcsProtocol = 'RCS_RICH' | 'RCS_MULTIMEDIA';
export type RcsMessageType = 'MARKETING' | 'TRANSACTIONAL' | 'SERVICE';

/** Suggested replies and actions shown under an RCS message. */
export interface RcsAction {
  type: 'reply' | 'url' | 'call' | 'location' | 'calendar';
  label: string;
  value: string;
}

export interface RcsMedia {
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
  thumbnail?: string;
}

export interface RcsCard {
  title: string;
  description?: string;
  media?: RcsMedia;
  actions?: RcsAction[];
}

export type RcsContent =
  | { type: 'text'; text: string; actions?: RcsAction[] }
  | { type: 'card'; card: RcsCard }
  | { type: 'carousel'; carousel: { cards: RcsCard[] } }
  | { type: 'media'; media: RcsMedia; actions?: RcsAction[] };

export interface SimplyRcsSendInput {
  senderIdId: string;
  to?: string;
  contactId?: string;
  protocolType?: RcsProtocol;
  messageType: RcsMessageType;
  content: RcsContent;
  idempotencyKey: string;
  /** Let SimplyRCS fall back to its own SMS route. Off by default: fallback is Signalmash's job. */
  fallbackToSms?: boolean;
}

export interface SimplyRcsSendResult {
  messageId: string;
  conversationId: string;
  contactId?: string;
  status: string;
  providerMessageId: string;
  fallbackUsed?: string;
}

export interface SimplyRcsContact {
  id: string;
  phone: string;
  rcsCap: boolean;
  lifecycleStatus?: string;
}

export interface SimplyRcsCapability {
  contactId: string;
  phone: string;
  isRcsCapable: boolean;
  provider: string;
  checkedAt: string;
  cached: boolean;
}

export interface SimplyRcsChannel {
  id: string;
  type: 'RCS' | 'WA' | 'MMS' | 'SMS';
  provider: string;
  status: string;
}

export interface SimplyRcsSenderId {
  id: string;
  type: 'TEN_DLC' | 'TOLL_FREE' | 'SHORT_CODE' | 'RCS_AGENT' | 'WA_BUSINESS';
  identifier: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'RELEASED';
  provider: string;
  channelId?: string | null;
  registrationStatus?: 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  registrationData?: Record<string, unknown>;
  protocols?: Array<{ type: string; enabled: boolean }>;
}

export type SimplyRcsAgentStatus =
  | 'READY_FOR_TESTING'
  | 'IN_TESTING'
  | 'PENDING_LAUNCH'
  | 'LIVE'
  | 'SUSPENDED'
  | 'UNKNOWN';

export interface SimplyRcsAgent {
  senderName: string;
  status?: SimplyRcsAgentStatus;
  senderStatus?: SimplyRcsAgentStatus;
  displayName?: string;
  description?: string;
  logoUrl?: string;
  bannerUrl?: string;
  color?: string;
  billingCategory?: string;
  useCase?: string;
  phone?: string;
  email?: string;
  website?: string;
  privacyUrl?: string;
  termsOfServiceUrl?: string;
  /** Brand name, or the brand object the dev environment returns. */
  brand?: string | { brandName?: string };
}

export interface CreateRcsAgentInput {
  senderName: string;
  brand: string;
  displayName: string;
  description: string;
  logoUrl: string;
  bannerUrl: string;
  color: string;
  billingCategory: 'NON_CONVERSATIONAL' | 'CONVERSATIONAL';
  useCase: 'OTP' | 'TRANSACTIONAL' | 'PROMOTIONAL' | 'MULTI_USE';
  hostingRegion?: string;
  phone?: string;
  phoneLabel?: string;
  email?: string;
  emailLabel?: string;
  website?: string;
  websiteLabel?: string;
  privacyUrl?: string;
  privacyLabel?: string;
  termsOfServiceUrl?: string;
  termsOfServiceLabel?: string;
}

export interface SimplyRcsTestDevice {
  phoneNumber: string;
  status: string;
  requestStatus?: string;
  updatedAt?: string;
}

export type SimplyRcsWebhookEvent =
  | 'message.received'
  | 'message.status'
  | 'message.delivered'
  | 'message.read'
  | 'message.failed'
  | 'message.revoked'
  | 'button.clicked'
  | 'handoff'
  | 'contact.opted_out';

export { verifySimplyRcsSignature } from './simplyrcs-webhook.service.js';

import { SimplyRcsRejectedError } from './simplyrcs-errors.js';
export { SimplyRcsRejectedError };

export class SimplyRcsService {
  private async getSetting(key: string, envFallback: string): Promise<string> {
    const cacheKey = `setting:${key}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return cached;
    } catch (error) {
      logger.debug({ error }, 'Redis cache unavailable');
    }
    try {
      const setting = await prisma.appSettings.findUnique({ where: { key } });
      if (setting && setting.value) {
        const value = setting.isEncrypted ? decrypt(setting.value) : setting.value;
        try { await redis.setex(cacheKey, SETTINGS_CACHE_TTL, value); } catch { /* ignore */ }
        return value;
      }
    } catch (error) {
      logger.debug({ error, key }, 'Failed to get setting from database');
    }
    return envFallback;
  }

  async getConfig(): Promise<{ apiUrl: string; apiKey: string; webhookSecret: string }> {
    const [apiUrl, apiKey, webhookSecret] = await Promise.all([
      this.getSetting(SETTINGS_KEYS.SIMPLYRCS_API_URL, config.simplyrcsApiUrl),
      this.getSetting(SETTINGS_KEYS.SIMPLYRCS_API_KEY, config.simplyrcsApiKey || ''),
      this.getSetting(SETTINGS_KEYS.SIMPLYRCS_WEBHOOK_SECRET, config.simplyrcsWebhookSecret || ''),
    ]);
    return { apiUrl: apiUrl.replace(/\/+$/, ''), apiKey, webhookSecret };
  }

  async isConfigured(): Promise<boolean> {
    return Boolean((await this.getConfig()).apiKey);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    options: { body?: unknown; idempotencyKey?: string; query?: Record<string, string | undefined> } = {}
  ): Promise<T> {
    const { apiUrl, apiKey } = await this.getConfig();
    if (!apiKey) {
      throw new ExternalServiceError('SimplyRCS', 'API key not configured. Please configure it in Admin Settings.');
    }
    const url = new URL(`${apiUrl}${endpoint}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
      throw new ExternalServiceError('SimplyRCS', `Could not reach ${url.origin}: ${cause?.code ?? (error instanceof Error ? error.message : 'network error')}`);
    }

    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

    if (!response.ok) {
      const detail = payload && typeof payload === 'object'
        ? String((payload as { message?: string; error?: string }).message ?? (payload as { error?: string }).error ?? text)
        : text;
      const code = payload && typeof payload === 'object' ? (payload as { error?: string }).error : undefined;
      logger.warn({ method, endpoint, status: response.status, detail: detail.slice(0, 300) }, 'SimplyRCS request rejected');
      if (response.status === 502) {
        // Provider acceptance uncertain: the spec says not to resend automatically.
        throw new ExternalServiceError('SimplyRCS', `Uncertain acceptance (502): ${detail.slice(0, 200)}`);
      }
      throw new SimplyRcsRejectedError(response.status, `${response.status}: ${detail.slice(0, 300)}`, code);
    }
    return payload as T;
  }

  // ---------------- health and inventory ----------------

  async health(): Promise<{ ok: boolean; detail: string }> {
    const { apiUrl } = await this.getConfig();
    try {
      const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(10_000) });
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async listChannels(): Promise<SimplyRcsChannel[]> {
    const payload = await this.request<{ data?: SimplyRcsChannel[]; channels?: SimplyRcsChannel[] } | SimplyRcsChannel[]>('GET', '/v1/channels');
    return Array.isArray(payload) ? payload : payload.data ?? payload.channels ?? [];
  }

  async listSenderIds(filter: { type?: string; status?: string } = {}): Promise<SimplyRcsSenderId[]> {
    const payload = await this.request<{ data?: SimplyRcsSenderId[]; senderIds?: SimplyRcsSenderId[] } | SimplyRcsSenderId[]>('GET', '/v1/sender-ids', { query: filter });
    return Array.isArray(payload) ? payload : payload.data ?? payload.senderIds ?? [];
  }

  async getSenderId(id: string): Promise<SimplyRcsSenderId> {
    const payload = await this.request<{ data?: SimplyRcsSenderId; senderId?: SimplyRcsSenderId } & Partial<SimplyRcsSenderId>>('GET', `/v1/sender-ids/${encodeURIComponent(id)}`);
    return (payload.data ?? payload.senderId ?? payload) as SimplyRcsSenderId;
  }

  // ---------------- RCS agents ----------------

  async listAgents(channelId: string): Promise<SimplyRcsAgent[]> {
    const payload = await this.request<{ data?: SimplyRcsAgent[]; senders?: SimplyRcsAgent[] } | SimplyRcsAgent[]>('GET', `/v1/channels/${encodeURIComponent(channelId)}/rcs/senders`);
    return Array.isArray(payload) ? payload : payload.data ?? payload.senders ?? [];
  }

  async createAgent(channelId: string, input: CreateRcsAgentInput): Promise<SimplyRcsAgent> {
    const payload = await this.request<{ data?: SimplyRcsAgent; sender?: SimplyRcsAgent } & Partial<SimplyRcsAgent>>('POST', `/v1/channels/${encodeURIComponent(channelId)}/rcs/senders`, { body: input });
    return (payload.data ?? payload.sender ?? payload) as SimplyRcsAgent;
  }

  async getAgent(channelId: string, senderName: string): Promise<SimplyRcsAgent> {
    const payload = await this.request<{ data?: SimplyRcsAgent; sender?: SimplyRcsAgent } & Partial<SimplyRcsAgent>>('GET', `/v1/channels/${encodeURIComponent(channelId)}/rcs/senders/${encodeURIComponent(senderName)}`);
    return (payload.data ?? payload.sender ?? payload) as SimplyRcsAgent;
  }

  async listTestDevices(channelId: string, senderName: string): Promise<SimplyRcsTestDevice[]> {
    const payload = await this.request<{ data?: SimplyRcsTestDevice[]; devices?: SimplyRcsTestDevice[] } | SimplyRcsTestDevice[]>('GET', `/v1/channels/${encodeURIComponent(channelId)}/rcs/senders/${encodeURIComponent(senderName)}/test-devices`);
    return Array.isArray(payload) ? payload : payload.data ?? payload.devices ?? [];
  }

  async addTestDevice(channelId: string, senderName: string, phoneNumber: string): Promise<SimplyRcsTestDevice> {
    const payload = await this.request<{ data?: SimplyRcsTestDevice; device?: SimplyRcsTestDevice } & Partial<SimplyRcsTestDevice>>('POST', `/v1/channels/${encodeURIComponent(channelId)}/rcs/senders/${encodeURIComponent(senderName)}/test-devices`, { body: { phoneNumber } });
    return (payload.data ?? payload.device ?? payload) as SimplyRcsTestDevice;
  }

  /** Submits the agent's sender id for review ("regulatory vetting" in the spec). */
  async submitSenderId(senderIdId: string, resubmit = false): Promise<SimplyRcsSenderId> {
    const payload = await this.request<{ senderId: SimplyRcsSenderId }>('POST', `/v1/sender-ids/${encodeURIComponent(senderIdId)}/submit`, { body: { resubmit } });
    return payload.senderId;
  }

  async refreshSenderIdStatus(senderIdId: string): Promise<Record<string, unknown>> {
    const payload = await this.request<{ data: Record<string, unknown> }>('POST', `/v1/sender-ids/${encodeURIComponent(senderIdId)}/refresh-status`);
    return payload.data ?? {};
  }

  /** Promotes a tested agent to go-live (LAUNCH_PENDING on the provider side). */
  async launchSenderId(senderIdId: string): Promise<SimplyRcsSenderId> {
    const payload = await this.request<{ senderId: SimplyRcsSenderId }>('POST', `/v1/sender-ids/${encodeURIComponent(senderIdId)}/launch`);
    return payload.senderId;
  }

  // ---------------- contacts and capability ----------------

  async findContactByPhone(phone: string): Promise<SimplyRcsContact | null> {
    const payload = await this.request<{ data?: SimplyRcsContact[]; contacts?: SimplyRcsContact[] }>('GET', '/v1/contacts', { query: { search: phone, limit: '5' } });
    const rows = payload.data ?? payload.contacts ?? [];
    const digits = phone.replace(/\D/g, '');
    return rows.find((row) => row.phone.replace(/\D/g, '') === digits) ?? null;
  }

  async createContact(phone: string, name?: string): Promise<SimplyRcsContact> {
    return this.request<SimplyRcsContact>('POST', '/v1/contacts', { body: { phone, name: name ?? null } });
  }

  async ensureContact(phone: string, name?: string): Promise<SimplyRcsContact> {
    const existing = await this.findContactByPhone(phone);
    if (existing) return existing;
    try {
      return await this.createContact(phone, name);
    } catch (error) {
      // Created concurrently, or the search did not surface it: look again before giving up.
      const again = await this.findContactByPhone(phone);
      if (again) return again;
      throw error;
    }
  }

  async checkCapability(contactId: string): Promise<SimplyRcsCapability> {
    return this.request<SimplyRcsCapability>('GET', `/v1/contacts/${encodeURIComponent(contactId)}/rcs-check`);
  }

  // ---------------- messages ----------------

  async sendMessage(input: SimplyRcsSendInput): Promise<SimplyRcsSendResult> {
    const body = {
      ...(input.contactId ? { contactId: input.contactId } : {}),
      ...(input.to ? { to: input.to } : {}),
      senderIdId: input.senderIdId,
      channelType: 'RCS',
      protocolType: input.protocolType ?? 'RCS_RICH',
      messageType: input.messageType,
      fallbackToSms: input.fallbackToSms ?? false,
      content: input.content,
    };
    return this.request<SimplyRcsSendResult>('POST', '/v1/messages/send', { body, idempotencyKey: input.idempotencyKey });
  }

  async revokeMessage(messageId: string): Promise<void> {
    await this.request('POST', `/v1/messages/${encodeURIComponent(messageId)}/revoke`);
  }

  // ---------------- webhooks ----------------

  async listWebhookEndpoints(): Promise<Array<{ id: string; url: string; events: string[]; isActive: boolean }>> {
    const payload = await this.request<{ data?: Array<{ id: string; url: string; events: string[]; isActive: boolean }>; endpoints?: Array<{ id: string; url: string; events: string[]; isActive: boolean }> }>('GET', '/v1/webhook-endpoints');
    return payload.data ?? payload.endpoints ?? [];
  }

  /** Registers our callback URL. The signing secret is returned once; the caller must store it. */
  async createWebhookEndpoint(url: string, events: SimplyRcsWebhookEvent[]): Promise<{ id: string; secret: string | null }> {
    const payload = await this.request<{ id?: string; secret?: string; endpoint?: { id: string }; data?: { id?: string; secret?: string } }>('POST', '/v1/webhook-endpoints', { body: { url, events } });
    const id = payload.id ?? payload.endpoint?.id ?? payload.data?.id ?? '';
    const secret = payload.secret ?? payload.data?.secret ?? null;
    return { id, secret };
  }

  async testWebhookEndpoint(id: string): Promise<{ success: boolean; statusCode: number }> {
    return this.request<{ success: boolean; statusCode: number }>('POST', `/v1/webhook-endpoints/${encodeURIComponent(id)}/test`);
  }

  /** Read-only diagnostic for the admin portal. */
  async runConnectionDiagnostic(): Promise<{
    testedAt: string;
    apiBaseUrl: string;
    ok: boolean;
    message: string;
    channels?: number;
    rcsChannels?: number;
    senderIds?: number;
    rcsAgents?: number;
    webhookEndpoints?: number;
  }> {
    const { apiUrl, apiKey } = await this.getConfig();
    const base = { testedAt: new Date().toISOString(), apiBaseUrl: apiUrl };
    if (!apiKey) return { ...base, ok: false, message: 'API key not configured' };
    try {
      const [channels, senderIds, endpoints] = await Promise.all([this.listChannels(), this.listSenderIds(), this.listWebhookEndpoints()]);
      return {
        ...base,
        ok: true,
        message: 'SimplyRCS answered.',
        channels: channels.length,
        rcsChannels: channels.filter((c) => c.type === 'RCS').length,
        senderIds: senderIds.length,
        rcsAgents: senderIds.filter((s) => s.type === 'RCS_AGENT').length,
        webhookEndpoints: endpoints.length,
      };
    } catch (error) {
      return { ...base, ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const simplyRcsService = new SimplyRcsService();
export const newIdempotencyKey = () => randomUUID();
