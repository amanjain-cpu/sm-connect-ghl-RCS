import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { finishMarketplaceInstallTab } from '@/lib/marketplace-install';

export function InstallCompletePage() {
  const [searchParams] = useSearchParams();
  const [showCloseHint, setShowCloseHint] = useState(false);
  const success = searchParams.get('success') === 'true';
  const isNew = searchParams.get('isNew') === 'true';
  const reason = searchParams.get('reason');
  const billingState = searchParams.get('billing');
  const installScope = searchParams.get('installScope');

  useEffect(() => {
    if (!(success && billingState === 'authorized')) {
      return;
    }

    const timeout = window.setTimeout(() => {
      finishMarketplaceInstallTab({
        explicitReturnUrl: searchParams.get('returnTo'),
        onStayOpen: () => setShowCloseHint(true),
      });
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [billingState, searchParams, success]);

  const returnToCrm = () => {
    finishMarketplaceInstallTab({
      explicitReturnUrl: searchParams.get('returnTo'),
      onStayOpen: () => setShowCloseHint(true),
    });
  };

  const failureMessage =
    reason === 'location_token_required'
      ? 'The installation returned an agency-level token. Reinstall Signalmash Connect from the target workspace so messaging permissions can be granted.'
      : reason === 'location_token_resolution_failed'
        ? 'The installation returned an agency-level token, but Signalmash Connect could not resolve which workspace was installed. Reopen Marketplace from the target workspace and reinstall.'
        : reason === 'location_token_exchange_failed'
          ? 'The installation returned an agency-level token and workspace token exchange failed. Reopen Marketplace from the target workspace and reinstall.'
      : reason === 'external_billing_authorization_failed'
        ? 'The marketplace redirected to the external billing page, but your CRM platform did not accept the billing authorization request. Reopen the install flow and try again.'
      : 'Return to your CRM and try the installation again. If the problem persists, open the Signalmash Connect app from your CRM and retry the connection flow.';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/12 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative max-w-xl rounded-[32px] border border-border bg-card px-8 py-10 text-center shadow-pop"
      >
        {success ? (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/12 text-primary">
              <CheckCircle className="h-10 w-10" />
            </div>
            <h1 className="mt-6 text-2xl font-semibold text-foreground">
              {billingState === 'authorized'
                ? 'Billing approved for installation'
                : installScope === 'agency'
                  ? 'Agency installation completed'
                : 'Signalmash Connect is installed'}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {billingState === 'authorized'
                ? <>Your CRM platform accepted the external billing authorization. HighLevel should continue the install inside the target workspace.</>
                : installScope === 'agency'
                  ? <>The app was installed at the agency level. Open SM Connect from a workspace inside your CRM to finish the workspace connection.</>
                : <>HighLevel should reopen <span className="font-medium text-foreground">SM Connect</span> inside the installed workspace.</>}
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {billingState === 'authorized'
                ? 'This status tab can be closed if it stays open.'
                : installScope === 'agency'
                  ? 'The first workspace open will complete the embedded connection for that workspace.'
                : isNew
                  ? 'Your first stop will be onboarding inside the embedded app.'
                  : 'The embedded app will reopen in the connected workspace.'}
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              {showCloseHint && (
                <button
                  onClick={returnToCrm}
                  className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Close this tab
                </button>
              )}
              <p className="text-xs text-muted-foreground">
                If the embedded app does not appear automatically, reopen SM Connect from the installed workspace menu.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/12 text-destructive">
              <AlertCircle className="h-10 w-10" />
            </div>
            <h1 className="mt-6 text-2xl font-semibold text-foreground">
              Installation could not be completed
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {failureMessage}
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
