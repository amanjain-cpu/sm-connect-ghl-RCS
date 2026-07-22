// ===========================================
// Platform Routes (OAuth & Connections)
// ===========================================

import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { platformService } from '../services/platform.service.js';
import { authService } from '../services/auth.service.js';
import { platformAdapterRegistry } from '../services/platform-adapter-registry.service.js';
import { integrationService } from '../services/integration.service.js';
import { deadLetterService } from '../services/dead-letter.service.js';
import type { CrmPlatformAdapter } from '../adapters/crm-platform.adapter.js';
import { validate, idParamSchema } from '../middleware/validation.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { BadRequestError } from '../utils/errors.js';
import { generateUrlSafeToken } from '../utils/crypto.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { setAuthCookies } from '../utils/auth-cookies.js';
import { adminService, SETTINGS_KEYS } from '../services/admin.service.js';
import type { PlatformConnection } from '@prisma/client';
import {
  findMatchingCrmInstallWebhookLocation,
  resolveCrmOAuthLocation,
  type CrmInstallWebhookSignal,
} from '../services/ghl-oauth-location-resolution.service.js';

const router: RouterType = Router();
const crmPlatformId = `${'lead'}connector` as const;
const crmPublicPlatformId = 'crm' as const;
const supportedPlatforms = [crmPlatformId, 'shopify', 'hubspot', 'salesforce', 'zoho'] as const;
const supportedPlatformRouteParams = [crmPublicPlatformId, ...supportedPlatforms] as const;
type SupportedPlatform = (typeof supportedPlatforms)[number];
type SupportedPlatformRouteParam = (typeof supportedPlatformRouteParams)[number];
const crmMarketplaceHostSuffixes = [
  `.${['go', 'high', 'level'].join('')}.com`,
  `.${['lead', 'connector', 'hq'].join('')}.com`,
];
const defaultCrmWorkspaceOrigin = `https://app.${['go', 'high', 'level'].join('')}.com`;

function normalizePlatformRouteParam(platform: SupportedPlatformRouteParam): SupportedPlatform {
  return platform === crmPublicPlatformId ? crmPlatformId : platform;
}

function getPublicPlatformRouteParam(
  platform: SupportedPlatformRouteParam | SupportedPlatform
): SupportedPlatformRouteParam | SupportedPlatform {
  return platform === crmPlatformId ? crmPublicPlatformId : platform;
}

function buildPlatformCallbackUrl(platform: SupportedPlatformRouteParam | SupportedPlatform): string {
  return `${config.apiUrl}/api/platforms/${getPublicPlatformRouteParam(platform)}/callback`;
}

function getTrustedCrmReturnUrl(referrer: string | undefined): string | null {
  if (!referrer) {
    return null;
  }

  try {
    const referrerUrl = new URL(referrer);
    if (crmMarketplaceHostSuffixes.some((hostnameSuffix) => referrerUrl.hostname.endsWith(hostnameSuffix))) {
      return referrerUrl.toString();
    }
  } catch {
    return null;
  }

  return null;
}

async function getEmbeddedCrmReturnUrl(
  locationId: string,
  fallbackUrl: string | null
): Promise<string | null> {
  const customPageLinkId = (
    await adminService.getSettingWithFallback(
      SETTINGS_KEYS.GHL_APP_CUSTOM_PAGE_LINK_ID,
      config.ghlAppCustomPageLinkId
    )
  ).trim();

  if (!customPageLinkId) {
    return fallbackUrl;
  }

  let origin = defaultCrmWorkspaceOrigin;

  if (fallbackUrl) {
    try {
      const fallback = new URL(fallbackUrl);
      if (crmMarketplaceHostSuffixes.some((hostnameSuffix) => fallback.hostname.endsWith(hostnameSuffix))) {
        origin = fallback.origin;
      }
    } catch {
      // Ignore malformed fallbacks and keep the canonical GHL origin.
    }
  }

  return new URL(
    `/v2/location/${encodeURIComponent(locationId)}/custom-page-link/${encodeURIComponent(customPageLinkId)}`,
    origin
  ).toString();
}

async function getCrmOAuthEmbeddedSessionContext(input: {
  organizationId: string;
  accountInfoId: string;
  connection: PlatformConnection;
}) {
  let installation = input.connection.installationId
    ? await prisma.platformInstallation.findFirst({
        where: {
          id: input.connection.installationId,
          organizationId: input.organizationId,
          platform: crmPlatformId,
          externalAccountId: input.accountInfoId,
        },
        select: {
          id: true,
          status: true,
          externalAccountId: true,
        },
      })
    : null;

  if (!installation) {
    installation = await prisma.platformInstallation.findFirst({
      where: {
        organizationId: input.organizationId,
        platform: crmPlatformId,
        externalAccountId: input.accountInfoId,
      },
      select: {
        id: true,
        status: true,
        externalAccountId: true,
      },
    });
  }

  if (!installation || installation.status !== 'connected') {
    const syncedInstallation = await integrationService.syncInstallationFromConnection(input.connection);
    installation = {
      id: syncedInstallation.id,
      status: syncedInstallation.status,
      externalAccountId: syncedInstallation.externalAccountId,
    };
  }

  if (installation.externalAccountId !== input.accountInfoId) {
    throw new BadRequestError(
      'The connected CRM workspace did not match the OAuth callback workspace.'
    );
  }

  if (installation.status !== 'connected') {
    throw new BadRequestError(
      'The CRM workspace connection is not active. Reconnect from the target workspace and try again.'
    );
  }

  return {
    locationId: input.accountInfoId,
    installationId: installation.id,
  };
}

// Validation schemas
const oauthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(), // Optional for direct marketplace installs
  locationId: z.string().optional(),
  companyId: z.string().optional(),
  userId: z.string().optional(),
});

const platformParamSchema = z.object({
  platform: z.enum(supportedPlatformRouteParams),
});

const activationSchema = z.object({
  source: z.enum(['manual_confirmation', 'test_send']).default('manual_confirmation'),
});

const embeddedSsoExchangeSchema = z.object({
  encryptedData: z.string().min(1, 'Encrypted SSO payload is required'),
});

const listConnectionsHandler = asyncHandler(async (req, res) => {
  const connections = await platformService.getConnectionSummaries(
    req.user!.organizationId
  );

  // Don't expose tokens
  const sanitizedConnections = connections.map((conn) => ({
    id: conn.id,
    platform: conn.platform,
    platformAccountId: conn.platformAccountId,
    platformAccountName: conn.platformAccountName,
    status: conn.status,
    scopes: conn.scopes,
    lastSyncAt: conn.lastSyncAt,
    createdAt: conn.createdAt,
    installation: conn.installation,
  }));

  res.json({
    success: true,
    data: sanitizedConnections,
  });
});

/**
 * GET /platforms
 * List all platform connections for the organization
 */
router.get(
  '/',
  authenticate,
  listConnectionsHandler
);

/**
 * GET /platforms/connections
 * Backwards-compatible alias for older frontend bundles
 */
router.get(
  '/connections',
  authenticate,
  listConnectionsHandler
);

/**
 * GET /platforms/:platform/oauth
 * Initiate OAuth flow for a platform
 */
router.get(
  '/:platform/oauth',
  optionalAuth,
  validate({ params: platformParamSchema }),
  asyncHandler(async (req, res) => {
    const routePlatform = req.params.platform as SupportedPlatformRouteParam;
    const platform = normalizePlatformRouteParam(routePlatform);
    const platformAdapter = platformAdapterRegistry.get(platform as Parameters<typeof platformAdapterRegistry.get>[0]);
    const redirectUri = buildPlatformCallbackUrl(routePlatform);

    // Generate state token
    const state = generateUrlSafeToken(32);

    // Store state in database for verification
    await prisma.oAuthState.create({
      data: {
        state,
        platform: platform as any,
        organizationId: req.user?.organizationId,
        redirectUri,
        embeddedLocationId: req.user?.embeddedLocationId,
        embeddedInstallationId: req.user?.embeddedInstallationId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      },
    });

    const authUrl = await platformAdapter.getAuthorizationUrl(state, redirectUri);

    res.json({
      success: true,
      data: { authUrl },
    });
  })
);

/**
 * GET /platforms/:platform/callback
 * OAuth callback handler
 */
router.get(
  '/:platform/callback',
  validate({ params: platformParamSchema, query: oauthCallbackSchema }),
  asyncHandler(async (req, res) => {
    const routePlatform = req.params.platform as SupportedPlatformRouteParam;
    const platform = normalizePlatformRouteParam(routePlatform);
    const { code, state, locationId: callbackLocationId, companyId: callbackCompanyId, userId: callbackUserId } = req.query;
    const platformAdapter = platformAdapterRegistry.get(platform as Parameters<typeof platformAdapterRegistry.get>[0]);
    const crmReturnUrl = getTrustedCrmReturnUrl(req.get('referer') ?? undefined);
    const getQueryString = (value: unknown): string | undefined =>
      typeof value === 'string' ? value : undefined;
    const callbackLocationIdValue = getQueryString(callbackLocationId);
    const callbackCompanyIdValue = getQueryString(callbackCompanyId);
    const callbackUserIdValue = getQueryString(callbackUserId);

    let storedOrganizationId: string | null = null;
    let storedEmbeddedLocationId: string | null = null;
    let storedEmbeddedInstallationId: string | null = null;

    // Verify state if provided (app-initiated flow)
    // State is optional for direct marketplace installs that originate inside the CRM shell.
    if (state) {
      const storedState = await prisma.oAuthState.findUnique({
        where: { state: state as string },
      });

      if (!storedState || storedState.expiresAt < new Date()) {
        throw new BadRequestError('Invalid or expired state');
      }

      // Delete used state
      await prisma.oAuthState.delete({ where: { id: storedState.id } });

      if (storedState.platform !== platform) {
        throw new BadRequestError('State platform mismatch');
      }

      storedOrganizationId = storedState.organizationId;
      storedEmbeddedLocationId = storedState.embeddedLocationId;
      storedEmbeddedInstallationId = storedState.embeddedInstallationId;
    } else {
      // Marketplace install without a stored state token.
      logger.info({ platform }, 'OAuth callback without state (marketplace install)');
    }

    const redirectUri = buildPlatformCallbackUrl(routePlatform);

    let tokens = await platformAdapter.exchangeCodeForTokens(code as string, redirectUri);
    let crmTokenContext:
      | ReturnType<CrmPlatformAdapter['getAccessTokenContext']>
      | null = null;

    if (platform === crmPlatformId) {
      const crmPlatformAdapter = platformAdapter as CrmPlatformAdapter;
      const delay = async (ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        });
      const failCrmInstall = (reason: string, message: string): never | void => {
        if (!state) {
          const installCompleteUrl = new URL(`${config.webUrl}/auth/install-complete`);
          installCompleteUrl.searchParams.set('platform', getPublicPlatformRouteParam(platform));
          installCompleteUrl.searchParams.set('success', 'false');
          installCompleteUrl.searchParams.set('reason', reason);
          res.redirect(installCompleteUrl.toString());
          return;
        }

        throw new BadRequestError(message);
      };
      const completeAgencyCrmInstall = async (input: {
        companyId: string;
      }): Promise<void> => {
        if (state) {
          throw new BadRequestError(
            'The platform returned an agency-scoped token and no target workspace could be resolved.'
          );
        }

        const placeholderAccountName = 'CRM Agency Workspace';
        const { organizationId, isNew } = await platformService.findOrCreateOrganization(
          platform as any,
          input.companyId,
          {
            name: placeholderAccountName,
            email: `${input.companyId}@${platform}.local`,
          }
        );

        await platformService.createConnection({
          organizationId,
          platform: platform as any,
          platformAccountId: input.companyId,
          platformAccountName: placeholderAccountName,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiresAt: tokens.expiresIn
            ? new Date(Date.now() + tokens.expiresIn * 1000)
            : undefined,
          scopes: tokens.scope?.split(' ') ?? [],
          status: 'pending',
          metadata: {
            ...(tokens.companyId ? { companyId: tokens.companyId } : {}),
            ...(crmTokenContext
              ? {
                  ghlAuthClass: crmTokenContext.authClass ?? null,
                  ghlAuthClassId: crmTokenContext.authClassId ?? null,
                  ghlPrimaryAuthClassId: crmTokenContext.primaryAuthClassId ?? null,
                  ghlTokenLocationId: crmTokenContext.locationId ?? null,
                  ghlTokenCompanyId: crmTokenContext.companyId ?? null,
                  ghlTokenScopes: crmTokenContext.scopes,
                }
              : {}),
          },
        });

        const installCompleteUrl = new URL(`${config.webUrl}/auth/install-complete`);
        installCompleteUrl.searchParams.set('platform', getPublicPlatformRouteParam(platform));
        installCompleteUrl.searchParams.set('success', 'true');
        installCompleteUrl.searchParams.set('installScope', 'agency');
        if (isNew) {
          installCompleteUrl.searchParams.set('isNew', 'true');
        }

        logger.info(
          { companyId: input.companyId, organizationId },
          'Completed agency-level CRM installation without a resolved workspace'
        );

        res.redirect(installCompleteUrl.toString());
      };

      crmTokenContext = crmPlatformAdapter.getAccessTokenContext(tokens.accessToken);

      if (!crmPlatformAdapter.isLocationScopedAccessToken(tokens.accessToken)) {
        logger.warn(
          {
            platform,
            authClass: crmTokenContext.authClass,
            tokenLocationId: crmTokenContext.locationId,
            tokenCompanyId: crmTokenContext.companyId,
          },
          'CRM OAuth callback returned an agency-scoped token; attempting workspace token exchange'
        );

        const companyId =
          tokens.companyId ??
          crmTokenContext.companyId ??
          callbackCompanyIdValue;
        const userId = tokens.userId ?? callbackUserIdValue;
        const appId = await crmPlatformAdapter.getMarketplaceAppId();
        let resolvedLocationId: string | undefined;

        const readRecentInstallWebhookSignals = async (): Promise<CrmInstallWebhookSignal[]> => {
          const recentInstallEvents = await prisma.webhookEvent.findMany({
            where: {
              platform: crmPlatformId,
              eventType: 'INSTALL',
              createdAt: {
                gte: new Date(Date.now() - 30 * 60 * 1000),
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 50,
            select: {
              payload: true,
              createdAt: true,
            },
          });

          return recentInstallEvents.map((event) => ({
            payload: event.payload,
            createdAt: event.createdAt,
          }));
        };

        const locationResolution = await resolveCrmOAuthLocation({
          companyId,
          currentRequestLocationId: callbackLocationIdValue ?? storedEmbeddedLocationId ?? undefined,
          tokenLocationId: tokens.platformAccountId ?? crmTokenContext.locationId,
          userId,
          appId,
          maxInstallSignalAttempts: state ? 2 : 8,
          installSignalRetryDelayMs: 1200,
          readRecentInstallWebhookSignals,
          readInstalledLocations: (restrictToUserLocations) =>
            crmPlatformAdapter.getInstalledLocations(tokens.accessToken, {
              companyId: companyId!,
              appId,
              limit: 100,
              ...(restrictToUserLocations ? { restrictToUserLocations: true } : {}),
            }),
          wait: delay,
          logger,
        });

        resolvedLocationId = locationResolution.locationId;

        logger.info(
          {
            platform,
            companyId,
            resolvedLocationId,
            resolutionSource: locationResolution.source,
            callbackLocationId: callbackLocationIdValue ?? null,
            storedEmbeddedLocationId,
            storedEmbeddedInstallationId,
            tokenLocationId: crmTokenContext.locationId ?? tokens.platformAccountId ?? null,
          },
          'Resolved CRM OAuth workspace location'
        );

        if (!companyId || !resolvedLocationId) {
          const maybeReturnedLocationId =
            crmTokenContext.locationId ??
            tokens.platformAccountId ??
            null;
          const maybeReturnedCompanyId =
            crmTokenContext.companyId ??
            tokens.companyId ??
            null;

          if (!resolvedLocationId && companyId && !state) {
            await completeAgencyCrmInstall({ companyId });
            return;
          }

          return failCrmInstall(
            'location_token_resolution_failed',
            `The platform returned an agency token and no target workspace could be resolved (companyId=${maybeReturnedCompanyId}, locationId=${maybeReturnedLocationId}).`
          );
        }

        let lastExchangeError: unknown;
        const maxExchangeAttempts = state ? 3 : 8;
        for (let attempt = 1; attempt <= maxExchangeAttempts; attempt += 1) {
          try {
            tokens = await crmPlatformAdapter.exchangeAgencyTokenForLocationToken(tokens.accessToken, {
              companyId,
              locationId: resolvedLocationId,
            });
            crmTokenContext = crmPlatformAdapter.getAccessTokenContext(tokens.accessToken);
            lastExchangeError = undefined;
            break;
          } catch (error) {
            lastExchangeError = error;

            if (attempt >= maxExchangeAttempts) {
              break;
            }

            logger.warn(
              {
                attempt,
                maxExchangeAttempts,
                companyId,
                locationId: resolvedLocationId,
                err: error,
              },
              'Retrying workspace token exchange for the CRM platform'
            );

            await delay(1200);
            const latestInstallWebhookMatch = companyId
              ? findMatchingCrmInstallWebhookLocation(
                  await readRecentInstallWebhookSignals(),
                  { companyId, userId, appId }
                )
              : null;
            resolvedLocationId = latestInstallWebhookMatch?.locationId ?? resolvedLocationId;
          }
        }

        if (lastExchangeError) {
          logger.error(
            {
              error: lastExchangeError,
              companyId,
              locationId: resolvedLocationId,
            },
            'Failed to exchange agency token for location token during OAuth callback'
          );
          return failCrmInstall(
            'location_token_exchange_failed',
            'The platform returned an agency token and workspace token exchange failed. Reopen Marketplace from the target workspace and reinstall.'
          );
        }
      }

      if (!crmPlatformAdapter.isLocationScopedAccessToken(tokens.accessToken)) {
        logger.error(
          {
            platform,
            authClass: crmTokenContext.authClass,
            tokenLocationId: crmTokenContext.locationId,
            tokenCompanyId: crmTokenContext.companyId,
          },
          'Rejected CRM OAuth callback because a workspace-scoped token is required'
        );

        return failCrmInstall(
          'location_token_required',
          'The platform returned an agency-scoped token. Reconnect from the target workspace to continue.'
        );
      }
    }

    const accountInfo = await platformAdapter.getAccountInfo(
      tokens.accessToken,
      tokens.platformAccountId,
      tokens.companyId
    );
    const crmConnectionCompanyId =
      platform === crmPlatformId
        ? tokens.companyId ?? crmTokenContext?.companyId ?? callbackCompanyIdValue
        : undefined;

    // Find or create organization
    const { organizationId, isNew } = await platformService.findOrCreateOrganization(
      platform as any,
      accountInfo.id,
      {
        name: accountInfo.name,
        email: accountInfo.email ?? `${accountInfo.id}@${platform}.local`,
        phone: accountInfo.phone,
        website: accountInfo.website,
      },
      crmConnectionCompanyId ? { companyId: crmConnectionCompanyId } : undefined
    );

    // Create/update platform connection
    const connection = await platformService.createConnection({
      organizationId,
      platform: platform as any,
      platformAccountId: accountInfo.id,
      platformAccountName: accountInfo.name,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000)
        : undefined,
      scopes: tokens.scope?.split(' ') ?? [],
      metadata: {
        ...(accountInfo.metadata ?? {}),
        ...(crmConnectionCompanyId ? { companyId: crmConnectionCompanyId } : {}),
        ...(crmTokenContext
          ? {
              ghlAuthClass: crmTokenContext.authClass ?? null,
              ghlAuthClassId: crmTokenContext.authClassId ?? null,
              ghlPrimaryAuthClassId: crmTokenContext.primaryAuthClassId ?? null,
              ghlTokenLocationId: crmTokenContext.locationId ?? null,
              ghlTokenCompanyId: crmTokenContext.companyId ?? null,
              ghlTokenScopes: crmTokenContext.scopes,
            }
        : {}),
      },
    });

    const crmEmbeddedSessionContext =
      platform === crmPlatformId
        ? await getCrmOAuthEmbeddedSessionContext({
            organizationId,
            accountInfoId: accountInfo.id,
            connection,
          })
        : null;

    logger.info(
      {
        platform,
        accountId: accountInfo.id,
        organizationId,
        connectionId: connection.id,
        resolvedLocationId: crmEmbeddedSessionContext?.locationId ?? null,
        installationId: crmEmbeddedSessionContext?.installationId ?? null,
        tokenLocationId: crmTokenContext?.locationId ?? null,
      },
      'Platform connected successfully'
    );

    if (platform === crmPlatformId) {
      const replaySummary = await deadLetterService.replayPendingInboundForOrganization(organizationId, 100);
      if (replaySummary.replayed > 0 || replaySummary.failed > 0) {
        logger.info(
          { organizationId, replaySummary },
          'Replayed deferred inbound jobs after the CRM reconnect'
        );
      }
    }

    if (!state) {
      const authResult = await authService.loginViaOAuth(
        organizationId,
        crmEmbeddedSessionContext ?? {}
      );
      setAuthCookies(req, res, authResult.tokens);
      const embeddedCrmReturnUrl =
        platform === crmPlatformId
          ? await getEmbeddedCrmReturnUrl(accountInfo.id, crmReturnUrl)
          : crmReturnUrl;

      const successUrl = new URL(`${config.webUrl}/auth/callback`);
      successUrl.searchParams.set('platform', getPublicPlatformRouteParam(platform));
      successUrl.searchParams.set('success', 'true');
      successUrl.searchParams.set('accessToken', authResult.tokens.accessToken);
      successUrl.searchParams.set('refreshToken', authResult.tokens.refreshToken);
      successUrl.searchParams.set('expiresIn', authResult.tokens.expiresIn.toString());
      successUrl.searchParams.set('marketplaceInstall', 'true');
      if (embeddedCrmReturnUrl) {
        successUrl.searchParams.set('returnTo', embeddedCrmReturnUrl);
      }
      if (isNew) {
        successUrl.searchParams.set('isNew', 'true');
      }

      res.redirect(successUrl.toString());
      return;
    }

    // Auto-login: Create user session and get JWT tokens for app-initiated OAuth
    const authResult = await authService.loginViaOAuth(
      organizationId,
      crmEmbeddedSessionContext ?? {}
    );
    setAuthCookies(req, res, authResult.tokens);
    const embeddedCrmReturnUrl =
      platform === crmPlatformId
        ? await getEmbeddedCrmReturnUrl(accountInfo.id, crmReturnUrl)
        : crmReturnUrl;

    const successUrl = new URL(`${config.webUrl}/auth/callback`);
    successUrl.searchParams.set('platform', getPublicPlatformRouteParam(platform));
    successUrl.searchParams.set('success', 'true');
    successUrl.searchParams.set('accessToken', authResult.tokens.accessToken);
    successUrl.searchParams.set('refreshToken', authResult.tokens.refreshToken);
    successUrl.searchParams.set('expiresIn', authResult.tokens.expiresIn.toString());
    if (embeddedCrmReturnUrl) {
      successUrl.searchParams.set('returnTo', embeddedCrmReturnUrl);
    }
    if (isNew) {
      successUrl.searchParams.set('isNew', 'true');
    }

    res.redirect(successUrl.toString());
  })
);

/**
 * Exchange embedded CRM SSO payload for app auth tokens.
 */
const handleEmbeddedCrmSsoExchange = asyncHandler(async (req, res) => {
  const { encryptedData } = embeddedSsoExchangeSchema.parse(req.body);
  const crmPlatformAdapter = platformAdapterRegistry.get(crmPlatformId) as CrmPlatformAdapter;
  const ssoPayload = await crmPlatformAdapter.decryptSsoData?.(encryptedData);

  if (!ssoPayload?.locationId) {
    if (ssoPayload?.companyId) {
      throw new BadRequestError(
        'Open the app from a workspace inside your CRM to continue.'
      );
    }

    throw new BadRequestError('Invalid embedded sign-in payload');
  }

  let connection = await platformService.getByPlatformAccount(
    crmPlatformId,
    ssoPayload.locationId
  );

  if (!connection && ssoPayload.companyId) {
    const agencyConnection = await platformService.getLeadconnectorAgencyConnectionByCompanyId(
      ssoPayload.companyId
    );

    if (agencyConnection) {
      const decryptedAgencyTokens = await platformService.getDecryptedTokens(agencyConnection.id);
      const agencyTokenContext = crmPlatformAdapter.getAccessTokenContext(decryptedAgencyTokens.accessToken);

      if (!crmPlatformAdapter.isLocationScopedAccessToken(decryptedAgencyTokens.accessToken)) {
        try {
          const locationTokens = await crmPlatformAdapter.exchangeAgencyTokenForLocationToken(
            decryptedAgencyTokens.accessToken,
            {
              companyId: ssoPayload.companyId,
              locationId: ssoPayload.locationId,
            }
          );
          const locationTokenContext = crmPlatformAdapter.getAccessTokenContext(locationTokens.accessToken);
          const accountInfo = await crmPlatformAdapter.getAccountInfo(
            locationTokens.accessToken,
            ssoPayload.locationId,
            ssoPayload.companyId
          );

          connection = await platformService.createConnection({
            organizationId: agencyConnection.organizationId,
            platform: crmPlatformId,
            platformAccountId: accountInfo.id,
            platformAccountName: accountInfo.name,
            accessToken: locationTokens.accessToken,
            refreshToken: locationTokens.refreshToken,
            tokenExpiresAt: locationTokens.expiresIn
              ? new Date(Date.now() + locationTokens.expiresIn * 1000)
              : undefined,
            scopes: locationTokens.scope?.split(' ') ?? [],
            metadata: {
              ...(accountInfo.metadata ?? {}),
              companyId: ssoPayload.companyId,
              agencyBridgeConnectionId: agencyConnection.id,
              agencyBridgeAuthClass: agencyTokenContext.authClass ?? null,
              ghlAuthClass: locationTokenContext.authClass ?? null,
              ghlAuthClassId: locationTokenContext.authClassId ?? null,
              ghlPrimaryAuthClassId: locationTokenContext.primaryAuthClassId ?? null,
              ghlTokenLocationId: locationTokenContext.locationId ?? null,
              ghlTokenCompanyId: locationTokenContext.companyId ?? null,
              ghlTokenScopes: locationTokenContext.scopes,
            },
          });

          logger.info(
            {
              locationId: ssoPayload.locationId,
              companyId: ssoPayload.companyId,
              agencyConnectionId: agencyConnection.id,
              organizationId: agencyConnection.organizationId,
            },
            'Created location-scoped CRM connection from agency installation during embedded sign-in'
          );
        } catch (error) {
          logger.error(
            {
              err: error,
              locationId: ssoPayload.locationId,
              companyId: ssoPayload.companyId,
              agencyConnectionId: agencyConnection.id,
            },
            'Failed to create location-scoped CRM connection from agency installation'
          );
        }
      }
    }
  }

  if (!connection) {
    throw new BadRequestError(
      'This workspace is not connected yet. Install or reconnect the Signalmash app first.'
    );
  }

  const installation = connection.installationId
    ? await prisma.platformInstallation.findFirst({
        where: {
          id: connection.installationId,
          organizationId: connection.organizationId,
          platform: crmPlatformId,
        },
        select: {
          id: true,
          status: true,
          externalAccountId: true,
        },
      })
    : await prisma.platformInstallation.findFirst({
        where: {
          organizationId: connection.organizationId,
          platform: crmPlatformId,
          externalAccountId: ssoPayload.locationId,
        },
        select: {
          id: true,
          status: true,
          externalAccountId: true,
        },
      });

  if (
    connection.status !== 'connected' ||
    !installation ||
    installation.status !== 'connected' ||
    installation.externalAccountId !== ssoPayload.locationId
  ) {
    logger.warn(
      {
        locationId: ssoPayload.locationId,
        connectionId: connection.id,
        connectionStatus: connection.status,
        installationId: installation?.id ?? null,
        installationStatus: installation?.status ?? null,
      },
      'Rejected embedded CRM SSO exchange because the workspace connection is not active'
    );

    throw new BadRequestError(
      'This workspace connection is inactive. Reconnect the Signalmash app from this workspace and try again.'
    );
  }

  const authResult = await authService.loginViaOAuth(connection.organizationId, {
    locationId: ssoPayload.locationId,
    installationId: installation.id,
  });
  setAuthCookies(req, res, authResult.tokens);

  res.json({
    success: true,
    data: {
      ...authResult,
      locationId: ssoPayload.locationId,
    },
  });
});

router.post(`/${crmPublicPlatformId}/sso/exchange`, handleEmbeddedCrmSsoExchange);
router.post(`/${crmPlatformId}/sso/exchange`, handleEmbeddedCrmSsoExchange);

/**
 * GET /platforms/:id
 * Get platform connection details
 */
router.get(
  '/:id',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const connection = await platformService.getConnectionSummaries(
      req.user!.organizationId
    ).then((connections) => connections.find((item) => item.id === req.params.id));

    if (!connection) {
      throw new BadRequestError('Platform connection not found');
    }

    res.json({
      success: true,
      data: {
        id: connection.id,
        platform: connection.platform,
        platformAccountId: connection.platformAccountId,
        platformAccountName: connection.platformAccountName,
        status: connection.status,
        scopes: connection.scopes,
        lastSyncAt: connection.lastSyncAt,
        createdAt: connection.createdAt,
        installation: connection.installation,
      },
    });
  })
);

/**
 * DELETE /platforms/connections/:id
 * Backwards-compatible alias for older frontend bundles
 */
router.delete(
  '/connections/:id',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await platformService.delete(req.params.id, req.user!.organizationId);

    res.json({
      success: true,
      message: 'Platform connection deleted',
    });
  })
);

/**
 * GET /platforms/:id/readiness
 * Get onboarding readiness details for a connection
 */
router.get(
  '/:id/readiness',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const connection = await platformService.getById(req.params.id, req.user!.organizationId);
    const readiness = await integrationService.getInstallationReadiness(
      req.user!.organizationId,
      connection.platform,
      connection.installationId
    );

    res.json({
      success: true,
      data: readiness,
    });
  })
);

/**
 * POST /platforms/:id/activate-provider
 * Mark manual provider activation as complete
 */
router.post(
  '/:id/activate-provider',
  authenticate,
  validate({ params: idParamSchema, body: activationSchema }),
  asyncHandler(async (req, res) => {
    const readiness = await integrationService.markProviderActivated(
      req.user!.organizationId,
      req.params.id,
      req.body
    );

    res.json({
      success: true,
      data: readiness,
    });
  })
);

/**
 * POST /platforms/:id/disconnect
 * Disconnect a platform
 */
router.post(
  '/:id/disconnect',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await platformService.disconnect(req.params.id, req.user!.organizationId);

    res.json({
      success: true,
      message: 'Platform disconnected successfully',
    });
  })
);

/**
 * DELETE /platforms/:id
 * Delete platform connection
 */
router.delete(
  '/:id',
  authenticate,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await platformService.delete(req.params.id, req.user!.organizationId);

    res.json({
      success: true,
      message: 'Platform connection deleted',
    });
  })
);

export { router as platformRoutes };
