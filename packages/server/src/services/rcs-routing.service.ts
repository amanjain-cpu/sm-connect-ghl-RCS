// ===========================================
// RCS-first routing with SMS fallback
// ===========================================
//
// Every outbound message is offered to RCS first when the organization has a live agent and the
// recipient's phone is known to accept RCS. Otherwise, or when SimplyRCS definitively rejects the
// message, it goes out as SMS/MMS through Signalmash exactly as in the 10DLC app. The decision and
// the send are written against small injected ports so they can be unit-tested without a database.

import type { RcsContent, SimplyRcsSendResult } from './simplyrcs.service.js';
import { SimplyRcsRejectedError } from './simplyrcs-errors.js';

/** How long a capability answer is trusted before the phone is checked again. */
export const CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type FallbackReason =
  | 'rcs_disabled'
  | 'no_live_agent'
  | 'recipient_not_rcs_capable'
  | 'capability_check_failed'
  | 'rcs_rejected';

export interface LiveAgent {
  id: string;
  senderIdId: string;
}

export interface CapabilityRecord {
  isRcsCapable: boolean;
  rcsContactId: string | null;
  checkedAt: Date;
}

export interface RoutingPorts {
  /** The organization's agent when it is live, else null. */
  getLiveAgent(organizationId: string): Promise<LiveAgent | null>;
  getCachedCapability(organizationId: string, phone: string): Promise<CapabilityRecord | null>;
  /** Asks SimplyRCS; creates the contact there if needed. */
  checkCapability(phone: string): Promise<{ isRcsCapable: boolean; contactId: string; provider?: string }>;
  saveCapability(organizationId: string, phone: string, record: { isRcsCapable: boolean; rcsContactId: string | null; provider?: string }): Promise<void>;
  now?: () => Date;
}

export type RouteDecision =
  | { channel: 'rcs'; agent: LiveAgent; contactId: string | null }
  | { channel: 'sms'; reason: FallbackReason; detail?: string };

export async function decideChannel(
  ports: RoutingPorts,
  input: { organizationId: string; to: string; rcsEnabled?: boolean }
): Promise<RouteDecision> {
  if (input.rcsEnabled === false) return { channel: 'sms', reason: 'rcs_disabled' };

  const agent = await ports.getLiveAgent(input.organizationId);
  if (!agent) return { channel: 'sms', reason: 'no_live_agent' };

  const now = (ports.now ?? (() => new Date()))();
  const cached = await ports.getCachedCapability(input.organizationId, input.to);
  if (cached && now.getTime() - cached.checkedAt.getTime() < CAPABILITY_TTL_MS) {
    return cached.isRcsCapable
      ? { channel: 'rcs', agent, contactId: cached.rcsContactId }
      : { channel: 'sms', reason: 'recipient_not_rcs_capable' };
  }

  try {
    const fresh = await ports.checkCapability(input.to);
    await ports.saveCapability(input.organizationId, input.to, { isRcsCapable: fresh.isRcsCapable, rcsContactId: fresh.contactId, provider: fresh.provider });
    return fresh.isRcsCapable
      ? { channel: 'rcs', agent, contactId: fresh.contactId }
      : { channel: 'sms', reason: 'recipient_not_rcs_capable' };
  } catch (error) {
    // The check is diagnostic only; a failed check must never block the message.
    return { channel: 'sms', reason: 'capability_check_failed', detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Turns a plain text + media send into the RCS content SimplyRCS accepts. */
export function rcsContentFor(input: { body: string; mediaUrls?: string[] | null; rcsContent?: RcsContent | null }): RcsContent {
  if (input.rcsContent) return input.rcsContent;
  const media = input.mediaUrls?.[0];
  if (media) {
    const type = /\.(mp4|mov|webm)(\?|$)/i.test(media) ? 'video' : /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(media) ? 'audio' : /\.(pdf|vcf|zip)(\?|$)/i.test(media) ? 'file' : 'image';
    if (input.body.trim()) {
      return { type: 'card', card: { title: input.body.slice(0, 200), description: input.body.length > 200 ? input.body.slice(200, 2000) : undefined, media: { type, url: media } } };
    }
    return { type: 'media', media: { type, url: media } };
  }
  return { type: 'text', text: input.body };
}

export interface SendPorts {
  sendRcs(input: { senderIdId: string; to: string; contactId: string | null; content: RcsContent; idempotencyKey: string; messageType: 'MARKETING' | 'TRANSACTIONAL' | 'SERVICE' }): Promise<SimplyRcsSendResult>;
  sendSms(input: { from: string; to: string; body: string; mediaUrls?: string[] }): Promise<{ messageId?: string; status: string }>;
}

export type SendOutcome =
  | { channel: 'rcs'; rcsMessageId: string; rcsConversationId: string; fallbackReason: null }
  | { channel: 'sms' | 'mms'; signalmashMessageId: string | null; fallbackReason: FallbackReason | null; detail?: string };

/**
 * Sends on the decided channel. A definite RCS rejection (4xx) falls back to SMS in the same call;
 * an uncertain outcome (network error, 502) is rethrown so nothing is sent twice.
 */
export async function sendWithFallback(
  ports: SendPorts,
  input: {
    decision: RouteDecision;
    from: string;
    to: string;
    body: string;
    mediaUrls?: string[];
    rcsContent?: RcsContent | null;
    idempotencyKey: string;
    messageType?: 'MARKETING' | 'TRANSACTIONAL' | 'SERVICE';
  }
): Promise<SendOutcome> {
  const smsChannel = input.mediaUrls && input.mediaUrls.length > 0 ? 'mms' : 'sms';
  const viaSms = async (fallbackReason: FallbackReason | null, detail?: string): Promise<SendOutcome> => {
    const result = await ports.sendSms({ from: input.from, to: input.to, body: input.body, mediaUrls: input.mediaUrls });
    return { channel: smsChannel, signalmashMessageId: result.messageId ?? null, fallbackReason, detail };
  };

  if (input.decision.channel === 'sms') return viaSms(input.decision.reason, input.decision.detail);

  try {
    const result = await ports.sendRcs({
      senderIdId: input.decision.agent.senderIdId,
      to: input.to,
      contactId: input.decision.contactId,
      content: rcsContentFor(input),
      idempotencyKey: input.idempotencyKey,
      messageType: input.messageType ?? 'SERVICE',
    });
    return { channel: 'rcs', rcsMessageId: result.messageId, rcsConversationId: result.conversationId, fallbackReason: null };
  } catch (error) {
    if (error instanceof SimplyRcsRejectedError) {
      return viaSms('rcs_rejected', error.message);
    }
    throw error;
  }
}
