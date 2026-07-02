// ===========================================
// Campaign Service
// ===========================================

import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { signalmashService } from './signalmash.service.js';
import { NotFoundError, BadRequestError, AppError, ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Prisma, type Campaign, type CampaignStatus, type CampaignUseCase } from '@prisma/client';
import { integrationService } from './integration.service.js';
import { providerOperationService } from './provider-operation.service.js';
import { phoneNumberService } from './phoneNumber.service.js';
import { subscriptionBillingService } from './subscription-billing.service.js';

interface CreateCampaignInput {
  organizationId: string;
  brandId: string;
  name: string;
  description: string;
  useCase: CampaignUseCase;
  subUsecases?: string[];
  embeddedLink?: boolean;
  embeddedPhone?: boolean;
  affiliateMarketing?: boolean;
  termsAndConditions?: boolean;
  numberPool?: boolean;
  ageGated?: boolean;
  directLending?: boolean;
  subscriberOptin?: boolean;
  subscriberOptout?: boolean;
  subscriberHelp?: boolean;
  sampleMessages: string[];
  messageFlow?: string;
  mnoIds?: string[];
  referenceId?: string;
  tags?: string[];
  autoRenewal?: boolean;
  optInKeywords?: string[];
  optOutKeywords?: string[];
  helpKeywords?: string[];
  optInMessage?: string;
  optOutMessage?: string;
  helpMessage?: string;
  privacyPolicyLink?: string;
  termsAndConditionsLink?: string;
  embeddedLinkSample?: string;
}

interface UpdateCampaignInput {
  name?: string;
  description?: string;
  useCase?: CampaignUseCase;
  subUsecases?: string[];
  embeddedLink?: boolean;
  embeddedPhone?: boolean;
  affiliateMarketing?: boolean;
  termsAndConditions?: boolean;
  numberPool?: boolean;
  ageGated?: boolean;
  directLending?: boolean;
  subscriberOptin?: boolean;
  subscriberOptout?: boolean;
  subscriberHelp?: boolean;
  sampleMessages?: string[];
  messageFlow?: string;
  mnoIds?: string[];
  referenceId?: string;
  tags?: string[];
  autoRenewal?: boolean;
  optInKeywords?: string[];
  optOutKeywords?: string[];
  helpKeywords?: string[];
  optInMessage?: string;
  optOutMessage?: string;
  helpMessage?: string;
  privacyPolicyLink?: string;
  termsAndConditionsLink?: string;
  embeddedLinkSample?: string;
}

interface CampaignNumberLinkIntentInput {
  mode: 'existing' | 'buy_new';
  phoneNumberId?: string;
  phoneNumber?: string;
  friendlyName?: string;
}

interface CampaignNumberLinkIntent {
  mode: 'existing' | 'buy_new';
  phoneNumberId?: string;
  phoneNumber?: string;
  friendlyName?: string;
}

type CampaignNumberLinkAction =
  | {
      mode: 'linked';
      phoneNumberId: string;
      phoneNumber: string;
    }
  | {
      mode: 'checkout';
      checkoutUrl: string;
      sessionId: string;
      activePhoneNumbers: number;
      includedPhoneNumbers: number;
      immediateChargeAmount: number;
    }
  | {
      mode: 'pending_provider';
      message: string;
    }
  | {
      mode: 'failed';
      message: string;
    };

type CampaignResultWithNumberLink = Campaign & {
  numberLinkAction?: CampaignNumberLinkAction;
};

export class CampaignService {
  private readonly useCasesRequiringSubUseCases = new Set(['low_volume', 'mixed']);
  private readonly supportedSubUseCases = new Set([
    'two_factor_auth',
    'account_notifications',
    'customer_care',
    'delivery_notifications',
    'fraud_alerts',
    'higher_education',
    'marketing',
    'polling_voting',
    'public_service_announcement',
    'security_alerts',
  ]);

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  private normalizeCampaignUseCaseToken(value: string): string {
    const normalized = value.trim().replace(/[\s-]+/g, '_').toLowerCase();
    const aliases: Record<string, string> = {
      '2fa': 'two_factor_auth',
      account_notification: 'account_notifications',
      delivery_notification: 'delivery_notifications',
      fraud_alert: 'fraud_alerts',
      security_alert: 'security_alerts',
    };

    return aliases[normalized] ?? normalized;
  }

  private normalizeCampaignSubUsecases(useCase: string, value: unknown): string[] {
    const normalizedUseCase = this.normalizeCampaignUseCaseToken(useCase);
    const requested = Array.from(
      new Set(
        this.asStringArray(value)
          .map((item) => this.normalizeCampaignUseCaseToken(item))
          .filter((item) => this.supportedSubUseCases.has(item))
      )
    );

    if (this.useCasesRequiringSubUseCases.has(normalizedUseCase)) {
      return requested;
    }

    return requested.length > 0 ? requested : [normalizedUseCase];
  }

  private buildDefaultHelpMessage(input: {
    email?: string | null;
    phone?: string | null;
  }) {
    const contactParts = [input.email?.trim(), input.phone?.trim()].filter(Boolean) as string[];

    if (contactParts.length === 0) {
      return 'Reply HELP for assistance.';
    }

    return `Reply HELP for assistance. Contact ${contactParts.join(' or ')}.`;
  }

  private assertCampaignReadyForSubmission(campaign: Campaign) {
    if (!campaign.name.trim()) {
      throw new BadRequestError('Campaign name is required before submission');
    }

    if (!campaign.description.trim()) {
      throw new BadRequestError('Campaign description is required before submission');
    }

    if (!campaign.messageFlow.trim()) {
      throw new BadRequestError('Message flow is required before submission');
    }

    const sampleMessages = this.asStringArray(campaign.sampleMessages);
    if (sampleMessages.length < 1) {
      throw new BadRequestError('At least one sample message is required before submission');
    }

    if (sampleMessages.length > 5) {
      throw new BadRequestError('No more than 5 sample messages can be submitted');
    }

    const subUsecases = this.normalizeCampaignSubUsecases(campaign.useCase, campaign.subUsecases);
    if (campaign.useCase === 'mixed' && subUsecases.length < 2) {
      throw new BadRequestError('Mixed campaigns must include at least 2 sub-use-cases before submission');
    }

    if (campaign.useCase === 'low_volume' && subUsecases.length < 1) {
      throw new BadRequestError('Low-volume campaigns must include at least 1 sub-use-case before submission');
    }

    if (
      this.useCasesRequiringSubUseCases.has(this.normalizeCampaignUseCaseToken(campaign.useCase)) &&
      sampleMessages.length < subUsecases.length
    ) {
      throw new BadRequestError(
        'Provide at least one sample message for each selected sub-use-case before submission'
      );
    }

    const optInKeywords = this.asStringArray(campaign.optInKeywords);
    const optOutKeywords = this.asStringArray(campaign.optOutKeywords);
    const helpKeywords = this.asStringArray(campaign.helpKeywords);

    if (optInKeywords.length === 0 || optOutKeywords.length === 0 || helpKeywords.length === 0) {
      throw new BadRequestError('Opt-in, opt-out, and help keywords are required before submission');
    }

    if (!campaign.optInMessage.trim() || !campaign.optOutMessage.trim() || !campaign.helpMessage.trim()) {
      throw new BadRequestError('Opt-in, opt-out, and help messages are required before submission');
    }

    if (!campaign.privacyPolicyLink?.trim()) {
      throw new BadRequestError('Privacy policy URL is required before submission');
    }

    if (!campaign.termsAndConditionsLink?.trim()) {
      throw new BadRequestError('Terms and conditions URL is required before submission');
    }

    if (campaign.embeddedLink && !campaign.embeddedLinkSample?.trim()) {
      throw new BadRequestError('An embedded-link sample is required when embedded links are enabled');
    }
  }

  private buildProviderPayload(
    campaign: Campaign,
    brandId: string,
    overrides?: {
      mnoIds?: string[];
    }
  ) {
    return {
      brandId,
      name: campaign.name,
      description: campaign.description,
      useCase: campaign.useCase,
      subUsecases: this.normalizeCampaignSubUsecases(campaign.useCase, campaign.subUsecases),
      embeddedLink: campaign.embeddedLink,
      embeddedPhone: campaign.embeddedPhone,
      affiliateMarketing: campaign.affiliateMarketing,
      termsAndConditions: campaign.termsAndConditions,
      numberPool: campaign.numberPool,
      ageGated: campaign.ageGated,
      directLending: campaign.directLending,
      subscriberOptin: campaign.subscriberOptin,
      subscriberOptout: campaign.subscriberOptout,
      subscriberHelp: campaign.subscriberHelp,
      sampleMessages: this.asStringArray(campaign.sampleMessages),
      messageFlow: campaign.messageFlow,
      mnoIds: overrides?.mnoIds ?? this.asStringArray(campaign.mnoIds),
      referenceId: campaign.referenceId ?? undefined,
      tag: this.asStringArray(campaign.tags),
      autoRenewal: campaign.autoRenewal,
      optInKeywords: this.asStringArray(campaign.optInKeywords),
      optOutKeywords: this.asStringArray(campaign.optOutKeywords),
      helpKeywords: this.asStringArray(campaign.helpKeywords),
      optInMessage: campaign.optInMessage,
      optOutMessage: campaign.optOutMessage,
      helpMessage: campaign.helpMessage,
      privacyPolicyLink: campaign.privacyPolicyLink ?? undefined,
      termsAndConditionsLink: campaign.termsAndConditionsLink ?? undefined,
      embeddedLinkSample: campaign.embeddedLinkSample ?? undefined,
    };
  }

  private resolveQualifiedMnoIds(
    campaign: Campaign,
    qualification: Awaited<ReturnType<typeof signalmashService.qualifyBrandByUseCase>>
  ): string[] {
    const requestedMnoIds = this.asStringArray(campaign.mnoIds);
    const eligibleMnoIds = qualification.eligibleMnoIds ?? [];

    if (eligibleMnoIds.length === 0) {
      return requestedMnoIds;
    }

    if (requestedMnoIds.length === 0) {
      return eligibleMnoIds;
    }

    const intersected = requestedMnoIds.filter((mnoId) => eligibleMnoIds.includes(mnoId));
    return intersected.length > 0 ? intersected : eligibleMnoIds;
  }

  private assertQualificationRequirements(
    campaign: Campaign,
    qualification: Awaited<ReturnType<typeof signalmashService.qualifyBrandByUseCase>>
  ) {
    const sampleMessages = this.asStringArray(campaign.sampleMessages);

    if (
      qualification.minimumSampleMessages !== undefined &&
      sampleMessages.length < qualification.minimumSampleMessages
    ) {
      throw new BadRequestError(
        `Signalmash requires at least ${qualification.minimumSampleMessages} sample message${qualification.minimumSampleMessages === 1 ? '' : 's'} for this campaign use case`
      );
    }

    if (qualification.requiresSubscriberOptin && !campaign.subscriberOptin) {
      throw new BadRequestError('This campaign use case must support subscriber opt-in');
    }

    if (qualification.requiresSubscriberOptout && !campaign.subscriberOptout) {
      throw new BadRequestError('This campaign use case must support subscriber opt-out');
    }

    if (qualification.requiresSubscriberHelp && !campaign.subscriberHelp) {
      throw new BadRequestError('This campaign use case must support subscriber help responses');
    }

    if (qualification.disallowEmbeddedLink && campaign.embeddedLink) {
      throw new BadRequestError('This campaign use case cannot include embedded links');
    }

    if (qualification.disallowEmbeddedPhone && campaign.embeddedPhone) {
      throw new BadRequestError('This campaign use case cannot include embedded phone numbers');
    }
  }

  private parseNumberLinkIntent(value: unknown): CampaignNumberLinkIntent | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const mode = record.mode === 'existing' || record.mode === 'buy_new'
      ? record.mode
      : null;

    if (!mode) {
      return null;
    }

    const phoneNumberId =
      typeof record.phoneNumberId === 'string' && record.phoneNumberId.trim().length > 0
        ? record.phoneNumberId.trim()
        : undefined;
    const phoneNumber =
      typeof record.phoneNumber === 'string' && record.phoneNumber.trim().length > 0
        ? record.phoneNumber.trim()
        : undefined;
    const friendlyName =
      typeof record.friendlyName === 'string' && record.friendlyName.trim().length > 0
        ? record.friendlyName.trim()
        : undefined;

    if (mode === 'existing' && !phoneNumberId) {
      return null;
    }

    if (mode === 'buy_new' && !phoneNumber) {
      return null;
    }

    return {
      mode,
      ...(phoneNumberId ? { phoneNumberId } : {}),
      ...(phoneNumber ? { phoneNumber } : {}),
      ...(friendlyName ? { friendlyName } : {}),
    };
  }

  private normalizeNumberLinkIntent(
    value?: CampaignNumberLinkIntentInput | null
  ): CampaignNumberLinkIntent | null {
    if (!value) {
      return null;
    }

    const mode = value.mode;
    if (mode !== 'existing' && mode !== 'buy_new') {
      throw new BadRequestError('Select a valid phone-number linking mode');
    }

    if (mode === 'existing') {
      const phoneNumberId = value.phoneNumberId?.trim();
      if (!phoneNumberId) {
        throw new BadRequestError('Select an existing phone number to link');
      }

      return {
        mode,
        phoneNumberId,
        ...(value.friendlyName?.trim() ? { friendlyName: value.friendlyName.trim() } : {}),
      };
    }

    const phoneNumber = value.phoneNumber?.trim();
    if (!phoneNumber) {
      throw new BadRequestError('Select a phone number to purchase and link');
    }

    return {
      mode,
      phoneNumber,
      ...(value.friendlyName?.trim() ? { friendlyName: value.friendlyName.trim() } : {}),
    };
  }

  private buildPhoneCheckoutUrls(campaignId: string) {
    return {
      successUrl: `${config.webUrl}/campaigns/${campaignId}?number_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${config.webUrl}/campaigns/${campaignId}?number_checkout=cancelled`,
    };
  }

  private async setNumberLinkIntent(
    campaign: Campaign,
    intentInput?: CampaignNumberLinkIntentInput | null
  ): Promise<Campaign> {
    if (intentInput === undefined) {
      return campaign;
    }

    const intent = this.normalizeNumberLinkIntent(intentInput);

    return prisma.campaign.update({
      where: { id: campaign.id },
      data: intent
        ? {
            numberLinkIntent: intent as unknown as Prisma.InputJsonValue,
            numberLinkStatus: 'requested',
            numberLinkError: null,
            numberLinkAttemptedAt: null,
            numberLinkCompletedAt: null,
          }
        : {
            numberLinkIntent: Prisma.DbNull,
            numberLinkStatus: 'none',
            numberLinkError: null,
            numberLinkAttemptedAt: null,
            numberLinkCompletedAt: null,
          },
    });
  }

  private async fulfillNumberLinkIntent(campaign: Campaign): Promise<CampaignResultWithNumberLink> {
    const intent = this.parseNumberLinkIntent(campaign.numberLinkIntent);

    if (!intent) {
      return campaign;
    }

    const attemptedAt = new Date();

    if (intent.mode === 'existing') {
      try {
        const linkedNumber = await phoneNumberService.updateNumber(
          campaign.organizationId,
          intent.phoneNumberId!,
          {
            friendlyName: intent.friendlyName,
            campaignId: campaign.id,
          }
        );
        const updatedCampaign = await prisma.campaign.update({
          where: { id: campaign.id },
          data: {
            numberLinkStatus: 'linked',
            numberLinkError: null,
            numberLinkAttemptedAt: attemptedAt,
            numberLinkCompletedAt: new Date(),
          },
        });

        return {
          ...updatedCampaign,
          numberLinkAction: {
            mode: 'linked',
            phoneNumberId: linkedNumber.id,
            phoneNumber: linkedNumber.phoneNumber,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to link the existing phone number';
        const updatedCampaign = await prisma.campaign.update({
          where: { id: campaign.id },
          data: {
            numberLinkStatus: campaign.status === 'approved' ? 'failed' : 'requested',
            numberLinkError: message,
            numberLinkAttemptedAt: attemptedAt,
            numberLinkCompletedAt: null,
          },
        });

        return {
          ...updatedCampaign,
          numberLinkAction: {
            mode: campaign.status === 'approved' ? 'failed' : 'pending_provider',
            message,
          },
        };
      }
    }

    const checkout = await subscriptionBillingService.preparePhoneNumberCheckout({
      organizationId: campaign.organizationId,
      phoneNumber: intent.phoneNumber!,
      campaignId: campaign.id,
      friendlyName: intent.friendlyName,
      ...this.buildPhoneCheckoutUrls(campaign.id),
    });

    if (checkout.mode === 'checkout') {
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          numberLinkStatus: 'checkout_required',
          numberLinkError: null,
          numberLinkAttemptedAt: attemptedAt,
          numberLinkCompletedAt: null,
        },
      });

      return {
        ...updatedCampaign,
        numberLinkAction: checkout,
      };
    }

    try {
      const number = await phoneNumberService.purchaseNumber(
        campaign.organizationId,
        intent.phoneNumber!,
        {
          campaignId: campaign.id,
          friendlyName: intent.friendlyName,
        }
      );
      const updatedCampaign = await prisma.campaign.findUnique({
        where: { id: campaign.id },
      });

      if (!updatedCampaign) {
        throw new NotFoundError('Campaign not found after phone number purchase');
      }

      return {
        ...updatedCampaign,
        numberLinkAction: {
          mode: 'linked',
          phoneNumberId: number.id,
          phoneNumber: number.phoneNumber,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to purchase and link the phone number';
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          numberLinkStatus: campaign.status === 'approved' ? 'failed' : 'requested',
          numberLinkError: message,
          numberLinkAttemptedAt: attemptedAt,
          numberLinkCompletedAt: null,
        },
      });

      return {
        ...updatedCampaign,
        numberLinkAction: {
          mode: campaign.status === 'approved' ? 'failed' : 'pending_provider',
          message,
        },
      };
    }
  }

  private async maybeFulfillPendingNumberLink(campaign: Campaign): Promise<CampaignResultWithNumberLink> {
    if (campaign.status !== 'approved' || campaign.numberLinkStatus !== 'requested') {
      return campaign;
    }

    return this.fulfillNumberLinkIntent(campaign);
  }

  /**
   * Create a new campaign (draft status)
   */
  async create(data: CreateCampaignInput): Promise<Campaign> {
    // Verify brand exists and belongs to organization
    const brand = await prisma.brand.findFirst({
      where: {
        id: data.brandId,
        organizationId: data.organizationId,
      },
    });

    if (!brand) {
      throw new NotFoundError('Brand not found');
    }

    // Brand must be verified to create campaigns
    if (brand.status !== 'verified') {
      throw new BadRequestError('Brand must be verified before creating campaigns');
    }

    // Validate sample messages
    if (data.sampleMessages.length < 1) {
      throw new BadRequestError('At least one sample message is required');
    }

    if (data.sampleMessages.length > 5) {
      throw new BadRequestError('Maximum 5 sample messages allowed');
    }

    const defaultHelpMessage = this.buildDefaultHelpMessage({
      email: brand.businessContactEmail ?? brand.email,
      phone: brand.phone,
    });

    const campaign = await prisma.campaign.create({
      data: {
        organizationId: data.organizationId,
        brandId: data.brandId,
        name: data.name,
        description: data.description,
        useCase: data.useCase,
        embeddedLink: data.embeddedLink ?? false,
        embeddedPhone: data.embeddedPhone ?? false,
        affiliateMarketing: data.affiliateMarketing ?? false,
        termsAndConditions: data.termsAndConditions ?? true,
        numberPool: data.numberPool ?? false,
        ageGated: data.ageGated ?? false,
        directLending: data.directLending ?? false,
        subscriberOptin: data.subscriberOptin ?? true,
        subscriberOptout: data.subscriberOptout ?? true,
        subscriberHelp: data.subscriberHelp ?? true,
        sampleMessages: data.sampleMessages,
        messageFlow: data.messageFlow ?? data.description,
        mnoIds: data.mnoIds ?? [],
        referenceId: data.referenceId ?? null,
        tags: data.tags ?? [],
        autoRenewal: data.autoRenewal ?? true,
        optInKeywords: data.optInKeywords ?? ['START', 'YES', 'SUBSCRIBE'],
        optOutKeywords: data.optOutKeywords ?? ['STOP', 'UNSUBSCRIBE', 'CANCEL'],
        helpKeywords: data.helpKeywords ?? ['HELP', 'INFO'],
        optInMessage: data.optInMessage ?? 'You have been subscribed to receive messages. Reply STOP to unsubscribe.',
        optOutMessage: data.optOutMessage ?? 'You have been unsubscribed and will no longer receive messages from us.',
        helpMessage: data.helpMessage ?? defaultHelpMessage,
        privacyPolicyLink: data.privacyPolicyLink ?? null,
        termsAndConditionsLink: data.termsAndConditionsLink ?? null,
        embeddedLinkSample: data.embeddedLinkSample ?? null,
        subUsecases: this.normalizeCampaignSubUsecases(data.useCase, data.subUsecases),
        status: 'draft',
      },
    });

    logger.info({ campaignId: campaign.id, brandId: data.brandId }, 'Campaign created');

    return campaign;
  }

  /**
   * Get campaign by ID
   */
  async getById(id: string, organizationId: string): Promise<Campaign> {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!campaign) {
      throw new NotFoundError('Campaign not found');
    }

    return campaign;
  }

  /**
   * Get all campaigns for an organization
   */
  async getByOrganization(
    organizationId: string,
    options?: {
      brandId?: string;
      status?: CampaignStatus;
    }
  ): Promise<Campaign[]> {
    return prisma.campaign.findMany({
      where: {
        organizationId,
        ...(options?.brandId && { brandId: options.brandId }),
        ...(options?.status && { status: options.status }),
      },
      include: {
        brand: {
          select: {
            id: true,
            displayName: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update campaign
   */
  async update(
    id: string,
    organizationId: string,
    data: UpdateCampaignInput
  ): Promise<Campaign> {
    const campaign = await this.getById(id, organizationId);

    if (!['draft', 'rejected'].includes(campaign.status)) {
      throw new BadRequestError('Cannot update campaign in current status');
    }

    const updatedCampaign = await prisma.campaign.update({
      where: { id },
      data: {
        ...data,
        ...(data.useCase !== undefined || data.subUsecases !== undefined
          ? {
              subUsecases: this.normalizeCampaignSubUsecases(
                data.useCase ?? campaign.useCase,
                data.subUsecases ?? campaign.subUsecases
              ),
            }
          : {}),
        status: campaign.status === 'rejected' ? 'draft' : campaign.status,
        rejectionReason: campaign.status === 'rejected' ? null : undefined,
      },
    });

    if (updatedCampaign.signalmashCampaignId) {
      const brand = await prisma.brand.findFirst({
        where: {
          id: updatedCampaign.brandId,
          organizationId,
        },
      });

      if (!brand?.signalmashBrandId) {
        throw new BadRequestError('Brand provider mapping is required before updating a provider campaign');
      }

      this.assertCampaignReadyForSubmission(updatedCampaign);

      try {
        const signalmashResult = await signalmashService.updateCampaign({
          campaignId: updatedCampaign.signalmashCampaignId,
          ...this.buildProviderPayload(updatedCampaign, brand.signalmashBrandId),
        });

        const syncedCampaign = await prisma.campaign.update({
          where: { id },
          data: {
            tcrCampaignId: signalmashResult.tcrCampaignId ?? updatedCampaign.tcrCampaignId,
            dailyMessageLimit: signalmashResult.dailyMessageLimit ?? updatedCampaign.dailyMessageLimit,
            messagesPerSecond: signalmashResult.messagesPerSecond ?? updatedCampaign.messagesPerSecond,
            providerStatus: signalmashResult.status,
            providerMessage: signalmashResult.message ?? updatedCampaign.providerMessage,
            lastStatusSyncedAt: new Date(),
            lastSubmissionError: null,
          },
        });

        await integrationService.syncCampaignMapping(syncedCampaign);
        await providerOperationService.log({
          organizationId,
          operation: 'update_campaign',
          localResourceType: 'Campaign',
          localResourceId: syncedCampaign.id,
          externalId: syncedCampaign.signalmashCampaignId,
          status: 'success',
          requestPayload: this.buildProviderPayload(updatedCampaign, brand.signalmashBrandId),
          responsePayload: signalmashResult as unknown as Record<string, unknown>,
        });

        return syncedCampaign;
      } catch (error) {
        await providerOperationService.log({
          organizationId,
          operation: 'update_campaign',
          localResourceType: 'Campaign',
          localResourceId: updatedCampaign.id,
          externalId: updatedCampaign.signalmashCampaignId,
          status: 'failed',
          requestPayload: this.buildProviderPayload(updatedCampaign, brand.signalmashBrandId),
          errorMessage: error instanceof Error ? error.message : 'Unknown provider update failure',
        });

        if (error instanceof ExternalServiceError) {
          throw new AppError(
            'Campaign was updated locally, but pushing the changes to Signalmash failed.',
            'PROVIDER_CAMPAIGN_UPDATE_FAILED',
            502,
            true,
            {
              provider: 'signalmash',
              operation: 'update_campaign',
              campaignId: updatedCampaign.id,
              signalmashCampaignId: updatedCampaign.signalmashCampaignId,
              upstreamMessage: error.message,
            }
          );
        }

        throw error;
      }
    }

    return updatedCampaign;
  }

  /**
   * Submit campaign for approval
   */
  async submitForApproval(
    id: string,
    organizationId: string,
    options?: {
      numberLinkIntent?: CampaignNumberLinkIntentInput | null;
    }
  ): Promise<CampaignResultWithNumberLink> {
    const campaign = await this.getById(id, organizationId);

    if (!['draft', 'rejected'].includes(campaign.status)) {
      throw new BadRequestError('Campaign cannot be submitted in its current state');
    }

    const brand = await prisma.brand.findFirst({
      where: {
        id: campaign.brandId,
        organizationId,
      },
    });

    if (!brand) {
      throw new NotFoundError('Brand not found');
    }

    if (brand.status !== 'verified' || !brand.signalmashBrandId) {
      throw new BadRequestError('Brand must be verified and linked to Signalmash before submitting a campaign');
    }

    const installation = await integrationService.getPrimaryInstallationForOrganization(organizationId);
    if (!installation || installation.status !== 'connected') {
      throw new BadRequestError('Connect your GHL workspace before submitting a campaign');
    }

    this.assertCampaignReadyForSubmission(campaign);
    const qualification = await signalmashService.qualifyBrandByUseCase(
      brand.signalmashBrandId,
      campaign.useCase
    );

    await providerOperationService.log({
      organizationId,
      installationId: installation.id,
      operation: 'qualify_campaign_brand',
      localResourceType: 'Campaign',
      localResourceId: campaign.id,
      externalId: brand.signalmashBrandId,
      status: qualification.qualified ? 'success' : 'failed',
      responsePayload: {
        ...qualification.raw,
        eligibleMnoIds: qualification.eligibleMnoIds ?? [],
        minimumSampleMessages: qualification.minimumSampleMessages ?? null,
        requiresSubscriberOptin: qualification.requiresSubscriberOptin ?? false,
        requiresSubscriberOptout: qualification.requiresSubscriberOptout ?? false,
        requiresSubscriberHelp: qualification.requiresSubscriberHelp ?? false,
        disallowEmbeddedLink: qualification.disallowEmbeddedLink ?? false,
        disallowEmbeddedPhone: qualification.disallowEmbeddedPhone ?? false,
      },
      errorMessage: qualification.qualified
        ? undefined
        : qualification.message ?? 'Brand is not qualified for the requested campaign use case',
    });

    if (!qualification.qualified) {
      const errorMessage =
        qualification.message ?? 'Brand is not qualified for the requested campaign use case yet';

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          providerMessage: errorMessage,
          lastSubmissionError: errorMessage,
        },
      });

      throw new BadRequestError(errorMessage);
    }

    try {
      this.assertQualificationRequirements(campaign, qualification);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Campaign does not satisfy the provider qualification requirements';

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          providerMessage: errorMessage,
          lastSubmissionError: errorMessage,
        },
      });

      throw error;
    }

    const requestPayload = this.buildProviderPayload(campaign, brand.signalmashBrandId, {
      mnoIds: this.resolveQualifiedMnoIds(campaign, qualification),
    });

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        submitAttempts: {
          increment: 1,
        },
        lastSubmittedAt: new Date(),
        lastSubmissionError: null,
        providerMessage: null,
      },
    });

    try {
      const result = campaign.signalmashCampaignId
        ? await signalmashService.updateCampaign({
            campaignId: campaign.signalmashCampaignId,
            ...requestPayload,
          })
        : await signalmashService.registerCampaign(requestPayload);
      const nextStatus = this.mapProviderCampaignStatus(result.status, 'pending_approval');

      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          signalmashCampaignId: result.campaignId,
          tcrCampaignId: result.tcrCampaignId ?? campaign.tcrCampaignId,
          status: nextStatus,
          providerStatus: result.status,
          providerMessage: result.message ?? null,
          rejectionReason: nextStatus === 'rejected' ? campaign.rejectionReason : null,
          dailyMessageLimit: result.dailyMessageLimit ?? campaign.dailyMessageLimit,
          messagesPerSecond: result.messagesPerSecond ?? campaign.messagesPerSecond,
          lastSubmissionError: null,
          lastStatusSyncedAt: new Date(),
        },
      });

      await integrationService.syncCampaignMapping(updatedCampaign);
      await integrationService.setPrimaryOnboardingResources(organizationId, {
        installationId: installation.id,
        brandId: brand.id,
        campaignId: updatedCampaign.id,
      });

      await providerOperationService.log({
        organizationId,
        installationId: installation.id,
        operation: campaign.signalmashCampaignId ? 'resubmit_campaign' : 'submit_campaign',
        localResourceType: 'Campaign',
        localResourceId: updatedCampaign.id,
        externalId: updatedCampaign.signalmashCampaignId,
        status: 'success',
        requestPayload,
        responsePayload: result as unknown as Record<string, unknown>,
      });

      const campaignWithIntent = await this.setNumberLinkIntent(
        updatedCampaign,
        options?.numberLinkIntent
      );

      const intent = this.parseNumberLinkIntent(campaignWithIntent.numberLinkIntent);
      if (!intent) {
        return campaignWithIntent;
      }

      return this.fulfillNumberLinkIntent(campaignWithIntent);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown provider submission failure';

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          lastSubmissionError: errorMessage,
          providerMessage: errorMessage,
        },
      });

      await providerOperationService.log({
        organizationId,
        installationId: installation.id,
        operation: campaign.signalmashCampaignId ? 'resubmit_campaign' : 'submit_campaign',
        localResourceType: 'Campaign',
        localResourceId: campaign.id,
        externalId: campaign.signalmashCampaignId,
        status: 'failed',
        requestPayload,
        errorMessage,
      });

      if (error instanceof ExternalServiceError) {
        throw new AppError(
          'Unable to submit the campaign to Signalmash right now.',
          'PROVIDER_CAMPAIGN_SUBMISSION_FAILED',
          502,
          true,
          {
            provider: 'signalmash',
            operation: campaign.signalmashCampaignId ? 'resubmit_campaign' : 'submit_campaign',
            campaignId: campaign.id,
            signalmashCampaignId: campaign.signalmashCampaignId,
            upstreamMessage: error.message,
          }
        );
      }

      throw error;
    }
  }

  /**
   * Handle approval webhook from Signalmash
   */
  async handleApprovalResult(
    signalmashCampaignId: string,
    status: string,
    rejectionReason?: string,
    throughput?: {
      dailyMessageLimit?: number;
      messagesPerSecond?: number;
    },
    tcrCampaignId?: string
  ): Promise<CampaignResultWithNumberLink> {
    const campaign = await prisma.campaign.findFirst({
      where: { signalmashCampaignId },
    });

    if (!campaign) {
      throw new NotFoundError('Campaign not found');
    }

    const nextStatus = this.mapProviderCampaignStatus(status, campaign.status);
    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: nextStatus,
        providerStatus: status,
        providerMessage: rejectionReason ?? null,
        rejectionReason: nextStatus === 'rejected' ? rejectionReason ?? campaign.rejectionReason : null,
        dailyMessageLimit: throughput?.dailyMessageLimit,
        messagesPerSecond: throughput?.messagesPerSecond,
        tcrCampaignId: tcrCampaignId ?? campaign.tcrCampaignId,
        lastStatusSyncedAt: new Date(),
        lastSubmissionError:
          nextStatus === 'rejected' ? rejectionReason ?? campaign.lastSubmissionError : null,
      },
    });

    logger.info(
      { campaignId: campaign.id, providerStatus: status, nextStatus },
      'Campaign approval status updated'
    );

    await integrationService.syncCampaignMapping(updatedCampaign);
    await providerOperationService.log({
      organizationId: campaign.organizationId,
      operation: 'campaign_webhook',
      localResourceType: 'Campaign',
      localResourceId: campaign.id,
      externalId: signalmashCampaignId,
      status: 'success',
      responsePayload: {
        status,
        nextStatus,
        rejectionReason,
        throughput,
        tcrCampaignId,
      },
    });

    return this.maybeFulfillPendingNumberLink(updatedCampaign);
  }

  async refreshApprovalStatus(id: string, organizationId: string): Promise<Campaign> {
    const campaign = await this.getById(id, organizationId);

    if (!campaign.signalmashCampaignId) {
      throw new BadRequestError('Campaign has not been submitted to Signalmash yet');
    }

    try {
      const providerStatus = await signalmashService.getCampaignStatus(campaign.signalmashCampaignId);
      const nextStatus = this.mapProviderCampaignStatus(providerStatus.status, campaign.status);

      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: nextStatus,
          providerStatus: providerStatus.status,
          providerMessage:
            providerStatus.rejectionReason ??
            providerStatus.providerMessage ??
            campaign.providerMessage,
          rejectionReason:
            nextStatus === 'rejected'
              ? providerStatus.rejectionReason ?? campaign.rejectionReason
              : null,
          dailyMessageLimit: providerStatus.dailyMessageLimit ?? campaign.dailyMessageLimit,
          messagesPerSecond: providerStatus.messagesPerSecond ?? campaign.messagesPerSecond,
          tcrCampaignId: providerStatus.tcrCampaignId ?? campaign.tcrCampaignId,
          lastStatusSyncedAt: new Date(),
          lastSubmissionError:
            nextStatus === 'rejected'
              ? providerStatus.rejectionReason ?? campaign.lastSubmissionError
              : null,
        },
      });

      logger.info(
        {
          campaignId: campaign.id,
          signalmashCampaignId: campaign.signalmashCampaignId,
          providerStatus: providerStatus.status,
          nextStatus,
          tcrCampaignId: updatedCampaign.tcrCampaignId,
        },
        'Campaign approval status refreshed from Signalmash'
      );

      await integrationService.syncCampaignMapping(updatedCampaign);
      await providerOperationService.log({
        organizationId,
        operation: 'refresh_campaign_status',
        localResourceType: 'Campaign',
        localResourceId: campaign.id,
        externalId: campaign.signalmashCampaignId,
        status: 'success',
        responsePayload: providerStatus as unknown as Record<string, unknown>,
      });

      const relinkedCampaign = await this.maybeFulfillPendingNumberLink(updatedCampaign);
      return relinkedCampaign;
    } catch (error) {
      await providerOperationService.log({
        organizationId,
        operation: 'refresh_campaign_status',
        localResourceType: 'Campaign',
        localResourceId: campaign.id,
        externalId: campaign.signalmashCampaignId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown provider refresh failure',
      });

      if (error instanceof ExternalServiceError) {
        throw new AppError(
          'Unable to refresh campaign status from Signalmash right now.',
          'PROVIDER_STATUS_REFRESH_FAILED',
          503,
          true,
          {
            provider: 'signalmash',
            operation: 'refresh_campaign_status',
            campaignId: campaign.id,
            signalmashCampaignId: campaign.signalmashCampaignId,
            upstreamMessage: error.message,
          }
        );
      }

      throw error;
    }
  }

  async linkPhoneNumber(
    id: string,
    organizationId: string,
    intentInput: CampaignNumberLinkIntentInput
  ): Promise<CampaignResultWithNumberLink> {
    const campaign = await this.getById(id, organizationId);

    if (!['pending_approval', 'approved'].includes(campaign.status)) {
      throw new BadRequestError('Phone numbers can only be linked after the campaign has been submitted');
    }

    if (!campaign.signalmashCampaignId && intentInput.mode === 'buy_new') {
      throw new BadRequestError('Campaign must be linked to Signalmash before buying a number');
    }

    const campaignWithIntent = await this.setNumberLinkIntent(campaign, intentInput);
    return this.fulfillNumberLinkIntent(campaignWithIntent);
  }

  async setManualApprovalStatus(
    id: string,
    organizationId: string,
    status: Extract<CampaignStatus, 'approved' | 'rejected'>,
    reason?: string
  ): Promise<CampaignResultWithNumberLink> {
    const campaign = await this.getById(id, organizationId);

    if (!campaign.signalmashCampaignId) {
      throw new BadRequestError('Campaign must be linked to Signalmash before admin approval can be set');
    }

    const normalizedReason = reason?.trim() || undefined;
    const rejectionReason =
      status === 'rejected'
        ? normalizedReason ??
          campaign.rejectionReason ??
          campaign.providerMessage ??
          campaign.lastSubmissionError ??
          'Marked rejected manually by admin.'
        : null;

    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status,
        rejectionReason,
        lastSubmissionError: status === 'rejected' ? rejectionReason : null,
      },
    });

    logger.info(
      {
        campaignId: campaign.id,
        signalmashCampaignId: campaign.signalmashCampaignId,
        previousStatus: campaign.status,
        nextStatus: status,
      },
      'Campaign approval status updated manually'
    );

    await integrationService.syncCampaignMapping(updatedCampaign);

    return status === 'approved'
      ? this.maybeFulfillPendingNumberLink(updatedCampaign)
      : updatedCampaign;
  }

  private mapProviderCampaignStatus(providerStatus: string, currentStatus: CampaignStatus): CampaignStatus {
    const normalized = providerStatus.trim().replace(/[\s-]+/g, '_').toLowerCase();

    if (['approved', 'active', 'verified'].includes(normalized)) {
      return 'approved';
    }

    if (['rejected', 'declined', 'failed'].includes(normalized)) {
      return 'rejected';
    }

    if (['suspended'].includes(normalized)) {
      return 'suspended';
    }

    if (['expired'].includes(normalized)) {
      return 'expired';
    }

    if (
      [
        'pending',
        'pending_approval',
        'submitted',
        'in_review',
        'review',
        'manual_review',
        'needs_info',
      ].includes(normalized)
    ) {
      return 'pending_approval';
    }

    return currentStatus;
  }

  /**
   * Delete campaign (only draft campaigns)
   */
  async delete(id: string, organizationId: string): Promise<void> {
    const campaign = await this.getById(id, organizationId);

    if (campaign.status !== 'draft') {
      throw new BadRequestError('Only draft campaigns can be deleted');
    }

    await prisma.campaign.delete({
      where: { id },
    });

    logger.info({ campaignId: id }, 'Campaign deleted');
  }

  /**
   * Get campaign with phone numbers
   */
  async getWithPhoneNumbers(id: string, organizationId: string): Promise<Campaign & {
    phoneNumbers: Array<{
      id: string;
      phoneNumber: string;
      formattedNumber: string;
      status: string;
    }>;
  }> {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        phoneNumbers: {
          select: {
            id: true,
            phoneNumber: true,
            formattedNumber: true,
            status: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundError('Campaign not found');
    }

    return campaign;
  }
}

export const campaignService = new CampaignService();
