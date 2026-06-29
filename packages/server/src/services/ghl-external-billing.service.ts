import { config } from '../config/index.js';
import { platformAdapterRegistry } from './platform-adapter-registry.service.js';
import type { CrmPlatformAdapter } from '../adapters/crm-platform.adapter.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

type InstallType = 'location' | 'agency' | 'agency,location';

type BillingAuthorizationTarget =
  | {
      authType: 'location';
      locationId: string;
      subscriptionId: string;
    }
  | {
      authType: 'company';
      companyId: string;
      subscriptionId: string;
    };

export class ExternalBillingBridgeService {
  private readonly crmPlatformId = `${'lead'}connector` as const;

  private getAdapter() {
    return platformAdapterRegistry.get(this.crmPlatformId) as CrmPlatformAdapter;
  }

  private buildAuthorizationTargets(input: {
    installType: InstallType | string;
    locationId?: string;
    companyId?: string;
  }): BillingAuthorizationTarget[] {
    const normalizedInstallType = input.installType.trim().toLowerCase();
    const includesLocationInstall = normalizedInstallType.includes('location');
    const includesAgencyInstall = normalizedInstallType.includes('agency');
    const locationIds = (input.locationId ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const uniqueLocationIds = [...new Set(locationIds)];
    const targets: BillingAuthorizationTarget[] = [];

    if (includesAgencyInstall && input.companyId) {
      targets.push({
        authType: 'company',
        companyId: input.companyId,
        subscriptionId: `smc-test-company-${input.companyId}`,
      });
    }

    if (includesLocationInstall) {
      for (const locationId of uniqueLocationIds) {
        targets.push({
          authType: 'location',
          locationId,
          subscriptionId: `smc-test-location-${locationId}`,
        });
      }
    }

    if (targets.length === 0) {
      throw new AppError(
        'Marketplace billing request is missing the required install target identifiers.',
        'CRM_BILLING_TARGET_MISSING',
        400,
        true,
        {
          installType: input.installType,
          hasLocationId: uniqueLocationIds.length > 0,
          hasCompanyId: Boolean(input.companyId),
        }
      );
    }

    return targets;
  }

  async authorizeInstallation(input: {
    clientId: string;
    installType: InstallType | string;
    locationId?: string;
    companyId?: string;
  }) {
    const adapter = this.getAdapter();
    const [configuredClientId, marketplaceAppId, clientSecret] = await Promise.all([
      adapter.getClientId(),
      adapter.getMarketplaceAppId(),
      adapter.getClientSecret(),
    ]);

    if (!configuredClientId || !marketplaceAppId || !clientSecret) {
      throw new AppError(
        'Marketplace billing credentials are not configured.',
        'CRM_BILLING_NOT_CONFIGURED',
        503
      );
    }

    const normalizedIncomingClientId = input.clientId.trim();
    const acceptedClientIds = new Set([
      configuredClientId.trim(),
      marketplaceAppId.trim(),
    ]);

    if (!acceptedClientIds.has(normalizedIncomingClientId)) {
      throw new AppError(
        'Marketplace billing request client ID does not match the configured app.',
        'CRM_BILLING_CLIENT_MISMATCH',
        400,
        true,
        {
          incomingClientId: normalizedIncomingClientId,
          expectedClientIds: Array.from(acceptedClientIds),
        }
      );
    }

    const billingRequestClientId = marketplaceAppId.trim();
    const billingHeaderClientKey = configuredClientId.trim();
    const authorizationTargets = this.buildAuthorizationTargets(input);
    const authorizations: Array<{
      authType: 'company' | 'location';
      targetId: string;
      subscriptionId: string;
      response: unknown;
    }> = [];

    for (const target of authorizationTargets) {
      const payload = {
        clientId: billingRequestClientId,
        authType: target.authType,
        ...(target.authType === 'location'
          ? { locationId: target.locationId }
          : { companyId: target.companyId }),
        subscriptionId: target.subscriptionId,
        amount: 0,
        status: 'COMPLETED',
        paymentType: 'recurring',
      };

      const response = await fetch(`${config.ghlApiDomain}/oauth/billing/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ghl-client-key': billingHeaderClientKey,
          'x-ghl-client-secret': clientSecret,
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let responseBody: unknown = null;

      if (responseText) {
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          responseBody = responseText;
        }
      }

      if (!response.ok) {
        logger.error(
          {
            status: response.status,
            authType: target.authType,
            installType: input.installType,
            incomingClientId: normalizedIncomingClientId,
            billingRequestClientId,
            billingHeaderClientKey,
            locationId: input.locationId,
            companyId: input.companyId,
            targetId: target.authType === 'location' ? target.locationId : target.companyId,
            responseBody,
          },
          'CRM billing authorization webhook failed'
        );

        throw new AppError(
          'The CRM marketplace rejected the billing authorization request.',
          'CRM_BILLING_AUTHORIZATION_FAILED',
          502,
          true,
          {
            status: response.status,
            authType: target.authType,
          }
        );
      }

      authorizations.push({
        authType: target.authType,
        targetId: target.authType === 'location' ? target.locationId : target.companyId,
        subscriptionId: target.subscriptionId,
        response: responseBody,
      });
    }

    logger.info(
      {
        installType: input.installType,
        incomingClientId: normalizedIncomingClientId,
        billingRequestClientId,
        billingHeaderClientKey,
        locationId: input.locationId,
        companyId: input.companyId,
        authorizationCount: authorizations.length,
        authorizations: authorizations.map((authorization) => ({
          authType: authorization.authType,
          targetId: authorization.targetId,
          subscriptionId: authorization.subscriptionId,
        })),
      },
      'Authorized external billing installation for the CRM marketplace'
    );

    return {
      authorizationCount: authorizations.length,
      amount: 0,
      authorizations,
    };
  }
}

export const externalBillingBridgeService = new ExternalBillingBridgeService();
