// ===========================================
// Signalmash Connect - Integration Contracts
// ===========================================

export type IntegrationPlatform =
  | 'leadconnector'
  | 'shopify'
  | 'hubspot'
  | 'salesforce'
  | 'zoho';

export type MessagingProvider = 'signalmash';

export type IntegrationConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'pending';

export type IntegrationLifecycleState =
  | 'installed'
  | 'business_details_needed'
  | 'connection_pending'
  | 'brand_pending'
  | 'campaign_pending'
  | 'campaign_approved'
  | 'number_setup_required'
  | 'port_in_progress'
  | 'provider_not_activated'
  | 'ready'
  | 'error_attention_required';

export type ExternalResourceKind =
  | 'platform_installation'
  | 'provider_connection'
  | 'brand'
  | 'campaign'
  | 'phone_number'
  | 'message'
  | 'contact'
  | 'conversation'
  | 'port_order';

export type ExternalResourceStatus =
  | 'pending'
  | 'active'
  | 'disabled'
  | 'failed'
  | 'archived';

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  scope?: string;
  platformAccountId?: string;
  companyId?: string;
  userId?: string;
  userType?: string;
}

export interface PlatformAccountProfile {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  website?: string;
  metadata?: Record<string, unknown>;
}

export interface OutboundMessagePayload {
  messageId?: string;
  conversationId?: string;
  contactId?: string;
  from?: string;
  to: string;
  body: string;
  mediaUrls?: string[];
  metadata?: Record<string, unknown>;
}

export interface ParsedOutboundMessage {
  providerMessageId: string;
  accountId: string;
  conversationId?: string;
  contactId?: string;
  from?: string;
  to?: string;
  body: string;
  mediaUrls?: string[];
  rawPayload: unknown;
}

export interface InboundMessagePayload {
  externalMessageId: string;
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
  occurredAt: Date;
  contactId?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface MessageStatusUpdate {
  externalMessageId: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'received';
  errorCode?: string;
  errorMessage?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

export interface PlatformContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformContactUpdate {
  dnd?: boolean;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformAdapterConnection {
  id: string;
  organizationId: string;
  platform: IntegrationPlatform;
  externalAccountId: string;
  externalAccountName?: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface AvailablePhoneNumber {
  phoneNumber: string;
  formattedNumber: string;
  monthlyPrice: number;
  capabilities: {
    sms: boolean;
    mms: boolean;
    voice: boolean;
  };
  metadata?: Record<string, unknown>;
}

export interface MessagingProviderConnectionConfig {
  externalAccountId: string;
  friendlyName?: string;
  webhookBaseUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface MessagingProviderAdapter {
  readonly provider: MessagingProvider;

  createConnection?(input: MessagingProviderConnectionConfig): Promise<{
    externalConnectionId: string;
    metadata?: Record<string, unknown>;
  }>;

  configureWebhooks?(input: {
    connectionId: string;
    callbackBaseUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  registerBrand(input: Record<string, unknown>): Promise<{
    externalBrandId: string;
    secondaryBrandId?: string;
    status: string;
    metadata?: Record<string, unknown>;
  }>;

  registerCampaign(input: Record<string, unknown>): Promise<{
    externalCampaignId: string;
    secondaryCampaignId?: string;
    status: string;
    metadata?: Record<string, unknown>;
  }>;

  searchAvailableNumbers(input: Record<string, unknown>): Promise<AvailablePhoneNumber[]>;

  buyNumber(input: {
    phoneNumber: string;
    campaignId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    externalNumberId: string;
    metadata?: Record<string, unknown>;
  }>;

  enableSms?(input: {
    phoneNumber: string;
    campaignId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  disableSms?(input: {
    phoneNumber: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  releaseNumber?(externalNumberId: string): Promise<void>;

  sendMessage(input: OutboundMessagePayload): Promise<{
    externalMessageId: string;
    status: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface PlatformAdapter {
  readonly platform: IntegrationPlatform;

  getAuthorizationUrl(state: string, redirectUri: string): string | Promise<string>;
  exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokenSet>;
  refreshTokens(refreshToken: string): Promise<OAuthTokenSet>;
  getAccountInfo(
    accessToken: string,
    platformAccountId?: string,
    companyId?: string
  ): Promise<PlatformAccountProfile>;

  verifyWebhookSignature?(
    payload: string,
    signatures: {
      xGhlSignature?: string;
      xWhSignature?: string;
    }
  ): boolean;

  parseOutboundWebhook?(payload: unknown): ParsedOutboundMessage | null;
  parseInboundMessage?(payload: unknown): InboundMessagePayload | null;
  parseStatusUpdate?(payload: unknown): MessageStatusUpdate | null;

  addInboundMessage?(
    connection: PlatformAdapterConnection,
    message: InboundMessagePayload
  ): Promise<{ externalMessageId: string }>;

  updateMessageStatus?(
    connection: PlatformAdapterConnection,
    externalMessageId: string,
    status: string,
    options?: {
      error?: {
        message: string;
        code?: string;
      };
    }
  ): Promise<void>;

  getContactByPhone?(
    connection: PlatformAdapterConnection,
    phoneNumber: string
  ): Promise<PlatformContact | null>;

  createContact?(
    connection: PlatformAdapterConnection,
    data: {
      phone: string;
      firstName?: string;
      lastName?: string;
      email?: string;
    }
  ): Promise<{ id: string }>;

  getOrCreateConversation?(
    connection: PlatformAdapterConnection,
    contactId: string
  ): Promise<string>;

  updateContactPreferences?(
    connection: PlatformAdapterConnection,
    contactId: string,
    update: PlatformContactUpdate
  ): Promise<void>;
}
