export interface EmbeddedCrmReconnectRequiredResult {
  action: 'reconnect_required';
  authUrl: string;
  locationId: string;
  installationId: string;
  message: string;
}

export function buildEmbeddedCrmReconnectRequiredResult(input: {
  authUrl: string;
  locationId: string;
  installationId: string;
  message: string;
}): EmbeddedCrmReconnectRequiredResult {
  return {
    action: 'reconnect_required',
    authUrl: input.authUrl,
    locationId: input.locationId,
    installationId: input.installationId,
    message: input.message,
  };
}

export function isEmbeddedReconnectOAuthState(
  storedEmbeddedLocationId: string | null | undefined
): boolean {
  return typeof storedEmbeddedLocationId === 'string' && storedEmbeddedLocationId.length > 0;
}

export function addEmbeddedReconnectCompletionParams(input: {
  successUrl: URL;
  storedEmbeddedLocationId: string | null | undefined;
}): void {
  if (!isEmbeddedReconnectOAuthState(input.storedEmbeddedLocationId)) {
    return;
  }

  input.successUrl.searchParams.set('marketplaceInstall', 'true');
  input.successUrl.searchParams.set('embeddedReconnect', 'true');
}
