import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, api, type EmbeddedSsoExchangeData } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

type EmbeddedSsoStatus = 'loading' | 'reconnect_required' | 'waiting' | 'success' | 'error';

interface ReconnectInfo {
  authUrl: string;
  locationId?: string;
  installationId?: string;
  message: string;
}

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

function getReconnectInfoFromData(data: EmbeddedSsoExchangeData | undefined): ReconnectInfo | null {
  if (data?.action !== 'reconnect_required') {
    return null;
  }

  return {
    authUrl: data.authUrl,
    locationId: data.locationId,
    installationId: data.installationId,
    message: data.message,
  };
}

function getReconnectInfoFromError(err: unknown): ReconnectInfo | null {
  const details = err instanceof ApiError
    ? err.details
    : (err as { details?: Record<string, unknown> } | null | undefined)?.details;
  const authUrl = details?.authUrl;

  if (typeof authUrl !== 'string' || !authUrl) {
    return null;
  }

  return {
    authUrl,
    locationId: typeof details?.locationId === 'string' ? details.locationId : undefined,
    installationId: typeof details?.installationId === 'string' ? details.installationId : undefined,
    message: err instanceof Error
      ? err.message
      : 'Authorize this CRM workspace to continue.',
  };
}

export function EmbeddedSsoPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginViaOAuth, clearLocalAuth } = useAuthStore();
  const [status, setStatus] = useState<EmbeddedSsoStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [encryptedData, setEncryptedData] = useState<string | null>(null);
  const [reconnectInfo, setReconnectInfo] = useState<ReconnectInfo | null>(null);

  const exchangePayload = useCallback(async (payload: string): Promise<'authenticated' | 'reconnect_required'> => {
    const response = await api.exchangeEmbeddedSso(payload);

    if (!response.success || !response.data) {
      throw new Error('Failed to complete embedded sign-in');
    }

    if (response.data.action === 'reconnect_required') {
      const reconnect = getReconnectInfoFromData(response.data);
      if (!reconnect) {
        throw new Error('Failed to prepare workspace authorization');
      }

      setReconnectInfo(reconnect);
      setError(null);
      return 'reconnect_required';
    }

    const expectedOrganizationId =
      typeof response.data.organization?.id === 'string'
        ? response.data.organization.id
        : typeof response.data.user?.organizationId === 'string'
          ? response.data.user.organizationId
          : undefined;

    await loginViaOAuth(
      response.data.tokens.accessToken,
      response.data.tokens.refreshToken,
      expectedOrganizationId
    );

    setStatus('success');
    window.setTimeout(() => {
      navigate('/onboarding', { replace: true });
    }, 800);

    return 'authenticated';
  }, [loginViaOAuth, navigate]);

  useEffect(() => {
    const requestEncryptedData = async (): Promise<string | null> => {
      if (window.parent !== window) {
        const parentPayload = await new Promise<string | null>((resolve) => {
          let timeout: number;
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

          timeout = window.setTimeout(() => {
            window.removeEventListener('message', handleMessage);
            resolve(null);
          }, 5000);

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
      const payload = await requestEncryptedData();

      if (!payload) {
        if (window.parent !== window) {
          clearLocalAuth();
        }

        setStatus('error');
        setError('Missing embedded user context. Open this page from the embedded app entry inside your CRM.');
        return;
      }

      setEncryptedData(payload);

      try {
        const outcome = await exchangePayload(payload);
        if (outcome === 'reconnect_required') {
          setStatus('reconnect_required');
        }
      } catch (firstError) {
        const reconnect = getReconnectInfoFromError(firstError);
        if (reconnect) {
          setReconnectInfo(reconnect);
          setError(null);
          setStatus('reconnect_required');
          return;
        }

        try {
          await new Promise((resolve) => window.setTimeout(resolve, 750));
          const outcome = await exchangePayload(payload);
          if (outcome === 'reconnect_required') {
            setStatus('reconnect_required');
          }
        } catch (err) {
          const retryReconnect = getReconnectInfoFromError(err);
          if (retryReconnect) {
            setReconnectInfo(retryReconnect);
            setError(null);
            setStatus('reconnect_required');
            return;
          }

          setStatus('error');
          setError(err instanceof Error ? err.message : 'Failed to complete embedded sign-in');
        }
      }
    };

    bootstrap();
  }, [clearLocalAuth, exchangePayload, searchParams]);

  useEffect(() => {
    if (status !== 'waiting' || !encryptedData) {
      return;
    }

    let stopped = false;

    const poll = async () => {
      try {
        const outcome = await exchangePayload(encryptedData);
        if (!stopped && outcome === 'reconnect_required') {
          setStatus('waiting');
        }
      } catch (err) {
        const reconnect = getReconnectInfoFromError(err);
        if (reconnect) {
          setReconnectInfo(reconnect);
          setError(null);
          return;
        }

        if (!stopped) {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Failed to complete embedded sign-in');
        }
      }
    };

    const firstPoll = window.setTimeout(poll, 1500);
    const pollInterval = window.setInterval(poll, 3000);

    return () => {
      stopped = true;
      window.clearTimeout(firstPoll);
      window.clearInterval(pollInterval);
    };
  }, [encryptedData, exchangePayload, status]);

  const openReconnectAuthorization = () => {
    if (!reconnectInfo) {
      return;
    }

    setError(null);
    setStatus('waiting');
    const opened = window.open(reconnectInfo.authUrl, '_blank');
    if (!opened) {
      setStatus('reconnect_required');
      setError('Your browser blocked the authorization tab. Use the button again or allow popups for this page.');
    }
  };

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

        {status === 'reconnect_required' && reconnectInfo && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/12 text-primary">
              <ExternalLink className="h-9 w-9" />
            </div>
            <h2 className="text-xl font-semibold">Authorize workspace</h2>
            <p className="max-w-md text-muted-foreground">{reconnectInfo.message}</p>
            {error && <p className="max-w-md text-sm text-destructive">{error}</p>}
            <Button
              onClick={openReconnectAuthorization}
              leftIcon={<ExternalLink />}
              className="mt-2"
            >
              Authorize workspace
            </Button>
            <p className="max-w-md text-xs text-muted-foreground">
              Authorization opens in a new tab. Keep this embedded page open.
            </p>
          </>
        )}

        {status === 'waiting' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <h2 className="text-xl font-semibold">Waiting for authorization</h2>
            <p className="max-w-md text-muted-foreground">
              Complete authorization in the tab that opened. This page will continue automatically.
            </p>
            {reconnectInfo && (
              <Button
                variant="outline"
                onClick={openReconnectAuthorization}
                leftIcon={<ExternalLink />}
                className="mt-2"
              >
                Reopen authorization
              </Button>
            )}
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
            <Button
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                  return;
                }

                navigate('/connect');
              }}
              className="mt-4"
            >
              Open standard connect flow
            </Button>
          </>
        )}
      </motion.div>
    </div>
  );
}
