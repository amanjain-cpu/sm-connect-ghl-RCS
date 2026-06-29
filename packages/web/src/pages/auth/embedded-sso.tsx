import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

function getEmbeddedDataFromQuery(
  searchParams: URLSearchParams,
  includeLegacyAliases = false
): string | null {
  return (
    searchParams.get('encryptedData') ||
    searchParams.get('ssoData') ||
    (includeLegacyAliases ? searchParams.get('token') : null) ||
    (includeLegacyAliases ? searchParams.get('data') : null)
  );
}

export function EmbeddedSsoPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginViaOAuth, checkAuth } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const requestEncryptedData = async (): Promise<string | null> => {
      if (window.parent !== window) {
        const parentPayload = await new Promise<string | null>((resolve) => {
          const timeout = window.setTimeout(() => {
            window.removeEventListener('message', handleMessage);
            resolve(null);
          }, 5000);

          const handleMessage = (event: MessageEvent) => {
            const payload = event.data as
              | { message?: string; payload?: string }
              | undefined;

            if (payload?.message !== 'REQUEST_USER_DATA_RESPONSE' || typeof payload.payload !== 'string') {
              return;
            }

            window.clearTimeout(timeout);
            window.removeEventListener('message', handleMessage);
            resolve(payload.payload);
          };

          window.addEventListener('message', handleMessage);
          window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
        });

        if (parentPayload) {
          return parentPayload;
        }

        const explicitQueryPayload = getEmbeddedDataFromQuery(searchParams);
        if (explicitQueryPayload) {
          return explicitQueryPayload;
        }

        return null;
      }

      return getEmbeddedDataFromQuery(searchParams, true);
    };

    const bootstrap = async () => {
      const hasExistingSession = await checkAuth();
      if (hasExistingSession) {
        setStatus('success');
        setTimeout(() => {
          navigate('/onboarding', { replace: true });
        }, 250);
        return;
      }

      const encryptedData = await requestEncryptedData();

      if (!encryptedData) {
        setStatus('error');
        setError('Missing embedded user context. Open this page from the embedded app entry inside your CRM.');
        return;
      }

      try {
        let response;
        try {
          response = await api.exchangeEmbeddedSso(encryptedData);
        } catch (firstError) {
          await new Promise((resolve) => window.setTimeout(resolve, 750));
          response = await api.exchangeEmbeddedSso(encryptedData);
        }

        if (!response.success || !response.data) {
          throw new Error('Failed to complete embedded sign-in');
        }

        await loginViaOAuth(
          response.data.tokens.accessToken,
          response.data.tokens.refreshToken
        );

        setStatus('success');

        setTimeout(() => {
          navigate('/onboarding', { replace: true });
        }, 800);
      } catch (err: any) {
        setStatus('error');
        setError(err?.message || 'Failed to complete embedded sign-in');
      }
    };

    bootstrap();
  }, [loginViaOAuth, navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/12 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative text-center space-y-4"
      >
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <h2 className="text-xl font-semibold">Opening Signalmash Connect...</h2>
            <p className="text-muted-foreground">
              Requesting workspace context from your CRM and preparing the embedded workspace.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/12 text-primary">
              <CheckCircle className="h-10 w-10" />
            </div>
            <h2 className="text-xl font-semibold">Workspace ready</h2>
            <p className="text-muted-foreground">Redirecting into the embedded onboarding flow...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/12 text-destructive">
              <AlertCircle className="h-10 w-10" />
            </div>
            <h2 className="text-xl font-semibold">Embedded sign-in failed</h2>
            <p className="max-w-md text-muted-foreground">{error}</p>
            <button
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                  return;
                }

                navigate('/connect');
              }}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
            >
              {error?.toLowerCase().includes('workspace')
                ? 'Return to CRM'
                : 'Open standard connect flow'}
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
