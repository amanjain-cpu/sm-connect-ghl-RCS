import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  MessageSquareMore,
  Phone,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageInset, PageSection, PageShell } from '@/components/layout/page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';
import { notify } from '@/stores/notification.store';

interface BillingPlan {
  id: 'starter' | 'growth' | 'scale';
  label: string;
  monthlyPrice: number;
  smsIncluded: number;
  mmsIncluded: number;
  phoneNumbersIncluded: number;
}

interface BillingSubscriptionSummary {
  plans: BillingPlan[];
  subscription: {
    id: string;
    plan: BillingPlan['id'] | null;
    status: string;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    billingBlockedAt?: string | null;
    billingBlockedReason?: string | null;
    pendingOverageBalance: number;
    smsIncluded: number;
    mmsIncluded: number;
    phoneNumbersIncluded: number;
    hasStripeCustomer: boolean;
  };
  usage: {
    smsUsed: number;
    smsRemaining: number;
    smsOverage: number;
    mmsUsed: number;
    mmsRemaining: number;
    mmsOverage: number;
    activePhoneNumbers: number;
    phoneNumbersIncluded: number;
    extraPhoneNumbers: number;
  };
  rates: {
    smsOverageRate: number;
    mmsOverageRate: number;
    extraPhoneNumberSetupFee: number;
    extraPhoneNumberMonthlyRate: number;
    realtimeChargeThreshold: number;
  };
  recentCharges: Array<{
    id: string;
    kind: string;
    status: string;
    amount: number;
    description: string;
    createdAt: string;
  }>;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatDate(value?: string | null) {
  if (!value) {
    return 'Not set';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function statusVariant(status: string): 'default' | 'warning' | 'destructive' | 'info' | 'success' {
  switch (status) {
    case 'active':
    case 'succeeded':
      return 'success';
    case 'trialing':
    case 'pending':
      return 'info';
    case 'past_due':
    case 'unpaid':
    case 'failed':
      return 'destructive';
    default:
      return 'warning';
  }
}

export function SubscriptionsPage() {
  const [searchParams] = useSearchParams();
  const [summary, setSummary] = useState<BillingSubscriptionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activePlanAction, setActivePlanAction] = useState<string | null>(null);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

  const loadSummary = async () => {
    const response = await api.getSubscriptionBillingSummary();
    if (response.success && response.data) {
      setSummary(response.data);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const checkoutStatus = searchParams.get('checkout');
        const sessionId = searchParams.get('session_id');

        if (checkoutStatus === 'success' && sessionId) {
          const response = await api.completeSubscriptionCheckout({ sessionId });
          if (response.success && response.data) {
            setSummary(response.data);
          }
          notify.success('Subscription updated', 'Stripe checkout completed and billing has been synced.');
          window.history.replaceState({}, '', '/subscriptions');
        } else if (checkoutStatus === 'cancelled') {
          notify.error('Checkout cancelled', 'The Stripe checkout session was not completed.');
          window.history.replaceState({}, '', '/subscriptions');
        }

        await loadSummary();
      } catch (error) {
        notify.error(
          'Billing unavailable',
          error instanceof Error ? error.message : 'Unable to load subscription details.'
        );
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();
  }, [searchParams]);

  const handlePlanSelection = async (plan: BillingPlan['id']) => {
    setActivePlanAction(plan);

    try {
      const response = await api.createSubscriptionCheckout(plan);
      if (!response.success || !response.data) {
        throw new Error('Unable to start Stripe checkout');
      }

      if (response.data.mode === 'checkout' && response.data.checkoutUrl) {
        window.location.href = response.data.checkoutUrl;
        return;
      }

      if (response.data.summary) {
        setSummary(response.data.summary);
      }

      if (response.data.mode === 'updated') {
        notify.success('Plan updated', 'The Stripe subscription was updated immediately.');
      } else if (response.data.mode === 'current') {
        notify.success('Current plan active', 'This workspace is already on the selected plan.');
      }
    } catch (error) {
      notify.error(
        'Plan update failed',
        error instanceof Error ? error.message : 'Unable to update the billing plan.'
      );
    } finally {
      setActivePlanAction(null);
    }
  };

  const handleOpenPortal = async () => {
    setIsOpeningPortal(true);

    try {
      const response = await api.createBillingPortalSession();
      if (!response.success || !response.data?.url) {
        throw new Error('Stripe billing portal URL was not returned.');
      }

      window.location.href = response.data.url;
    } catch (error) {
      notify.error(
        'Billing portal unavailable',
        error instanceof Error ? error.message : 'Unable to open the Stripe billing portal.'
      );
    } finally {
      setIsOpeningPortal(false);
    }
  };

  return (
    <div>
      <Header
        title="Billing"
        subtitle="Manage your Stripe subscription, usage allowances, and overage state."
      />

      <PageShell>
        {isLoading ? (
          <PageSection className="p-8">
            <div className="flex items-center justify-center gap-3 text-slate-600 dark:text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading billing workspace...</span>
            </div>
          </PageSection>
        ) : summary ? (
          <>
            <PageSection className="p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(summary.subscription.status)} dot>
                      {summary.subscription.status.replace(/_/g, ' ')}
                    </Badge>
                    {summary.subscription.plan ? (
                      <Badge variant="outline">{summary.subscription.plan}</Badge>
                    ) : (
                      <Badge variant="warning">No active plan</Badge>
                    )}
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">
                      Stripe subscription overview
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                      External Payment from your CRM routes here, then Stripe remains the billing source of truth.
                      Message overages accumulate in real time and charge automatically once the unpaid balance
                      reaches {formatCurrency(summary.rates.realtimeChargeThreshold)}.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={handleOpenPortal}
                    isLoading={isOpeningPortal}
                    disabled={!summary.subscription.hasStripeCustomer}
                    leftIcon={<CreditCard className="h-4 w-4" />}
                  >
                    Manage Payment Method
                  </Button>
                </div>
              </div>

              {summary.subscription.billingBlockedAt ? (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">Billing action required</p>
                      <p className="mt-1">
                        {summary.subscription.billingBlockedReason || 'Stripe reported a billing issue.'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </PageSection>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.95fr)]">
              <PageSection className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Plans</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      Choose a monthly plan for SMS, MMS, and included sender inventory.
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-3">
                  {summary.plans.map((plan) => {
                    const isCurrent = summary.subscription.plan === plan.id;

                    return (
                      <Card key={plan.id} className={`border-slate-200 shadow-sm dark:border-slate-800 ${isCurrent ? 'ring-2 ring-primary/30' : ''}`}>
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                                {plan.label}
                              </p>
                              <div className="mt-2 flex items-end gap-1">
                                <span className="text-3xl font-semibold text-slate-950 dark:text-slate-50">
                                  {formatCurrency(plan.monthlyPrice)}
                                </span>
                                <span className="pb-1 text-sm text-slate-500 dark:text-slate-400">/mo</span>
                              </div>
                            </div>
                            {isCurrent ? (
                              <Badge variant="success">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Current
                              </Badge>
                            ) : null}
                          </div>

                          <div className="mt-5 space-y-3 text-sm text-slate-700 dark:text-slate-300">
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2">
                                <MessageSquareMore className="h-4 w-4 text-primary" />
                                SMS included
                              </span>
                              <span className="font-medium">{plan.smsIncluded.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2">
                                <MessageSquareMore className="h-4 w-4 text-primary" />
                                MMS included
                              </span>
                              <span className="font-medium">{plan.mmsIncluded.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2">
                                <Phone className="h-4 w-4 text-primary" />
                                Included numbers
                              </span>
                              <span className="font-medium">{plan.phoneNumbersIncluded}</span>
                            </div>
                          </div>

                          <Button
                            className="mt-6 w-full"
                            variant={isCurrent ? 'outline' : 'default'}
                            onClick={() => handlePlanSelection(plan.id)}
                            isLoading={activePlanAction === plan.id}
                          >
                            {isCurrent ? 'Current Plan' : 'Choose Plan'}
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </PageSection>

              <div className="space-y-5">
                <PageSection className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Usage This Cycle</h3>
                  <div className="mt-5 grid gap-4">
                    <PageInset className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">SMS</span>
                        <span className="text-sm font-medium text-slate-950 dark:text-slate-50">
                          {summary.usage.smsUsed.toLocaleString()} / {summary.subscription.smsIncluded.toLocaleString()}
                        </span>
                      </div>
                    </PageInset>
                    <PageInset className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">MMS</span>
                        <span className="text-sm font-medium text-slate-950 dark:text-slate-50">
                          {summary.usage.mmsUsed.toLocaleString()} / {summary.subscription.mmsIncluded.toLocaleString()}
                        </span>
                      </div>
                    </PageInset>
                    <PageInset className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Active Phone Numbers</span>
                        <span className="text-sm font-medium text-slate-950 dark:text-slate-50">
                          {summary.usage.activePhoneNumbers} / {summary.subscription.phoneNumbersIncluded}
                        </span>
                      </div>
                    </PageInset>
                  </div>

                  <div className="mt-5 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                    <p>Current period: {formatDate(summary.subscription.currentPeriodStart)} to {formatDate(summary.subscription.currentPeriodEnd)}</p>
                    <p>Pending message overage balance: {formatCurrency(summary.subscription.pendingOverageBalance)}</p>
                    <p>Extra number setup fee: {formatCurrency(summary.rates.extraPhoneNumberSetupFee)}</p>
                    <p>Extra number monthly recurring charge: {formatCurrency(summary.rates.extraPhoneNumberMonthlyRate)}</p>
                  </div>
                </PageSection>

                <PageSection className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Recent Charges</h3>
                  <div className="mt-5 space-y-3">
                    {summary.recentCharges.length > 0 ? summary.recentCharges.map((charge) => (
                      <div
                        key={charge.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-950 dark:text-slate-50">
                              {charge.description}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {formatDate(charge.createdAt)}
                            </p>
                          </div>
                          <div className="text-right">
                            <Badge variant={statusVariant(charge.status)}>{charge.status}</Badge>
                            <p className="mt-2 text-sm font-medium text-slate-950 dark:text-slate-50">
                              {formatCurrency(charge.amount)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        No Stripe-backed charges have been recorded for this workspace yet.
                      </div>
                    )}
                  </div>
                </PageSection>
              </div>
            </div>
          </>
        ) : (
          <PageSection className="p-8">
            <div className="text-sm text-slate-600 dark:text-slate-300">
              Billing data could not be loaded.
            </div>
          </PageSection>
        )}
      </PageShell>
    </div>
  );
}
