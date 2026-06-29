// ===========================================
// Signalmash Connect - Shared Types
// ===========================================

// Platform Types
export type Platform = 'leadconnector' | 'shopify' | 'hubspot' | 'salesforce' | 'zoho';

export type PlatformStatus = 'connected' | 'disconnected' | 'error' | 'pending';

// Organization Types
export interface Organization {
  id: string;
  name: string;
  email: string;
  phone?: string;
  website?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationCreateInput {
  name: string;
  email: string;
  phone?: string;
  website?: string;
}

// User Types
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  organizationId: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 'owner' | 'admin' | 'member';

export interface UserCreateInput {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  organizationId: string;
  role?: UserRole;
}

// Brand Registration Types
export type BrandStatus =
  | 'draft'
  | 'pending_verification'
  | 'verified'
  | 'unverified'
  | 'rejected'
  | 'suspended';

export type EntityType =
  | 'sole_proprietor'
  | 'partnership'
  | 'corporation'
  | 'llc'
  | 'non_profit'
  | 'government';

export type BusinessVertical =
  | 'retail'
  | 'healthcare'
  | 'financial'
  | 'education'
  | 'hospitality'
  | 'real_estate'
  | 'technology'
  | 'professional_services'
  | 'other';

export interface Brand {
  id: string;
  organizationId: string;
  legalName: string;
  displayName: string;
  ein?: string;
  entityType: EntityType;
  vertical: BusinessVertical;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  website: string;
  phone: string;
  email: string;

  // Signalmash/TCR specific
  signalmashBrandId?: string;
  tcrBrandId?: string;
  status: BrandStatus;
  verificationScore?: number;
  rejectionReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface BrandCreateInput {
  organizationId: string;
  legalName: string;
  displayName: string;
  ein?: string;
  entityType: EntityType;
  vertical: BusinessVertical;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  website: string;
  phone: string;
  email: string;
}

// Campaign Types
export type CampaignStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'expired';

export type CampaignUseCase =
  | '2fa'
  | 'account_notifications'
  | 'customer_care'
  | 'delivery_notifications'
  | 'fraud_alerts'
  | 'higher_education'
  | 'low_volume'
  | 'marketing'
  | 'mixed'
  | 'polling_voting'
  | 'public_service_announcement'
  | 'security_alerts';

export interface Campaign {
  id: string;
  organizationId: string;
  brandId: string;
  name: string;
  description: string;
  useCase: CampaignUseCase;
  sampleMessages: string[];

  // Opt-in details
  optInKeywords: string[];
  optOutKeywords: string[];
  helpKeywords: string[];
  optInMessage: string;
  optOutMessage: string;
  helpMessage: string;

  // Signalmash/TCR specific
  signalmashCampaignId?: string;
  tcrCampaignId?: string;
  status: CampaignStatus;
  rejectionReason?: string;

  // Throughput
  dailyMessageLimit?: number;
  messagesPerSecond?: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignCreateInput {
  organizationId: string;
  brandId: string;
  name: string;
  description: string;
  useCase: CampaignUseCase;
  sampleMessages: string[];
  optInKeywords?: string[];
  optOutKeywords?: string[];
  helpKeywords?: string[];
  optInMessage?: string;
  optOutMessage?: string;
  helpMessage?: string;
}

// Platform Connection Types
export interface PlatformConnection {
  id: string;
  organizationId: string;
  platform: Platform;
  platformAccountId: string;
  platformAccountName?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes: string[];
  webhookUrl?: string;
  status: PlatformStatus;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformConnectionCreateInput {
  organizationId: string;
  platform: Platform;
  platformAccountId: string;
  platformAccountName?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes: string[];
}

// Phone Number Types
export type PhoneNumberStatus = 'active' | 'pending' | 'suspended' | 'released';

export interface PhoneNumber {
  id: string;
  organizationId: string;
  campaignId?: string;
  phoneNumber: string;
  formattedNumber: string;
  capabilities: PhoneNumberCapabilities;
  signalmashNumberId?: string;
  status: PhoneNumberStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface PhoneNumberCapabilities {
  sms: boolean;
  mms: boolean;
  voice: boolean;
}

// Message Types
export type MessageDirection = 'inbound' | 'outbound';

export type MessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'undelivered'
  | 'received';

export type MessageType = 'sms' | 'mms';

export interface Message {
  id: string;
  organizationId: string;
  platformConnectionId?: string;
  campaignId?: string;
  phoneNumberId?: string;

  direction: MessageDirection;
  type: MessageType;
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];

  status: MessageStatus;
  errorCode?: string;
  errorMessage?: string;

  // External IDs
  signalmashMessageId?: string;
  platformMessageId?: string;
  platformConversationId?: string;

  // Timestamps
  sentAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export * from './integration.js';

export interface MessageSendInput {
  organizationId: string;
  platformConnectionId?: string;
  campaignId?: string;
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
}

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
}

// Pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Webhook Types
export interface WebhookEvent {
  id: string;
  type: string;
  platform: Platform;
  payload: Record<string, unknown>;
  processedAt?: Date;
  createdAt: Date;
}

// OAuth Types
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  scope?: string;
}

export interface OAuthState {
  platform: Platform;
  organizationId?: string;
  redirectUri: string;
  nonce: string;
}

// CRM platform-specific types
export interface CrmLocation {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface CrmConversation {
  id: string;
  locationId: string;
  contactId: string;
  type: string;
  lastMessageDate?: Date;
}

export interface CrmContact {
  id: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

// Dashboard Stats
export interface DashboardStats {
  totalMessages: number;
  messagesSent: number;
  messagesReceived: number;
  messagesDelivered: number;
  messagesFailed: number;
  deliveryRate: number;
  connectedPlatforms: number;
  activeCampaigns: number;
}

export interface MessageStats {
  date: string;
  sent: number;
  delivered: number;
  failed: number;
}
