// ===========================================
// Signalmash API Service
// ===========================================

import { config } from '../config/index.js';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { decrypt } from '../utils/crypto.js';
import { ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isSmsAlreadyEnabledMessage } from './signalmash-sms-enablement.service.js';
import {
  CAMPAIGN_SUB_USE_CASE_VALUES,
  CAMPAIGN_USE_CASES_REQUIRING_SUB_USE_CASES,
  retry,
} from '@signalmash-connect/shared';
import { createHash } from 'crypto';

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
  providerCode?: string;
  verificationScore?: number;
  message?: string;
}

interface RawBrandRegistrationResult {
  brandId?: string;
  tcrBrandId?: string;
  tcr_brand_id?: string;
  status?: string | number;
  verificationScore?: number;
  verification_score?: number;
  identityStatus?: string;
  identity_status?: string;
  message?: string;
  data?: unknown;
}

interface BrandStatusResult {
  status: string;
  signalmashBrandId?: string;
  displayName?: string;
  tcrBrandId?: string;
  verificationScore?: number;
  rejectionReason?: string;
  referenceId?: string;
  providerCode?: string;
  providerMessage?: string;
}

interface RawBrandStatusResult {
  status?: string | number;
  message?: string;
  brandId?: string;
  tcrBrandId?: string;
  tcr_brand_id?: string;
  verificationScore?: number;
  verification_score?: number;
  rejectionReason?: string;
  rejection_reason?: string;
  referenceId?: string;
  reference_id?: string;
  identityStatus?: string;
  identity_status?: string;
  data?: {
    [key: string]: unknown;
  } | Array<Record<string, unknown>>;
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
  providerCode?: string;
  dailyMessageLimit?: number;
  messagesPerSecond?: number;
  message?: string;
}

interface RawCampaignRegistrationResult {
  campaignId?: string;
  campaign_id?: string;
  signalmashCampaignId?: string;
  campaign_key?: string;
  sm_reference_no?: string;
  tcrCampaignId?: string;
  tcr_campaign_id?: string;
  status?: string | number;
  dailyMessageLimit?: number;
  daily_message_limit?: number;
  messagesPerSecond?: number;
  messages_per_second?: number;
  message?: string;
  campaignStatus?: string;
  campaign_status?: string;
  data?: unknown;
}

interface CampaignStatusResult {
  status: string;
  signalmashCampaignId?: string;
  brandId?: string;
  name?: string;
  tcrCampaignId?: string;
  rejectionReason?: string;
  dailyMessageLimit?: number;
  messagesPerSecond?: number;
  providerCode?: string;
  providerMessage?: string;
}

interface RawCampaignStatusResult {
  status?: string | number;
  message?: string;
  campaignId?: string;
  campaign_id?: string;
  signalmashCampaignId?: string;
  campaign_key?: string;
  sm_reference_no?: string;
  tcrCampaignId?: string;
  tcr_campaign_id?: string;
  rejectionReason?: string;
  rejection_reason?: string;
  dailyMessageLimit?: number;
  daily_message_limit?: number;
  messagesPerSecond?: number;
  messages_per_second?: number;
  campaignStatus?: string;
  campaign_status?: string;
  data?: {
    [key: string]: unknown;
  } | Array<Record<string, unknown>>;
}

interface CampaignUpdateInput extends CampaignRegistrationInput {
  campaignId: string;
}

interface RawCollectionResult {
  status?: string | number;
  message?: string;
  data?: unknown;
}

interface SignalmashListedBrand {
  brandId: string;
  displayName?: string;
  status?: string;
}

interface SignalmashListedCampaign {
  campaignId: string;
  brandId?: string;
  name?: string;
  status?: string;
}

interface SignalmashCampaignQualificationResult {
  qualified: boolean;
  status: string;
  message?: string;
  providerCode?: string;
  eligibleMnoIds?: string[];
  minimumSampleMessages?: number;
  requiresSubscriberOptin?: boolean;
  requiresSubscriberOptout?: boolean;
  requiresSubscriberHelp?: boolean;
  disallowEmbeddedLink?: boolean;
  disallowEmbeddedPhone?: boolean;
  restrictions?: Record<string, unknown>;
  raw: Record<string, unknown>;
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

interface RawNumberInventoryResponse {
  status?: number | string;
  statusCode?: number | string;
  code?: number | string;
  message?: string;
  error?: unknown;
  data?: unknown;
  result?: unknown;
  results?: unknown;
  numbers?: unknown;
  phone_numbers?: unknown;
  phoneNumbers?: unknown;
  dids?: unknown;
  DIDs?: unknown;
  availableNumbers?: unknown;
  available_numbers?: unknown;
}

export interface SignalmashConnectionDiagnostic {
  testedAt: string;
  method: 'GET';
  requestUrl: string;
  status: number | null;
  ok: boolean;
  responseBody: string;
  apiBaseUrl?: string;
  tokenFingerprint?: string;
  balanceStatus?: number | null;
  balanceBody?: string;
  sampleBrandIds?: string[];
  sampleCampaignIds?: string[];
  brandLookup?: {
    requestedId: string;
    found: boolean;
    status?: string;
    message?: string;
  };
  campaignLookup?: {
    requestedId: string;
    found: boolean;
    status?: string;
    message?: string;
  };
}

export class SignalmashService {
  private static readonly PURCHASE_CONNECTION_KEY =
    'XI-ohLkyE_WkXgU-ivW0HNoR9p1-Fg';
  private readonly campaignSubUseCaseValues = new Set<string>(CAMPAIGN_SUB_USE_CASE_VALUES);
  private readonly campaignUseCasesRequiringSubUseCases = new Set<string>(
    CAMPAIGN_USE_CASES_REQUIRING_SUB_USE_CASES
  );

  private readonly brandLifecycleStatuses = new Set([
    'SELF_DECLARED',
    'UNVERIFIED',
    'VERIFIED',
    'VETTED_VERIFIED',
    'REJECTED',
    'DECLINED',
    'FAILED',
    'SUSPENDED',
    'PENDING',
    'PENDING_VERIFICATION',
    'IN_REVIEW',
    'REVIEW',
    'NEEDS_INFO',
    'MANUAL_REVIEW',
  ]);

  private readonly campaignLifecycleStatuses = new Set([
    'APPROVED',
    'ACTIVE',
    'VERIFIED',
    'REJECTED',
    'DECLINED',
    'FAILED',
    'SUSPENDED',
    'EXPIRED',
    'PENDING',
    'PENDING_APPROVAL',
    'SUBMITTED',
    'IN_REVIEW',
    'REVIEW',
    'MANUAL_REVIEW',
    'NEEDS_INFO',
  ]);

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

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private asRecordArray(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item)
      );
    }

    const record = this.asRecord(value);
    return record ? [record] : [];
  }

  private pickString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }

    return undefined;
  }

  private isSmsEnablementCampaignId(value?: string): boolean {
    return /^C[A-Za-z0-9]{6}$/.test(value ?? '');
  }

  private pickSmsEnablementCampaignId(...values: unknown[]): string | undefined {
    for (const value of values) {
      const candidate = this.pickString(value);
      if (candidate && this.isSmsEnablementCampaignId(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private assertSmsEnablementCampaignId(campaignId: string) {
    if (!this.isSmsEnablementCampaignId(campaignId)) {
      throw new ExternalServiceError(
        'Signalmash',
        'SMS enablement requires the provider campaign ID that is exactly 7 characters and starts with C.'
      );
    }
  }

  private getLegacyResultMessage(result: {
    message?: string;
    error?: { message?: string; description?: string };
  }): string | undefined {
    return result.error?.message || result.error?.description || result.message;
  }

  private pickNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return undefined;
  }

  private extractInventoryPhoneNumber(record: Record<string, unknown>): string | undefined {
    return this.pickString(
      record.phone_number,
      record.phoneNumber,
      record.phone,
      record.number,
      record.did,
      record.DID
    );
  }

  private collectNumberInventoryRecords(value: unknown): Record<string, unknown>[] {
    const records = this.asRecordArray(value);
    const inventoryRecords: Record<string, unknown>[] = [];

    for (const record of records) {
      if (this.extractInventoryPhoneNumber(record)) {
        inventoryRecords.push(record);
        continue;
      }

      for (const nested of [
        record.data,
        record.result,
        record.results,
        record.numbers,
        record.phone_numbers,
        record.phoneNumbers,
        record.dids,
        record.DIDs,
        record.availableNumbers,
        record.available_numbers,
      ]) {
        inventoryRecords.push(...this.collectNumberInventoryRecords(nested));
      }
    }

    return inventoryRecords;
  }

  private normalizeInventoryPhoneDigits(phoneNumber: string): string {
    const digits = phoneNumber.replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  }

  private isEmptyNumberInventoryMessage(message?: string): boolean {
    if (!message?.trim()) {
      return false;
    }

    return /no\s+(?:did'?s?|phone\s+numbers?|numbers?|result|results)\s+found/i.test(message);
  }

  private assertNumberInventoryResponseSucceeded(response: RawNumberInventoryResponse): void {
    const error = this.asRecord(response.error);
    const providerStatus = this.pickNumber(response.status, response.statusCode, response.code);
    const providerMessage = this.pickString(
      response.message,
      response.error,
      error?.message,
      error?.description
    );

    if (
      providerStatus !== undefined &&
      providerStatus >= 400 &&
      !this.isEmptyNumberInventoryMessage(providerMessage)
    ) {
      throw new ExternalServiceError(
        'Signalmash',
        providerMessage
          ? `Number inventory search failed: ${providerMessage}`
          : `Number inventory search failed with provider status ${providerStatus}`
      );
    }
  }

  private mapNumberInventoryResponse(
    response: RawNumberInventoryResponse,
    options?: {
      areaCode?: string;
      contains?: string;
    }
  ): Array<{
    phoneNumber: string;
    formattedNumber: string;
    capabilities: { sms: boolean; mms: boolean; voice: boolean };
    monthlyPrice: number;
  }> {
    this.assertNumberInventoryResponseSucceeded(response);

    const records = this.collectNumberInventoryRecords(response);
    const areaCode = options?.areaCode?.replace(/\D/g, '');
    const contains = options?.contains?.replace(/\D/g, '');
    const hasNonEmptyPayload = [
      response.data,
      response.result,
      response.results,
      response.numbers,
      response.phone_numbers,
      response.phoneNumbers,
      response.dids,
      response.DIDs,
      response.availableNumbers,
      response.available_numbers,
    ].some((value) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return !!this.asRecord(value);
    });

    if (records.length === 0 && hasNonEmptyPayload) {
      logger.warn(
        {
          status: response.status,
          message: response.message,
          responseKeys: Object.keys(response),
        },
        'Signalmash number inventory response did not contain parseable DID records'
      );
    }

    return records.flatMap((record) => {
      const rawPhoneNumber = this.extractInventoryPhoneNumber(record);
      if (!rawPhoneNumber) {
        return [];
      }

      const nationalDigits = this.normalizeInventoryPhoneDigits(rawPhoneNumber);
      if (areaCode && !nationalDigits.startsWith(areaCode)) {
        return [];
      }

      if (contains && !nationalDigits.includes(contains)) {
        return [];
      }

      const phoneNumber = nationalDigits.length === 10 ? nationalDigits : rawPhoneNumber;

      return [{
        phoneNumber,
        formattedNumber: this.formatPhoneNumber(phoneNumber),
        capabilities: { sms: true, mms: true, voice: false },
        monthlyPrice: this.pickNumber(
          record.rates,
          record.rate,
          record.monthlyPrice,
          record.monthly_price,
          record.monthlyRate,
          record.monthly_rate,
          record.price
        ) ?? 0,
      }];
    });
  }

  private normalizeProviderCode(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    return undefined;
  }

  private normalizeLifecycleCandidate(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return undefined;
    }

    return value.trim().replace(/[\s-]+/g, '_').toUpperCase();
  }

  private resolveBrandLifecycleStatus(
    detail: Record<string, unknown> | null,
    result?: Pick<RawBrandRegistrationResult & RawBrandStatusResult, 'status' | 'identityStatus' | 'identity_status'>,
    fallback = 'PENDING_VERIFICATION'
  ): string {
    const candidates = [
      detail?.identityStatus,
      detail?.identity_status,
      detail?.status,
      result?.identityStatus,
      result?.identity_status,
      result?.status,
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeLifecycleCandidate(candidate);
      if (normalized && this.brandLifecycleStatuses.has(normalized)) {
        return normalized;
      }
    }

    return fallback;
  }

  private resolveCampaignLifecycleStatus(
    detail: Record<string, unknown> | null,
    result?: Pick<RawCampaignRegistrationResult & RawCampaignStatusResult, 'status' | 'campaignStatus' | 'campaign_status'>,
    fallback = 'PENDING_APPROVAL'
  ): string {
    const candidates = [
      detail?.campaignStatus,
      detail?.campaign_status,
      detail?.approvalStatus,
      detail?.approval_status,
      detail?.status,
      result?.campaignStatus,
      result?.campaign_status,
      result?.status,
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeLifecycleCandidate(candidate);
      if (normalized && this.campaignLifecycleStatuses.has(normalized)) {
        return normalized;
      }
    }

    return fallback;
  }

  private normalizeProviderMessage(message?: string): string | undefined {
    if (!message?.trim()) {
      return undefined;
    }

    if (/fetched successfully/i.test(message)) {
      return undefined;
    }

    return message.trim();
  }

  private responseSignalsNoResult(status: unknown, message?: string): boolean {
    const numericStatus = this.pickNumber(status);
    if (numericStatus !== undefined && numericStatus >= 400) {
      return true;
    }

    return typeof message === 'string' && /no result found/i.test(message);
  }

  private brandDetailFromStatusResult(result: RawBrandStatusResult): Record<string, unknown> | null {
    const records = this.asRecordArray(result.data);
    if (records.length > 0) {
      return records[0];
    }

    return this.asRecord(result.data);
  }

  private campaignDetailFromStatusResult(result: RawCampaignStatusResult): Record<string, unknown> | null {
    const records = this.asRecordArray(result.data);
    if (records.length > 0) {
      return records[0];
    }

    return this.asRecord(result.data);
  }

  private tokenFingerprint(apiKey: string): string {
    const digest = createHash('sha256').update(apiKey).digest('hex');
    return `${digest.slice(0, 8)}...${digest.slice(-6)}`;
  }

  private normalizeCampaignUseCaseKey(useCase: string): string {
    const normalized = useCase.trim().replace(/[\s-]+/g, '_').toLowerCase();
    const aliases: Record<string, string> = {
      '2fa': 'two_factor_auth',
      account_notification: 'account_notifications',
      delivery_notification: 'delivery_notifications',
      fraud_alert: 'fraud_alerts',
      security_alert: 'security_alerts',
    };

    return aliases[normalized] ?? normalized;
  }

  private mapCampaignUseCase(useCase: string): string {
    const mappings: Record<string, string> = {
      two_factor_auth: '2FA',
      account_notifications: 'ACCOUNT_NOTIFICATION',
      customer_care: 'CUSTOMER_CARE',
      delivery_notifications: 'DELIVERY_NOTIFICATION',
      fraud_alerts: 'FRAUD_ALERT',
      higher_education: 'HIGHER_EDUCATION',
      low_volume: 'LOW_VOLUME',
      marketing: 'MARKETING',
      mixed: 'MIXED',
      polling_voting: 'POLLING_VOTING',
      public_service_announcement: 'PUBLIC_SERVICE_ANNOUNCEMENT',
      security_alerts: 'SECURITY_ALERT',
    };

    const normalizedUseCase = this.normalizeCampaignUseCaseKey(useCase);
    return mappings[normalizedUseCase] ?? useCase;
  }

  private buildProviderCampaignSubUseCases(
    useCase: string,
    subUsecases?: string[]
  ): string[] {
    const normalizedUseCase = this.normalizeCampaignUseCaseKey(useCase);
    const normalizedSubUsecases = Array.from(
      new Set(
        (subUsecases ?? [])
          .map((value) => this.normalizeCampaignUseCaseKey(value))
          .filter((value) => this.campaignSubUseCaseValues.has(value))
      )
    );

    if (this.campaignUseCasesRequiringSubUseCases.has(normalizedUseCase)) {
      return normalizedSubUsecases.map((value) => this.mapCampaignUseCase(value));
    }

    const effectiveSubUsecases =
      normalizedSubUsecases.length > 0 ? normalizedSubUsecases : [normalizedUseCase];

    return effectiveSubUsecases.map((value) => this.mapCampaignUseCase(value));
  }

  private buildCampaignRegistrationPayload(
    input: CampaignRegistrationInput | CampaignUpdateInput
  ): Record<string, unknown> {
    const [sample1, sample2, sample3, sample4, sample5] = input.sampleMessages;
    const isCampaignUpdate = 'campaignId' in input;

    return {
      brandId: input.brandId,
      usecase: this.mapCampaignUseCase(input.useCase),
      subUsecases: this.buildProviderCampaignSubUseCases(input.useCase, input.subUsecases),
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
      referenceId:
        input.referenceId ??
        input.name ??
        (isCampaignUpdate ? input.campaignId : `campaign-${Date.now()}`),
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
    };
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

          if (endpoint === '/registerbrand' || endpoint === '/registercampaign' || endpoint.startsWith('/updateCampaign')) {
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

    const detail = this.asRecord(result.data);
    const lifecycleStatus = this.resolveBrandLifecycleStatus(detail, result);
    const providerCode = this.normalizeProviderCode(result.status);

    logger.info(
      { brandId: result.brandId, status: lifecycleStatus, providerCode },
      'Brand registered with Signalmash'
    );

    return {
      brandId: result.brandId,
      tcrBrandId: result.tcrBrandId ?? result.tcr_brand_id,
      status: lifecycleStatus,
      providerCode,
      verificationScore: this.pickNumber(
        result.verificationScore,
        result.verification_score,
        detail?.verificationScore,
        detail?.verification_score
      ),
      message: result.message,
    };
  }

  /**
   * Get brand status
   */
  async getBrandStatus(brandId: string): Promise<BrandStatusResult> {
    const result = await this.request<RawBrandStatusResult>(
      'GET',
      `/brand?brandId=${encodeURIComponent(brandId)}`
    );
    const data = this.brandDetailFromStatusResult(result);
    const providerMessage = this.normalizeProviderMessage(result.message);

    if (this.responseSignalsNoResult(result.status, result.message)) {
      throw new ExternalServiceError(
        'Signalmash',
        providerMessage ?? 'No Result Found!'
      );
    }

    return {
      status: this.resolveBrandLifecycleStatus(data, result, 'UNKNOWN'),
      signalmashBrandId: this.pickString(data?.brandId, data?.brand_id, result.brandId, brandId),
      displayName: this.pickString(
        data?.displayName,
        data?.display_name,
        data?.brandName,
        data?.brand_name,
      ),
      tcrBrandId: this.pickString(data?.tcrBrandId, data?.tcr_brand_id, result.tcrBrandId, result.tcr_brand_id),
      verificationScore: this.pickNumber(
        data?.verificationScore,
        data?.verification_score,
        result.verificationScore,
        result.verification_score
      ),
      rejectionReason: this.pickString(
        data?.rejectionReason,
        data?.rejection_reason,
        result.rejectionReason,
        result.rejection_reason
      ),
      referenceId: this.pickString(data?.referenceId, data?.reference_id, result.referenceId, result.reference_id),
      providerCode: this.normalizeProviderCode(result.status),
      providerMessage,
    };
  }

  /**
   * Register a campaign
   */
  async registerCampaign(input: CampaignRegistrationInput): Promise<CampaignRegistrationResult> {
    logger.info({ name: input.name, brandId: input.brandId }, 'Registering campaign with Signalmash');

    const payload = this.buildCampaignRegistrationPayload(input);

    const result = await this.request<RawCampaignRegistrationResult>(
      'POST',
      '/registercampaign',
      payload
    );
    const detail = this.asRecord(result.data);
    const campaignId = this.pickString(
      result.sm_reference_no,
      result.campaign_key,
      detail?.sm_reference_no,
      detail?.campaign_key,
      result.campaignId,
      result.campaign_id,
      detail?.campaignId,
      detail?.campaign_id
    );

    if ((typeof result.status === 'number' && result.status >= 400) || !campaignId) {
      throw new ExternalServiceError(
        'Signalmash',
        result.message || 'Campaign registration did not return a campaign ID'
      );
    }

    const lifecycleStatus = this.resolveCampaignLifecycleStatus(detail, result);
    const providerCode = this.normalizeProviderCode(result.status);

    logger.info(
      { campaignId, status: lifecycleStatus, providerCode },
      'Campaign registered with Signalmash'
    );

    return {
      campaignId,
      tcrCampaignId: this.pickSmsEnablementCampaignId(
        result.tcrCampaignId,
        result.tcr_campaign_id,
        detail?.tcrCampaignId,
        detail?.tcr_campaign_id,
        result.signalmashCampaignId,
        result.campaign_id,
        result.campaignId,
        detail?.signalmashCampaignId,
        detail?.campaign_id,
        detail?.campaignId
      ),
      status: lifecycleStatus,
      providerCode,
      dailyMessageLimit: this.pickNumber(
        result.dailyMessageLimit,
        result.daily_message_limit,
        detail?.dailyMessageLimit,
        detail?.daily_message_limit
      ),
      messagesPerSecond: this.pickNumber(
        result.messagesPerSecond,
        result.messages_per_second,
        detail?.messagesPerSecond,
        detail?.messages_per_second
      ),
      message: result.message,
    };
  }

  async updateCampaign(input: CampaignUpdateInput): Promise<CampaignRegistrationResult> {
    logger.info({ campaignId: input.campaignId, brandId: input.brandId }, 'Updating campaign with Signalmash');

    const payload = this.buildCampaignRegistrationPayload(input);

    const result = await this.request<RawCampaignRegistrationResult>(
      'PUT',
      `/updateCampaign?campaignId=${encodeURIComponent(input.campaignId)}`,
      payload
    );
    const detail = this.asRecord(result.data);
    const campaignId = this.pickString(
      result.sm_reference_no,
      result.campaign_key,
      detail?.sm_reference_no,
      detail?.campaign_key,
      input.campaignId,
      result.campaignId,
      result.campaign_id,
      detail?.campaignId,
      detail?.campaign_id
    );

    if ((typeof result.status === 'number' && result.status >= 400) || !campaignId) {
      throw new ExternalServiceError(
        'Signalmash',
        result.message || 'Campaign update did not return a campaign ID'
      );
    }

    const lifecycleStatus = this.resolveCampaignLifecycleStatus(detail, result);
    const providerCode = this.normalizeProviderCode(result.status);

    logger.info(
      { campaignId, status: lifecycleStatus, providerCode },
      'Campaign updated with Signalmash'
    );

    return {
      campaignId,
      tcrCampaignId: this.pickSmsEnablementCampaignId(
        result.tcrCampaignId,
        result.tcr_campaign_id,
        detail?.tcrCampaignId,
        detail?.tcr_campaign_id,
        result.signalmashCampaignId,
        result.campaign_id,
        result.campaignId,
        detail?.signalmashCampaignId,
        detail?.campaign_id,
        detail?.campaignId
      ),
      status: lifecycleStatus,
      providerCode,
      dailyMessageLimit: this.pickNumber(
        result.dailyMessageLimit,
        result.daily_message_limit,
        detail?.dailyMessageLimit,
        detail?.daily_message_limit
      ),
      messagesPerSecond: this.pickNumber(
        result.messagesPerSecond,
        result.messages_per_second,
        detail?.messagesPerSecond,
        detail?.messages_per_second
      ),
      message: result.message,
    };
  }

  /**
   * Get campaign status
   */
  async getCampaignStatus(campaignId: string): Promise<CampaignStatusResult> {
    const result = await this.request<RawCampaignStatusResult>(
      'GET',
      `/campaignDetails?campaignId=${encodeURIComponent(campaignId)}`
    );
    const data = this.campaignDetailFromStatusResult(result);
    const providerMessage = this.normalizeProviderMessage(result.message);

    if (this.responseSignalsNoResult(result.status, result.message)) {
      throw new ExternalServiceError(
        'Signalmash',
        providerMessage ?? 'No Result Found!'
      );
    }

    return {
      status: this.resolveCampaignLifecycleStatus(data, result, 'UNKNOWN'),
      signalmashCampaignId: this.pickString(
        data?.sm_reference_no,
        data?.campaign_key,
        result.sm_reference_no,
        result.campaign_key,
        data?.campaignId,
        data?.campaign_id,
        result.campaignId,
        campaignId
      ),
      brandId: this.pickString(data?.brandId, data?.brand_id),
      name: this.pickString(
        data?.campaignName,
        data?.campaign_name,
        data?.name,
      ),
      tcrCampaignId: this.pickSmsEnablementCampaignId(
        data?.tcrCampaignId,
        data?.tcr_campaign_id,
        result.tcrCampaignId,
        result.tcr_campaign_id,
        data?.signalmashCampaignId,
        data?.campaign_id,
        data?.campaignId,
        result.signalmashCampaignId,
        result.campaign_id,
        result.campaignId
      ),
      rejectionReason: this.pickString(
        data?.rejectionReason,
        data?.rejection_reason,
        result.rejectionReason,
        result.rejection_reason
      ),
      dailyMessageLimit: this.pickNumber(
        data?.dailyMessageLimit,
        data?.daily_message_limit,
        result.dailyMessageLimit,
        result.daily_message_limit
      ),
      messagesPerSecond: this.pickNumber(
        data?.messagesPerSecond,
        data?.messages_per_second,
        result.messagesPerSecond,
        result.messages_per_second
      ),
      providerCode: this.normalizeProviderCode(result.status),
      providerMessage,
    };
  }

  async qualifyBrandByUseCase(
    brandId: string,
    useCase: string
  ): Promise<SignalmashCampaignQualificationResult> {
    const mappedUseCase = this.mapCampaignUseCase(useCase);
    const result = await this.request<RawCollectionResult>(
      'GET',
      `/qualifyBrandByUsecas?brandId=${encodeURIComponent(brandId)}&usecase=${encodeURIComponent(mappedUseCase)}`
    );

    const detail = this.asRecord(result.data) ?? {};
    const providerCode = this.normalizeProviderCode(result.status);
    const message = this.pickString(
      detail.message,
      detail.reason,
      detail.rejectionReason,
      detail.rejection_reason,
      result.message
    );
    const explicitFlag = [detail.qualified, detail.isQualified, detail.allowed, detail.eligible].find(
      (value) => typeof value === 'boolean'
    ) as boolean | undefined;
    const statusCandidate = this.pickString(
      detail.qualificationStatus,
      detail.qualification_status,
      detail.status,
      result.message
    );
    const mnoEntries = Object.entries(detail)
      .map(([mnoId, value]) => ({ mnoId, value: this.asRecord(value) }))
      .filter(
        (entry): entry is { mnoId: string; value: Record<string, unknown> } =>
          !!entry.value && /^\d+$/.test(entry.mnoId)
      );
    const eligibleMnoIds = mnoEntries
      .filter((entry) => entry.value.qualify === true && entry.value.mnoSupport !== false)
      .map((entry) => entry.mnoId);
    const minimumSampleMessages = mnoEntries.reduce<number | undefined>((currentMinimum, entry) => {
      if (!(entry.value.qualify === true && entry.value.mnoSupport !== false)) {
        return currentMinimum;
      }

      const candidate = this.pickNumber(entry.value.minMsgSamples);
      if (candidate === undefined) {
        return currentMinimum;
      }

      return currentMinimum === undefined ? candidate : Math.max(currentMinimum, candidate);
    }, undefined);
    const isExplicitFailure =
      explicitFlag === false ||
      /unrecognized[_\s-]*usecase/i.test(`${statusCandidate ?? ''} ${message ?? ''}`) ||
      /not[_\s-]*qualified|ineligible|not[_\s-]*eligible|rejected|blocked/i.test(
        `${statusCandidate ?? ''} ${message ?? ''}`
      ) ||
      (mnoEntries.length > 0 && eligibleMnoIds.length === 0);
    const status = isExplicitFailure
      ? /unrecognized[_\s-]*usecase/i.test(`${statusCandidate ?? ''} ${message ?? ''}`)
        ? 'UNRECOGNIZED_USECASE'
        : 'NOT_QUALIFIED'
      : 'QUALIFIED';

    return {
      qualified:
        explicitFlag === undefined
          ? eligibleMnoIds.length > 0 && !isExplicitFailure
          : explicitFlag && !isExplicitFailure,
      status,
      message,
      providerCode,
      eligibleMnoIds,
      minimumSampleMessages,
      requiresSubscriberOptin: mnoEntries.some(
        (entry) => entry.value.qualify === true && entry.value.reqSubscriberOptin === true
      ),
      requiresSubscriberOptout: mnoEntries.some(
        (entry) => entry.value.qualify === true && entry.value.reqSubscriberOptout === true
      ),
      requiresSubscriberHelp: mnoEntries.some(
        (entry) => entry.value.qualify === true && entry.value.reqSubscriberHelp === true
      ),
      disallowEmbeddedLink: mnoEntries.some(
        (entry) => entry.value.qualify === true && entry.value.noEmbeddedLink === true
      ),
      disallowEmbeddedPhone: mnoEntries.some(
        (entry) => entry.value.qualify === true && entry.value.noEmbeddedPhone === true
      ),
      restrictions: Object.keys(detail).length > 0 ? detail : undefined,
      raw: {
        status: result.status ?? null,
        message: result.message ?? null,
        data: result.data ?? null,
      },
    };
  }

  async listBrands(): Promise<SignalmashListedBrand[]> {
    const result = await this.request<RawCollectionResult>('GET', '/getbrands');
    const brands: SignalmashListedBrand[] = [];

    for (const brand of this.asRecordArray(result.data)) {
      const brandId = this.pickString(brand.brandId, brand.brand_id);
      if (!brandId) {
        continue;
      }

      brands.push({
        brandId,
        displayName: this.pickString(brand.displayName, brand.display_name, brand.brand_name),
        status: this.resolveBrandLifecycleStatus(brand, undefined, 'UNKNOWN'),
      });
    }

    return brands;
  }

  async listCampaigns(): Promise<SignalmashListedCampaign[]> {
    const result = await this.request<RawCollectionResult>('GET', '/campaigns');
    const campaigns: SignalmashListedCampaign[] = [];

    for (const campaign of this.asRecordArray(result.data)) {
      const campaignId = this.pickString(
        campaign.sm_reference_no,
        campaign.campaign_key,
        campaign.campaignId,
        campaign.campaign_id
      );
      if (!campaignId) {
        continue;
      }

      campaigns.push({
        campaignId,
        brandId: this.pickString(campaign.brandId, campaign.brand_id),
        name: this.pickString(campaign.campaignName, campaign.campaign_name, campaign.name),
        status: this.resolveCampaignLifecycleStatus(campaign, undefined, 'UNKNOWN'),
      });
    }

    return campaigns;
  }

  async getAccountBalanceDiagnostic(): Promise<{ status: number | null; body: string }> {
    const signalmashConfig = await this.getConfig();
    const requestUrl = `${signalmashConfig.apiUrl}/checkBalance`;

    if (!signalmashConfig.apiKey) {
      return {
        status: null,
        body: 'API key not configured',
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

      return {
        status: response.status,
        body: (await response.text()).slice(0, 500),
      };
    } catch (error) {
      return {
        status: null,
        body: error instanceof Error ? error.message : 'Unknown balance diagnostic error',
      };
    }
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

      const response = await this.request<RawNumberInventoryResponse>(
        'GET',
        `/searchbystate?${params.toString()}`
      );

      return this.mapNumberInventoryResponse(response, options);
    }

    if (options?.areaCode) {
      const params = new URLSearchParams({
        NPA: options.areaCode,
        Qty: String(options.limit ?? 20),
      });

      const response = await this.request<RawNumberInventoryResponse>(
        'GET',
        `/searchbynpa?${params.toString()}`
      );

      return this.mapNumberInventoryResponse(response, options);
    }

    throw new ExternalServiceError(
      'Signalmash',
      'Search requires either a state or area code'
    );
  }

  /**
   * Purchase a phone number
   */
  private async buyDid(phoneNumber: string) {
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

    return purchasedDid;
  }

  private async setPurchasedNumberConnection(purchasedDid: string) {
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
  }

  async enableSmsForNumber(
    phoneNumber: string,
    campaignId: string
  ): Promise<void> {
    this.assertSmsEnablementCampaignId(campaignId);

    const did = this.formatSmsEndpointPhone(phoneNumber);
    let enableSmsResult: LegacyEnableSmsResult | null = null;

    try {
      enableSmsResult = await this.requestForm<LegacyEnableSmsResult>(
        'POST',
        '/enablesms',
        new URLSearchParams({
          DID: did,
          CampaignId: campaignId,
        })
      );
    } catch (error) {
      if (!isSmsAlreadyEnabledMessage(error instanceof Error ? error.message : error)) {
        throw error;
      }

      logger.info(
        { did, campaignId },
        'Signalmash reported SMS was already enabled for DID; continuing idempotently'
      );
    }

    const enableSmsMessage = enableSmsResult
      ? this.getLegacyResultMessage(enableSmsResult)
      : undefined;

    if (enableSmsResult && (enableSmsResult.status ?? 500) >= 400) {
      if (isSmsAlreadyEnabledMessage(enableSmsMessage)) {
        logger.info(
          { did, campaignId },
          'Signalmash reported SMS was already enabled for DID; continuing idempotently'
        );
      } else {
        throw new ExternalServiceError(
          'Signalmash',
          enableSmsMessage ||
            `SMS enablement failed for DID ${did}`
        );
      }
    }

    await this.setPurchasedNumberConnection(did);
  }

  async purchaseNumberWithoutSmsEnablement(
    phoneNumber: string
  ): Promise<{
    numberId: string;
    phoneNumber: string;
    status: string;
  }> {
    const purchasedDid = await this.buyDid(phoneNumber);

    try {
      await this.setPurchasedNumberConnection(purchasedDid);
    } catch (error) {
      try {
        await this.releaseNumber(purchasedDid);
      } catch (releaseError) {
        logger.warn(
          {
            numberId: purchasedDid,
            error: releaseError instanceof Error ? releaseError.message : releaseError,
          },
          'Failed to release purchased DID after connection assignment error'
        );
      }

      throw error;
    }

    return {
      numberId: purchasedDid,
      phoneNumber: purchasedDid,
      status: 'active',
    };
  }

  async purchaseNumber(
    phoneNumber: string,
    campaignId: string
  ): Promise<{
    numberId: string;
    phoneNumber: string;
    status: string;
  }> {
    this.assertSmsEnablementCampaignId(campaignId);
    const purchasedDid = await this.buyDid(phoneNumber);

    try {
      await this.enableSmsForNumber(purchasedDid, campaignId);
    } catch (error) {
      try {
        await this.releaseNumber(purchasedDid);
      } catch (releaseError) {
        logger.warn(
          {
            numberId: purchasedDid,
            error: releaseError instanceof Error ? releaseError.message : releaseError,
          },
          'Failed to release purchased DID after downstream provisioning error'
        );
      }

      throw error;
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

  async runConnectionDiagnostic(lookups?: {
    brandId?: string;
    campaignId?: string;
  }): Promise<SignalmashConnectionDiagnostic> {
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
        apiBaseUrl: signalmashConfig.apiUrl,
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
      const [balanceDiagnostic, brands, campaigns] = await Promise.all([
        this.getAccountBalanceDiagnostic(),
        this.listBrands().catch(() => []),
        this.listCampaigns().catch(() => []),
      ]);
      const diagnostic: SignalmashConnectionDiagnostic = {
        testedAt: new Date().toISOString(),
        method: 'GET',
        requestUrl,
        status: response.status,
        ok: response.ok,
        responseBody,
        apiBaseUrl: signalmashConfig.apiUrl,
        tokenFingerprint: this.tokenFingerprint(signalmashConfig.apiKey),
        balanceStatus: balanceDiagnostic.status,
        balanceBody: balanceDiagnostic.body,
        sampleBrandIds: brands.slice(0, 10).map((brand) => brand.brandId),
        sampleCampaignIds: campaigns.slice(0, 10).map((campaign) => campaign.campaignId),
      };

      if (lookups?.brandId?.trim()) {
        try {
          const brand = await this.getBrandStatus(lookups.brandId.trim());
          diagnostic.brandLookup = {
            requestedId: lookups.brandId.trim(),
            found: true,
            status: brand.status,
            message: brand.providerMessage ?? brand.rejectionReason,
          };
        } catch (error) {
          diagnostic.brandLookup = {
            requestedId: lookups.brandId.trim(),
            found: false,
            message: error instanceof Error ? error.message : 'Unknown lookup failure',
          };
        }
      }

      if (lookups?.campaignId?.trim()) {
        try {
          const campaign = await this.getCampaignStatus(lookups.campaignId.trim());
          diagnostic.campaignLookup = {
            requestedId: lookups.campaignId.trim(),
            found: true,
            status: campaign.status,
            message: campaign.providerMessage ?? campaign.rejectionReason,
          };
        } catch (error) {
          diagnostic.campaignLookup = {
            requestedId: lookups.campaignId.trim(),
            found: false,
            message: error instanceof Error ? error.message : 'Unknown lookup failure',
          };
        }
      }

      return diagnostic;
    } catch (error) {
      return {
        testedAt: new Date().toISOString(),
        method: 'GET',
        requestUrl,
        status: null,
        ok: false,
        responseBody: error instanceof Error ? error.message : 'Unknown diagnostic error',
        apiBaseUrl: signalmashConfig.apiUrl,
        tokenFingerprint: this.tokenFingerprint(signalmashConfig.apiKey),
      };
    }
  }
}

export const signalmashService = new SignalmashService();
