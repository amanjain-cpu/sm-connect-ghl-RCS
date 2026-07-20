// ===========================================
// API Client
// ===========================================

import { safeGetItem, safeRemoveItem, safeSetItem } from './storage';
import { sanitizePlatformBranding } from './platform-branding';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const crmPlatformId = `${'lead'}connector` as const;
const crmPublicPlatformId = 'crm' as const;

function getPublicPlatformId(platform: string): string {
  return platform === crmPlatformId ? crmPublicPlatformId : platform;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.accessToken = safeGetItem('accessToken');
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
    if (token) {
      safeSetItem('accessToken', token);
    } else {
      safeRemoveItem('accessToken');
    }
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Set tokens from OAuth callback (SSO flow)
   */
  setTokensFromOAuth(accessToken: string, refreshToken: string) {
    this.setAccessToken(accessToken);
    safeSetItem('refreshToken', refreshToken);
  }

  /**
   * Get the OAuth URL for a platform
   */
  async initiateOAuth(platform: string) {
    return this.get<{ authUrl: string }>(`/platforms/${getPublicPlatformId(platform)}/oauth`);
  }

  async exchangeEmbeddedSso(encryptedData: string) {
    return this.post<{
      user: any;
      organization: any;
      tokens: { accessToken: string; refreshToken: string; expiresIn: number };
      locationId: string;
    }>(`/platforms/${crmPublicPlatformId}/sso/exchange`, { encryptedData });
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    canAttemptRefresh = true
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers,
      });
    } catch (error) {
      throw new ApiError(
        sanitizePlatformBranding(error instanceof Error ? error.message : 'Network request failed'),
        'NETWORK_ERROR',
        0
      );
    }

    const responseText = await response.text();
    let data: any = {};

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        const responseType = response.headers.get('content-type') || 'unknown content-type';
        const responsePreview = responseText.slice(0, 160).replace(/\s+/g, ' ').trim();

        throw new ApiError(
          sanitizePlatformBranding(
            response.ok
            ? `API returned an invalid ${responseType} response instead of JSON.`
            : `API request failed with a non-JSON ${responseType} response (${response.status}). ${responsePreview}`
          ),
          'INVALID_API_RESPONSE',
          response.status || 0
        );
      }
    }

    if (!response.ok) {
      // Handle 401 - token expired
      if (response.status === 401 && canAttemptRefresh && endpoint !== '/auth/refresh') {
        // Try to refresh token
        const refreshToken = safeGetItem('refreshToken');
        try {
          const refreshResponse = await this.refreshToken(refreshToken ?? undefined);
          if (refreshResponse.success && refreshResponse.data) {
            this.setAccessToken(refreshResponse.data.accessToken);
            safeSetItem('refreshToken', refreshResponse.data.refreshToken);
            // Retry original request
            return this.request<T>(endpoint, options, false);
          }
        } catch {
          this.setAccessToken(null);
          safeRemoveItem('refreshToken');
        }
      }

      throw new ApiError(
        sanitizePlatformBranding(data.error?.message || 'An error occurred'),
        data.error?.code || 'UNKNOWN_ERROR',
        response.status,
        data.error?.details
      );
    }

    return data;
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  // Auth endpoints
  async login(email: string, password: string) {
    const response = await this.post<{
      user: any;
      organization: any;
      tokens: { accessToken: string; refreshToken: string; expiresIn: number };
    }>('/auth/login', { email, password });

    if (response.success && response.data) {
      this.setAccessToken(response.data.tokens.accessToken);
      safeSetItem('refreshToken', response.data.tokens.refreshToken);
    }

    return response;
  }

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    organizationName: string;
  }) {
    const response = await this.post<{
      user: any;
      organization: any;
      tokens: { accessToken: string; refreshToken: string; expiresIn: number };
    }>('/auth/register', data);

    if (response.success && response.data) {
      this.setAccessToken(response.data.tokens.accessToken);
      safeSetItem('refreshToken', response.data.tokens.refreshToken);
    }

    return response;
  }

  async refreshToken(refreshToken?: string) {
    return this.post<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>('/auth/refresh', refreshToken ? { refreshToken } : undefined);
  }

  async logout() {
    const refreshToken = safeGetItem('refreshToken');
    try {
      await this.post('/auth/logout', refreshToken ? { refreshToken } : undefined);
    } catch {
      // Ignore errors during logout
    }
    this.setAccessToken(null);
    safeRemoveItem('refreshToken');
  }

  async getMe() {
    return this.get<{ user: any }>('/auth/me');
  }

  // Organization endpoints
  async getOrganization() {
    return this.get<any>('/organization');
  }

  async getOrganizationStats() {
    return this.get<any>('/organization/stats');
  }

  async getOrganizationDashboard() {
    return this.get<any>('/organization/dashboard');
  }

  // Brand endpoints
  async getBrands() {
    return this.get<any[]>('/brands');
  }

  async getBrand(id: string) {
    return this.get<any>(`/brands/${id}`);
  }

  async createBrand(data: any) {
    return this.post<any>('/brands', data);
  }

  async updateBrand(id: string, data: any) {
    return this.put<any>(`/brands/${id}`, data);
  }

  async submitBrand(id: string) {
    return this.post<any>(`/brands/${id}/submit`);
  }

  async refreshBrandStatus(id: string) {
    return this.post<any>(`/brands/${id}/refresh-status`);
  }

  async deleteBrand(id: string) {
    return this.delete(`/brands/${id}`);
  }

  // Campaign endpoints
  async getCampaigns(params?: { brandId?: string; status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.brandId) searchParams.set('brandId', params.brandId);
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return this.get<any[]>(`/campaigns${query ? `?${query}` : ''}`);
  }

  async getCampaign(id: string) {
    return this.get<any>(`/campaigns/${id}`);
  }

  async createCampaign(data: any) {
    return this.post<any>('/campaigns', data);
  }

  async updateCampaign(id: string, data: any) {
    return this.put<any>(`/campaigns/${id}`, data);
  }

  async submitCampaign(id: string, data?: {
    numberLinkIntent?: {
      mode: 'existing';
      phoneNumberId: string;
      friendlyName?: string;
      confirmReassignment?: boolean;
    } | {
      mode: 'buy_new';
      phoneNumber: string;
      friendlyName?: string;
      makeDefaultSender?: boolean;
    };
  }) {
    return this.post<any>(`/campaigns/${id}/submit`, data);
  }

  async linkCampaignPhoneNumber(id: string, data: {
    mode: 'existing';
    phoneNumberId: string;
    friendlyName?: string;
    confirmReassignment?: boolean;
    makeDefaultSender?: boolean;
  } | {
    mode: 'buy_new';
    phoneNumber: string;
    friendlyName?: string;
    makeDefaultSender?: boolean;
  }) {
    return this.post<any>(`/campaigns/${id}/link-number`, data);
  }

  async refreshCampaignStatus(id: string) {
    return this.post<any>(`/campaigns/${id}/refresh-status`);
  }

  async deleteCampaign(id: string) {
    return this.delete(`/campaigns/${id}`);
  }

  // Message endpoints
  async getMessages(params?: Record<string, any>) {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.set(key, String(value));
      });
    }
    const query = searchParams.toString();
    return this.get<any[]>(`/messages${query ? `?${query}` : ''}`);
  }

  async sendMessage(data: { from: string; to: string; body: string; campaignId?: string; phoneNumberId?: string }) {
    return this.post<any>('/messages', data);
  }

  async getMessageStats(params?: { campaignId?: string; startDate?: string; endDate?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.campaignId) searchParams.set('campaignId', params.campaignId);
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    const query = searchParams.toString();
    return this.get<any>(`/messages/stats${query ? `?${query}` : ''}`);
  }

  // Platform endpoints
  async getPlatformConnections() {
    return this.get<any[]>('/platforms');
  }

  async getOAuthUrl(platform: string) {
    return this.get<{ authUrl: string }>(`/platforms/${getPublicPlatformId(platform)}/oauth`);
  }

  async disconnectPlatform(id: string) {
    return this.delete(`/platforms/${id}`);
  }

  async getPlatformReadiness(id: string) {
    return this.get<any>(`/platforms/${id}/readiness`);
  }

  async activatePlatformProvider(id: string, source: 'manual_confirmation' | 'test_send' = 'manual_confirmation') {
    return this.post<any>(`/platforms/${id}/activate-provider`, { source });
  }

  async getBillingSummary() {
    return this.get<any>('/billing/summary');
  }

  async getBillingEvents() {
    return this.get<any[]>('/billing/events');
  }

  async getSubscriptionBillingSummary() {
    return this.get<any>('/billing/subscription');
  }

  async getWalletBillingSummary() {
    return this.get<any>('/billing/wallet');
  }

  async createSubscriptionCheckout(plan: 'starter' | 'growth' | 'scale') {
    return this.post<any>('/billing/subscription/checkout', { plan });
  }

  async completeSubscriptionCheckout(data: { sessionId: string }) {
    return this.post<any>('/billing/subscription/checkout/complete', data);
  }

  async createBillingPortalSession() {
    return this.post<{ url: string }>('/billing/wallet/portal');
  }

  async createPaymentMethodSetupSession() {
    return this.post<{ checkoutUrl: string; sessionId: string }>('/billing/wallet/payment-method/setup');
  }

  async completePaymentMethodSetup(data: { sessionId: string }) {
    return this.post<any>('/billing/wallet/payment-method/setup/complete', data);
  }

  async createMessageCreditTopupCheckout(amountDollars: number) {
    return this.post<{ checkoutUrl: string; sessionId: string; amountDollars: number }>(
      '/billing/wallet/top-ups/checkout',
      { amountDollars }
    );
  }

  async completeMessageCreditTopupCheckout(data: { sessionId: string }) {
    return this.post<any>('/billing/wallet/top-ups/checkout/complete', data);
  }

  async createOnboardingCheckout(data: {
    topUpAmount: number;
    includeEnhancedVetting?: boolean;
    includeCampaignExpedite?: boolean;
    phoneNumber?: string;
    friendlyName?: string;
    campaignId?: string;
  }) {
    return this.post<{ checkoutUrl: string; sessionId: string; onboardingCart: any }>(
      '/billing/wallet/onboarding/checkout',
      data
    );
  }

  async completeOnboardingCheckout(data: { sessionId: string }) {
    return this.post<any>('/billing/wallet/onboarding/checkout/complete', data);
  }

  async releaseHeldInboundMessages() {
    return this.post<any>('/billing/wallet/release-held');
  }

  async authorizeMarketplaceBillingInstall(data: {
    clientId: string;
    installType: string;
    locationId?: string;
    companyId?: string;
  }) {
    return this.post<any>(`/billing/${crmPublicPlatformId}/install/authorize`, data);
  }

  async processBillingEvents(limit = 100) {
    return this.post<any>('/billing/process', { limit });
  }

  async updateBillingEventStatus(
    id: string,
    data: { status: 'posted' | 'failed' | 'ignored'; reason?: string; metadata?: Record<string, unknown> }
  ) {
    return this.patch<any>(`/billing/events/${id}/status`, data);
  }

  async getOperationsSummary() {
    return this.get<any>('/operations/summary');
  }

  async createSupportAgentSession(data: {
    page?: string;
    appStep?: string;
    fieldFocus?: string;
    onboardingStatus?: string;
  }) {
    return this.post<{
      apiBaseUrl: string;
      widgetAssetBaseUrl: string;
      token: string;
      expiresAt: string;
    }>('/support-agent/session', data);
  }

  async getDeadLetters() {
    return this.get<any[]>('/operations/dead-letters');
  }

  async replayDeadLetter(id: string) {
    return this.post<any>(`/operations/dead-letters/${id}/replay`);
  }

  async getPortOrders() {
    return this.get<any[]>('/port-orders');
  }

  async createPortOrder(data: any) {
    return this.post<any>('/port-orders', data);
  }

  async updatePortOrder(id: string, data: any) {
    return this.patch<any>(`/port-orders/${id}`, data);
  }

  // Campaign actions
  async pauseCampaign(id: string) {
    return this.post<any>(`/campaigns/${id}/pause`);
  }

  async resumeCampaign(id: string) {
    return this.post<any>(`/campaigns/${id}/resume`);
  }

  // User/Profile endpoints
  async updateProfile(data: { firstName: string; lastName: string; email: string }) {
    return this.put<any>('/users/profile', data);
  }

  async changePassword(currentPassword: string, newPassword: string) {
    return this.post<any>('/users/password', { currentPassword, newPassword });
  }

  async updateOrganization(data: { name?: string; email?: string; phone?: string; website?: string; logoUrl?: string }) {
    return this.put<any>('/organization', data);
  }

  // API Keys
  async getApiKeys() {
    return this.get<any[]>('/api-keys');
  }

  async createApiKey(data: { name: string }) {
    return this.post<{ key: string; id: string }>('/api-keys', data);
  }

  async deleteApiKey(id: string) {
    return this.delete(`/api-keys/${id}`);
  }

  // Phone Numbers (DIDs)
  async searchAvailableNumbers(params?: { areaCode?: string; contains?: string; state?: string; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.areaCode) searchParams.set('areaCode', params.areaCode);
    if (params?.contains) searchParams.set('contains', params.contains);
    if (params?.state) searchParams.set('state', params.state);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return this.get<any[]>(`/phone-numbers/available${query ? `?${query}` : ''}`);
  }

  async getPhoneNumbers(params?: { status?: string; campaignId?: string; page?: number; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.campaignId) searchParams.set('campaignId', params.campaignId);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return this.get<any[]>(`/phone-numbers${query ? `?${query}` : ''}`);
  }

  async getPhoneNumberStats() {
    return this.get<any>('/phone-numbers/stats');
  }

  async getPhoneNumber(id: string) {
    return this.get<any>(`/phone-numbers/${id}`);
  }

  async purchasePhoneNumber(data: { phoneNumber: string; campaignId?: string; friendlyName?: string }) {
    return this.post<
      | {
          id: string;
          phoneNumber: string;
          status: string;
          campaignId?: string | null;
        }
      | {
          pending: true;
          campaignId: string;
          phoneNumber: string;
          message: string;
        }
    >('/phone-numbers/purchase', data);
  }

  async createPhoneNumberCheckout(data: { phoneNumber: string; campaignId?: string; friendlyName?: string }) {
    return this.post<
      {
        mode: 'wallet_ready';
        activePhoneNumbers: number;
        phoneNumberMonthlyRate: number;
        pricingTier: string;
        fundingSource: 'onboarding_package' | 'wallet';
        phoneNumber: string;
        campaignId?: string;
        friendlyName?: string;
      }
    >('/phone-numbers/checkout', data);
  }

  async completePhoneNumberCheckout(data: { sessionId: string }) {
    return this.post<
      | {
          id: string;
          phoneNumber: string;
          status: string;
          campaignId?: string | null;
        }
      | {
          pending: true;
          campaignId: string;
          phoneNumber: string;
          message: string;
        }
    >('/phone-numbers/checkout/complete', data);
  }

  async updatePhoneNumber(id: string, data: { friendlyName?: string; campaignId?: string | null; makeDefault?: boolean; confirmReassignment?: boolean }) {
    return this.patch<any>(`/phone-numbers/${id}`, data);
  }

  async releasePhoneNumber(id: string) {
    return this.delete(`/phone-numbers/${id}`);
  }
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.name = 'ApiError';
  }
}

export const api = new ApiClient(API_BASE_URL);
