// ===========================================
// CRM Platform Adapter
// ===========================================

import { config } from '../config/index.js';
import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { ExternalServiceError } from '../utils/errors.js';
import {
  BasePlatformAdapter,
  type OAuthTokens,
  type PlatformAccountInfo,
  type OutboundMessagePayload,
  toPlatformAdapterConnection,
} from './base.adapter.js';
import type { PlatformConnection } from '@prisma/client';
import { decrypt } from '../utils/crypto.js';
import * as jose from 'jose';
import CryptoJS from 'crypto-js';
import { adminService, SETTINGS_KEYS } from '../services/admin.service.js';
import { platformService } from '../services/platform.service.js';
import type {
  InboundMessagePayload,
  MessageStatusUpdate,
  ParsedOutboundMessage,
  PlatformAdapterConnection,
  PlatformContact,
} from '@signalmash-connect/shared';
import crypto from 'crypto';

const GHL_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

const GHL_WEBHOOK_LEGACY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

const crmMarketplaceHost = ['marketplace', ['go', 'high', 'level'].join(''), 'com'].join('.');
const crmApiHost = ['services', ['lead', 'connector', 'hq'].join(''), 'com'].join('.');
const GHL_OAUTH_URL = `https://${crmMarketplaceHost}/oauth/chooselocation`;
const GHL_TOKEN_URL = `https://${crmApiHost}/oauth/token`;
const GHL_API_VERSION = '2021-07-28'; // Required API version header

interface GHLTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  locationId?: string;
  companyId?: string;
  userId?: string;
  userType?: string;
  isBulkInstallation?: boolean;
  installToFutureLocations?: boolean;
  approveAllLocations?: boolean;
}

interface GHLLocationResponse {
  location: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    logoUrl?: string;
  };
}

interface GHLLocationsListResponse {
  locations: Array<{
    id: string;
    name: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    logoUrl?: string;
  }>;
}

interface GHLInstalledLocationsResponse {
  locations: Array<{
    _id?: string;
    id?: string;
    name?: string;
    isInstalled?: boolean;
    versionId?: string;
    installedAt?: string;
  }>;
  count?: number;
  installToFutureLocations?: boolean;
}

interface GHLConversationMessage {
  type: string;
  locationId: string;
  contactId: string;
  conversationId: string;
  body: string;
  attachments?: string[];
}

const TOKEN_REFRESH_LOCK_TTL_MS = 15_000;

type GHLConnection = PlatformAdapterConnection | PlatformConnection;

type GHLAccessTokenContext = {
  authClass?: string;
  authClassId?: string;
  primaryAuthClassId?: string;
  locationId?: string;
  companyId?: string;
  scopes: string[];
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function decodeAccessTokenContext(accessToken: string): GHLAccessTokenContext {
  try {
    const payload = jose.decodeJwt(accessToken) as Record<string, unknown>;
    const oauthMeta =
      typeof payload['oauthMeta'] === 'object' &&
      payload['oauthMeta'] !== null &&
      !Array.isArray(payload['oauthMeta'])
        ? payload['oauthMeta'] as Record<string, unknown>
        : null;
    const scopeFromMeta = toStringArray(oauthMeta?.['scopes']);
    const scopeFromString =
      typeof payload['scope'] === 'string'
        ? payload['scope']
            .split(/\s+/)
            .map((scope) => scope.trim())
            .filter(Boolean)
        : [];

    return {
      authClass: typeof payload['authClass'] === 'string' ? payload['authClass'] : undefined,
      authClassId: typeof payload['authClassId'] === 'string' ? payload['authClassId'] : undefined,
      primaryAuthClassId:
        typeof payload['primaryAuthClassId'] === 'string' ? payload['primaryAuthClassId'] : undefined,
      locationId: typeof payload['locationId'] === 'string' ? payload['locationId'] : undefined,
      companyId: typeof payload['companyId'] === 'string' ? payload['companyId'] : undefined,
      scopes: scopeFromMeta.length > 0 ? scopeFromMeta : scopeFromString,
    };
  } catch {
    return { scopes: [] };
  }
}

function isLocationAuthClass(authClass: string | undefined): boolean {
  return typeof authClass === 'string' && authClass.toLowerCase() === 'location';
}

function normalizeConnection(connection: GHLConnection): PlatformAdapterConnection {
  if ('externalAccountId' in connection) {
    return connection;
  }

  return toPlatformAdapterConnection(connection);
}

export class GHLAdapter extends BasePlatformAdapter {
  readonly platform = 'leadconnector' as const;

  getAccessTokenContext(accessToken: string): GHLAccessTokenContext {
    return decodeAccessTokenContext(accessToken);
  }

  isLocationScopedAccessToken(accessToken: string): boolean {
    return isLocationAuthClass(this.getAccessTokenContext(accessToken).authClass);
  }

  private ensureLocationScopedAccessToken(accessToken: string): void {
    const tokenContext = this.getAccessTokenContext(accessToken);
    if (isLocationAuthClass(tokenContext.authClass)) {
      return;
    }

    const authClass = tokenContext.authClass ?? 'unknown';
    throw new ExternalServiceError(
      'Platform',
      `Location-scoped token required for Conversations API access (received authClass=${authClass})`
    );
  }

  private async apiRequestWithConnection<T>(
    connection: GHLConnection,
    request: (accessToken: string) => Promise<T>
  ): Promise<T> {
    const normalizedConnection = normalizeConnection(connection);

    try {
      const accessToken = decrypt(normalizedConnection.accessToken);
      this.ensureLocationScopedAccessToken(accessToken);
      return await request(accessToken);
    } catch (error) {
      if (!this.isUnauthorizedError(error)) {
        throw error;
      }

      const refreshedConnection = await this.refreshConnectionTokens(normalizedConnection.id);
      const refreshedAccessToken = decrypt(refreshedConnection.accessToken);
      this.ensureLocationScopedAccessToken(refreshedAccessToken);
      return request(refreshedAccessToken);
    }
  }

  private isUnauthorizedError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('401');
  }

  private async refreshConnectionTokens(connectionId: string) {
    const lockKey = `crm:token-refresh:${connectionId}`;
    const lockValue = `${Date.now()}`;
    const lockAcquired = await redis.set(lockKey, lockValue, 'PX', TOKEN_REFRESH_LOCK_TTL_MS, 'NX');

    if (lockAcquired === 'OK') {
      try {
        const persistedConnection = await platformService.getByIdUnsafe(connectionId);
        const decryptedTokens = await platformService.getDecryptedTokens(connectionId);

        if (!decryptedTokens.refreshToken) {
          throw new ExternalServiceError('Platform', 'Refresh token is missing');
        }

        const refreshedTokens = await this.refreshTokens(decryptedTokens.refreshToken);

        return platformService.updateConnection(connectionId, {
          accessToken: refreshedTokens.accessToken,
          refreshToken: refreshedTokens.refreshToken ?? decryptedTokens.refreshToken,
          tokenExpiresAt: refreshedTokens.expiresIn
            ? new Date(Date.now() + refreshedTokens.expiresIn * 1000)
            : persistedConnection.tokenExpiresAt ?? undefined,
          scopes: refreshedTokens.scope?.split(' ') ?? persistedConnection.scopes as string[],
          status: 'connected',
        });
      } finally {
        await redis.del(lockKey);
      }
    }

    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const persistedConnection = await platformService.getByIdUnsafe(connectionId);
      if (persistedConnection.updatedAt.getTime() > Date.now() - TOKEN_REFRESH_LOCK_TTL_MS) {
        return persistedConnection;
      }
    }

    throw new ExternalServiceError('Platform', 'Timed out waiting for token refresh');
  }

  /**
   * Override apiRequest to include the CRM platform's required Version header
   */
  protected override async apiRequest<T>(
    url: string,
    options: {
      method?: string;
      accessToken: string;
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const { method = 'GET', accessToken, body, headers = {} } = options;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Version': GHL_API_VERSION, // Required by the CRM platform API
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  // ===========================================
  // Credential Getters (Database-first with env fallback)
  // ===========================================

  /**
   * Get the CRM client ID from database settings, falling back to env vars
   */
  async getClientId(): Promise<string> {
    return adminService.getSettingWithFallback(
      SETTINGS_KEYS.GHL_APP_CLIENT_ID,
      config.ghlAppClientId
    );
  }

  /**
   * Get the CRM client secret from database settings, falling back to env vars
   */
  async getClientSecret(): Promise<string> {
    return adminService.getSettingWithFallback(
      SETTINGS_KEYS.GHL_APP_CLIENT_SECRET,
      config.ghlAppClientSecret
    );
  }

  /**
   * Get the CRM shared secret from database settings, falling back to env vars
   * Kept on the legacy setting key for backwards compatibility.
   */
  async getSsoKey(): Promise<string> {
    return adminService.getSettingWithFallback(
      SETTINGS_KEYS.GHL_APP_SSO_KEY,
      config.ghlAppSsoKey
    );
  }

  /**
   * Allow multiple shared secrets during GHL app version transitions.
   * Secrets can be stored as comma- or newline-delimited values.
   */
  async getSsoKeys(): Promise<string[]> {
    const rawValue = await this.getSsoKey();

    return [...new Set(
      rawValue
        .split(/[\r\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    )];
  }

  // ===========================================
  // OAuth Methods
  // ===========================================

  async getMarketplaceAppId(): Promise<string> {
    const clientId = await this.getClientId();
    const appId = clientId.split('-')[0]?.trim();

    if (!appId) {
      throw new ExternalServiceError('Platform', 'Unable to determine marketplace app ID from client ID');
    }

    return appId;
  }

  /**
   * Get the CRM OAuth authorization URL
   */
  async getAuthorizationUrl(state: string, redirectUri: string): Promise<string> {
    const clientId = await this.getClientId();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      // Request location-level access
      scope: [
        'conversations.readonly',
        'conversations.write',
        'conversations/message.readonly',
        'conversations/message.write',
        'contacts.readonly',
        'contacts.write',
        'locations.readonly',
      ].join(' '),
    });

    return `${GHL_OAUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens> {
    try {
      const [clientId, clientSecret] = await Promise.all([
        this.getClientId(),
        this.getClientSecret(),
      ]);

      const response = await fetch(GHL_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'CRM token exchange failed');
        throw new ExternalServiceError('Platform', `Token exchange failed: ${response.status}`);
      }

      const data = await response.json() as GHLTokenResponse;
      const tokenContext = this.getAccessTokenContext(data.access_token);

      // Log the full response to understand the CRM token payload.
      logger.info({
        locationId: data.locationId,
        companyId: data.companyId,
        userId: data.userId,
        authClass: tokenContext.authClass,
        tokenLocationId: tokenContext.locationId,
        tokenCompanyId: tokenContext.companyId,
        scope: data.scope,
        hasAccessToken: !!data.access_token,
        hasRefreshToken: !!data.refresh_token,
        allKeys: Object.keys(data),
      }, 'CRM tokens obtained');

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        tokenType: data.token_type,
        scope: data.scope,
        platformAccountId: data.locationId, // Location-level install
        companyId: data.companyId, // Company-level (agency) install
        userId: data.userId,
        userType: data.userType,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to exchange CRM authorization code');
      throw error;
    }
  }

  /**
   * Refresh expired tokens
   */
  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    try {
      const [clientId, clientSecret] = await Promise.all([
        this.getClientId(),
        this.getClientSecret(),
      ]);

      const response = await fetch(GHL_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'CRM token refresh failed');
        throw new ExternalServiceError('Platform', `Token refresh failed: ${response.status}`);
      }

      const data = await response.json() as GHLTokenResponse;

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        tokenType: data.token_type,
        scope: data.scope,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to refresh CRM tokens');
      throw error;
    }
  }

  async getInstalledLocations(
    agencyAccessToken: string,
    input: {
      companyId: string;
      appId: string;
      limit?: number;
      restrictToUserLocations?: boolean;
    }
  ): Promise<Array<{
    id: string;
    name?: string;
    installedAt?: string;
  }>> {
    const params = new URLSearchParams({
      companyId: input.companyId,
      appId: input.appId,
      isInstalled: 'true',
      sortOrder: 'desc',
      limit: String(input.limit ?? 100),
    });

    if (input.restrictToUserLocations) {
      params.set('restrictToUserLocations', 'true');
    }

    const response = await this.apiRequest<GHLInstalledLocationsResponse>(
      `${config.ghlApiDomain}/oauth/installedLocations?${params.toString()}`,
      { accessToken: agencyAccessToken }
    );

    return (response.locations ?? [])
      .map((location) => ({
        id: location._id ?? location.id ?? '',
        name: location.name,
        installedAt: location.installedAt,
      }))
      .filter((location) => location.id.length > 0);
  }

  async exchangeAgencyTokenForLocationToken(
    agencyAccessToken: string,
    input: { companyId: string; locationId: string }
  ): Promise<OAuthTokens> {
    const response = await fetch(`${config.ghlApiDomain}/oauth/locationToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Bearer ${agencyAccessToken}`,
        'Version': GHL_API_VERSION,
      },
      body: new URLSearchParams({
        companyId: input.companyId,
        locationId: input.locationId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        {
          status: response.status,
          companyId: input.companyId,
          locationId: input.locationId,
          error: errorText,
        },
        'CRM location token exchange failed'
      );
      throw new ExternalServiceError(
        'Platform',
        `Location token exchange failed: ${response.status}`
      );
    }

    const data = await response.json() as GHLTokenResponse;
    const tokenContext = this.getAccessTokenContext(data.access_token);

    logger.info(
      {
        companyId: data.companyId ?? input.companyId,
        locationId: data.locationId ?? input.locationId,
        userId: data.userId,
        authClass: tokenContext.authClass,
      },
      'CRM location token generated from agency token'
    );

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope,
      platformAccountId: data.locationId ?? input.locationId,
      companyId: data.companyId ?? input.companyId,
      userId: data.userId,
      userType: data.userType,
    };
  }

  /**
   * Get locations for a company (agency-level token)
   */
  async getCompanyLocations(accessToken: string, companyId: string): Promise<Array<{
    id: string;
    name: string;
    email?: string;
    phone?: string;
  }>> {
    try {
      const response = await this.apiRequest<GHLLocationsListResponse>(
        `${config.ghlApiDomain}/locations/search?companyId=${companyId}&limit=100`,
        { accessToken }
      );

      return response.locations || [];
    } catch (error) {
      logger.error({ error, companyId }, 'Failed to get company locations');
      throw error;
    }
  }

  /**
   * Get CRM location (account) info
   */
  async getAccountInfo(accessToken: string, platformAccountId?: string, companyId?: string): Promise<PlatformAccountInfo> {
    try {
      const tokenContext = this.getAccessTokenContext(accessToken);
      // Use passed locationId, or try to decode from token as fallback
      let locationId = platformAccountId;

      if (!locationId) {
        locationId = tokenContext.locationId;
      }

      if (!locationId) {
        logger.error(
          {
            authClass: tokenContext.authClass,
            companyId: companyId ?? tokenContext.companyId,
          },
          'CRM token does not include a locationId'
        );
        throw new ExternalServiceError(
          'Platform',
          'No location ID available in OAuth token. Reinstall from the target workspace.'
        );
      }

      // Fetch location details
      const response = await this.apiRequest<GHLLocationResponse>(
        `${config.ghlApiDomain}/locations/${locationId}`,
        { accessToken }
      );

      const { location } = response;

      return {
        id: location.id,
        name: location.name,
        email: location.email,
        phone: location.phone,
        website: location.website,
        metadata: {
          address: location.address,
          city: location.city,
          state: location.state,
          country: location.country,
          logoUrl: location.logoUrl,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get CRM location info');
      throw error;
    }
  }

  /**
   * Send a message via the CRM Conversations API
   * This is used when acting as a Conversation Provider
   */
  async sendMessage(
    connection: GHLConnection,
    payload: OutboundMessagePayload
  ): Promise<{ platformMessageId: string }> {
    const normalizedConnection = normalizeConnection(connection);

    try {
      const response = await this.apiRequestWithConnection<{ messageId: string }>(
        normalizedConnection,
        async (accessToken) => this.apiRequest<{ messageId: string }>(
          `${config.ghlApiDomain}/conversations/messages`,
          {
            method: 'POST',
            accessToken,
            body: {
              type: 'SMS',
              contactId: payload.contactId,
              conversationId: payload.conversationId,
              message: payload.body,
              attachments: payload.mediaUrls,
            },
          }
        )
      );

      return { platformMessageId: response.messageId };
    } catch (error) {
      logger.error({ error, connectionId: normalizedConnection.id }, 'Failed to send CRM message');
      throw error;
    }
  }

  /**
   * Add an inbound message to the CRM conversation
   */
  async addInboundMessage(
    connection: GHLConnection,
    message: InboundMessagePayload
  ): Promise<{ externalMessageId: string }> {
    const normalizedConnection = normalizeConnection(connection);

    try {
      const response = await this.apiRequestWithConnection<{ messageId: string }>(
        normalizedConnection,
        async (accessToken) => this.apiRequest<{ messageId: string }>(
          `${config.ghlApiDomain}/conversations/messages/inbound`,
          {
            method: 'POST',
            accessToken,
            body: {
              type: 'SMS',
              conversationId: message.conversationId,
              message: message.body,
              attachments: message.mediaUrls,
            },
          }
        )
      );

      return { externalMessageId: response.messageId };
    } catch (error) {
      logger.error({ error, connectionId: normalizedConnection.id }, 'Failed to add inbound message to the CRM platform');
      throw error;
    }
  }

  /**
   * Update message status in the CRM platform
   */
  async updateMessageStatus(
    connection: GHLConnection,
    externalMessageId: string,
    status: string
  ): Promise<void> {
    const normalizedConnection = normalizeConnection(connection);
    const ghlStatusMap: Record<string, string> = {
      queued: 'pending',
      sending: 'pending',
      sent: 'sent',
      delivered: 'delivered',
      undelivered: 'failed',
      failed: 'failed',
      read: 'read',
    };
    const ghlStatus = ghlStatusMap[status] ?? status;

    try {
      await this.apiRequestWithConnection(
        normalizedConnection,
        async (accessToken) => this.apiRequest(
          `${config.ghlApiDomain}/conversations/messages/${externalMessageId}/status`,
          {
            method: 'PUT',
            accessToken,
            body: { status: ghlStatus },
          }
        )
      );
    } catch (error) {
      logger.error(
        {
          error,
          errorMessage: error instanceof Error ? error.message : 'Unknown platform status update error',
          connectionId: normalizedConnection.id,
          messageId: externalMessageId,
          status,
          ghlStatus,
        },
        'Failed to update CRM message status'
      );
      throw error;
    }
  }

  /**
   * Verify the CRM webhook signature
   */
  verifyWebhookSignature(
    payload: string,
    signatures: {
      xPlatformSignature?: string;
      xWhSignature?: string;
    }
  ): boolean {
    const payloadBuffer = Buffer.from(payload, 'utf8');

    if (signatures.xPlatformSignature && signatures.xPlatformSignature !== 'N/A') {
      try {
        const signatureBuffer = Buffer.from(signatures.xPlatformSignature, 'base64');
        return crypto.verify(
          null,
          payloadBuffer,
          config.ghlWebhookPublicKey ?? GHL_WEBHOOK_PUBLIC_KEY,
          signatureBuffer
        );
      } catch (error) {
        logger.warn({ error }, 'Failed to verify the primary CRM webhook signature');
        return false;
      }
    }

    if (signatures.xWhSignature && signatures.xWhSignature !== 'N/A') {
      try {
        const verifier = crypto.createVerify('SHA256');
        verifier.update(payload);
        verifier.end();

        return verifier.verify(
          config.ghlWebhookLegacyPublicKey ?? GHL_WEBHOOK_LEGACY_PUBLIC_KEY,
          signatures.xWhSignature,
          'base64'
        );
      } catch (error) {
        logger.warn({ error }, 'Failed to verify X-WH-Signature');
        return false;
      }
    }

    return false;
  }

  /**
   * Parse the CRM outbound message webhook.
   * This is received when a user sends a message from the CRM that should go through our provider.
   */
  parseOutboundWebhook(payload: unknown): ParsedOutboundMessage | null {
    try {
      const data = payload as Record<string, unknown>;

      const body = data['message'] ?? data['body'];
      const to = data['phone'] ?? data['contactPhone'] ?? data['to'];
      const from = data['fromNumber'] ?? data['from'];
      const mediaUrls = data['attachments'] ?? data['mediaUrls'];

      if (!data['locationId'] || !data['messageId'] || !body) {
        return null;
      }

      return {
        providerMessageId: data['messageId'] as string,
        accountId: data['locationId'] as string,
        conversationId: data['conversationId'] as string | undefined,
        contactId: data['contactId'] as string | undefined,
        from: typeof from === 'string' && /^\+?\d[\d\s().-]*$/.test(from) ? from : undefined,
        to: to as string | undefined,
        body: body as string,
        mediaUrls: Array.isArray(mediaUrls) ? mediaUrls as string[] : undefined,
        rawPayload: payload,
      };
    } catch {
      return null;
    }
  }

  /**
   * Decrypt user context from the CRM custom page using the app shared secret.
   */
  async decryptSsoData(encryptedData: string): Promise<{
    locationId?: string;
    companyId?: string;
    type?: string;
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
  }> {
    try {
      const sharedSecrets = await this.getSsoKeys();
      const normalizedInput = decodeURIComponent(encryptedData.trim());

      const parsePayload = (raw: string): Record<string, unknown> | null => {
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return null;
        }
      };

      const decryptPayload = (secret: string): string | null => {
        try {
          const decrypted = CryptoJS.AES.decrypt(normalizedInput, secret).toString(CryptoJS.enc.Utf8);
          return decrypted || null;
        } catch {
          return null;
        }
      };

      const candidates = [
        normalizedInput,
        ...sharedSecrets.map((secret) => decryptPayload(secret)),
      ].filter((value): value is string => Boolean(value));

      let payload: Record<string, unknown> | null = null;
      for (const candidate of candidates) {
        payload = parsePayload(candidate);
        if (payload) {
          break;
        }
      }

      if (!payload) {
        throw new Error('Unable to parse SSO payload');
      }

      const rawUserName =
        typeof payload.userName === 'string'
          ? payload.userName
          : typeof payload.name === 'string'
            ? payload.name
            : '';
      const userName = rawUserName.trim();
      const nameParts = userName.split(/\s+/).filter(Boolean);
      const firstName = typeof payload.firstName === 'string'
        ? payload.firstName
        : nameParts[0] ?? 'User';
      const lastName = typeof payload.lastName === 'string'
        ? payload.lastName
        : nameParts.slice(1).join(' ');
      const locationId =
        (typeof payload.activeLocation === 'string' && payload.activeLocation) ||
        (typeof payload.activeLocationId === 'string' && payload.activeLocationId) ||
        (typeof payload.locationId === 'string' && payload.locationId) ||
        (
          typeof payload.location === 'object' &&
          payload.location !== null &&
          typeof (payload.location as Record<string, unknown>).id === 'string' &&
          (payload.location as Record<string, unknown>).id as string
        ) ||
        (
          typeof payload.activeLocation === 'object' &&
          payload.activeLocation !== null &&
          typeof (payload.activeLocation as Record<string, unknown>).id === 'string' &&
          (payload.activeLocation as Record<string, unknown>).id as string
        ) ||
        undefined;
      const companyId =
        (typeof payload.companyId === 'string' && payload.companyId) ||
        (
          typeof payload.company === 'object' &&
          payload.company !== null &&
          typeof (payload.company as Record<string, unknown>).id === 'string' &&
          (payload.company as Record<string, unknown>).id as string
        ) ||
        undefined;
      const contextType =
        typeof payload.type === 'string' ? payload.type : undefined;

      if (!locationId && !companyId) {
        throw new Error('Missing company and active location');
      }

      return {
        locationId,
        companyId,
        type: contextType,
        userId: typeof payload.userId === 'string' ? payload.userId : '',
        email:
          typeof payload.email === 'string'
            ? payload.email
            : typeof payload.user === 'object' &&
                payload.user !== null &&
                typeof (payload.user as Record<string, unknown>).email === 'string'
              ? (payload.user as Record<string, unknown>).email as string
              : '',
        firstName,
        lastName,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to decrypt CRM SSO data');
      throw new ExternalServiceError('Platform', 'Invalid SSO data');
    }
  }

  /**
   * Get or create conversation for a contact
   */
  async getOrCreateConversation(
    connection: GHLConnection,
    contactId: string
  ): Promise<string> {
    const normalizedConnection = normalizeConnection(connection);

    try {
      // First try to get existing conversation
      const response = await this.apiRequestWithConnection<{ conversations: Array<{ id: string }> }>(
        normalizedConnection,
        async (accessToken) => this.apiRequest<{ conversations: Array<{ id: string }> }>(
          `${config.ghlApiDomain}/conversations/search?contactId=${contactId}`,
          { accessToken }
        )
      );

      if (response.conversations.length > 0 && response.conversations[0]) {
        return response.conversations[0].id;
      }

      // Create new conversation
      const createResponse = await this.apiRequestWithConnection<{ conversation: { id: string } }>(
        normalizedConnection,
        async (accessToken) => this.apiRequest<{ conversation: { id: string } }>(
          `${config.ghlApiDomain}/conversations`,
          {
            method: 'POST',
            accessToken,
            body: {
              contactId,
              locationId: normalizedConnection.externalAccountId,
            },
          }
        )
      );

      return createResponse.conversation.id;
    } catch (error) {
      logger.error({ error, contactId }, 'Failed to get or create the CRM conversation');
      throw error;
    }
  }

  /**
   * Get contact by phone number
   */
  async getContactByPhone(
    connection: GHLConnection,
    phoneNumber: string
  ): Promise<PlatformContact | null> {
    const normalizedConnection = normalizeConnection(connection);

    try {
      const response = await this.apiRequestWithConnection<{ contacts: Array<{
        id: string;
        firstName?: string;
        lastName?: string;
        email?: string;
      }> }>(
        normalizedConnection,
        async (accessToken) => this.apiRequest<{ contacts: Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          email?: string;
        }> }>(
          `${config.ghlApiDomain}/contacts/search/duplicate?phone=${encodeURIComponent(phoneNumber)}&locationId=${normalizedConnection.externalAccountId}`,
          { accessToken }
        )
      );

      if (response.contacts.length > 0) {
        return response.contacts[0] ?? null;
      }

      return null;
    } catch (error) {
      logger.error({ error, phoneNumber }, 'Failed to get the CRM contact by phone');
      return null;
    }
  }

  /**
   * Create a contact in the CRM platform
   */
  async createContact(
    connection: GHLConnection,
    data: {
      phone: string;
      firstName?: string;
      lastName?: string;
      email?: string;
    }
  ): Promise<{ id: string }> {
    const normalizedConnection = normalizeConnection(connection);

    try {
      const response = await this.apiRequestWithConnection<{ contact: { id: string } }>(
        normalizedConnection,
        async (accessToken) => this.apiRequest<{ contact: { id: string } }>(
          `${config.ghlApiDomain}/contacts`,
          {
            method: 'POST',
            accessToken,
            body: {
              locationId: normalizedConnection.externalAccountId,
              phone: data.phone,
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
            },
          }
        )
      );

      return { id: response.contact.id };
    } catch (error) {
      if (error instanceof Error) {
        const duplicateContactIdMatch = error.message.match(/"contactId":"([^"]+)"/);
        if (
          duplicateContactIdMatch?.[1] &&
          error.message.includes('This location does not allow duplicated contacts')
        ) {
          logger.warn(
            { phone: data.phone, contactId: duplicateContactIdMatch[1] },
            'CRM platform reported a duplicate contact, reusing the existing contact ID'
          );
          return { id: duplicateContactIdMatch[1] };
        }
      }

      logger.error({ error, phone: data.phone }, 'Failed to create the CRM contact');
      throw error;
    }
  }

  async updateContactPreferences(
    connection: GHLConnection,
    contactId: string,
    update: {
      dnd?: boolean;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const normalizedConnection = normalizeConnection(connection);

    try {
      await this.apiRequestWithConnection(
        normalizedConnection,
        async (accessToken) => this.apiRequest(
          `${config.ghlApiDomain}/contacts/${contactId}`,
          {
            method: 'PUT',
            accessToken,
            body: {
              ...(update.firstName ? { firstName: update.firstName } : {}),
              ...(update.lastName ? { lastName: update.lastName } : {}),
              ...(update.email ? { email: update.email } : {}),
              ...(update.phone ? { phone: update.phone } : {}),
              ...(typeof update.dnd === 'boolean'
                ? {
                    dnd: update.dnd,
                  }
                : {}),
              ...(update.metadata ? { customFields: update.metadata } : {}),
            },
          }
        )
      );
    } catch (error) {
      logger.error({ error, contactId }, 'Failed to update CRM contact preferences');
      throw error;
    }
  }
}

export const ghlAdapter = new GHLAdapter();
export type CrmPlatformAdapter = GHLAdapter;
export const crmPlatformAdapter = ghlAdapter;
