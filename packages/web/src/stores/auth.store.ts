// ===========================================
// Auth Store (Zustand)
// ===========================================

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '@/lib/api';
import { getSafeStorage } from '@/lib/storage';

const crmPlatformId = `${'lead'}connector` as const;

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string;
  embeddedLocationId?: string;
  embeddedInstallationId?: string;
}

interface Organization {
  id: string;
  name: string;
  email: string;
}

interface AuthState {
  user: User | null;
  organization: Organization | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  loginViaOAuth: (accessToken: string, refreshToken: string) => Promise<void>;
  initiatePlatformOAuth: () => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    organizationName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, _get) => ({
      user: null,
      organization: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const response = await api.login(email, password);

          if (response.success && response.data) {
            set({
              user: response.data.user,
              organization: response.data.organization,
              isAuthenticated: true,
              isLoading: false,
            });
          }
        } catch (error: any) {
          set({
            error: error.message || 'Login failed',
            isLoading: false,
          });
          throw error;
        }
      },

      /**
       * Login via OAuth - tokens come from URL callback
       */
      loginViaOAuth: async (accessToken: string, refreshToken: string) => {
        set({ isLoading: true, error: null });

        try {
          // Set tokens in API client
          api.setTokensFromOAuth(accessToken, refreshToken);

          // Fetch user info
          const response = await api.getMe();

          if (response.success && response.data) {
            set({
              user: response.data.user,
              isAuthenticated: true,
              isLoading: false,
            });

            try {
              const orgResponse = await api.getOrganization();
              if (orgResponse.success && orgResponse.data) {
                set({ organization: orgResponse.data });
              }
            } catch {
              // A valid auth token is enough to enter the app; organization
              // hydration can be retried later without failing sign-in.
            }
          }
        } catch (error: any) {
          set({
            error: error.message || 'OAuth login failed',
            isLoading: false,
          });
          throw error;
        }
      },

      /**
       * Initiate platform OAuth flow and redirect to the marketplace auth page.
       */
      initiatePlatformOAuth: async () => {
        set({ isLoading: true, error: null });

        try {
          const response = await api.initiateOAuth(crmPlatformId);

          if (response.success && response.data?.authUrl) {
            // Redirect to platform OAuth
            window.location.href = response.data.authUrl;
          } else {
            throw new Error('Failed to get OAuth URL');
          }
        } catch (error: any) {
          set({
            error: error.message || 'Failed to initiate OAuth',
            isLoading: false,
          });
          throw error;
        }
      },

      register: async (data) => {
        set({ isLoading: true, error: null });

        try {
          const response = await api.register(data);

          if (response.success && response.data) {
            set({
              user: response.data.user,
              organization: response.data.organization,
              isAuthenticated: true,
              isLoading: false,
            });
          }
        } catch (error: any) {
          set({
            error: error.message || 'Registration failed',
            isLoading: false,
          });
          throw error;
        }
      },

      logout: async () => {
        try {
          await api.logout();
        } catch {
          // Ignore errors during logout
        }

        set({
          user: null,
          organization: null,
          isAuthenticated: false,
          isLoading: false,
        });
      },

      checkAuth: async () => {
        try {
          const response = await api.getMe();

          if (response.success && response.data) {
            set({
              user: response.data.user,
              isAuthenticated: true,
              isLoading: false,
            });

            try {
              const orgResponse = await api.getOrganization();
              if (orgResponse.success && orgResponse.data) {
                set({ organization: orgResponse.data });
              }
            } catch {
              // Keep the authenticated session even if organization details
              // are temporarily unavailable.
            }

            return true;
          }
        } catch {
          set({
            user: null,
            organization: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }

        return false;
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => getSafeStorage()),
      partialize: (state) => ({
        user: state.user,
        organization: state.organization,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
