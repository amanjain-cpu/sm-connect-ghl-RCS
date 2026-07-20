import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  MessageSquareMore,
  Phone,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageInset, PageSection, PageShell } from '@/components/layout/page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { reserveCheckoutWindow } from '@/lib/external-checkout';
import { notify } from '@/stores/notification.store';

interface WalletBillingSummary {
  account: {
    id: string;
    status: 'active' | 'suspended';
    suspensionReason?: string | null;
    suspendedAt?: string | null;
    pricingTier: string;
    pricingTierLabel: string;
    walletBalance: number;
    hasStripeCustomer: boolean;
    hasSavedPaymentMethod: boolean;
    mrcNextRunAt?: string | null;
    setupFeeChargedAt?: string | null;
  };
  rates: {
    sms: number;
    mms: number;
    campaignMonthly: number;
    phoneNumberMonthly: number;
    basicSetup: number;
    enhancedVetting: number;
    campaignExpedite: number;
  };
  carrierSurcharges?: Array<{
    carrier: string;
    sms: number;
    mms: number;
  }>;
  carrierSurchargeNote?: string;
  prepayBalanceNote?: string;
  onboardingCart?: {
    isNewCustomer: boolean;
    requiresOnboardingPackage?: boolean;
    topUpAmount: number;
    requiredLineItems: Array<{
      key: string;
      label: string;
      amount: number;
      required: boolean;
      selected: boolean;
      description: string;
    }>;
    optionalLineItems: Array<{
      key: 'enhanced_vetting' | 'campaign_expedite' | string;
      label: string;
      amount: number;
      required: boolean;
      selected: boolean;
      description: string;
    }>;
    hasExistingNonReleasedPhoneNumber: boolean;
    totalWithDefaults: number;
    totalWithSelectedOptions: number;
  };
  topUpOptions: number[];
  usage: {
    cycleMonth: string;
    smsUnits: number;
    mmsUnits: number;
    activePhoneNumbers: number;
    activeCampaigns: number;
    heldInboundCount: number;
    estimatedMonthlyRecurring: number;
  };
  recentLedgerEntries: Array<{
    id: string;
    entryType: 'credit' | 'debit' | 'hold' | 'release';
    category: string;
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: string;
  }>;
}

function formatCurrency(value: number, precise = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: precise ? 4 : 2,
    maximumFractionDigits: precise ? 4 : 2,
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
    case 'credit':
      return 'success';
    case 'hold':
      return 'warning';
    case 'suspended':
    case 'debit':
      return 'destructive';
    default:
      return 'info';
  }
}

function labelize(value: string) {
  return value.replace(/_/g, ' ');
}

export function SubscriptionsPage() {
  const [searchParams] = useSearchParams();
  const [summary, setSummary] = useState<WalletBillingSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isSettingUpCard, setIsSettingUpCard] = useState(false);
  const [isOpeningOnboardingCheckout, setIsOpeningOnboardingCheckout] = useState(false);
  const [includeEnhancedVetting, setIncludeEnhancedVetting] = useState(false);
  const [includeCampaignExpedite, setIncludeCampaignExpedite] = useState(false);
  const [activeTopUpAmount, setActiveTopUpAmount] = useState<number | null>(null);
  const [customTopUpAmount, setCustomTopUpAmount] = useState('250');
  const [isReleasingHeld, setIsReleasingHeld] = useState(false);

  const customAmount = useMemo(() => Number(customTopUpAmount), [customTopUpAmount]);
  const customTopUpInvalid = !Number.isFinite(customAmount) || customAmount < 250;
  const onboardingCart = summary?.onboardingCart ?? null;
  const onboardingSelectedTotal = useMemo(() => {
    if (!onboardingCart) {
      return 0;
    }

    return onboardingCart.totalWithDefaults +
      onboardingCart.optionalLineItems.reduce((total, item) => {
        if (item.key === 'enhanced_vetting' && includeEnhancedVetting) {
          return total + item.amount;
        }

        if (item.key === 'campaign_expedite' && includeCampaignExpedite) {
          return total + item.amount;
        }

        return total;
      }, 0);
  }, [includeCampaignExpedite, includeEnhancedVetting, onboardingCart]);

  const loadSummary = async () => {
    const response = await api.getWalletBillingSummary();
    if (response.success && response.data) {
      setSummary(response.data);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const walletTopupStatus = searchParams.get('wallet_topup');
        const paymentMethodStatus = searchParams.get('payment_method');
        const sessionId = searchParams.get('session_id');

        const onboardingStatus = searchParams.get('onboarding');

        if (onboardingStatus === 'success' && sessionId) {
          const response = await api.completeOnboardingCheckout({ sessionId });
          if (response.success && response.data) {
            setSummary(response.data);
          }
          notify.success('Onboarding package paid', 'Wallet funds and setup fees were recorded.');
          window.history.replaceState({}, '', '/subscriptions');
        } else if (onboardingStatus === 'cancelled') {
          notify.error('Onboarding checkout cancelled', 'The Stripe checkout session was not completed.');
          window.history.replaceState({}, '', '/subscriptions');
        }

        if (walletTopupStatus === 'success' && sessionId) {
          const response = await api.completeMessageCreditTopupCheckout({ sessionId });
          if (response.success && response.data) {
            setSummary(response.data);
          }
          notify.success('Wallet funded', 'The wallet balance was updated.');
          window.history.replaceState({}, '', '/subscriptions');
        } else if (walletTopupStatus === 'cancelled') {
          notify.error('Top-up cancelled', 'The Stripe checkout session was not completed.');
          window.history.replaceState({}, '', '/subscriptions');
        }

        if (paymentMethodStatus === 'success' && sessionId) {
          const response = await api.completePaymentMethodSetup({ sessionId });
          if (response.success && response.data) {
            setSummary(response.data);
          }
          notify.success('Payment method saved', 'The saved card is ready for automatic MRC charges.');
          window.history.replaceState({}, '', '/subscriptions');
        } else if (paymentMethodStatus === 'cancelled') {
          notify.error('Setup cancelled', 'No payment method was saved.');
          window.history.replaceState({}, '', '/subscriptions');
        }

        await loadSummary();
      } catch (error) {
        notify.error(
          'Billing unavailable',
          error instanceof Error ? error.message : 'Unable to load wallet details.'
        );
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();
  }, [searchParams]);

  const handleOpenPortal = async () => {
    setIsOpeningPortal(true);
    const checkoutWindow = reserveCheckoutWindow();
    let checkoutOpened = false;

    try {
      const response = await api.createBillingPortalSession();
      if (!response.success || !response.data?.url) {
        throw new Error('Stripe billing portal URL was not returned.');
      }

      checkoutOpened = true;
      checkoutWindow.open(response.data.url);
    } catch (error) {
      notify.error(
        'Billing portal unavailable',
        error instanceof Error ? error.message : 'Unable to open the Stripe billing portal.'
      );
    } finally {
      if (!checkoutOpened) {
        checkoutWindow.close();
      }
      setIsOpeningPortal(false);
    }
  };

  const handleSetupCard = async () => {
    setIsSettingUpCard(true);

    try {
      const response = await api.createPaymentMethodSetupSession();
      if (!response.success || !response.data?.checkoutUrl) {
        throw new Error('Stripe setup URL was not returned.');
      }

      window.location.href = response.data.checkoutUrl;
    } catch (error) {
      notify.error(
        'Payment method setup unavailable',
        error instanceof Error ? error.message : 'Unable to start Stripe setup.'
      );
    } finally {
      setIsSettingUpCard(false);
    }
  };

  const handleTopUp = async (amountDollars: number) => {
    setActiveTopUpAmount(amountDollars);
    const checkoutWindow = reserveCheckoutWindow();
    let checkoutOpened = false;

    try {
      const response = await api.createMessageCreditTopupCheckout(amountDollars);
      if (!response.success || !response.data?.checkoutUrl) {
        throw new Error('Stripe top-up checkout URL was not returned.');
      }

      checkoutOpened = true;
      checkoutWindow.open(response.data.checkoutUrl);
      notify.success('Checkout opened', 'Complete Stripe checkout in the new tab to add credits.');
    } catch (error) {
      notify.error(
        'Top-up unavailable',
        error instanceof Error ? error.message : 'Unable to start the wallet top-up.'
      );
    } finally {
      if (!checkoutOpened) {
        checkoutWindow.close();
      }
      setActiveTopUpAmount(null);
    }
  };

  const handleOnboardingCheckout = async () => {
    if (!onboardingCart) return;

    setIsOpeningOnboardingCheckout(true);
    const checkoutWindow = reserveCheckoutWindow();
    let checkoutOpened = false;

    try {
      const response = await api.createOnboardingCheckout({
        topUpAmount: onboardingCart.topUpAmount,
        includeEnhancedVetting,
        includeCampaignExpedite,
      });
      if (!response.success || !response.data?.checkoutUrl) {
        throw new Error('Stripe onboarding checkout URL was not returned.');
      }

      checkoutOpened = true;
      checkoutWindow.open(response.data.checkoutUrl);
      notify.success('Checkout opened', 'Complete Stripe checkout in the new tab to fund onboarding.');
    } catch (error) {
      notify.error(
        'Onboarding checkout unavailable',
        error instanceof Error ? error.message : 'Unable to start onboarding checkout.'
      );
    } finally {
      if (!checkoutOpened) {
        checkoutWindow.close();
      }
      setIsOpeningOnboardingCheckout(false);
    }
  };

  const handleReleaseHeld = async () => {
    setIsReleasingHeld(true);

    try {
      const response = await api.releaseHeldInboundMessages();
      if (response.success) {
        notify.success('Held inbound checked', `${response.data?.released ?? 0} message(s) released.`);
        await loadSummary();
      }
    } catch (error) {
      notify.error(
        'Release failed',
        error instanceof Error ? error.message : 'Unable to release held inbound messages.'
      );
    } finally {
      setIsReleasingHeld(false);
    }
  };

  return (
    <div>
      <Header
        title="Billing"
        subtitle="Wallet balance, rates, saved card, and usage ledger."
      />

      <PageShell>
        {isLoading ? (
          <PageSection className="p-8">
            <div className="flex items-center justify-center gap-3 text-slate-600 dark:text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading billing wallet...</span>
            </div>
          </PageSection>
        ) : summary ? (
          <>
            <PageSection className="p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(summary.account.status)} dot>
                      {summary.account.status}
                    </Badge>
                    <Badge variant="outline">{summary.account.pricingTierLabel} tier</Badge>
                    {summary.account.hasSavedPaymentMethod ? (
                      <Badge variant="success">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Card saved
                      </Badge>
                    ) : (
                      <Badge variant="warning">Card required</Badge>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Wallet Balance</p>
                    <h2 className="mt-1 text-4xl font-semibold text-slate-950 dark:text-slate-50">
                      {formatCurrency(summary.account.walletBalance)}
                    </h2>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={handleSetupCard}
                    isLoading={isSettingUpCard}
                    leftIcon={<CreditCard className="h-4 w-4" />}
                  >
                    Save Card
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleOpenPortal}
                    isLoading={isOpeningPortal}
                    disabled={!summary.account.hasStripeCustomer}
                    leftIcon={<CreditCard className="h-4 w-4" />}
                  >
                    Stripe Portal
                  </Button>
                </div>
              </div>

              {summary.account.status === 'suspended' ? (
                <div className="mt-6 rounded-[8px] border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">Billing suspended</p>
                      <p className="mt-1">
                        {summary.account.suspensionReason || 'Payment action is required.'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </PageSection>

            {onboardingCart?.requiresOnboardingPackage ? (
              <PageSection className="p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={onboardingCart.isNewCustomer ? 'info' : 'warning'}>
                        {onboardingCart.isNewCustomer ? 'New onboarding' : 'Onboarding required'}
                      </Badge>
                      {onboardingCart.hasExistingNonReleasedPhoneNumber ? (
                        <Badge variant="outline">Existing number detected</Badge>
                      ) : (
                        <Badge variant="outline">First number included</Badge>
                      )}
                    </div>
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                      Onboarding Cart
                    </h3>
                    <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                      Pay the setup package once. Only the wallet top-up becomes spendable balance; setup, first-month recurring items, and selected add-ons are recorded separately.
                    </p>
                  </div>
                  <div className="text-left lg:text-right">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Package total</p>
                    <p className="mt-1 text-3xl font-semibold text-slate-950 dark:text-slate-50">
                      {formatCurrency(onboardingSelectedTotal)}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-3">
                    {onboardingCart.requiredLineItems.map((item) => (
                      <PageInset key={item.key} className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-950 dark:text-slate-50">{item.label}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{item.description}</p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold text-slate-950 dark:text-slate-50">
                            {formatCurrency(item.amount)}
                          </span>
                        </div>
                      </PageInset>
                    ))}
                  </div>

                  <div className="space-y-4">
                    <PageInset className="p-4">
                      <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Optional Add-ons</p>
                      <div className="mt-4 space-y-3">
                        {onboardingCart.optionalLineItems.map((item) => {
                          const checked =
                            item.key === 'enhanced_vetting'
                              ? includeEnhancedVetting
                              : item.key === 'campaign_expedite'
                                ? includeCampaignExpedite
                                : item.selected;

                          return (
                            <label key={item.key} className="flex cursor-pointer items-start gap-3">
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                                checked={checked}
                                onChange={(event) => {
                                  if (item.key === 'enhanced_vetting') {
                                    setIncludeEnhancedVetting(event.target.checked);
                                  }

                                  if (item.key === 'campaign_expedite') {
                                    setIncludeCampaignExpedite(event.target.checked);
                                  }
                                }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center justify-between gap-3 text-sm font-medium text-slate-950 dark:text-slate-50">
                                  <span>{item.label}</span>
                                  <span className="shrink-0">{formatCurrency(item.amount)}</span>
                                </span>
                                <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                                  {item.description}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </PageInset>

                    <Button
                      onClick={handleOnboardingCheckout}
                      isLoading={isOpeningOnboardingCheckout}
                      className="w-full"
                      leftIcon={<CreditCard className="h-4 w-4" />}
                    >
                      Checkout Onboarding Package
                    </Button>
                  </div>
                </div>
              </PageSection>
            ) : null}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.9fr)]">
              <div className="space-y-5">
                <PageSection className="p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Top Up</h3>
                    <Wallet className="h-5 w-5 text-primary" />
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {summary.topUpOptions.map((amount) => (
                      <Button
                        key={amount}
                        variant="outline"
                        onClick={() => handleTopUp(amount)}
                        isLoading={activeTopUpAmount === amount}
                      >
                        {formatCurrency(amount)}
                      </Button>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <Input
                      type="number"
                      min={250}
                      step={50}
                      value={customTopUpAmount}
                      onChange={(event) => setCustomTopUpAmount(event.target.value)}
                      aria-label="Custom top-up amount"
                    />
                    <Button
                      onClick={() => handleTopUp(customAmount)}
                      disabled={customTopUpInvalid}
                      isLoading={activeTopUpAmount === customAmount}
                    >
                      Custom Top-up
                    </Button>
                  </div>

                  {summary.prepayBalanceNote ? (
                    <div className="mt-4 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{summary.prepayBalanceNote}</p>
                      </div>
                    </div>
                  ) : null}
                </PageSection>

                <PageSection className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Rates</h3>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <PageInset className="p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <MessageSquareMore className="h-4 w-4" />
                        SMS
                      </div>
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
                        {formatCurrency(summary.rates.sms, true)}
                      </p>
                    </PageInset>
                    <PageInset className="p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <MessageSquareMore className="h-4 w-4" />
                        MMS
                      </div>
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
                        {formatCurrency(summary.rates.mms, true)}
                      </p>
                    </PageInset>
                    <PageInset className="p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <Phone className="h-4 w-4" />
                        Phone MRC
                      </div>
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
                        {formatCurrency(summary.rates.phoneNumberMonthly)}
                      </p>
                    </PageInset>
                    <PageInset className="p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <RefreshCw className="h-4 w-4" />
                        Campaign MRC
                      </div>
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
                        {formatCurrency(summary.rates.campaignMonthly)}
                      </p>
                    </PageInset>
                  </div>

                  {(summary.carrierSurcharges?.length ?? 0) > 0 ? (
                    <div className="mt-5">
                      <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                        Carrier Surcharges
                      </h4>
                      <div className="mt-3 overflow-hidden rounded-[8px] border border-slate-200 dark:border-slate-800">
                        <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-slate-50 px-4 py-2 text-xs font-medium uppercase text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                          <span>Carrier</span>
                          <span className="text-right">SMS</span>
                          <span className="text-right">MMS</span>
                        </div>
                        {summary.carrierSurcharges?.map((surcharge) => (
                          <div
                            key={surcharge.carrier}
                            className="grid grid-cols-[1.4fr_1fr_1fr] border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800"
                          >
                            <span className="font-medium text-slate-950 dark:text-slate-50">
                              {surcharge.carrier}
                            </span>
                            <span className="text-right text-slate-700 dark:text-slate-300">
                              {formatCurrency(surcharge.sms, true)}
                            </span>
                            <span className="text-right text-slate-700 dark:text-slate-300">
                              {formatCurrency(surcharge.mms, true)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {summary.carrierSurchargeNote ? (
                        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                          {summary.carrierSurchargeNote}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </PageSection>

                <PageSection className="p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Ledger</h3>
                    {summary.usage.heldInboundCount > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleReleaseHeld}
                        isLoading={isReleasingHeld}
                        leftIcon={<RefreshCw className="h-4 w-4" />}
                      >
                        Release Held
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-5 space-y-3">
                    {summary.recentLedgerEntries.length > 0 ? summary.recentLedgerEntries.map((entry) => (
                      <Card key={entry.id} className="border-slate-200 shadow-sm dark:border-slate-800">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-slate-950 dark:text-slate-50">
                                {entry.description}
                              </p>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {formatDate(entry.createdAt)} · {labelize(entry.category)}
                              </p>
                            </div>
                            <div className="text-right">
                              <Badge variant={statusVariant(entry.entryType)}>{entry.entryType}</Badge>
                              <p className="mt-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
                                {entry.entryType === 'debit' ? '-' : entry.entryType === 'credit' ? '+' : ''}
                                {formatCurrency(entry.amount)}
                              </p>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {formatCurrency(entry.balanceAfter)}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )) : (
                      <div className="rounded-[8px] border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        No ledger entries yet.
                      </div>
                    )}
                  </div>
                </PageSection>
              </div>

              <div className="space-y-5">
                <PageSection className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Usage</h3>
                  <div className="mt-5 grid gap-4">
                    <PageInset className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">SMS units</span>
                        <span className="text-sm font-medium text-slate-950 dark:text-slate-50">
                          {summary.usage.smsUnits.toLocaleString()}
                        </span>
                      </div>
                    </PageInset>
                    <PageInset className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">MMS units</span>
                        <span className="text-sm font-medium text-slate-950 dark:text-slate-50">
                          {summary.usage.mmsUnits.toLocaleString()}
                        </span>
                      </div>
                    </PageInset>
                    <PageInset className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Active numbers</span>
                        <span className="text-sm font-medium text-slate-950 dark:text-slate-50">
                          {summary.usage.activePhoneNumbers}
                        </span>
                      </div>
                    </PageInset>
                    <PageInset className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Approved campaigns</span>
                        <span className="text-sm font-medium text-slate-950 dark:text-slate-50">
                          {summary.usage.activeCampaigns}
                        </span>
                      </div>
                    </PageInset>
                    <PageInset className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Held inbound</span>
                        <span className="text-sm font-medium text-slate-950 dark:text-slate-50">
                          {summary.usage.heldInboundCount}
                        </span>
                      </div>
                    </PageInset>
                  </div>
                </PageSection>

                <PageSection className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Monthly Charges</h3>
                  <div className="mt-5 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <span className="text-slate-600 dark:text-slate-400">Campaign Monthly</span>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-500">Per approved campaign</p>
                      </div>
                      <span className="shrink-0 text-right font-medium text-slate-950 dark:text-slate-50">
                        {formatCurrency(summary.rates.campaignMonthly)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <span className="text-slate-600 dark:text-slate-400">Phone Numbers Monthly</span>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-500">Per active phone number</p>
                      </div>
                      <span className="shrink-0 text-right font-medium text-slate-950 dark:text-slate-50">
                        {formatCurrency(summary.rates.phoneNumberMonthly)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Estimated MRC</span>
                      <span className="font-medium text-slate-950 dark:text-slate-50">
                        {formatCurrency(summary.usage.estimatedMonthlyRecurring)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Next MRC run</span>
                      <span className="font-medium text-slate-950 dark:text-slate-50">
                        {formatDate(summary.account.mrcNextRunAt)}
                      </span>
                    </div>
                  </div>
                </PageSection>

                <PageSection className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">One-Time Fees</h3>
                  <div className="mt-5 space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Basic Setup</span>
                      <span className="font-medium text-slate-950 dark:text-slate-50">
                        {summary.account.setupFeeChargedAt ? 'Paid' : formatCurrency(summary.rates.basicSetup)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="min-w-0 text-slate-600 dark:text-slate-400">Enhanced Vetting Setup - Optional</span>
                      <span className="shrink-0 text-right font-medium text-slate-950 dark:text-slate-50">
                        {formatCurrency(summary.rates.enhancedVetting)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="min-w-0 text-slate-600 dark:text-slate-400">Campaign Expedite Setup - Optional</span>
                      <span className="shrink-0 text-right font-medium text-slate-950 dark:text-slate-50">
                        {formatCurrency(summary.rates.campaignExpedite)}
                      </span>
                    </div>
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
