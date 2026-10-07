// ===========================================
// SimplyRCS webhook normalisation
// ===========================================
//
// Envelope (integration guide): { event, data, timestamp, orgId }. Field names inside `data` are
// read defensively because the spec leaves them open; every alias seen in the docs is accepted.

import { createHmac, timingSafeEqual } from 'crypto';

/** Lowercase hex HMAC-SHA256 of the raw request body, sent in the X-Signature header. */
export function verifySimplyRcsSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signature.trim().toLowerCase().replace(/^sha256=/, '');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}

export type NormalizedSimplyRcsEvent =
  | {
      type: 'inbound';
      data: {
        rcsMessageId: string;
        rcsConversationId?: string | null;
        senderIdId?: string | null;
        organizationId?: string | null;
        from: string;
        body: string;
        mediaUrls?: string[];
      };
    }
  | {
      type: 'status';
      data: { rcsMessageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; errorCode?: string; errorMessage?: string };
    }
  | { type: 'ignored'; event: string };

type Json = Record<string, unknown>;

function text(source: Json | undefined, ...keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return undefined;
}

function object(source: Json | undefined, key: string): Json | undefined {
  const value = source?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;
}

/** The customer's phone, from whichever place the event carries it. */
function phoneFrom(data: Json): string | undefined {
  return text(data, 'from', 'phone', 'contactPhone', 'msisdn') ?? text(object(data, 'contact'), 'phone', 'msisdn');
}

function bodyFrom(data: Json): { body: string; mediaUrls?: string[] } {
  const content = object(data, 'contentJson') ?? object(data, 'content');
  const direct = text(data, 'text', 'body', 'message');
  const body = text(content, 'text', 'body') ?? direct ?? '';
  const media = content?.media && typeof content.media === 'object' ? (content.media as Json) : undefined;
  const mediaUrl = text(media, 'url') ?? text(data, 'mediaUrl');
  const list = Array.isArray(data.mediaUrls) ? data.mediaUrls.map(String) : mediaUrl ? [mediaUrl] : undefined;
  return { body, mediaUrls: list };
}

export function mapSimplyRcsStatus(value: string | undefined): 'sent' | 'delivered' | 'read' | 'failed' | null {
  switch (String(value ?? '').toUpperCase()) {
    case 'QUEUED': case 'PROCESSING': case 'SENT': return 'sent';
    case 'DELIVERED': return 'delivered';
    case 'SEEN': case 'READ': return 'read';
    case 'FAILED': case 'CANCELED': case 'CANCELLED': case 'UNDELIVERED': case 'EXPIRED': return 'failed';
    default: return null;
  }
}

export function normalizeSimplyRcsWebhook(payload: unknown): NormalizedSimplyRcsEvent[] {
  if (Array.isArray(payload)) return payload.flatMap((item) => normalizeSimplyRcsWebhook(item));
  if (!payload || typeof payload !== 'object') return [];
  const envelope = payload as Json;
  const event = String(envelope.event ?? envelope.type ?? '').toLowerCase();
  const data = object(envelope, 'data') ?? envelope;
  const orgId = text(envelope, 'orgId') ?? text(data, 'orgId');
  const senderIdId = text(data, 'senderIdId', 'senderId', 'sender_id_id') ?? text(object(data, 'sender'), 'id');
  const messageId = text(data, 'messageId', 'id', 'message_id');

  switch (event) {
    case 'message.received': {
      const from = phoneFrom(data);
      if (!messageId || !from) return [{ type: 'ignored', event }];
      const { body, mediaUrls } = bodyFrom(data);
      return [{ type: 'inbound', data: { rcsMessageId: messageId, rcsConversationId: text(data, 'conversationId'), senderIdId, organizationId: null, from, body, mediaUrls } }];
    }
    case 'button.clicked': {
      // A tapped suggestion arrives as an inbound message carrying the button's text.
      const from = phoneFrom(data);
      const payloadValue = text(data, 'buttonLabel', 'label') ?? text(data, 'buttonPayload', 'payload', 'value') ?? '';
      const tapId = text(data, 'eventId', 'clickId') ?? (messageId ? `${messageId}:tap:${payloadValue}` : undefined);
      if (!tapId || !from) return [{ type: 'ignored', event }];
      return [{ type: 'inbound', data: { rcsMessageId: tapId, rcsConversationId: text(data, 'conversationId'), senderIdId, organizationId: null, from, body: payloadValue } }];
    }
    case 'message.status':
    case 'message.delivered':
    case 'message.read':
    case 'message.failed': {
      if (!messageId) return [{ type: 'ignored', event }];
      const status = event === 'message.delivered' ? 'delivered' : event === 'message.read' ? 'read' : event === 'message.failed' ? 'failed' : mapSimplyRcsStatus(text(data, 'status'));
      if (!status) return [{ type: 'ignored', event }];
      const error = object(data, 'error');
      return [{ type: 'status', data: { rcsMessageId: messageId, status, errorCode: text(data, 'errorCode', 'code') ?? text(error, 'code'), errorMessage: text(data, 'errorMessage', 'reason') ?? text(error, 'message') } }];
    }
    default:
      return [{ type: 'ignored', event: event || 'unknown' }];
  }
  void orgId;
}
