// ===========================================
// Pure helpers for the RCS agent lifecycle (no database or network imports, so tests exit cleanly)
// ===========================================

import type { RcsAgentStatus } from '@prisma/client';

/** Maps the provider's agent status to ours. */
export function mapAgentStatus(status: string | null | undefined, current: RcsAgentStatus): RcsAgentStatus {
  switch (String(status ?? '').toUpperCase()) {
    case 'READY_FOR_TESTING': return 'ready_for_testing';
    case 'IN_TESTING': return 'in_testing';
    case 'PENDING_LAUNCH': case 'LAUNCH_PENDING': case 'LAUNCHED_PARTIAL_SUCCESS': return 'pending_launch';
    case 'LIVE': case 'ACTIVE': case 'LAUNCHED': return 'live';
    case 'SUSPENDED': return 'suspended';
    case 'REJECTED': return 'rejected';
    default: return current;
  }
}

/** Digits only; a bare 10-digit North American number gets its country code so "(512) 555-0100" equals "+15125550100". */
function normalizeDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
}

/** True when the phone accepted a test-device invite on the agent. */
export function isApprovedTestDevice(devices: unknown, phone: string): boolean {
  if (!Array.isArray(devices)) return false;
  const digits = normalizeDigits(phone);
  return devices.some((device) => {
    const row = device as { phoneNumber?: string; status?: string };
    return normalizeDigits(String(row.phoneNumber ?? '')) === digits && ['APPROVED', 'ACCEPTED', 'COMPLETED'].includes(String(row.status ?? '').toUpperCase());
  });
}
