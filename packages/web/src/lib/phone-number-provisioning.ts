import { useEffect, useState } from 'react';
import { safeGetItem, safeSetItem } from '@/lib/storage';

export const PHONE_NUMBER_PROVISIONING_LOCK_MS = 20 * 60 * 1000;

const STORAGE_KEY = 'sm-phone-number-provisioning-locks-v1';
const UPDATE_EVENT = 'sm-phone-number-provisioning-locks-updated';

export type PhoneNumberProvisioningLock = {
  phoneNumber: string;
  phoneNumberId?: string;
  purchasedAt: string;
};

type RecordProvisioningLockInput = {
  phoneNumber: string;
  phoneNumberId?: string;
  purchasedAt?: Date | string | number;
};

type PhoneNumberIdentity = {
  phoneNumber?: string | null;
  phoneNumberId?: string | null;
};

function normalizePhoneNumberKey(phoneNumber?: string | null): string {
  return (phoneNumber ?? '').replace(/\D/g, '');
}

function normalizePurchasedAt(value?: Date | string | number): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  return new Date().toISOString();
}

function readStoredLocks(): PhoneNumberProvisioningLock[] {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item): PhoneNumberProvisioningLock[] => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const candidate = item as Partial<PhoneNumberProvisioningLock>;
      if (typeof candidate.phoneNumber !== 'string' || typeof candidate.purchasedAt !== 'string') {
        return [];
      }

      return [{
        phoneNumber: candidate.phoneNumber,
        phoneNumberId: typeof candidate.phoneNumberId === 'string' ? candidate.phoneNumberId : undefined,
        purchasedAt: candidate.purchasedAt,
      }];
    });
  } catch {
    return [];
  }
}

function writeStoredLocks(locks: PhoneNumberProvisioningLock[]): void {
  safeSetItem(STORAGE_KEY, JSON.stringify(locks));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UPDATE_EVENT));
  }
}

function isSameLock(a: PhoneNumberIdentity, b: PhoneNumberIdentity): boolean {
  if (a.phoneNumberId && b.phoneNumberId && a.phoneNumberId === b.phoneNumberId) {
    return true;
  }

  const aPhone = normalizePhoneNumberKey(a.phoneNumber);
  const bPhone = normalizePhoneNumberKey(b.phoneNumber);
  return Boolean(aPhone && bPhone && aPhone === bPhone);
}

export function getRemainingProvisioningMs(
  lock: PhoneNumberProvisioningLock,
  now = Date.now()
): number {
  const purchasedAtMs = new Date(lock.purchasedAt).getTime();
  if (Number.isNaN(purchasedAtMs)) {
    return 0;
  }

  return Math.max(0, purchasedAtMs + PHONE_NUMBER_PROVISIONING_LOCK_MS - now);
}

export function getProvisioningLocks(): PhoneNumberProvisioningLock[] {
  const locks = readStoredLocks();
  const activeLocks = locks.filter((lock) => getRemainingProvisioningMs(lock) > 0);

  if (activeLocks.length !== locks.length) {
    writeStoredLocks(activeLocks);
  }

  return activeLocks;
}

export function recordProvisioningLock(input: RecordProvisioningLockInput): PhoneNumberProvisioningLock[] {
  const phoneNumber = input.phoneNumber.trim();
  if (!phoneNumber) {
    return getProvisioningLocks();
  }

  const nextLock: PhoneNumberProvisioningLock = {
    phoneNumber,
    phoneNumberId: input.phoneNumberId,
    purchasedAt: normalizePurchasedAt(input.purchasedAt),
  };

  const locks = getProvisioningLocks();
  const nextLocks = [
    ...locks.filter((lock) => !isSameLock(lock, nextLock)),
    nextLock,
  ];

  writeStoredLocks(nextLocks);
  return nextLocks;
}

export function getPhoneNumberProvisioningLock(
  identity: PhoneNumberIdentity,
  locks = getProvisioningLocks()
): PhoneNumberProvisioningLock | null {
  return locks.find((lock) => (
    getRemainingProvisioningMs(lock) > 0 &&
    isSameLock(identity, lock)
  )) ?? null;
}

export function getSoonestActiveProvisioningLock(
  locks = getProvisioningLocks()
): PhoneNumberProvisioningLock | null {
  return locks.reduce<PhoneNumberProvisioningLock | null>((soonest, lock) => {
    if (getRemainingProvisioningMs(lock) <= 0) {
      return soonest;
    }

    if (!soonest || getRemainingProvisioningMs(lock) < getRemainingProvisioningMs(soonest)) {
      return lock;
    }

    return soonest;
  }, null);
}

export function formatProvisioningCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatProvisioningWait(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

export function useProvisioningLocks(): PhoneNumberProvisioningLock[] {
  const [locks, setLocks] = useState<PhoneNumberProvisioningLock[]>(() => getProvisioningLocks());

  useEffect(() => {
    const refreshLocks = () => {
      setLocks(getProvisioningLocks());
    };

    refreshLocks();

    const interval = window.setInterval(refreshLocks, 1000);
    window.addEventListener('storage', refreshLocks);
    window.addEventListener(UPDATE_EVENT, refreshLocks);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', refreshLocks);
      window.removeEventListener(UPDATE_EVENT, refreshLocks);
    };
  }, []);

  return locks;
}
