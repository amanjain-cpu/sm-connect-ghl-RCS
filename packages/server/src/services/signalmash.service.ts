// ===========================================
// Signalmash API Service
// ===========================================

import { config } from '../config/index.js';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { decrypt } from '../utils/crypto.js';
import { ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { retry } from '@signalmash-connect/shared';

// Settings keys (must match admin.service.ts)
const SETTINGS_KEYS = {
  SIGNALMASH_API_KEY: 'signalmash_api_key',
  SIGNALMASH_API_URL: 'signalmash_api_url',
} as const;

// Cache TTL for settings (5 minutes)
const SETTINGS_CACHE_TTL = 300;

interface BrandRegistrationInput {
  entityType: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  companyName: string;
  ein?: string;
  einIssuingCountry?: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  email: string;
  stockSymbol?: string;
  stockExchange?: string;
  ipAddress?: string;
  brandRelationship?: string;
  website: string;
  vertical: string;
  altBusinessId?: string;
  altBusinessIdType?: string;
  referenceId?: string;
  tag?: string[];
  mobilePhone?: string;
  businessContactEmail?: string;
}

interface BrandRegistrationResult {
  brandId: string;
  tcrBrandId?: string;
  status: string;
  verificationScore?: number;
  message?: string;
}

interface RawBrandRegistrationResult {
  brandId?: string;
  tcrBrandId?: string;
  status?: string | number;
  verificationScore?: number;
  message?: string;
}

interface BrandStatusResult {
  status: string;
  signalmashBrandId?: string;
  tcrBrandId?: string;
  verificationScore?: number;
  rejectionReason?: string;
  referenceId?: string;
}

interface RawBrandStatusResult {
  status?: string | number;
  brandId?: string;
  tcrBrandId?: string;
  verificationScore?: number;
  rejectionReason?: string;
  referenceId?: string;
  data?: {
    status?: string | number;
    brandId?: string;
    tcrBrandId?: string;
    tcr_brand_id?: string;
    verificationScore?: number;
    verification_score?: number;
    rejectionReason?: string;
    rejection_reason?: string;
    referenceId?: string;
    reference_id?: string;
  };
}

interface CampaignRegistrationInput {
  brandId: string;
  name?: string;
  description: string;
  useCase: string;
  sampleMessages: string[];
  optInKeywords: string[];
  optOutKeywords: string[];
  helpKeywords: string[];
  optInMessage: string;
  optOutMessage: string;
  helpMessage: string;
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
  messageFlow?: string;
  mnoIds?: string[];
  referenceId?: string;
  autoRenewal?: boolean;
  tag?: string[];
  privacyPolicyLink?: string;
  termsAndConditionsLink?: string;
  embeddedLinkSample?: string;
}

interface CampaignRegistrationResult {
  campaignId: string;
  tcrCampaignId?: string;
  status: string;
  dailyMessageLimit?: number;
  messagesPerSecond?: number;
  message?: string;
}

interface RawCampaignRegistrationResult {
  campaignId?: string;
  tcrCampaignId?: string;
  status?: string | number;
  dailyMessageLimit?: number;
  messagesPerSecond?: number;
  message?: string;
}

interface RawCampaignStatusResult {
  status?: string | number;
  campaignId?: string;
  tcrCampaignId?: string;
  rejectionReason?: string;
  dailyMessageLimit?: number;
  messagesPerSecond?: number;
  data?: {
    status?: string | number;
    campaignId?: string;
    tcrCampaignId?: string;
    tcr_campaign_id?: string;
    rejectionReason?: string;
    rejection_reason?: string;
    dailyMessageLimit?: number;
    daily_message_limit?: number;
    messagesPerSecond?: number;
    messages_per_second?: number;
  };
}

interface CampaignUpdateInput extends CampaignRegistrationInput {
  campaignId: string;
}

interface SendMessageInput {
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
  webhookUrl?: string;
}

interface SendMessageResult {
  messageId?: string;
  status: string;
  from: string;
  to: string;
}

interface RawSendMessageResult {
  messageId?: string;
  messageSid?: string;
  MessageSid?: string;
  message_id?: string;
  id?: string;
  sid?: string;
  status?: string | number;
  message?: string;
  error?: string;
  data?: {
    messageId?: string;
    messageSid?: string;
    MessageSid?: string;
    message_id?: string;
    id?: string;
    sid?: string;
    status?: string | number;
  };
}

interface MessageStatusResult {
  messageId: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
}

interface LegacyNumberPurchaseResult {
  error_code?: number;
  status?: number;
  message?: string;
  error?: {
    code?: number;
    message?: string;
    description?: string;
  };
  result?: Array<{
    did?: string;
  }>;
}

interface LegacyEnableSmsResult {
  status?: number;
  message?: string;
  error?: {
    code?: number;
    message?: string;
    description?: string;
  };
}

interface LegacySetConnectionResult {
  status?: number;
  message?: string;
  error?: {
    code?: number;
    message?: string;
    description?: string;
  };
}

export interface SignalmashConnectionDiagnostic {
  testedAt: string;
  method: 'GET';
  requestUrl: string;
  status: number | null;
  ok: boolean;
  responseBody: string;
}

export class SignalmashService {
  private static readonly PURCHASE_CONNECTION_KEY =
    'XI-ohLkyE_WkXgU-ivW0HNoR9p1-Fg';

  private extractResponseMessage(responseText: string, fallback: string): string {
    const trimmed = responseText.trim();

    if (!trimmed) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        message?: string;
        error?: string | { message?: string; code?: string };
      };

      if (typeof parsed.error === 'string' && parsed.error) {
        return parsed.error;
      }

      if (parsed.error && typeof parsed.error === 'object' && parsed.error.message) {
        return parsed.error.message;
      }

      if (parsed.message) {
        return parsed.message;
      }
    } catch {
      // Fall back to plain-text / HTML extraction below.
    }

    const preMatch = trimmed.match(/<pre>([\s\S]*?)<\/pre>/i);
    if (preMatch?.[1]) {
      return preMatch[1].replace(/\s+/g, ' ').trim();
    }

    const textOnly = trimmed
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return textOnly || fallback;
  }

  private parseJsonResponse<T>(responseText: string): T {
    return JSON.parse(responseText) as T;
  }

  private mapCampaignUseCase(useCase: string): string {
    const mappings: Record<string, string> = {
      two_factor_auth: '2FA',
      account_notifications: 'ACCOUNT_NOTIFICATIONS',
      customer_care: 'CUSTOMER_CARE',
      delivery_notifications: 'DELIVERY_NOTIFICATIONS',
      fraud_alerts: 'FRAUD_ALERTS',
      higher_education: 'HIGHER_EDUCATION',
      low_volume: 'LOW_VOLUME',
      marketing: 'MARKETING',
      mixed: 'MIXED',
      polling_voting: 'POLLING_VOTING',
      public_service_announcement: 'PUBLIC_SERVICE_ANNOUNCEMENT',
      security_alerts: 'SECURITY_ALERTS',
    };

    return mappings[useCase] ?? useCase;
  }

  private formatPhoneNumber(phoneNumber: string): string {
    const digits = phoneNumber.replace(/\D/g, '');

    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    if (digits.length === 11 && digits.startsWith('1')) {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }

    return phoneNumber;
  }

  private formatSmsEndpointPhone(phoneNumber: string): string {
    const digits = phoneNumber.replace(/\D/g, '');

    if (digits.length === 11 && digits.startsWith('1')) {
      return digits.slice(1);
    }

    return digits;
  }

  /**
   * Get a setting value from database with caching
   * Falls back to environment variables if not set in database
   */
  private async getSetting(key: string, envFallback: string): Promise<string> {
    // Check cache first
    const cacheKey = `setting:${key}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error) {
      // Redis might not be available, continue without cache
      logger.debug({ error }, 'Redis cache unavailable');
    }

    // Check database
    try {
      const setting = await prisma.appSettings.findUnique({
        where: { key },
      });

      if (setting && setting.value) {
        const value = setting.isEncrypted ? decrypt(setting.value) : setting.value;

        // Cache the value
        try {
          await redis.setex(cacheKey, SETTINGS_CACHE_TTL, value);
        } catch {
          // Ignore cache errors
        }

        return value;
      }
    } catch (error) {
      logger.debug({ error, key }, 'Failed to get setting from database');
    }

    // Fall back to environment variable
    return envFallback;
  }

  /**
   * Get the current Signalmash API configuration
   * This is fetched fresh for each request to support runtime updates
   */
  private async getConfig(): Promise<{ apiUrl: string; apiKey: string }> {
    const [apiUrl, apiKey] = await Promise.all([
      this.getSetting(SETTINGS_KEYS.SIGNALMASH_API_URL, config.signalmashApiUrl),
      this.getSetting(SETTINGS_KEYS.SIGNALMASH_API_KEY, config.signalmashApiKey || ''),
    ]);

    return {
      apiUrl,
      apiKey,
    };
  }

  /**
   * Make authenticated request to Signalmash API
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    // Get fresh config (supports runtime API key updates)
    const signalmashConfig = await this.getConfig();

    if (!signalmashConfig.apiKey) {
      throw new ExternalServiceError(
        'Signalmash',
        'API key not configured. Please configure it in Admin Settings.'
      );
    }

    const url = `${signalmashConfig.apiUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': signalmashConfig.apiKey,
    };

    try {
      const response = await retry(
        async () => {
          const res = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });

          const responseText = await res.text();

          if (endpoint === '/messages') {
            logger.info(
              {
                endpoint,
                httpStatus: res.status,
                ok: res.ok,
                responseText: responseText.slice(0, 500),
              },
              'Signalmash messages raw response'
            );
          }

          if (endpoint === '/registerbrand') {
            logger.info(
              {
                endpoint,
                status: res.status,
                ok: res.ok,
                requestBody: body,
                responseText,
              },
              'Signalmash registerbrand raw response'
            );
          }

          if (!res.ok) {
            const upstreamMessage = this.extractResponseMessage(
              responseText,
              res.statusText
            );

            logger.warn(
              {
                endpoint,
                httpStatus: res.status,
                contentType: res.headers.get('content-type'),
                responseSnippet: responseText.slice(0, 300),
              },
              'Signalmash API returned an error response'
            );

            throw new ExternalServiceError(
              'Signalmash',
              `${res.status}: ${upstreamMessage}`
            );
          }

          try {
            return this.parseJsonResponse<T>(responseText);
          } catch (error) {
            logger.error(
              {
                endpoint,
                status: res.status,
                responseSnippet: responseText.slice(0, 300),
                error,
              },
              'Signalmash API returned a non-JSON success response'
            );
            throw new ExternalServiceError(
              'Signalmash',
              `Unexpected non-JSON response from ${endpoint}`
            );
          }
        },
        { maxRetries: 3, initialDelay: 1000 }
      );

      return response;
    } catch (error) {
      logger.error({ error, endpoint, method }, 'Signalmash API request failed');
      throw error;
    }
  }

  private async requestForm<T>(
    method: string,
    endpoint: string,
    form: URLSearchParams
  ): Promise<T> {
    const signalmashConfig = await this.getConfig();

    if (!signalmashConfig.apiKey) {
      throw new ExternalServiceError(
        'Signalmash',
        'API key not configured. Please configure it in Admin Settings.'
      );
    }

    const url = `${signalmashConfig.apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': signalmashConfig.apiKey,
    };

    try {
      return await retry(
        async () => {
          const res = await fetch(url, {
            method,
            headers,
            body: form.toString(),
          });

          const responseText = await res.text();

          if (!res.ok) {
            let message = res.statusText;
            try {
              const errorBody = JSON.parse(responseText || '{}') as { message?: string; error?: string };
              message = errorBody.message || errorBody.error || message;
            } catch {
              message = responseText || message;
            }

            throw new ExternalServiceError('Signalmash', `${res.status}: ${message}`);
          }

          try {
            return JSON.parse(responseText || '{}') as T;
          } catch {
            return { message: responseText } as T;
          }
        },
        { maxRetries: 3, initialDelay: 1000 }
      );
    } catch (error) {
      logger.error({ error, endpoint, method }, 'Signalmash form API request failed');
      throw error;
    }
  }

  /**
   * Register a brand for 10DLC
   */
  async registerBrand(input: BrandRegistrationInput): Promise<BrandRegistrationResult> {
    logger.info({ companyName: input.companyName, displayName: input.displayName }, 'Registering brand with Signalmash');

    const result = await this.request<RawBrandRegistrationResult>(
      'POST',
      '/registerbrand',
      {
        entityType: input.entityType,
        firstName: input.firstName ?? '',
        lastName: input.lastName ?? '',
        displayName: input.displayName,
        companyName: input.companyName,
        ein: input.ein,
        einIssuingCountry: input.einIssuingCountry ?? input.country,
        phone: input.phone,
        street: input.street,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        country: input.country,
        email: input.email,
        stockSymbol: input.stockSymbol ?? 'NONE',
        stockExchange: input.stockExchange ?? 'NONE',
        ipAddress: input.ipAddress ?? '',
        brandRelationship: input.brandRelationship ?? 'BASIC_ACCOUNT',
        website: input.website,
        vertical: input.vertical,
        altBusinessId: input.altBusinessId ?? 'NONE',
        altBusinessIdType: input.altBusinessIdType ?? 'NONE',
        referenceId: input.referenceId ?? 'NONE',
        tag: input.tag ?? [],
        mobilePhone: input.mobilePhone ?? 'NONE',
        businessContactEmail: input.businessContactEmail ?? input.email,
      }
    );

    if ((typeof result.status === 'number' && result.status >= 400) || !result.brandId) {
      throw new ExternalServiceError(
        'Signalmash',
        result.message || 'Brand registration did not return a brand ID'
      );
    }

    logger.info(
      { brandId: result.brandId, status: result.status },
      'Brand registered with Signalmash'
    );

    return {
      brandId: result.brandId,
      tcrBrandId: result.tcrBrandId,
      status: String(result.status ?? 'submitted'),
      verificationScore: result.verificationScore,
      message: result.message,
    };
  }

  /**
   * Get brand status
   */
  async getBrandStatus(brandId: string): Promise<{
    status: string;
    signalmashBrandId?: string;
    tcrBrandId?: string;
    verificationScore?: number;
    rejectionReason?: string;
    referenceId?: string;
  }> {
    const result = await this.request<RawBrandStatusResult>(
      'GET',
      `/brand?brandId=${encodeURIComponent(brandId)}`
    );
    const data = result.data ?? {};

    return {
      status: String(data.status ?? result.status ?? 'unknown'),
      signalmashBrandId: data.brandId ?? result.brandId ?? brandId,
      tcrBrandId: data.tcrBrandId ?? data.tcr_brand_id ?? result.tcrBrandId,
      verificationScore: data.verificationScore ?? data.verification_score ?? result.verificationScore,
      rejectionReason: data.rejectionReason ?? data.rejection_reason ?? result.rejectionReason,
      referenceId: data.referenceId ?? data.reference_id ?? result.referenceId,
    };
  }

  /**
   * Register a campaign
   */
  async registerCampaign(input: CampaignRegistrationInput): Promise<CampaignRegistrationResult> {
    logger.info({ name: input.name, brandId: input.brandId }, 'Registering campaign with Signalmash');

    const [sample1, sample2, sample3, sample4, sample5] = input.sampleMessages;

    const result = await this.request<RawCampaignRegistrationResult>(
      'POST',
      '/registercampaign',
      {
        brandId: input.brandId,
        usecase: this.mapCampaignUseCase(input.useCase),
        subUsecases: input.subUsecases ?? [],
        description: input.description,
        embeddedLink: input.embeddedLink ?? false,
        embeddedPhone: input.embeddedPhone ?? false,
        affiliateMarketing: input.affiliateMarketing ?? false,
        termsAndConditions: input.termsAndConditions ?? true,
        numberPool: input.numberPool ?? false,
        ageGated: input.ageGated ?? false,
        directLending: input.directLending ?? false,
        subscriberOptin: input.subscriberOptin ?? true,
        subscriberOptout: input.subscriberOptout ?? true,
        subscriberHelp: input.subscriberHelp ?? true,
        sample1: sample1 ?? '',
        sample2: sample2 ?? '',
        sample3: sample3 ?? '',
        sample4: sample4 ?? '',
        sample5: sample5 ?? '',
        messageFlow: input.messageFlow ?? input.description,
        helpMessage: input.helpMessage,
        mnoIds: input.mnoIds ?? [],
        referenceId: input.referenceId ?? input.name ?? `campaign-${Date.now()}`,
        autoRenewal: input.autoRenewal ?? true,
        tag: input.tag ?? [],
        optinKeywords: input.optInKeywords.join(','),
        optoutKeywords: input.optOutKeywords.join(','),
        helpKeywords: input.helpKeywords.join(','),
        optinMessage: input.optInMessage,
        optoutMessage: input.optOutMessage,
        privacyPolicyLink: input.privacyPolicyLink ?? '',
        termsAndConditionsLink: input.termsAndConditionsLink ?? '',
        embeddedLinkSample: input.embeddedLinkSample ?? '',
      }
    );

    if ((typeof result.status === 'number' && result.status >= 400) || !result.campaignId) {
      throw new ExternalServiceError(
        'Signalmash',
        result.message || 'Campaign registration did not return a campaign ID'
      );
    }

    logger.info(
      { campaignId: result.campaignId, status: result.status },
      'Campaign registered with Signalmash'
    );

    return {
      campaignId: result.campaignId,
      tcrCampaignId: result.tcrCampaignId,
      status: String(result.status ?? 'submitted'),
      dailyMessageLimit: result.dailyMessageLimit,
      messagesPerSecond: result.messagesPerSecond,
      message: result.message,
    };
  }

  async updateCampaign(input: CampaignUpdateInput): Promise<CampaignRegistrationResult> {
    logger.info({ campaignId: input.campaignId, brandId: input.brandId }, 'Updating campaign with Signalmash');

    const [sample1, sample2, sample3, sample4, sample5] = input.sampleMessages;

    const result = await this.request<RawCampaignRegistrationResult>(
      'POST',
      '/updateCampaign',
      {
        campaignId: input.campaignId,
        brandId: input.brandId,
        usecase: this.mapCampaignUseCase(input.useCase),
        subUsecases: input.subUsecases ?? [],
        description: input.description,
        embeddedLink: input.embeddedLink ?? false,
        embeddedPhone: input.embeddedPhone ?? false,
        affiliateMarketing: input.affiliateMarketing ?? false,
        termsAndConditions: input.termsAndConditions ?? true,
        numberPool: input.numberPool ?? false,
        ageGated: input.ageGated ?? false,
        directLending: input.directLending ?? false,
        subscriberOptin: input.subscriberOptin ?? true,
        subscriberOptout: input.subscriberOptout ?? true,
        subscriberHelp: input.subscriberHelp ?? true,
        sample1: sample1 ?? '',
        sample2: sample2 ?? '',
        sample3: sample3 ?? '',
        sample4: sample4 ?? '',
        sample5: sample5 ?? '',
        messageFlow: input.messageFlow ?? input.description,
        helpMessage: input.helpMessage,
        mnoIds: input.mnoIds ?? [],
        referenceId: input.referenceId ?? input.name ?? input.campaignId,
        autoRenewal: input.autoRenewal ?? true,
        tag: input.tag ?? [],
        optinKeywords: input.optInKeywords.join(','),
        optoutKeywords: input.optOutKeywords.join(','),
        helpKeywords: input.helpKeywords.join(','),
        optinMessage: input.optInMessage,
        optoutMessage: input.optOutMessage,
        privacyPolicyLink: input.privacyPolicyLink ?? '',
        termsAndConditionsLink: input.termsAndConditionsLink ?? '',
        embeddedLinkSample: input.embeddedLinkSample ?? '',
      }
    );

    if ((typeof result.status === 'number' && result.status >= 400) || !result.campaignId) {
      throw new ExternalServiceError(
        'Signalmash',
        result.message || 'Campaign update did not return a campaign ID'
      );
    }

    logger.info(
      { campaignId: result.campaignId, status: result.status },
      'Campaign updated with Signalmash'
    );

    return {
      campaignId: result.campaignId,
      tcrCampaignId: result.tcrCampaignId,
      status: String(result.status ?? 'updated'),
      dailyMessageLimit: result.dailyMessageLimit,
      messagesPerSecond: result.messagesPerSecond,
      message: result.message,
    };
  }

  /**
   * Get campaign status
   */
  async getCampaignStatus(campaignId: string): Promise<{
    status: string;
    signalmashCampaignId?: string;
    tcrCampaignId?: string;
    rejectionReason?: string;
    dailyMessageLimit?: number;
    messagesPerSecond?: number;
  }> {
    const result = await this.request<RawCampaignStatusResult>(
      'GET',
      `/campaign?campaignId=${encodeURIComponent(campaignId)}`
    );
    const data = result.data ?? {};

    return {
      status: String(data.status ?? result.status ?? 'unknown'),
      signalmashCampaignId: data.campaignId ?? result.campaignId ?? campaignId,
      tcrCampaignId: data.tcrCampaignId ?? data.tcr_campaign_id ?? result.tcrCampaignId,
      rejectionReason: data.rejectionReason ?? data.rejection_reason ?? result.rejectionReason,
      dailyMessageLimit: data.dailyMessageLimit ?? data.daily_message_limit ?? result.dailyMessageLimit,
      messagesPerSecond: data.messagesPerSecond ?? data.messages_per_second ?? result.messagesPerSecond,
    };
  }

  /**
   * Send an SMS message
   */
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    logger.debug({ from: input.from, to: input.to }, 'Sending SMS via Signalmash');

    const form = new URLSearchParams({
      FROM: this.formatSmsEndpointPhone(input.from),
      TO: this.formatSmsEndpointPhone(input.to),
      BODY: input.body,
      ATTACHMENT: input.mediaUrls?.[0] ?? '',
    });

    const result = await this.requestForm<RawSendMessageResult>(
      'POST',
      '/messages',
      form
    );

    const messageId =
      result.data?.messageId ??
      result.data?.messageSid ??
      result.data?.MessageSid ??
      result.data?.message_id ??
      result.data?.id ??
      result.data?.sid ??
      result.messageId ??
      result.messageSid ??
      result.MessageSid ??
      result.message_id ??
      result.id ??
      result.sid;

    const status = result.data?.status ?? result.status ?? 'sent';
    const numericStatus = typeof status === 'number' ? status : Number(status);

    if (Number.isFinite(numericStatus) && numericStatus >= 400) {
      throw new ExternalServiceError(
        'Signalmash',
        `${numericStatus}: ${result.message || result.error || 'Message send failed'}`
      );
    }

    logger.info(
      { messageId, status },
      'Message sent via Signalmash'
    );

    return {
      messageId,
      status: String(status),
      from: input.from,
      to: input.to,
    };
  }

  /**
   * Get message status
   */
  async getMessageStatus(messageId: string): Promise<MessageStatusResult> {
    return this.request('GET', `/v1/messages/${messageId}`);
  }

  /**
   * List available phone numbers for purchase
   */
  async listAvailableNumbers(options?: {
    areaCode?: string;
    contains?: string;
    state?: string;
    limit?: number;
  }): Promise<Array<{
    phoneNumber: string;
    formattedNumber: string;
    capabilities: { sms: boolean; mms: boolean; voice: boolean };
    monthlyPrice: number;
  }>> {
    const normalizedState = options?.state?.trim().toUpperCase();

    if (normalizedState) {
      const params = new URLSearchParams({
        State: normalizedState,
        Qty: String(options?.limit ?? 20),
      });

      const response = await this.request<{
        status: number;
        message: string;
        data?: Array<{
          phone_number: string;
          rate_center?: string;
          state?: string;
          supplier_tier?: number;
          provider?: string;
          rates?: number;
        }>;
      }>('GET', `/searchbystate?${params.toString()}`);

      return (response.data ?? [])
        .filter((number) => {
          if (options?.areaCode && !number.phone_number.startsWith(options.areaCode)) {
            return false;
          }

          if (options?.contains && !number.phone_number.includes(options.contains)) {
            return false;
          }

          return true;
        })
        .map((number) => ({
        phoneNumber: number.phone_number,
        formattedNumber: this.formatPhoneNumber(number.phone_number),
        capabilities: { sms: true, mms: true, voice: false },
        monthlyPrice: number.rates ?? 0,
        }));
    }

    if (options?.areaCode) {
      const params = new URLSearchParams({
        NPA: options.areaCode,
        Qty: String(options.limit ?? 20),
      });

      const response = await this.request<{
        status: number;
        message: string;
        data?: Array<{
          phone_number: string;
          rate_center?: string;
          state?: string;
          supplier_tier?: number;
          provider?: string;
          rates?: number;
        }>;
      }>('GET', `/searchbynpa?${params.toString()}`);

      return (response.data ?? [])
        .filter((number) => {
          if (!number.phone_number.startsWith(options.areaCode!)) {
            return false;
          }

          if (options?.contains && !number.phone_number.includes(options.contains)) {
            return false;
          }

          return true;
        })
        .map((number) => ({
          phoneNumber: number.phone_number,
          formattedNumber: this.formatPhoneNumber(number.phone_number),
          capabilities: { sms: true, mms: true, voice: false },
          monthlyPrice: number.rates ?? 0,
        }));
    }

    throw new ExternalServiceError(
      'Signalmash',
      'Search requires either a state or area code'
    );
  }

  /**
   * Purchase a phone number
   */
  async purchaseNumber(
    phoneNumber: string,
    campaignId: string
  ): Promise<{
    numberId: string;
    phoneNumber: string;
    status: string;
  }> {
    const did = this.formatSmsEndpointPhone(phoneNumber);
    const purchaseResult = await this.requestForm<LegacyNumberPurchaseResult>(
      'POST',
      '/buy',
      new URLSearchParams({
        DID: did,
      })
    );

    const purchasedDid = purchaseResult.result?.[0]?.did ?? did;

    if ((purchaseResult.status ?? 500) >= 400 || purchaseResult.error_code === 0) {
      throw new ExternalServiceError(
        'Signalmash',
        purchaseResult.error?.message ||
          purchaseResult.message ||
          `Number purchase failed for DID ${did}`
      );
    }

    const enableSmsResult = await this.requestForm<LegacyEnableSmsResult>(
      'POST',
      '/enablesms',
      new URLSearchParams({
        DID: purchasedDid,
        CampaignId: campaignId,
      })
    );

    if ((enableSmsResult.status ?? 500) >= 400) {
      throw new ExternalServiceError(
        'Signalmash',
        enableSmsResult.error?.message ||
          enableSmsResult.message ||
          `SMS enablement failed for DID ${purchasedDid}`
      );
    }

    const setConnectionResult = await this.requestForm<LegacySetConnectionResult>(
      'PUT',
      '/setConnection',
      new URLSearchParams({
        DID: purchasedDid,
        ConnectionKey: SignalmashService.PURCHASE_CONNECTION_KEY,
      })
    );

    if ((setConnectionResult.status ?? 200) >= 400) {
      throw new ExternalServiceError(
        'Signalmash',
        setConnectionResult.error?.message ||
          setConnectionResult.message ||
          `Connection assignment failed for DID ${purchasedDid}`
      );
    }

    return {
      numberId: purchasedDid,
      phoneNumber: purchasedDid,
      status: 'active',
    };
  }

  /**
   * Release a phone number
   */
  async releaseNumber(numberId: string): Promise<void> {
    await this.requestForm(
      'POST',
      '/disconnect',
      new URLSearchParams({
        DID: this.formatSmsEndpointPhone(numberId),
      })
    );
  }

  /**
   * Configure webhook for a number
   */
  async configureWebhook(
    numberId: string,
    webhookUrl: string
  ): Promise<void> {
    logger.info(
      { numberId, webhookUrl },
      'Skipping per-number Signalmash webhook configuration; account-level webhook subscription is used instead'
    );
  }

  async runConnectionDiagnostic(): Promise<SignalmashConnectionDiagnostic> {
    const signalmashConfig = await this.getConfig();
    const requestUrl = `${signalmashConfig.apiUrl}/searchbystate?State=NJ&Qty=1`;

    if (!signalmashConfig.apiKey) {
      return {
        testedAt: new Date().toISOString(),
        method: 'GET',
        requestUrl,
        status: null,
        ok: false,
        responseBody: 'API key not configured',
      };
    }

    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': signalmashConfig.apiKey,
        },
      });

      const responseBody = (await response.text()).slice(0, 500);

      return {
        testedAt: new Date().toISOString(),
        method: 'GET',
        requestUrl,
        status: response.status,
        ok: response.ok,
        responseBody,
      };
    } catch (error) {
      return {
        testedAt: new Date().toISOString(),
        method: 'GET',
        requestUrl,
        status: null,
        ok: false,
        responseBody: error instanceof Error ? error.message : 'Unknown diagnostic error',
      };
    }
  }
}

export const signalmashService = new SignalmashService();
