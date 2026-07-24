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
import { walletBillingService } from './wallet-billing.service.js';
import {
  getErrorMessage,
  isNumberNotApprovedForMnoError,
} from '../utils/provider-errors.js';

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
  phoneNumber?: string;
  signalmashNumberId?: string;
  friendlyName?: string;
  configureWebhook?: boolean;
  makeDefaultSender?: boolean;
  validationTo?: string;
  installationId?: string | null;
}

interface DefaultSenderValidationEvidence {
  validatedAt?: string;
  validatedTo?: string;
  validationMessageId?: string | null;
  lastValidationError?: string | null;
}

const TOLL_FREE_NPAS = new Set(['800', '833', '844', '855', '866', '877', '888']);
const SMS_ENABLEMENT_CAMPAIGN_ID_PATTERN = /^C[A-Za-z0-9]{6}$/;
const DEFAULT_SENDER_VALIDATION_BODY =
  'SignalMash Connect sender validation. This SMS confirms this sender is approved for this recipient carrier.';

export class PhoneNumberService {
  private getSignalmashWebhookUrl(): string {
    return `${config.apiUrl}/api/webhooks/signalmash`;
  }

  private async reconcileCampaignNumberLinkState(
    organizationId: string,
    campaignId?: string | null
  ) {
    if (!campaignId) {
      return;
    }

    const [campaign, linkedNumberCount] = await Promise.all([
      prisma.campaign.findFirst({
        where: {
          id: campaignId,
          organizationId,
        },
        select: {
          id: true,
          numberLinkStatus: true,
          numberLinkIntent: true,
        },
      }),
      prisma.phoneNumber.count({
        where: {
          organizationId,
          campaignId,
          status: { not: 'released' },
        },
      }),
    ]);

    if (!campaign) {
      return;
    }

    if (linkedNumberCount > 0) {
      await this.syncCampaignNumberLinkState(organizationId, campaignId, 'linked');
      return;
    }

    if (campaign.numberLinkStatus === 'requested' || campaign.numberLinkStatus === 'checkout_required') {
      await prisma.campaign.updateMany({
        where: {
          id: campaignId,
          organizationId,
        },
        data: {
          numberLinkCompletedAt: null,
        },
      });
      return;
    }

    await prisma.campaign.updateMany({
      where: {
        id: campaignId,
        organizationId,
      },
      data: {
        numberLinkStatus: 'none',
        numberLinkError: null,
        numberLinkCompletedAt: null,
      },
    });
  }

  private normalizeUsLongCode(phoneNumber: string) {
    const normalized = formatPhoneE164(phoneNumber);
    const digits = normalized.replace(/\D/g, '');
    const nationalDigits = digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits;
    const areaCode = nationalDigits.slice(0, 3);

    return {
      normalized,
      nationalDigits,
      areaCode,
      isUsLongCode: nationalDigits.length === 10,
      isTollFree: TOLL_FREE_NPAS.has(areaCode),
    };
  }

  private assertPurchasableLongCode(phoneNumber: string) {
    const normalized = this.normalizeUsLongCode(phoneNumber);

    if (!normalized.isUsLongCode || normalized.isTollFree) {
      throw new AppError(
        'Only US 10DLC long-code numbers can be assigned or purchased in this flow.',
        'PHONE_NUMBER_NOT_10DLC_COMPATIBLE',
        400
      );
    }

    return normalized;
  }

  async validateAvailableNumberSelection(organizationId: string, phoneNumber: string) {
    const normalized = this.assertPurchasableLongCode(phoneNumber);
    const existing = await prisma.phoneNumber.findFirst({
      where: {
        phoneNumber: normalized.normalized,
        status: { not: 'released' },
      },
      select: {
        id: true,
        organizationId: true,
      },
    });

    if (existing) {
      throw new AppError(
        existing.organizationId === organizationId
          ? 'Phone number is already owned by this organization'
          : 'Phone number is already owned by another organization',
        existing.organizationId === organizationId ? 'NUMBER_ALREADY_OWNED' : 'NUMBER_ALREADY_LINKED',
        409
      );
    }

    const availableNumbers = await this.searchAvailableNumbers({
      areaCode: normalized.areaCode,
      contains: normalized.nationalDigits.slice(-7),
      limit: 500,
    });
    const match = availableNumbers.find((candidate) => {
      try {
        return this.normalizeUsLongCode(candidate.phoneNumber).normalized === normalized.normalized;
      } catch {
        return false;
      }
    });

    if (!match) {
      throw new AppError(
        'Selected phone number is no longer available. Search again and choose another number.',
        'PHONE_NUMBER_NOT_AVAILABLE',
        409
      );
    }

    return {
      phoneNumber: normalized.normalized,
      formattedNumber: match.formattedNumber,
      areaCode: normalized.areaCode,
      capabilities: match.capabilities,
    };
  }

  async savePendingNumberPurchaseIntent(input: {
    organizationId: string;
    campaignId?: string;
    phoneNumber: string;
    friendlyName?: string;
    makeDefaultSender?: boolean;
    validationTo?: string;
    installationId?: string | null;
    error: AppError;
  }) {
    if (!input.campaignId) {
      return null;
    }

    const campaign = await prisma.campaign.findFirst({
      where: {
        id: input.campaignId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        status: true,
        signalmashCampaignId: true,
      },
    });

    if (campaign?.status !== 'pending_approval' || !campaign.signalmashCampaignId) {
      return null;
    }

    const makeDefaultSender = input.makeDefaultSender === true;
    if (makeDefaultSender) {
      this.assertLocationContext(input.installationId);
    }

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        numberLinkIntent: {
          mode: 'buy_new',
          phoneNumber: input.phoneNumber,
          makeDefaultSender,
          ...(input.validationTo ? { validationTo: input.validationTo } : {}),
          ...(makeDefaultSender ? { installationId: input.installationId } : {}),
          ...(input.friendlyName ? { friendlyName: input.friendlyName } : {}),
        } as any,
        numberLinkStatus: 'requested',
        numberLinkError: input.error.message,
        numberLinkAttemptedAt: new Date(),
        numberLinkCompletedAt: null,
      },
    });

    return {
      pending: true,
      campaignId: campaign.id,
      phoneNumber: input.phoneNumber,
      message: 'Number selection saved. Signalmash did not provision the DID yet, so the app will retry after campaign approval.',
    };
  }

  private normalizeProviderLifecycleStatus(status?: string | null) {
    if (!status?.trim()) {
      return undefined;
    }

    return status.trim().replace(/[\s-]+/g, '_').toUpperCase();
  }

  private isVerifiedBrandProviderStatus(status?: string | null) {
    const normalized = this.normalizeProviderLifecycleStatus(status);
    return normalized ? ['VERIFIED', 'APPROVED', 'ACTIVE'].includes(normalized) : false;
  }

  private isApprovedCampaignProviderStatus(status?: string | null) {
    const normalized = this.normalizeProviderLifecycleStatus(status);
    return normalized ? ['APPROVED', 'ACTIVE'].includes(normalized) : false;
  }

  private isSmsEnablementCampaignId(campaignId?: string | null) {
    return SMS_ENABLEMENT_CAMPAIGN_ID_PATTERN.test(campaignId?.trim() ?? '');
  }

  private assertProviderLinkedCampaignReady(
    campaign: Pick<Campaign, 'status' | 'signalmashCampaignId'>
  ) {
    if (!['pending_approval', 'approved'].includes(campaign.status)) {
      throw new AppError(
        'Campaign must be submitted to Signalmash before assigning phone numbers',
        'CAMPAIGN_NOT_READY',
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
  }

  private async resolveSmsEnablementCampaignId(
    campaign: Pick<Campaign, 'id' | 'signalmashCampaignId' | 'tcrCampaignId'>
  ) {
    const savedCampaignId = campaign.tcrCampaignId?.trim();
    if (this.isSmsEnablementCampaignId(savedCampaignId)) {
      return savedCampaignId!;
    }

    let providerSmsCampaignId: string | undefined;
    let providerLookupError: string | undefined;

    if (campaign.signalmashCampaignId) {
      try {
        const providerStatus = await signalmashService.getCampaignStatus(campaign.signalmashCampaignId);
        providerSmsCampaignId = providerStatus.tcrCampaignId?.trim();
      } catch (error) {
        providerLookupError = error instanceof Error ? error.message : 'Unknown provider status lookup failure';
        logger.warn(
          {
            error,
            campaignId: campaign.id,
            signalmashCampaignId: campaign.signalmashCampaignId,
          },
          'Unable to refresh Signalmash campaign status while resolving SMS enablement campaign ID'
        );
      }
    }

    if (this.isSmsEnablementCampaignId(providerSmsCampaignId)) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          tcrCampaignId: providerSmsCampaignId,
          lastStatusSyncedAt: new Date(),
        },
      });

      return providerSmsCampaignId!;
    }

    throw new AppError(
      'Campaign is missing the Signalmash SMS enablement campaign ID. Refresh the campaign status after provider approval before provisioning a phone number.',
      'CAMPAIGN_PROVIDER_SMS_ID_MISSING',
      400,
      true,
      {
        campaignId: campaign.id,
        signalmashCampaignId: campaign.signalmashCampaignId,
        tcrCampaignId: campaign.tcrCampaignId,
        ...(providerLookupError ? { providerLookupError } : {}),
      }
    );
  }

  async assertCampaignReadyForNumberProvisioning(
    organizationId: string,
    campaignId: string
  ) {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        organizationId,
      },
      select: {
        id: true,
        status: true,
        signalmashCampaignId: true,
        tcrCampaignId: true,
      },
    });

    if (!campaign) {
      throw new AppError('Campaign not found', 'CAMPAIGN_NOT_FOUND', 404);
    }

    this.assertProviderLinkedCampaignReady(campaign);
    await this.resolveSmsEnablementCampaignId(campaign);
  }

  private async syncCampaignNumberLinkState(
    organizationId: string,
    campaignId: string,
    status: 'linked' | 'failed',
    error?: string | null
  ) {
    await prisma.campaign.updateMany({
      where: {
        id: campaignId,
        organizationId,
      },
      data: {
        numberLinkStatus: status,
        numberLinkError: error ?? null,
        numberLinkAttemptedAt: new Date(),
        numberLinkCompletedAt: status === 'linked' ? new Date() : null,
      },
    });
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

      return numbers
        .filter((number) => {
          const normalized = this.normalizeUsLongCode(number.phoneNumber);
          return normalized.isUsLongCode && !normalized.isTollFree;
        })
        .map((n) => ({
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
      makeDefaultSender?: boolean;
      validationTo?: string;
      installationId?: string | null;
      onboardingPhoneNumberMrcChargeKey?: string;
    } = {}
  ) {
    logger.info({ organizationId, phoneNumber }, 'Purchasing phone number');
    const normalizedLongCode = this.assertPurchasableLongCode(phoneNumber);
    const normalizedPhoneNumber = normalizedLongCode.normalized;
    const makeDefaultSender = options.makeDefaultSender === true;

    if (makeDefaultSender) {
      this.assertLocationContext(options.installationId);
    }

    // Check if number is already owned
    const existing = await prisma.phoneNumber.findUnique({
      where: { phoneNumber: normalizedPhoneNumber },
    });

    if (existing) {
      throw new AppError('Phone number is already owned', 'NUMBER_ALREADY_OWNED', 400);
    }

    const funding = await walletBillingService.assertCanFundPhoneNumberPurchase(organizationId);
    let campaign: Campaign | null = null;
    let smsEnablementCampaignId: string | null = null;

    if (options.campaignId) {
      campaign = await prisma.campaign.findFirst({
        where: {
          id: options.campaignId,
          organizationId,
        },
      });

      if (!campaign) {
        throw new AppError('Campaign not found', 'CAMPAIGN_NOT_FOUND', 404);
      }

      if (!['pending_approval', 'approved'].includes(campaign.status)) {
        throw new AppError(
          'Only submitted or approved campaigns can be selected for pending number assignment',
          'CAMPAIGN_NOT_READY',
          400
        );
      }

      if (campaign.status === 'approved') {
        this.assertProviderLinkedCampaignReady(campaign);
        smsEnablementCampaignId = await this.resolveSmsEnablementCampaignId(campaign);
      }
    }

    let providerNumberId: string | null = null;
    let createdNumberId: string | null = null;

    try {
      // Purchase from Signalmash
      const result = smsEnablementCampaignId
        ? await signalmashService.purchaseNumber(phoneNumber, smsEnablementCampaignId)
        : await signalmashService.purchaseNumberWithoutSmsEnablement(phoneNumber);
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
          campaignId: smsEnablementCampaignId && campaign ? campaign.id : null,
          monthlyPrice: funding.phoneNumberMonthlyRate.toFixed(2),
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
      createdNumberId = number.id;

      logger.info({ numberId: number.id, phoneNumber: normalizedPhoneNumber }, 'Phone number purchased');

      await integrationService.syncPhoneNumberMapping(number);

      if (smsEnablementCampaignId && campaign) {
        if (makeDefaultSender) {
          const validationEvidence = await this.validateDefaultSenderCandidate({
            organizationId,
            installationId: options.installationId,
            phoneNumberId: number.id,
            campaignId: campaign.id,
            validationTo: options.validationTo,
          });
          await this.ensureDefaultSenderProfiles(number, true, options.installationId, validationEvidence);
        }
        await this.syncCampaignNumberLinkState(organizationId, campaign.id, 'linked');
      } else if (campaign) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: {
            numberLinkIntent: {
              mode: 'existing',
              phoneNumberId: number.id,
              makeDefaultSender,
              ...(makeDefaultSender ? { installationId: options.installationId } : {}),
              ...(options.friendlyName ? { friendlyName: options.friendlyName } : {}),
            } as any,
            numberLinkStatus: 'requested',
            numberLinkError: 'Phone number purchased. SMS/MMS assignment will finish after campaign approval.',
            numberLinkAttemptedAt: new Date(),
            numberLinkCompletedAt: null,
          },
        });
      }

      await walletBillingService.recordPhoneNumberFirstMonthCharge({
        organizationId,
        phoneNumberId: number.id,
        phoneNumber: normalizedPhoneNumber,
        onboardingChargeKey: options.onboardingPhoneNumberMrcChargeKey,
      });

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

      if (createdNumberId) {
        await prisma.phoneNumber.updateMany({
          where: {
            id: createdNumberId,
            organizationId,
          },
          data: {
            status: 'released',
            campaignId: null,
          },
        });
      }

      if (error instanceof ExternalServiceError) {
        throw new AppError(
          'Signalmash phone-number provisioning failed. The DID may be unavailable or temporarily blocked by the provider.',
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

      if (options.campaignId) {
        await this.syncCampaignNumberLinkState(
          organizationId,
          options.campaignId,
          'failed',
          error instanceof Error ? error.message : 'Unknown number provisioning failure'
        );
      }

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
    phoneNumber: PhoneNumber | null;
    webhookConfigured: boolean;
    webhookError?: string;
  }> {
    const makeDefaultSender = input.makeDefaultSender === true;
    if (makeDefaultSender) {
      this.assertLocationContext(input.installationId);
    }

    const normalizedPhoneNumber = input.phoneNumber
      ? formatPhoneE164(input.phoneNumber)
      : undefined;
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

    const organizationContactPhone = formatPhoneE164(
      organization.phone ?? normalizedPhoneNumber ?? '+15550000000'
    );

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
      normalizedPhoneNumber
        ? prisma.phoneNumber.findFirst({
            where: {
              phoneNumber: normalizedPhoneNumber,
              organizationId: { not: input.organizationId },
              status: { not: 'released' },
            },
          })
        : Promise.resolve(null),
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
            phone: organizationContactPhone,
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
          numberLinkStatus: 'linked',
          numberLinkError: null,
          numberLinkAttemptedAt: new Date(),
          numberLinkCompletedAt: new Date(),
          rejectionReason: null,
        },
      });

      const existingNumber = normalizedPhoneNumber
        ? await tx.phoneNumber.findFirst({
            where: {
              organizationId: input.organizationId,
              phoneNumber: normalizedPhoneNumber,
            },
          })
        : null;

      const phoneNumber = normalizedPhoneNumber
        ? existingNumber
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
            })
        : null;

      return { brand: syncedBrand, campaign: syncedCampaign, phoneNumber };
    });

    await integrationService.syncBrandMapping(result.brand);
    await integrationService.syncCampaignMapping(result.campaign);
    await integrationService.setPrimaryOnboardingResources(result.brand.organizationId, {
      brandId: result.brand.id,
      campaignId: result.campaign.id,
    });

    if (result.phoneNumber) {
      await integrationService.syncPhoneNumberMapping(result.phoneNumber);
      if (makeDefaultSender) {
        const validationEvidence = await this.validateDefaultSenderCandidate({
          organizationId: input.organizationId,
          installationId: input.installationId,
          phoneNumberId: result.phoneNumber.id,
          campaignId: result.campaign.id,
          validationTo: input.validationTo,
        });
        await this.ensureDefaultSenderProfiles(result.phoneNumber, true, input.installationId, validationEvidence);
      }
    }

    let webhookConfigured = false;
    let webhookError: string | undefined;
    if (result.phoneNumber && input.configureWebhook && !input.signalmashNumberId) {
      webhookError = 'Signalmash Number ID is required to configure the number webhook automatically.';
    }

    if (result.phoneNumber && input.configureWebhook && input.signalmashNumberId) {
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
        phoneNumberId: result.phoneNumber?.id,
        webhookConfigured,
      },
      'Existing Signalmash assets linked to organization'
    );

    return { ...result, webhookConfigured, webhookError };
  }

  async linkVerifiedBrandCampaignFromProvider(input: {
    organizationId: string;
    signalmashBrandId: string;
    signalmashCampaignId: string;
  }): Promise<{
    brand: Brand;
    campaign: Campaign;
    phoneNumber: PhoneNumber | null;
    providerBrandStatus: string;
    providerCampaignStatus: string;
  }> {
    const [listedBrands, listedCampaigns, brandStatus, campaignStatus] = await Promise.all([
      signalmashService.listBrands(),
      signalmashService.listCampaigns(),
      signalmashService.getBrandStatus(input.signalmashBrandId),
      signalmashService.getCampaignStatus(input.signalmashCampaignId),
    ]);

    if (!this.isVerifiedBrandProviderStatus(brandStatus.status)) {
      throw new AppError(
        `Only verified Signalmash brands can be assigned. Current provider status: ${brandStatus.status}`,
        'BRAND_NOT_VERIFIED',
        400
      );
    }

    if (!this.isApprovedCampaignProviderStatus(campaignStatus.status)) {
      throw new AppError(
        `Only approved Signalmash campaigns can be assigned. Current provider status: ${campaignStatus.status}`,
        'CAMPAIGN_NOT_APPROVED',
        400
      );
    }

    const listedBrand = listedBrands.find((brand) => brand.brandId === input.signalmashBrandId);
    const listedCampaign = listedCampaigns.find((campaign) => campaign.campaignId === input.signalmashCampaignId);
    const campaignBrandId = campaignStatus.brandId ?? listedCampaign?.brandId;

    if (!listedCampaign) {
      throw new AppError('Signalmash campaign was not returned by the provider account', 'CAMPAIGN_NOT_VISIBLE', 404);
    }

    if (!campaignBrandId || campaignBrandId !== input.signalmashBrandId) {
      throw new AppError(
        'The selected Signalmash campaign does not belong to the selected brand',
        'CAMPAIGN_BRAND_MISMATCH',
        400
      );
    }

    const linked = await this.linkExistingAssets({
      organizationId: input.organizationId,
      brandName: listedBrand?.displayName ?? brandStatus.displayName ?? input.signalmashBrandId,
      signalmashBrandId: input.signalmashBrandId,
      tcrBrandId: brandStatus.tcrBrandId,
      campaignName: campaignStatus.name ?? listedCampaign.name ?? input.signalmashCampaignId,
      signalmashCampaignId: input.signalmashCampaignId,
      tcrCampaignId: campaignStatus.tcrCampaignId,
    });

    return {
      ...linked,
      providerBrandStatus: brandStatus.status,
      providerCampaignStatus: campaignStatus.status,
    };
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
      data: numbers.map((number) => {
        const { senderProfiles, ...numberData } = number;

        return {
          ...numberData,
          isDefaultSender: options.installationId
            ? senderProfiles.some((profile) => profile.installationId === options.installationId)
            : false,
        };
      }),
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
      confirmReassignment?: boolean;
      validationTo?: string;
    },
    options: {
      installationId?: string | null;
    } = {}
  ) {
    const number = await this.getNumber(organizationId, numberId);
    const makeDefault = data.makeDefault === true;
    if (makeDefault) {
      this.assertLocationContext(options.installationId);
    }

    const previousCampaignId = number.campaign?.id ?? null;
    const previousCampaignName = number.campaign?.name ?? null;
    let targetCampaign: Campaign | null = null;
    let nextCampaignId = data.campaignId === undefined ? previousCampaignId : data.campaignId;

    // Validate new campaign if provided
    if (data.campaignId) {
      this.assertPurchasableLongCode(number.phoneNumber);
      targetCampaign = await prisma.campaign.findFirst({
        where: {
          id: data.campaignId,
          organizationId,
        },
      });

      if (!targetCampaign) {
        throw new AppError('Campaign not found', 'CAMPAIGN_NOT_FOUND', 404);
      }

      if (!['pending_approval', 'approved'].includes(targetCampaign.status)) {
        throw new AppError(
          'Campaign must be submitted to Signalmash before assigning phone numbers',
          'CAMPAIGN_NOT_READY',
          400
        );
      }

      if (previousCampaignId && previousCampaignId !== data.campaignId && data.confirmReassignment !== true) {
        throw new AppError(
          'This number is already linked to another campaign. Confirm reassignment before moving it.',
          'PHONE_NUMBER_REASSIGN_CONFIRMATION_REQUIRED',
          409
        );
      }

      if (targetCampaign.status === 'pending_approval') {
        nextCampaignId = null;
        await prisma.campaign.update({
          where: { id: targetCampaign.id },
          data: {
            numberLinkIntent: {
              mode: 'existing',
              phoneNumberId: number.id,
              makeDefaultSender: makeDefault,
              ...(makeDefault ? { installationId: options.installationId } : {}),
              ...(data.friendlyName ? { friendlyName: data.friendlyName } : {}),
              ...(data.confirmReassignment ? { confirmReassignment: true } : {}),
            } as any,
            numberLinkStatus: 'requested',
            numberLinkError: 'Phone number assignment will finish after campaign approval.',
            numberLinkAttemptedAt: new Date(),
            numberLinkCompletedAt: null,
          },
        });
      } else {
        if (!targetCampaign.signalmashCampaignId) {
          throw new AppError(
            'Campaign is missing its Signalmash campaign ID',
            'CAMPAIGN_PROVIDER_ID_MISSING',
            400
          );
        }

        const smsEnablementCampaignId = await this.resolveSmsEnablementCampaignId(targetCampaign);
        if (!makeDefault) {
          await signalmashService.enableSmsForNumber(
            number.signalmashNumberId ?? number.phoneNumber,
            smsEnablementCampaignId
          );
        }
      }
    }

    const validationCampaignId = data.campaignId === undefined ? previousCampaignId : nextCampaignId ?? null;
    const validationEvidence = makeDefault
      ? await this.validateDefaultSenderCandidate({
          organizationId,
          installationId: options.installationId,
          phoneNumberId: number.id,
          campaignId: validationCampaignId,
          validationTo: data.validationTo,
        })
      : undefined;

    const updated = await prisma.phoneNumber.update({
      where: { id: numberId },
      data: {
        friendlyName: data.friendlyName,
        campaignId: nextCampaignId,
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
    if (options.installationId) {
      await this.ensureDefaultSenderProfiles(updated, makeDefault, options.installationId, validationEvidence);
    }

    if (nextCampaignId) {
      await this.syncCampaignNumberLinkState(organizationId, nextCampaignId, 'linked');
    }

    if (previousCampaignId && previousCampaignId !== nextCampaignId) {
      await this.reconcileCampaignNumberLinkState(organizationId, previousCampaignId);
    }

    return {
      ...updated,
      reassignedFromCampaignId:
        previousCampaignId && previousCampaignId !== nextCampaignId ? previousCampaignId : null,
      reassignedFromCampaignName:
        previousCampaignId && previousCampaignId !== nextCampaignId ? previousCampaignName : null,
    };
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

      logger.info({ numberId, phoneNumber: number.phoneNumber }, 'Phone number released');

      await integrationService.markPhoneNumberReleased(numberId);
      await this.reconcileCampaignNumberLinkState(organizationId, number.campaign?.id ?? null);

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

  private assertLocationContext(installationId?: string | null): asserts installationId is string {
    if (!installationId) {
      throw new AppError(
        'Open Signalmash Connect from a CRM location before changing the default sender.',
        'LOCATION_CONTEXT_REQUIRED',
        400
      );
    }
  }

  private normalizeValidationRecipient(validationTo?: string | null) {
    if (!validationTo?.trim()) {
      throw new AppError(
        'A validation recipient is required before changing the default sender.',
        'DEFAULT_SENDER_VALIDATION_TO_REQUIRED',
        400
      );
    }

    try {
      return formatPhoneE164(validationTo);
    } catch {
      throw new AppError(
        'Enter a valid validation recipient phone number before changing the default sender.',
        'DEFAULT_SENDER_VALIDATION_TO_INVALID',
        400
      );
    }
  }

  private metadataRecord(metadata: unknown): Record<string, unknown> {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {};
  }

  private buildSenderProfileMetadata(
    number: Pick<PhoneNumber, 'signalmashNumberId' | 'campaignId'>,
    existingMetadata?: unknown,
    validationEvidence?: DefaultSenderValidationEvidence
  ) {
    const metadata: Record<string, unknown> = {
      ...this.metadataRecord(existingMetadata),
      signalmashNumberId: number.signalmashNumberId,
      campaignId: number.campaignId,
      linkedExisting: true,
    };

    if (validationEvidence) {
      if (validationEvidence.validatedAt !== undefined) {
        metadata['validatedAt'] = validationEvidence.validatedAt;
      }
      if (validationEvidence.validatedTo !== undefined) {
        metadata['validatedTo'] = validationEvidence.validatedTo;
      }
      if (validationEvidence.validationMessageId !== undefined) {
        metadata['validationMessageId'] = validationEvidence.validationMessageId;
      }
      if (validationEvidence.lastValidationError !== undefined) {
        metadata['lastValidationError'] = validationEvidence.lastValidationError;
      }
    }

    return metadata as any;
  }

  private async recordDefaultSenderValidationFailure(input: {
    organizationId: string;
    installationId: string;
    number: PhoneNumber;
    validationTo: string;
    errorMessage: string;
  }) {
    const evidence: DefaultSenderValidationEvidence = {
      validatedTo: input.validationTo,
      lastValidationError: input.errorMessage,
    };

    const existing = await prisma.senderProfile.findFirst({
      where: {
        organizationId: input.organizationId,
        platform: 'leadconnector',
        installationId: input.installationId,
        phoneNumberId: input.number.id,
      },
    });

    if (existing) {
      await prisma.senderProfile.update({
        where: { id: existing.id },
        data: {
          senderKey: input.number.phoneNumber,
          senderLabel: input.number.friendlyName ?? input.number.formattedNumber,
          metadata: this.buildSenderProfileMetadata(input.number, existing.metadata, evidence),
        },
      });
      return;
    }

    await prisma.senderProfile.create({
      data: {
        organizationId: input.organizationId,
        installationId: input.installationId,
        phoneNumberId: input.number.id,
        platform: 'leadconnector',
        senderKey: input.number.phoneNumber,
        senderLabel: input.number.friendlyName ?? input.number.formattedNumber,
        isDefault: false,
        metadata: this.buildSenderProfileMetadata(input.number, undefined, evidence),
      },
    });
  }

  private async logDefaultSenderValidation(input: {
    organizationId: string;
    installationId: string;
    phoneNumberId: string;
    signalmashNumberId?: string | null;
    from: string;
    to: string;
    campaignId: string;
    smsEnablementCampaignId: string;
    status: 'success' | 'failed';
    responsePayload?: Record<string, unknown>;
    errorMessage?: string;
  }) {
    await prisma.providerOperationLog.create({
      data: {
        organizationId: input.organizationId,
        installationId: input.installationId,
        provider: 'signalmash',
        operation: 'default_sender_validation',
        localResourceType: 'phone_number',
        localResourceId: input.phoneNumberId,
        externalId: input.signalmashNumberId ?? input.from,
        status: input.status,
        requestPayload: {
          from: input.from,
          to: input.to,
          campaignId: input.campaignId,
          smsEnablementCampaignId: input.smsEnablementCampaignId,
        } as any,
        responsePayload: input.responsePayload as any,
        errorMessage: input.errorMessage,
      },
    });
  }

  private async validateDefaultSenderCandidate(input: {
    organizationId: string;
    installationId?: string | null;
    phoneNumberId: string;
    campaignId?: string | null;
    validationTo?: string | null;
  }): Promise<DefaultSenderValidationEvidence> {
    this.assertLocationContext(input.installationId);
    const validationTo = this.normalizeValidationRecipient(input.validationTo);

    const [number, installation] = await Promise.all([
      prisma.phoneNumber.findFirst({
        where: {
          id: input.phoneNumberId,
          organizationId: input.organizationId,
        },
        include: {
          campaign: true,
        },
      }),
      prisma.platformInstallation.findFirst({
        where: {
          id: input.installationId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
        },
      }),
    ]);

    if (!installation) {
      throw new AppError(
        'The selected CRM location is not linked to this organization.',
        'LOCATION_CONTEXT_INVALID',
        400
      );
    }

    if (!number) {
      throw new AppError('Phone number not found', 'NUMBER_NOT_FOUND', 404);
    }

    if (number.status !== 'active') {
      throw new AppError(
        'Only active phone numbers can be selected as the default sender.',
        'DEFAULT_SENDER_NUMBER_NOT_ACTIVE',
        400
      );
    }

    if (!number.signalmashNumberId) {
      throw new AppError(
        'The selected number is missing its Signalmash DID.',
        'DEFAULT_SENDER_DID_MISSING',
        400
      );
    }

    const campaign = input.campaignId
      ? await prisma.campaign.findFirst({
          where: {
            id: input.campaignId,
            organizationId: input.organizationId,
          },
        })
      : number.campaign;

    if (!campaign) {
      throw new AppError(
        'The selected sender must be linked to an approved campaign before it can become the default.',
        'DEFAULT_SENDER_CAMPAIGN_REQUIRED',
        400
      );
    }

    if (campaign.status !== 'approved') {
      throw new AppError(
        'The selected sender campaign must be approved before it can become the default.',
        'DEFAULT_SENDER_CAMPAIGN_NOT_APPROVED',
        400
      );
    }

    if (!campaign.signalmashCampaignId) {
      throw new AppError(
        'The selected sender campaign is missing its Signalmash campaign ID.',
        'DEFAULT_SENDER_CAMPAIGN_PROVIDER_ID_MISSING',
        400
      );
    }

    const smsEnablementCampaignId = await this.resolveSmsEnablementCampaignId(campaign);

    try {
      await signalmashService.enableSmsForNumber(number.signalmashNumberId, smsEnablementCampaignId);

      const validationResult = await signalmashService.sendMessage({
        from: number.phoneNumber,
        to: validationTo,
        body: DEFAULT_SENDER_VALIDATION_BODY,
        webhookUrl: this.getSignalmashWebhookUrl(),
      });

      const evidence: DefaultSenderValidationEvidence = {
        validatedAt: new Date().toISOString(),
        validatedTo: validationTo,
        validationMessageId: validationResult.messageId ?? null,
        lastValidationError: null,
      };

      await this.logDefaultSenderValidation({
        organizationId: input.organizationId,
        installationId: input.installationId,
        phoneNumberId: number.id,
        signalmashNumberId: number.signalmashNumberId,
        from: number.phoneNumber,
        to: validationTo,
        campaignId: campaign.id,
        smsEnablementCampaignId,
        status: 'success',
        responsePayload: {
          messageId: validationResult.messageId ?? null,
          status: validationResult.status,
        },
      });

      return evidence;
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Default sender validation failed');

      await this.logDefaultSenderValidation({
        organizationId: input.organizationId,
        installationId: input.installationId,
        phoneNumberId: number.id,
        signalmashNumberId: number.signalmashNumberId,
        from: number.phoneNumber,
        to: validationTo,
        campaignId: campaign.id,
        smsEnablementCampaignId,
        status: 'failed',
        errorMessage,
      });

      await this.recordDefaultSenderValidationFailure({
        organizationId: input.organizationId,
        installationId: input.installationId,
        number,
        validationTo,
        errorMessage,
      });

      if (isNumberNotApprovedForMnoError(error)) {
        throw new AppError(
          'The selected sender number is not approved by Signalmash for the validation recipient carrier/MNO. The current default sender was not changed.',
          'DEFAULT_SENDER_MNO_NOT_APPROVED',
          409,
          true,
          {
            provider: 'signalmash',
            from: number.phoneNumber,
            to: validationTo,
            upstreamMessage: errorMessage,
          }
        );
      }

      throw new AppError(
        'Default sender validation failed. The current default sender was not changed.',
        'DEFAULT_SENDER_VALIDATION_FAILED',
        502,
        true,
        {
          provider: 'signalmash',
          from: number.phoneNumber,
          to: validationTo,
          upstreamMessage: errorMessage,
        }
      );
    }
  }

  private async ensureDefaultSenderProfiles(
    number: PhoneNumber,
    makeDefault: boolean,
    installationId?: string | null,
    validationEvidence?: DefaultSenderValidationEvidence
  ) {
    this.assertLocationContext(installationId);

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
          metadata: this.buildSenderProfileMetadata(number, existing.metadata, validationEvidence),
        },
      });
      return;
    }

    if (!makeDefault) {
      return;
    }

    await prisma.senderProfile.create({
      data: {
        organizationId: number.organizationId,
        installationId,
        phoneNumberId: number.id,
        platform: 'leadconnector',
        senderKey: number.phoneNumber,
        senderLabel: number.friendlyName ?? number.formattedNumber,
        isDefault: true,
        metadata: this.buildSenderProfileMetadata(number, undefined, validationEvidence),
      },
    });
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
