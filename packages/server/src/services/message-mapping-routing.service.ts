import type { Platform } from '@prisma/client';

export function resolveMessageMappingContext(input: {
  hasPlatformConnectionId: boolean;
  connectionInfo?: {
    installationId?: string | null;
    platform: Platform;
  } | null;
  primaryInstallation?: {
    id: string;
    platform: Platform;
  } | null;
}) {
  const installationId = input.connectionInfo?.installationId ??
    (input.hasPlatformConnectionId ? undefined : input.primaryInstallation?.id);
  const platform = input.connectionInfo?.platform ??
    (input.hasPlatformConnectionId ? 'leadconnector' : input.primaryInstallation?.platform ?? 'leadconnector');

  return { installationId, platform };
}
