// ===========================================
// Signalmash Messaging Provider Adapter
// ===========================================

import type {
  AvailablePhoneNumber,
  MessagingProviderAdapter,
  OutboundMessagePayload,
} from '@signalmash-connect/shared';
import { signalmashService } from '../services/signalmash.service.js';

export class SignalmashProviderAdapter implements MessagingProviderAdapter {
  readonly provider = 'signalmash' as const;

  async registerBrand(input: Record<string, unknown>) {
    const result = await signalmashService.registerBrand(input as unknown as Parameters<typeof signalmashService.registerBrand>[0]);

    return {
      externalBrandId: result.brandId,
      secondaryBrandId: result.tcrBrandId,
      status: result.status,
      metadata: {
        verificationScore: result.verificationScore,
      },
    };
  }

  async registerCampaign(input: Record<string, unknown>) {
    const result = await signalmashService.registerCampaign(input as unknown as Parameters<typeof signalmashService.registerCampaign>[0]);

    return {
      externalCampaignId: result.campaignId,
      secondaryCampaignId: result.tcrCampaignId,
      status: result.status,
      metadata: {
        dailyMessageLimit: result.dailyMessageLimit,
        messagesPerSecond: result.messagesPerSecond,
      },
    };
  }

  async searchAvailableNumbers(input: Record<string, unknown>): Promise<AvailablePhoneNumber[]> {
    return signalmashService.listAvailableNumbers(input as Parameters<typeof signalmashService.listAvailableNumbers>[0]);
  }

  async buyNumber(input: {
    phoneNumber: string;
    campaignId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const result = input.campaignId
      ? await signalmashService.purchaseNumber(input.phoneNumber, input.campaignId)
      : await signalmashService.purchaseNumberWithoutSmsEnablement(input.phoneNumber);

    return {
      externalNumberId: result.numberId,
      metadata: {
        status: result.status,
        phoneNumber: result.phoneNumber,
      },
    };
  }

  async releaseNumber(externalNumberId: string) {
    await signalmashService.releaseNumber(externalNumberId);
  }

  async sendMessage(input: OutboundMessagePayload) {
    const result = await signalmashService.sendMessage({
      from: input.from ?? '',
      to: input.to,
      body: input.body,
      mediaUrls: input.mediaUrls,
    });

    return {
      externalMessageId: result.messageId ?? `signalmash-accepted-${Date.now()}`,
      status: result.status,
      metadata: {
        from: result.from,
        to: result.to,
        providerMessageId: result.messageId,
      },
    };
  }
}

export const signalmashProvider = new SignalmashProviderAdapter();
