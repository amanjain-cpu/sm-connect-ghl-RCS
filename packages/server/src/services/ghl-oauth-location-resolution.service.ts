export interface CrmInstallWebhookSignal {
  payload: unknown;
  createdAt?: Date;
}

export interface CrmInstalledLocation {
  id: string;
  name?: string;
  installedAt?: string;
}

interface ResolveCrmOAuthLocationInput {
  companyId?: string;
  preferredLocationId?: string;
  userId?: string;
  appId?: string;
  maxInstallSignalAttempts: number;
  installSignalRetryDelayMs: number;
  readRecentInstallWebhookSignals: () => Promise<CrmInstallWebhookSignal[]>;
  readInstalledLocations: (restrictToUserLocations: boolean) => Promise<CrmInstalledLocation[]>;
  wait?: (ms: number) => Promise<void>;
  logger?: {
    info: (object: Record<string, unknown>, message: string) => void;
    warn: (object: Record<string, unknown>, message: string) => void;
  };
}

export type CrmOAuthLocationResolutionSource =
  | 'preferred'
  | 'install_webhook'
  | 'installed_locations'
  | 'unresolved';

export interface CrmOAuthLocationResolution {
  locationId?: string;
  source: CrmOAuthLocationResolutionSource;
  installedLocationCount?: number;
  eventCreatedAt?: Date;
}

function getPayloadRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
}

export function findMatchingCrmInstallWebhookLocation(
  signals: CrmInstallWebhookSignal[],
  input: {
    companyId: string;
    userId?: string;
    appId?: string;
  }
): CrmOAuthLocationResolution | null {
  for (const signal of signals) {
    const payload = getPayloadRecord(signal.payload);

    if (!payload) {
      continue;
    }

    const payloadCompanyId =
      typeof payload['companyId'] === 'string' ? payload['companyId'] : null;
    const payloadLocationId =
      typeof payload['locationId'] === 'string' ? payload['locationId'] : null;
    const payloadAppId =
      typeof payload['appId'] === 'string' ? payload['appId'] : null;
    const payloadUserId =
      typeof payload['userId'] === 'string' ? payload['userId'] : null;

    if (!payloadLocationId || !payloadCompanyId || payloadCompanyId !== input.companyId) {
      continue;
    }

    if (input.userId && payloadUserId && payloadUserId !== input.userId) {
      continue;
    }

    if (input.appId && payloadAppId && payloadAppId !== input.appId) {
      continue;
    }

    return {
      locationId: payloadLocationId,
      source: 'install_webhook',
      eventCreatedAt: signal.createdAt,
    };
  }

  return null;
}

export async function resolveCrmOAuthLocation(
  input: ResolveCrmOAuthLocationInput
): Promise<CrmOAuthLocationResolution> {
  const logger = input.logger ?? {
    info: () => undefined,
    warn: () => undefined,
  };

  if (input.preferredLocationId) {
    return {
      locationId: input.preferredLocationId,
      source: 'preferred',
    };
  }

  if (!input.companyId) {
    return { source: 'unresolved' };
  }

  const wait = input.wait ?? ((ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }));

  for (let attempt = 1; attempt <= input.maxInstallSignalAttempts; attempt += 1) {
    const installWebhookMatch = findMatchingCrmInstallWebhookLocation(
      await input.readRecentInstallWebhookSignals(),
      {
        companyId: input.companyId,
        userId: input.userId,
        appId: input.appId,
      }
    );

    if (installWebhookMatch?.locationId) {
      logger.info(
        {
          companyId: input.companyId,
          resolvedLocationId: installWebhookMatch.locationId,
          eventCreatedAt: installWebhookMatch.eventCreatedAt?.toISOString(),
        },
        'Resolved the workspace location from a recent install webhook'
      );

      return installWebhookMatch;
    }

    if (attempt >= input.maxInstallSignalAttempts) {
      break;
    }

    logger.warn(
      {
        attempt,
        maxResolutionAttempts: input.maxInstallSignalAttempts,
        companyId: input.companyId,
        userId: input.userId,
      },
      'Waiting for install signals to resolve the workspace location'
    );

    await wait(input.installSignalRetryDelayMs);
  }

  const userRestrictedLocations = await input.readInstalledLocations(true);
  const fallbackLocations =
    userRestrictedLocations.length > 0
      ? userRestrictedLocations
      : await input.readInstalledLocations(false);

  if (fallbackLocations[0]) {
    const fallbackLocationId = fallbackLocations[0].id;
    logger.warn(
      {
        companyId: input.companyId,
        resolvedLocationId: fallbackLocationId,
        installedLocationCount: fallbackLocations.length,
      },
      'Resolved the workspace location from the installed locations fallback after install webhook signal window expired'
    );

    return {
      locationId: fallbackLocationId,
      source: 'installed_locations',
      installedLocationCount: fallbackLocations.length,
    };
  }

  return { source: 'unresolved' };
}
