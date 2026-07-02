// ===========================================
// Admin Auth Store
// ===========================================

import { create } from 'zustand';
import { sanitizePlatformBranding } from '@/lib/platform-branding';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/storage';

interface Admin {
  id: string;
  email: string;
  name?: string;
  role?: string;
}

interface AdminAuthState {
  admin: Admin | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

const ADMIN_API_URL = import.meta.env.VITE_API_URL || '/api';
const ADMIN_PROFILE_KEY = 'adminProfile';

const saveAdminSession = (payload: { accessToken: string; refreshToken: string; admin?: Admin }) => {
  safeSetItem('adminAccessToken', payload.accessToken);
  safeSetItem('adminRefreshToken', payload.refreshToken);
  if (payload.admin) {
    safeSetItem(ADMIN_PROFILE_KEY, JSON.stringify(payload.admin));
  }
};

const clearAdminSession = () => {
  safeRemoveItem('adminAccessToken');
  safeRemoveItem('adminRefreshToken');
  safeRemoveItem(ADMIN_PROFILE_KEY);
};

const getStoredAdminProfile = (): Admin | null => {
  const raw = safeGetItem(ADMIN_PROFILE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Admin;
  } catch {
    return null;
  }
};

export const useAdminStore = create<AdminAuthState>((set, _get) => ({
  admin: typeof window !== 'undefined' ? getStoredAdminProfile() : null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${ADMIN_API_URL}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(sanitizePlatformBranding(data.error?.message || 'Login failed'));
      }

      saveAdminSession({
        accessToken: data.data.tokens.accessToken,
        refreshToken: data.data.tokens.refreshToken,
        admin: data.data.admin,
      });

      set({
        admin: data.data.admin,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: sanitizePlatformBranding(error instanceof Error ? error.message : 'Login failed'),
        isLoading: false,
      });
      throw error;
    }
  },

  logout: async () => {
    const refreshToken = safeGetItem('adminRefreshToken');
    if (refreshToken) {
      try {
        await fetch(`${ADMIN_API_URL}/admin/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // Ignore errors during logout
      }
    }

    clearAdminSession();

    set({
      admin: null,
      isAuthenticated: false,
      error: null,
    });
  },

  checkAuth: async () => {
    const token = safeGetItem('adminAccessToken');
    const storedProfile = getStoredAdminProfile();
    if (!token) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const response = await fetch(`${ADMIN_API_URL}/admin/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        // Try refresh
        const refreshToken = safeGetItem('adminRefreshToken');
        if (refreshToken) {
          const refreshResponse = await fetch(`${ADMIN_API_URL}/admin/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });

          if (refreshResponse.ok) {
            const refreshData = await refreshResponse.json();
            saveAdminSession({
              accessToken: refreshData.data.accessToken,
              refreshToken: refreshData.data.refreshToken,
              admin: storedProfile || undefined,
            });

            // Retry with new token
            const retryResponse = await fetch(`${ADMIN_API_URL}/admin/me`, {
              headers: { Authorization: `Bearer ${refreshData.data.accessToken}` },
            });

            if (retryResponse.ok) {
              const retryData = await retryResponse.json();
              const adminProfile = {
                ...storedProfile,
                ...retryData.data.admin,
              };
              safeSetItem(ADMIN_PROFILE_KEY, JSON.stringify(adminProfile));
              set({
                admin: adminProfile,
                isAuthenticated: true,
                isLoading: false,
              });
              return;
            }
          }
        }

        throw new Error('Auth failed');
      }

      const data = await response.json();
      const adminProfile = {
        ...storedProfile,
        ...data.data.admin,
      };
      safeSetItem(ADMIN_PROFILE_KEY, JSON.stringify(adminProfile));
      set({
        admin: adminProfile,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      clearAdminSession();
      set({
        admin: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));

// Admin API helper
class AdminApiClient {
  private getToken(): string | null {
    return safeGetItem('adminAccessToken');
  }

  private async refreshAccessToken(): Promise<string | null> {
    const refreshToken = safeGetItem('adminRefreshToken');
    if (!refreshToken) {
      return null;
    }

    const response = await fetch(`${ADMIN_API_URL}/admin/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      clearAdminSession();
      return null;
    }

    const data = await response.json();
    saveAdminSession({
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken,
      admin: getStoredAdminProfile() || undefined,
    });

    return data.data.accessToken;
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${ADMIN_API_URL}/admin${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (response.status === 401) {
      const refreshedToken = await this.refreshAccessToken();
      if (refreshedToken) {
        const retryHeaders = {
          ...headers,
          Authorization: `Bearer ${refreshedToken}`,
        };

        const retryResponse = await fetch(`${ADMIN_API_URL}/admin${endpoint}`, {
          ...options,
          headers: retryHeaders,
        });

        const retryData = await retryResponse.json();
        if (!retryResponse.ok) {
          throw new Error(sanitizePlatformBranding(retryData.error?.message || 'Request failed'));
        }

        return retryData;
      }

      throw new Error('Admin session expired. Please log in again.');
    }

    if (!response.ok) {
      throw new Error(sanitizePlatformBranding(data.error?.message || 'Request failed'));
    }

    return data;
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  // Settings
  async getSettings() {
    return this.get<{ success: boolean; data: any[] }>('/settings');
  }

  async updateSetting(key: string, value: string, description?: string) {
    return this.put<{ success: boolean; data: any }>(`/settings/${key}`, { value, description });
  }

  async getSignalmashDiagnostic() {
    return this.get<{ success: boolean; data: any | null }>('/settings/signalmash/diagnostic');
  }

  async testSignalmashConnection(lookups?: { brandId?: string; campaignId?: string }) {
    return this.post<{ success: boolean; data: any }>('/settings/signalmash/test-connection', lookups);
  }

  async getSignalmashBrands() {
    return this.get<{ success: boolean; data: any[] }>('/settings/signalmash/brands');
  }

  async getSignalmashBrandCampaigns(brandId: string) {
    return this.get<{ success: boolean; data: any[] }>(`/settings/signalmash/brands/${encodeURIComponent(brandId)}/campaigns`);
  }

  async assignSignalmashBrandCampaign(data: {
    organizationId: string;
    signalmashBrandId: string;
    signalmashCampaignId: string;
  }) {
    return this.post<{ success: boolean; data: any; message?: string }>('/settings/signalmash/assign-brand-campaign', data);
  }

  // Dashboard
  async getDashboard() {
    return this.get<{ success: boolean; data: any }>('/dashboard');
  }

  // Organizations
  async getOrganizations(page = 1, limit = 20) {
    return this.get<{ success: boolean; data: any[]; meta: any }>(`/organizations?page=${page}&limit=${limit}`);
  }

  async getOrganizationOnboarding(id: string) {
    return this.get<{ success: boolean; data: any }>(`/organizations/${id}/onboarding`);
  }

  async suspendOrganization(id: string, reason?: string) {
    return this.post<{ success: boolean; data: any; message?: string }>(`/organizations/${id}/suspend`, reason ? { reason } : {});
  }

  async unsuspendOrganization(id: string) {
    return this.post<{ success: boolean; data: any; message?: string }>(`/organizations/${id}/unsuspend`);
  }

  async submitOrganizationBrand(organizationId: string, brandId: string) {
    return this.post<{ success: boolean; data: any; message?: string }>(`/organizations/${organizationId}/brands/${brandId}/submit`);
  }

  async refreshOrganizationBrand(organizationId: string, brandId: string) {
    return this.post<{ success: boolean; data: any; message?: string }>(`/organizations/${organizationId}/brands/${brandId}/refresh-status`);
  }

  async setOrganizationBrandStatus(
    organizationId: string,
    brandId: string,
    data: {
      status: 'verified' | 'rejected';
      reason?: string;
    }
  ) {
    return this.post<{ success: boolean; data: any; message?: string }>(
      `/organizations/${organizationId}/brands/${brandId}/manual-status`,
      data
    );
  }

  async submitOrganizationCampaign(organizationId: string, campaignId: string) {
    return this.post<{ success: boolean; data: any; message?: string }>(`/organizations/${organizationId}/campaigns/${campaignId}/submit`);
  }

  async refreshOrganizationCampaign(organizationId: string, campaignId: string) {
    return this.post<{ success: boolean; data: any; message?: string }>(`/organizations/${organizationId}/campaigns/${campaignId}/refresh-status`);
  }

  async setOrganizationCampaignStatus(
    organizationId: string,
    campaignId: string,
    data: {
      status: 'approved' | 'rejected';
      reason?: string;
    }
  ) {
    return this.post<{ success: boolean; data: any; message?: string }>(
      `/organizations/${organizationId}/campaigns/${campaignId}/manual-status`,
      data
    );
  }

  async linkExistingSignalmashAssets(data: {
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
  }) {
    return this.post<{ success: boolean; data: any; message?: string }>('/organizations/link-existing-assets', data);
  }

  // Audit logs
  async getAuditLogs(page = 1, limit = 50) {
    return this.get<{ success: boolean; data: any[]; meta: any }>(`/audit-logs?page=${page}&limit=${limit}`);
  }

  // Setup
  async setup(data: { email: string; password: string; name: string; signalmashApiKey?: string; signalmashApiUrl?: string }) {
    return this.post<{ success: boolean; data: any }>('/setup', data);
  }
}

export const adminApi = new AdminApiClient();
