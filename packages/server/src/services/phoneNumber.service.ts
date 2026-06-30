// ===========================================
// Phone Number (DID) Management Service
// ===========================================

import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { signalmashService } from './signalmash.service.js';
import { AppError, ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { Brand, Campaign, PhoneNumber, PhoneNumberStatus } from '@prisma/client';
import { integrationService } from './integration.service.js';
import { deadLetterService } from './dead-letter.service.js';
import { formatPhoneE164 } from '@signalmash-connect/shared';

interface AvailableNumber {
  phoneNumber: string;
  formattedNumber: string;
  areaCode: string;
  capabilities: {
    sms: boolean;
    mms: boolean;
    voice: boolean;
  };
  monthlyPrice: number;
}

interface SearchOptions {
  areaCode?: string;
  contains?: string;
  state?: string;
  limit?: number;
}

interface LinkExistingAssetsInput {
  organizationId: string;
  brandName: string;
  signalmashBrandId: string;
  tcrBrandId?: string;
  campaignName: string;
  signalmashCampaignId: string;
  tcrCampaignId?: string;
  phoneNumber: string;
  signalmashNumberId?: string;
  friendlyName?: string;
  configureWebhook?: boolean;
  makeDefaultSender?: boolean;
}

export class PhoneNumberService {
  private getSignalmashWebhookUrl(): string {
    return `${config.apiUrl}/api/webhooks/signalmash`;
  }

  // ===========================================
  // Search Available Numbers
  // ===========================================

  /**
   * Search for available phone numbers to purchase
   */
  async searchAvailableNumbers(options: SearchOptions): Promise<AvailableNumber[]> {
    logger.info({ options }, 'Searching available phone numbers');

    try {
      const numbers = await signalmashService.listAvailableNumbers({
        areaCode: options.areaCode,
        contains: options.contains,
        state: options.state,
        limit: options.limit || 20,
      });

      return numbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        formattedNumber: n.formattedNumber,
        areaCode: this.extractAreaCode(n.phoneNumber),
        capabilities: {
          sms: n.capabilities.sms,
          mms: n.capabilities.mms,
          voice: n.capabilities.voice,
        },
        monthlyPrice: n.monthlyPrice,
      }));
    } catch (error) {
      if (error instanceof ExternalServiceError) {
        throw new AppError(
          options.state || options.areaCode
            ? 'The provider search failed for the selected criteria. Check the Signalmash runtime configuration and try again.'
            : 'Enter a state or area code before searching for numbers.',
          options.state || options.areaCode
            ? 'PROVIDER_CONNECTION_BLOCKED'
            : 'SEARCH_CRITERIA_REQUIRED',
          options.state || options.areaCode ? 503 : 400,
          true,
          {
            provider: 'signalmash',
            operation: 'search_available_numbers',
            upstreamMessage: error.message,
          }
        );
      }

      logger.error({ error }, 'Failed to search available numbers');
      throw error;
    }
  }

  // ===========================================
  // Purchase Number
  // ===========================================

  /**
   * Purchase a phone number for an organization
   */
  async purchaseNumber(
    organizationId: string,
    phoneNumber: string,
    options: {
      campaignId?: string;
      friendlyName?: string;
    } = {}
  ) {
    logger.info({ organizationId, phoneNumber }, 'Purchasing phone number');
    const normalizedPhoneNumber = formatPhoneE164(phoneNumber);

    // Check if number is already owned
    const existing = await prisma.phoneNumber.findUnique({
      where: { phoneNumber: normalizedPhoneNumber },
    });

    if (existing) {
      throw new AppError('Phone number is already owned', 'NUMBER_ALREADY_OWNED', 400);
    }

    if (!options.campaignId) {
      throw new AppError(
        'An approved campaign is required before purchasing a phone number',
        'CAMPAIGN_REQUIRED_FOR_NUMBER_PURCHASE',
        400
      );
    }

    const campaign = await prisma.campaign.findFirst({
      where: {
        id: options.campaignId,
        organizationId,
      },
    });

    if (!campaign) {
      throw new AppError('Campaign not found', 'CAMPAIGN_NOT_FOUND', 404);
    }

    if (campaign.status !== 'approved') {
      throw new AppError(
        'Campaign must be approved before assigning phone numbers',
        'CAMPAIGN_NOT_APPROVED',
        400
      );
    }

    if (!campaign.signalmashCampaignId) {
      throw new AppError(
        'Campaign is approved locally but is missing its Signalmash campaign ID',
        'CAMPAIGN_PROVIDER_ID_MISSING',
        400
      );
    }

    let providerNumberId: string | null = null;

    try {
      // Purchase from Signalmash
      const result = await signalmashService.purchaseNumber(
        phoneNumber,
        campaign.signalmashCampaignId
      );
      providerNumberId = result.numberId;

      await signalmashService.configureWebhook(
        result.numberId,
        this.getSignalmashWebhookUrl()
      );

      // Extract area code
      const areaCode = this.extractAreaCode(phoneNumber);
      // Store in database
      const number = await prisma.phoneNumber.create({
        data: {
          phoneNumber: normalizedPhoneNumber,
          formattedNumber: this.formatPhoneNumber(normalizedPhoneNumber),
          friendlyName: options.friendlyName,
          areaCode,
          signalmashNumberId: result.numberId,
          status: this.mapProviderNumberStatus(result.status),
          organizationId,
          campaignId: options.campaignId,
          smsCapable: true,
          mmsCapable: true,
          voiceCapable: false,
        },
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
      });

      logger.info({ numberId: number.id, phoneNumber: normalizedPhoneNumber }, 'Phone number purchased');

      await integrationService.syncPhoneNumberMapping(number);

      return number;
    } catch (error) {
      if (providerNumberId) {
        try {
          await signalmashService.releaseNumber(providerNumberId);
        } catch (releaseError) {
          await deadLetterService.record({
            queueName: 'phone-number-provisioning',
            jobName: 'release-purchased-number-after-db-failure',
            jobKey: `${organizationId}:${phoneNumber}:release-after-failure`,
            organizationId,
            payload: {
              organizationId,
              phoneNumber: normalizedPhoneNumber,
              providerNumberId,
              campaignId: options.campaignId,
            },
            error: releaseError instanceof Error ? releaseError.message : 'Unknown release failure',
            metadata: {
              stage: 'db-create-rollback',
            },
          });
        }
      }

      if (error instanceof ExternalServiceError) {
        throw new AppError(
          'Signalmash phone-number provisioning failed. The DID may be unavailable, or SMS enablement for the selected campaign may have been rejected.',
          'PROVIDER_NUMBER_PROVISIONING_UNAVAILABLE',
          503,
          true,
          {
            provider: 'signalmash',
            operation: 'purchase_number',
            upstreamMessage: error.message,
          }
        );
      }

      logger.error({ error, phoneNumber }, 'Failed to purchase phone number');
      throw error;
    }
  }

  async configureExistingNumberWebhooks(): Promise<{
    configured: number;
    failed: Array<{ id: string; phoneNumber: string; reason: string }>;
  }> {
    const numbers = await prisma.phoneNumber.findMany({
      where: {
        signalmashNumberId: {
          not: null,
        },
        status: 'active',
      },
      select: {
        id: true,
        phoneNumber: true,
        signalmashNumberId: true,
      },
    });

    const failed: Array<{ id: string; phoneNumber: string; reason: string }> = [];
    let configured = 0;
    const webhookUrl = this.getSignalmashWebhookUrl();

    for (const number of numbers) {
      try {
        await signalmashService.configureWebhook(number.signalmashNumberId!, webhookUrl);
        configured += 1;
      } catch (error) {
        failed.push({
          id: number.id,
          phoneNumber: number.phoneNumber,
          reason: error instanceof Error ? error.message : 'Unknown webhook configuration failure',
        });
      }
    }

    return { configured, failed };
  }

  async linkExistingAssets(input: LinkExistingAssetsInput): Promise<{
    brand: Brand;
    campaign: Campaign;
    phoneNumber: PhoneNumber;
    webhookConfigured: boolean;
    webhookError?: string;
  }> {
    const normalizedPhoneNumber = formatPhoneE164(input.phoneNumber);
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        website: true,
      },
    });

    if (!organization) {
      throw new AppError('Organization not found', 'ORGANIZATION_NOT_FOUND', 404);
    }

    const [brandOwnedByOtherOrg, campaignOwnedByOtherOrg, numberOwnedByOtherOrg] = await Promise.all([
      prisma.brand.findFirst({
        where: {
          signalmashBrandId: input.signalmashBrandId,
          organizationId: { not: input.organizationId },
        },
      }),
      prisma.campaign.findFirst({
        where: {
          signalmashCampaignId: input.signalmashCampaignId,
          organizationId: { not: input.organizationId },
        },
      }),
      prisma.phoneNumber.findFirst({
        where: {
          phoneNumber: normalizedPhoneNumber,
          organizationId: { not: input.organizationId },
          status: { not: 'released' },
        },
      }),
    ]);

    if (brandOwnedByOtherOrg) {
      throw new AppError('Signalmash brand is already linked to another organization', 'BRAND_ALREADY_LINKED', 409);
    }

    if (campaignOwnedByOtherOrg) {
      throw new AppError('Signalmash campaign is already linked to another organization', 'CAMPAIGN_ALREADY_LINKED', 409);
    }

    if (numberOwnedByOtherOrg) {
      throw new AppError('Phone number is already linked to another organization', 'NUMBER_ALREADY_LINKED', 409);
    }

    const result = await prisma.$transaction(async (tx) => {
      const brand =
        (await tx.brand.findFirst({
          where: {
            organizationId: input.organizationId,
            signalmashBrandId: input.signalmashBrandId,
          },
        })) ??
        (await tx.brand.create({
          data: {
            organizationId: input.organizationId,
            legalName: input.brandName,
            displayName: input.brandName,
            entityType: 'corporation',
            vertical: 'other',
            streetAddress: 'Linked externally',
            city: 'External',
            state: 'NA',
            postalCode: '00000',
            country: 'US',
            website: organization.website ?? 'https://example.com',
            phone: organization.phone ?? normalizedPhoneNumber,
            email: organization.email,
            businessContactEmail: organization.email,
            signalmashBrandId: input.signalmashBrandId,
            tcrBrandId: input.tcrBrandId,
            status: 'verified',
            tags: ['linked-existing'],
          },
        }));

      const syncedBrand = await tx.brand.update({
        where: { id: brand.id },
        data: {
          legalName: input.brandName,
          displayName: input.brandName,
          signalmashBrandId: input.signalmashBrandId,
          tcrBrandId: input.tcrBrandId ?? brand.tcrBrandId,
          status: 'verified',
          rejectionReason: null,
        },
      });

      const campaign =
        (await tx.campaign.findFirst({
          where: {
            organizationId: input.organizationId,
            signalmashCampaignId: input.signalmashCampaignId,
          },
        })) ??
        (await tx.campaign.create({
          data: {
            organizationId: input.organizationId,
            brandId: syncedBrand.id,
            name: input.campaignName,
            description: `Linked existing Signalmash campaign ${input.signalmashCampaignId}`,
            useCase: 'customer_care',
            sampleMessages: ['Hello, this is a test message from our approved messaging campaign.'],
            messageFlow: 'Existing Signalmash campaign linked for live send-flow validation.',
            signalmashCampaignId: input.signalmashCampaignId,
            tcrCampaignId: input.tcrCampaignId,
            status: 'approved',
            tags: ['linked-existing'],
          },
        }));

      const syncedCampaign = await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          brandId: syncedBrand.id,
          name: input.campaignName,
          signalmashCampaignId: input.signalmashCampaignId,
          tcrCampaignId: input.tcrCampaignId ?? campaign.tcrCampaignId,
          status: 'approved',
          rejectionReason: null,
        },
      });

      const existingNumber = await tx.phoneNumber.findFirst({
        where: {
          organizationId: input.organizationId,
          phoneNumber: normalizedPhoneNumber,
        },
      });

      const phoneNumber = existingNumber
        ? await tx.phoneNumber.update({
            where: { id: existingNumber.id },
            data: {
              formattedNumber: this.formatPhoneNumber(normalizedPhoneNumber),
              friendlyName: input.friendlyName ?? existingNumber.friendlyName,
              areaCode: this.extractAreaCode(normalizedPhoneNumber),
              signalmashNumberId: input.signalmashNumberId ?? existingNumber.signalmashNumberId,
              status: 'active',
              campaignId: syncedCampaign.id,
              smsCapable: true,
              mmsCapable: true,
            },
          })
        : await tx.phoneNumber.create({
            data: {
              organizationId: input.organizationId,
              campaignId: syncedCampaign.id,
              phoneNumber: normalizedPhoneNumber,
              formattedNumber: this.formatPhoneNumber(normalizedPhoneNumber),
              friendlyName: input.friendlyName,
              areaCode: this.extractAreaCode(normalizedPhoneNumber),
              signalmashNumberId: input.signalmashNumberId,
              status: 'active',
              smsCapable: true,
              mmsCapable: true,
              voiceCapable: false,
            },
          });

      return { brand: syncedBrand, campaign: syncedCampaign, phoneNumber };
    });

    await integrationService.syncBrandMapping(result.brand);
    await integrationService.syncCampaignMapping(result.campaign);
    await integrationService.syncPhoneNumberMapping(result.phoneNumber);
    await this.ensureDefaultSenderProfiles(result.phoneNumber, input.makeDefaultSender ?? true);

    let webhookConfigured = false;
    let webhookError: string | undefined;
    if (input.configureWebhook && !input.signalmashNumberId) {
      webhookError = 'Signalmash Number ID is required to configure the number webhook automatically.';
    }

    if (input.configureWebhook && input.signalmashNumberId) {
      try {
        await signalmashService.configureWebhook(
          input.signalmashNumberId,
          this.getSignalmashWebhookUrl()
        );
        webhookConfigured = true;
      } catch (error) {
        webhookError = error instanceof Error ? error.message : 'Unknown webhook configuration failure';
        logger.warn({ error, phoneNumber: normalizedPhoneNumber }, 'Linked number but failed to configure webhook');
      }
    }

    logger.info(
      {
        organizationId: input.organizationId,
        brandId: result.brand.id,
        campaignId: result.campaign.id,
        phoneNumberId: result.phoneNumber.id,
        webhookConfigured,
      },
      'Existing Signalmash assets linked to organization'
    );

    return { ...result, webhookConfigured, webhookError };
  }

  // ===========================================
  // List Organization Numbers
  // ===========================================

  /**
   * Get all phone numbers for an organization
   */
  async getOrganizationNumbers(
    organizationId: string,
    options: {
      status?: PhoneNumberStatus;
      campaignId?: string;
      installationId?: string | null;
      page?: number;
      limit?: number;
    } = {}
  ) {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (options.status) {
      where.status = options.status;
    }

    if (options.campaignId) {
      where.campaignId = options.campaignId;
    }

    const [numbers, total] = await Promise.all([
      prisma.phoneNumber.findMany({
        where,
        skip,
        take: limit,
        include: {
          senderProfiles: {
            where: {
              platform: 'leadconnector',
              isDefault: true,
            },
            select: {
              id: true,
              installationId: true,
            },
          },
          campaign: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
          _count: {
            select: {
              messages: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.phoneNumber.count({ where }),
    ]);

    return {
      data: numbers.map((number) => ({
        ...number,
        isDefaultSender: number.senderProfiles.some((profile) =>
          options.installationId
            ? profile.installationId === options.installationId
            : true
        ),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ===========================================
  // Get Single Number
  // ===========================================

  /**
   * Get a single phone number by ID
   */
  async getNumber(organizationId: string, numberId: string) {
    const number = await prisma.phoneNumber.findFirst({
      where: {
        id: numberId,
        organizationId,
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            brand: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    if (!number) {
      throw new AppError('Phone number not found', 'NUMBER_NOT_FOUND', 404);
    }

    return number;
  }

  // ===========================================
  // Update Number
  // ===========================================

  /**
   * Update a phone number's settings
   */
  async updateNumber(
    organizationId: string,
    numberId: string,
    data: {
      friendlyName?: string;
      campaignId?: string | null;
      makeDefault?: boolean;
    },
    options: {
      installationId?: string | null;
    } = {}
  ) {
    const number = await this.getNumber(organizationId, numberId);

    // Validate new campaign if provided
    if (data.campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: data.campaignId,
          organizationId,
        },
      });

      if (!campaign) {
        throw new AppError('Campaign not found', 'CAMPAIGN_NOT_FOUND', 404);
      }

      if (campaign.status !== 'approved') {
        throw new AppError(
          'Campaign must be approved before assigning phone numbers',
          'CAMPAIGN_NOT_APPROVED',
          400
        );
      }
    }

    const updated = await prisma.phoneNumber.update({
      where: { id: numberId },
      data: {
        friendlyName: data.friendlyName,
        campaignId: data.campaignId,
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    logger.info({ numberId }, 'Phone number updated');

    await integrationService.syncPhoneNumberMapping(updated);
    await this.ensureDefaultSenderProfiles(updated, data.makeDefault === true, options.installationId);

    return updated;
  }

  // ===========================================
  // Release Number
  // ===========================================

  /**
   * Release (delete) a phone number
   */
  async releaseNumber(organizationId: string, numberId: string) {
    const number = await this.getNumber(organizationId, numberId);

    try {
      // Release from Signalmash
      if (number.signalmashNumberId) {
        await signalmashService.releaseNumber(number.signalmashNumberId);
      }

      // Update status in database (keep record for history)
      await prisma.phoneNumber.update({
        where: { id: numberId },
        data: {
          status: 'released',
          campaignId: null,
        },
      });

      await prisma.senderProfile.updateMany({
        where: {
          organizationId,
          phoneNumberId: numberId,
        },
        data: {
          isDefault: false,
        },
      });

      await this.ensureFallbackDefaultSenders(organizationId, numberId);

      logger.info({ numberId, phoneNumber: number.phoneNumber }, 'Phone number released');

      await integrationService.markPhoneNumberReleased(numberId);

      return { success: true };
    } catch (error) {
      await deadLetterService.record({
        queueName: 'phone-number-provisioning',
        jobName: 'release-number',
        jobKey: `${organizationId}:${numberId}:release`,
        organizationId,
        payload: {
          organizationId,
          numberId,
          phoneNumber: number.phoneNumber,
          signalmashNumberId: number.signalmashNumberId,
        },
        error: error instanceof Error ? error.message : 'Unknown release failure',
        metadata: {
          stage: 'provider-release',
        },
      });
      logger.error({ error, numberId }, 'Failed to release phone number');
      throw error;
    }
  }

  // ===========================================
  // Stats
  // ===========================================

  /**
   * Get phone number stats for an organization
   */
  async getStats(organizationId: string) {
    const [total, active, pending, byAreaCode] = await Promise.all([
      prisma.phoneNumber.count({
        where: { organizationId },
      }),
      prisma.phoneNumber.count({
        where: { organizationId, status: 'active' },
      }),
      prisma.phoneNumber.count({
        where: { organizationId, status: 'pending' },
      }),
      prisma.phoneNumber.groupBy({
        by: ['areaCode'],
        where: { organizationId, status: 'active' },
        _count: { _all: true },
        orderBy: { _count: { areaCode: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      total,
      active,
      pending,
      released: total - active - pending,
      byAreaCode: byAreaCode.map((g) => ({
        areaCode: g.areaCode,
        count: g._count._all,
      })),
    };
  }

  // ===========================================
  // Helpers
  // ===========================================

  private async ensureDefaultSenderProfiles(
    number: PhoneNumber,
    makeDefault: boolean,
    installationId?: string | null
  ) {
    const targets = installationId
      ? [installationId]
      : await this.resolveSenderProfileTargets(number.organizationId);

    for (const installationId of targets) {
      if (makeDefault) {
        await prisma.senderProfile.updateMany({
          where: {
            organizationId: number.organizationId,
            platform: 'leadconnector',
            installationId,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      const existing = await prisma.senderProfile.findFirst({
        where: {
          organizationId: number.organizationId,
          platform: 'leadconnector',
          installationId,
          phoneNumberId: number.id,
        },
      });

      if (existing) {
        await prisma.senderProfile.update({
          where: { id: existing.id },
          data: {
            senderKey: number.phoneNumber,
            senderLabel: number.friendlyName ?? number.formattedNumber,
            isDefault: makeDefault ? true : existing.isDefault,
            metadata: {
              signalmashNumberId: number.signalmashNumberId,
              campaignId: number.campaignId,
              linkedExisting: true,
            },
          },
        });
        continue;
      }

      const existingDefault = await prisma.senderProfile.findFirst({
        where: {
          organizationId: number.organizationId,
          platform: 'leadconnector',
          installationId,
          isDefault: true,
        },
      });

      await prisma.senderProfile.create({
        data: {
          organizationId: number.organizationId,
          installationId,
          phoneNumberId: number.id,
          platform: 'leadconnector',
          senderKey: number.phoneNumber,
          senderLabel: number.friendlyName ?? number.formattedNumber,
          isDefault: makeDefault || !existingDefault,
          metadata: {
            signalmashNumberId: number.signalmashNumberId,
            campaignId: number.campaignId,
            linkedExisting: true,
          },
        },
      });
    }
  }

  private async resolveSenderProfileTargets(organizationId: string) {
    const installations = await prisma.platformInstallation.findMany({
      where: {
        organizationId,
        platform: 'leadconnector',
      },
      select: { id: true },
    });

    const installationIds = installations.map((installation) => installation.id);
    return installationIds.length > 0 ? installationIds : [null];
  }

  private async ensureFallbackDefaultSenders(organizationId: string, releasedNumberId: string) {
    const installations = await prisma.platformInstallation.findMany({
      where: {
        organizationId,
        platform: 'leadconnector',
      },
      select: { id: true },
    });

    const targetInstallationIds = installations.length > 0
      ? installations.map((installation) => installation.id)
      : [null];

    const fallbackNumber = await prisma.phoneNumber.findFirst({
      where: {
        organizationId,
        status: 'active',
        id: { not: releasedNumberId },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const installationId of targetInstallationIds) {
      const existingDefault = await prisma.senderProfile.findFirst({
        where: {
          organizationId,
          platform: 'leadconnector',
          installationId,
          isDefault: true,
          phoneNumber: {
            status: 'active',
          },
        },
      });

      if (existingDefault || !fallbackNumber) {
        continue;
      }

      const fallbackProfile = await prisma.senderProfile.findFirst({
        where: {
          organizationId,
          platform: 'leadconnector',
          installationId,
          phoneNumberId: fallbackNumber.id,
        },
      });

      if (fallbackProfile) {
        await prisma.senderProfile.update({
          where: { id: fallbackProfile.id },
          data: {
            isDefault: true,
            senderKey: fallbackNumber.phoneNumber,
            senderLabel: fallbackNumber.friendlyName ?? fallbackNumber.formattedNumber,
            metadata: {
              signalmashNumberId: fallbackNumber.signalmashNumberId,
              campaignId: fallbackNumber.campaignId,
              linkedExisting: true,
            },
          },
        });
        continue;
      }

      await prisma.senderProfile.create({
        data: {
          organizationId,
          installationId,
          phoneNumberId: fallbackNumber.id,
          platform: 'leadconnector',
          senderKey: fallbackNumber.phoneNumber,
          senderLabel: fallbackNumber.friendlyName ?? fallbackNumber.formattedNumber,
          isDefault: true,
          metadata: {
            signalmashNumberId: fallbackNumber.signalmashNumberId,
            campaignId: fallbackNumber.campaignId,
            linkedExisting: true,
          },
        },
      });
    }
  }

  private formatPhoneNumber(phoneNumber: string): string {
    const cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length === 10) {
      return `+1 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phoneNumber;
  }

  private extractAreaCode(phoneNumber: string): string {
    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.length === 11 && cleaned.startsWith("1")) {
      return cleaned.slice(1, 4);
    }
    if (cleaned.length >= 10) {
      return cleaned.slice(0, 3);
    }
    return cleaned.slice(0, 3);
  }

  private mapProviderNumberStatus(status: string | null | undefined): PhoneNumberStatus {
    const normalized = status?.toLowerCase();

    if (normalized === 'active' || normalized === 'enabled' || normalized === 'provisioned') {
      return 'active';
    }

    if (normalized === 'suspended' || normalized === 'disabled') {
      return 'suspended';
    }

    if (normalized === 'released' || normalized === 'deleted') {
      return 'released';
    }

    return 'pending';
  }
}

export const phoneNumberService = new PhoneNumberService();
