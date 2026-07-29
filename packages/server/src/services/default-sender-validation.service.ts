import { getErrorMessage } from '../utils/provider-errors.js';
import { isSmsAlreadyEnabledMessage } from './signalmash-sms-enablement.service.js';

export interface DefaultSenderValidationSmsInput {
  signalmashNumberId: string;
  smsEnablementCampaignId: string;
  from: string;
  to: string;
  body: string;
  webhookUrl: string;
}

export interface DefaultSenderValidationSmsResult {
  messageId?: string;
  status?: string | number;
}

export interface DefaultSenderValidationProvider {
  enableSmsForNumber(phoneNumber: string, campaignId: string): Promise<void>;
  sendMessage(input: {
    from: string;
    to: string;
    body: string;
    webhookUrl: string;
  }): Promise<DefaultSenderValidationSmsResult>;
}

export interface DefaultSenderValidationLogger {
  info(payload: Record<string, unknown>, message: string): void;
}

export async function sendDefaultSenderValidationSms(
  input: DefaultSenderValidationSmsInput,
  provider: DefaultSenderValidationProvider,
  logger?: DefaultSenderValidationLogger
) {
  try {
    await provider.enableSmsForNumber(input.signalmashNumberId, input.smsEnablementCampaignId);
  } catch (error) {
    const errorMessage = getErrorMessage(error, String(error ?? ''));
    if (!isSmsAlreadyEnabledMessage(errorMessage)) {
      throw error;
    }

    logger?.info(
      {
        signalmashNumberId: input.signalmashNumberId,
        smsEnablementCampaignId: input.smsEnablementCampaignId,
      },
      'Signalmash reported SMS was already enabled for default sender validation; continuing idempotently'
    );
  }

  return provider.sendMessage({
    from: input.from,
    to: input.to,
    body: input.body,
    webhookUrl: input.webhookUrl,
  });
}
