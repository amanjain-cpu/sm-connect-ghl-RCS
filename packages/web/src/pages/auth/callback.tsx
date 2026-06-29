// ===========================================
// OAuth Callback Page
// Handles OAuth tokens and signs the user in
// ===========================================

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { finishMarketplaceInstallTab } from '@/lib/marketplace-install';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginViaOAuth } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [showCloseHint, setShowCloseHint] = useState(false);

  useEffect(() => {
    const handleCallback = async () => {
      const accessToken = searchParams.get('accessToken');
      const refreshToken = searchParams.get('refreshToken');
      const success = searchParams.get('success');
      const isNew = searchParams.get('isNew');
      const isMarketplaceInstall = searchParams.get('marketplaceInstall') === 'true';

      if (success !== 'true' || !accessToken || !refreshToken) {
        setStatus('error');
        setError('Invalid OAuth callback. Please try again.');
        return;
      }

      try {
        await loginViaOAuth(accessToken, refreshToken);
        setStatus('success');

        setTimeout(() => {
          if (isMarketplaceInstall) {
            finishMarketplaceInstallTab({
              explicitReturnUrl: searchParams.get('returnTo'),
              onStayOpen: () => setShowCloseHint(true),
            });
            return;
          }

          if (isNew === 'true') {
            navigate('/onboarding', { replace: true });
          } else {
            navigate('/dashboard', { replace: true });
          }
        }, 1500);
      } catch (err: any) {
        setStatus('error');
        setError(err.message || 'Failed to complete authentication');
      }
    };

    handleCallback();
  }, [searchParams, loginViaOAuth, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/12 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative text-center"
      >
        {status === 'loading' && (
          <div className="space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <h2 className="text-xl font-semibold">
              {searchParams.get('marketplaceInstall') === 'true'
                ? 'Completing installation...'
                : 'Completing authentication...'}
            </h2>
            <p className="text-muted-foreground">
              {searchParams.get('marketplaceInstall') === 'true'
                ? 'Please wait while we prepare your Signalmash Connect workspace.'
                : 'Please wait while we set up your session'}
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/12 text-primary">
              <CheckCircle className="h-10 w-10" />
            </div>
            <h2 className="text-xl font-semibold">
              {searchParams.get('marketplaceInstall') === 'true'
                ? 'Installation complete'
                : 'Authentication successful!'}
            </h2>
            <p className="text-muted-foreground">
              {searchParams.get('marketplaceInstall') === 'true'
                ? 'HighLevel is reopening Signalmash Connect inside the installed workspace.'
                : 'Redirecting to your dashboard...'}
            </p>
            {searchParams.get('marketplaceInstall') === 'true' && showCloseHint && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This install tab can be closed if it stays open.
                </p>
                <button
                  onClick={() =>
                    finishMarketplaceInstallTab({
                      explicitReturnUrl: searchParams.get('returnTo'),
                      onStayOpen: () => setShowCloseHint(true),
                    })
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
                >
                  Close this tab
                </button>
              </div>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/12 text-destructive">
              <AlertCircle className="h-10 w-10" />
            </div>
            <h2 className="text-xl font-semibold">Authentication failed</h2>
            <p className="text-muted-foreground">{error}</p>
            <button
              onClick={() => navigate('/connect')}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
