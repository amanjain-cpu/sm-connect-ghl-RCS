import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { finishMarketplaceInstallTab } from '@/lib/marketplace-install';
import { useAuthStore } from '@/stores/auth.store';

const crmPublicPlatformId = 'crm' as const;

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

export function BillingEntryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, loginViaOAuth } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [showCloseHint, setShowCloseHint] = useState(false);

  const installContext = useMemo(() => {
    const clientId = searchParams.get('clientId') || '';
    const installType = searchParams.get('installType') || '';
    const locationId = searchParams.get('locationId') || '';
    const companyId = searchParams.get('companyId') || '';

    return {
      clientId,
      installType,
      locationId,
      companyId,
      isMarketplaceBillingInstall: Boolean(clientId && installType && (locationId || companyId)),
    };
  }, [searchParams]);

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
      if (installContext.isMarketplaceBillingInstall) {
        try {
          await api.authorizeMarketplaceBillingInstall({
            clientId: installContext.clientId,
            installType: installContext.installType,
            locationId: installContext.locationId || undefined,
            companyId: installContext.companyId || undefined,
          });

          setStatus('success');

          window.setTimeout(() => {
            finishMarketplaceInstallTab({
              onStayOpen: () => setShowCloseHint(true),
            });
          }, 900);
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Marketplace billing authorization failed';
          setStatus('error');
          setError(message);
          return;
        }
      }

      if (isAuthenticated) {
        navigate('/subscriptions', { replace: true });
        return;
      }

      const encryptedData = await requestEncryptedData();

      if (!encryptedData) {
        setStatus('error');
        setError(
          'This billing page was opened without the marketplace install parameters and without embedded CRM context. Use the app install flow or open SM Connect from the CRM menu.'
        );
        return;
      }

      try {
        const response = await api.exchangeEmbeddedSso(encryptedData);

        if (!response.success || !response.data) {
          throw new Error('Failed to complete embedded sign-in');
        }

        if (response.data.action === 'reconnect_required') {
          throw new Error(response.data.message);
        }

        await loginViaOAuth(
          response.data.tokens.accessToken,
          response.data.tokens.refreshToken
        );

        setStatus('success');

        window.setTimeout(() => {
          navigate('/subscriptions', { replace: true });
        }, 700);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to complete embedded sign-in';
        setStatus('error');
        setError(message);
      }
    };

    bootstrap();
  }, [installContext, isAuthenticated, loginViaOAuth, navigate, searchParams]);

  const isMarketplaceInstall = installContext.isMarketplaceBillingInstall;

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
            <h2 className="text-xl font-semibold">
              {isMarketplaceInstall ? 'Authorizing installation...' : 'Opening billing workspace...'}
            </h2>
            <p className="max-w-md text-muted-foreground">
              {isMarketplaceInstall
                ? 'Validating the marketplace install and submitting the external billing authorization back to your CRM platform.'
                : 'Loading your embedded CRM session and preparing Stripe billing options.'}
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/12 text-primary">
              <CheckCircle className="h-10 w-10" />
            </div>
            <h2 className="text-xl font-semibold">
              {isMarketplaceInstall ? 'Installation authorized' : 'Billing workspace ready'}
            </h2>
            <p className="max-w-md text-muted-foreground">
              {isMarketplaceInstall
                ? 'Your CRM platform has accepted the external billing authorization. HighLevel should continue the install inside the target workspace.'
                : 'Redirecting to wallet billing...'}
            </p>
            {isMarketplaceInstall && showCloseHint && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This tab can be closed if it stays open.
                </p>
                <button
                  onClick={() =>
                    finishMarketplaceInstallTab({
                      onStayOpen: () => setShowCloseHint(true),
                    })
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
                >
                  Close this tab
                </button>
              </div>
            )}
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/12 text-destructive">
              <AlertCircle className="h-10 w-10" />
            </div>
            <h2 className="text-xl font-semibold">
              {isMarketplaceInstall ? 'Installation authorization failed' : 'Billing entry failed'}
            </h2>
            <p className="max-w-md text-muted-foreground">{error}</p>
            <button
              onClick={() => navigate(isMarketplaceInstall ? `/auth/install-complete?platform=${crmPublicPlatformId}&success=false&reason=external_billing_authorization_failed` : '/connect')}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
            >
              {isMarketplaceInstall ? 'Back to install status' : 'Open standard connect flow'}
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
