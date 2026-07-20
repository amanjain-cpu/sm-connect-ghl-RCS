import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CreditCard,
  Image,
  Loader2,
  MapPin,
  MessageSquareMore,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageInset, PageSection, PageShell } from '@/components/layout/page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { reserveCheckoutWindow } from '@/lib/external-checkout';
import { cn } from '@/lib/utils';
import { notify } from '@/stores/notification.store';

interface PricingTier {
  id: 'tier_250' | 'tier_500' | 'tier_1400';
  label: string;
  minTopUpAmount: number;
  maxTopUpAmount: number | null;
  smsRate: number;
  mmsRate: number;
  campaignMonthlyRate: number;
  phoneNumberMonthlyRate: number;
  basicSetupFee: number;
  enhancedVettingFee: number;
  campaignExpediteFee: number;
}

interface AvailableNumber {
  phoneNumber: string;
  formattedNumber: string;
  areaCode: string;
  capabilities: {
    sms: boolean;
    mms: boolean;
    voice: boolean;
  };
  monthlyPrice?: number | null;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
}

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
    pricingTier?: PricingTier['id'];
  };
  pricingCatalog?: {
    fixedTopUpOptions: number[];
    tiers: PricingTier[];
  };
  onboardingProvisioning?: {
    status: 'none' | 'succeeded' | 'pending' | 'failed';
    phoneNumber?: string;
    phoneNumberId?: string;
    campaignId?: string | null;
    message?: string;
    error?: string;
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

const STATE_OPTIONS = [
  { label: 'California', value: 'CA' },
  { label: 'Texas', value: 'TX' },
  { label: 'New York', value: 'NY' },
  { label: 'Florida', value: 'FL' },
  { label: 'Illinois', value: 'IL' },
  { label: 'New Jersey', value: 'NJ' },
];

const isPurchasableCampaign = (campaign: Campaign) =>
  ['pending_approval', 'approved'].includes(campaign.status);

const campaignStatusLabel = (status: string) =>
  status === 'pending_approval'
    ? 'Pending approval'
    : status === 'approved'
      ? 'Approved'
      : labelize(status);

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
  const [selectedOnboardingTopUp, setSelectedOnboardingTopUp] = useState(250);
  const [onboardingNumbers, setOnboardingNumbers] = useState<AvailableNumber[]>([]);
  const [selectedOnboardingNumber, setSelectedOnboardingNumber] = useState<AvailableNumber | null>(null);
  const [onboardingNumberState, setOnboardingNumberState] = useState('');
  const [onboardingNumberAreaCode, setOnboardingNumberAreaCode] = useState('');
  const [onboardingNumberContains, setOnboardingNumberContains] = useState('');
  const [onboardingFriendlyName, setOnboardingFriendlyName] = useState('');
  const [onboardingCampaignId, setOnboardingCampaignId] = useState('');
  const [onboardingCampaigns, setOnboardingCampaigns] = useState<Campaign[]>([]);
  const [isSearchingOnboardingNumbers, setIsSearchingOnboardingNumbers] = useState(false);
  const [onboardingNumberError, setOnboardingNumberError] = useState('');
  const [onboardingProviderBlocked, setOnboardingProviderBlocked] = useState<string | null>(null);

  const customAmount = useMemo(() => Number(customTopUpAmount), [customTopUpAmount]);
  const customTopUpInvalid = !Number.isFinite(customAmount) || customAmount < 250;
  const onboardingCart = summary?.onboardingCart ?? null;
  const packageOptions = useMemo(
    () => summary?.pricingCatalog?.fixedTopUpOptions ?? [250, 500, 1400],
    [summary?.pricingCatalog?.fixedTopUpOptions]
  );
  const selectedPricingTier = useMemo(() => {
    const tiers = summary?.pricingCatalog?.tiers ?? [];
    return tiers.find((tier) =>
      selectedOnboardingTopUp >= tier.minTopUpAmount &&
      (tier.maxTopUpAmount === null || selectedOnboardingTopUp <= tier.maxTopUpAmount)
    ) ?? tiers[0] ?? null;
  }, [selectedOnboardingTopUp, summary?.pricingCatalog?.tiers]);
  const onboardingDisplayCart = useMemo(() => {
    if (!onboardingCart || !selectedPricingTier) {
      return onboardingCart;
    }

    const requiredLineItems = onboardingCart.requiredLineItems.map((item) => {
      if (item.key === 'wallet_topup') {
        return {
          ...item,
          label: `Wallet top-up (${selectedPricingTier.label} tier)`,
          amount: selectedOnboardingTopUp,
        };
      }

      if (item.key === 'basic_setup') {
        return {
          ...item,
          amount: selectedPricingTier.basicSetupFee,
        };
      }

      if (item.key === 'campaign_mrc') {
        return {
          ...item,
          amount: selectedPricingTier.campaignMonthlyRate,
        };
      }

      if (item.key === 'phone_number_mrc') {
        return {
          ...item,
          amount: selectedPricingTier.phoneNumberMonthlyRate,
        };
      }

      return item;
    });

    const optionalLineItems = onboardingCart.optionalLineItems.map((item) => {
      if (item.key === 'enhanced_vetting') {
        return {
          ...item,
          amount: selectedPricingTier.enhancedVettingFee,
          selected: includeEnhancedVetting,
        };
      }

      if (item.key === 'campaign_expedite') {
        return {
          ...item,
          amount: selectedPricingTier.campaignExpediteFee,
          selected: includeCampaignExpedite,
        };
      }

      return item;
    });

    const totalWithDefaults = requiredLineItems.reduce(
      (total, item) => total + (item.selected ? item.amount : 0),
      0
    );
    const optionalTotal = optionalLineItems.reduce(
      (total, item) => total + (item.selected ? item.amount : 0),
      0
    );

    return {
      ...onboardingCart,
      topUpAmount: selectedOnboardingTopUp,
      pricingTier: selectedPricingTier.id,
      requiredLineItems,
      optionalLineItems,
      totalWithDefaults,
      totalWithSelectedOptions: totalWithDefaults + optionalTotal,
    };
  }, [
    includeCampaignExpedite,
    includeEnhancedVetting,
    onboardingCart,
    selectedOnboardingTopUp,
    selectedPricingTier,
  ]);
  const requiresFirstNumberSelection = Boolean(
    onboardingDisplayCart?.requiredLineItems.some(
      (item) => item.key === 'phone_number_mrc' && item.selected && item.amount > 0
    )
  );
  const onboardingSelectedTotal = onboardingDisplayCart?.totalWithSelectedOptions ?? 0;

  useEffect(() => {
    if (!onboardingCart) {
      return;
    }

    setSelectedOnboardingTopUp((current) =>
      packageOptions.includes(current) ? current : onboardingCart.topUpAmount
    );
  }, [onboardingCart, packageOptions]);

  useEffect(() => {
    if (!requiresFirstNumberSelection) {
      setSelectedOnboardingNumber(null);
      setOnboardingNumbers([]);
      setOnboardingCampaigns([]);
      return;
    }

    const loadCampaigns = async () => {
      try {
        const response = await api.getCampaigns();
        if (response.success && response.data) {
          setOnboardingCampaigns(response.data.filter(isPurchasableCampaign));
        }
      } catch (error) {
        console.error('Failed to load onboarding campaigns:', error);
      }
    };

    loadCampaigns();
  }, [requiresFirstNumberSelection]);

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
            const provisioning = response.data.onboardingProvisioning;
            if (provisioning?.status === 'succeeded') {
              notify.success('Onboarding package paid', provisioning.message || 'Wallet funds, setup fees, and the selected number were recorded.');
            } else if (provisioning?.status === 'pending') {
              notify.success('Onboarding package paid', provisioning.message || 'The number selection was saved for provider retry.');
            } else if (provisioning?.status === 'failed') {
              notify.error('Number provisioning failed', provisioning.message || provisioning.error || 'Wallet funds and setup fees were recorded.');
            } else {
              notify.success('Onboarding package paid', 'Wallet funds and setup fees were recorded.');
            }
          } else {
            notify.success('Onboarding package paid', 'Wallet funds and setup fees were recorded.');
          }
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

  const handleOnboardingNumberSearch = async () => {
    if (!onboardingNumberAreaCode && !onboardingNumberContains && !onboardingNumberState) {
      setOnboardingNumberError('Enter a state, area code, or digits to search.');
      return;
    }

    setOnboardingNumberError('');
    setOnboardingProviderBlocked(null);
    setIsSearchingOnboardingNumbers(true);

    try {
      const response = await api.searchAvailableNumbers({
        areaCode: onboardingNumberAreaCode || undefined,
        contains: onboardingNumberContains || undefined,
        state: onboardingNumberState || undefined,
        limit: 20,
      });

      if (response.success && response.data) {
        setOnboardingNumbers(response.data);
        setSelectedOnboardingNumber(null);
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && (
        error.code === 'PROVIDER_CONNECTION_BLOCKED' ||
        error.code === 'SEARCH_CRITERIA_REQUIRED'
      )) {
        setOnboardingProviderBlocked(error.message);
        setOnboardingNumbers([]);
        return;
      }

      setOnboardingNumberError(error instanceof Error ? error.message : 'Failed to search for numbers.');
    } finally {
      setIsSearchingOnboardingNumbers(false);
    }
  };

  const handleOnboardingCheckout = async () => {
    if (!onboardingDisplayCart) return;

    if (requiresFirstNumberSelection && !selectedOnboardingNumber) {
      notify.error('Select a phone number', 'Choose the first 10DLC number before starting onboarding checkout.');
      return;
    }

    setIsOpeningOnboardingCheckout(true);
    const checkoutWindow = reserveCheckoutWindow();
    let checkoutOpened = false;

    try {
      const response = await api.createOnboardingCheckout({
        topUpAmount: onboardingDisplayCart.topUpAmount,
        includeEnhancedVetting,
        includeCampaignExpedite,
        phoneNumber: selectedOnboardingNumber?.phoneNumber,
        friendlyName: onboardingFriendlyName || undefined,
        campaignId: onboardingCampaignId || undefined,
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

            {onboardingDisplayCart?.requiresOnboardingPackage ? (
              <PageSection className="p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={onboardingDisplayCart.isNewCustomer ? 'info' : 'warning'}>
                        {onboardingDisplayCart.isNewCustomer ? 'New onboarding' : 'Onboarding required'}
                      </Badge>
                      {onboardingDisplayCart.hasExistingNonReleasedPhoneNumber ? (
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

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {packageOptions.map((amount) => {
                    const tier = summary.pricingCatalog?.tiers.find((candidate) =>
                      amount >= candidate.minTopUpAmount &&
                      (candidate.maxTopUpAmount === null || amount <= candidate.maxTopUpAmount)
                    );
                    const selected = selectedOnboardingTopUp === amount;

                    return (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setSelectedOnboardingTopUp(amount)}
                        className={cn(
                          'rounded-[8px] border px-4 py-4 text-left transition-colors',
                          selected
                            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                            : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700'
                        )}
                      >
                        <span className="block text-lg font-semibold text-slate-950 dark:text-slate-50">
                          {formatCurrency(amount)}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                          {tier?.label ?? formatCurrency(amount)} tier
                        </span>
                        <span className="mt-3 block text-xs leading-5 text-slate-600 dark:text-slate-300">
                          Phone MRC {formatCurrency(tier?.phoneNumberMonthlyRate ?? 0)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-3">
                    {onboardingDisplayCart.requiredLineItems.map((item) => (
                      <PageInset key={item.key} className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-950 dark:text-slate-50">{item.label}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{item.description}</p>
                            {item.key === 'phone_number_mrc' && selectedOnboardingNumber ? (
                              <p className="mt-2 inline-flex items-center gap-2 rounded-[8px] bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
                                <Check className="h-3.5 w-3.5" />
                                {selectedOnboardingNumber.formattedNumber}
                              </p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-sm font-semibold text-slate-950 dark:text-slate-50">
                            {formatCurrency(item.amount)}
                          </span>
                        </div>
                      </PageInset>
                    ))}

                    {requiresFirstNumberSelection ? (
                      <PageInset className="p-4">
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                                First Phone Number
                              </p>
                              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                Select one available US 10DLC number before checkout.
                              </p>
                            </div>
                            {selectedOnboardingNumber ? (
                              <Badge variant="success">
                                <Check className="h-3.5 w-3.5" />
                                Selected
                              </Badge>
                            ) : (
                              <Badge variant="warning">Required</Badge>
                            )}
                          </div>

                          <div className="grid gap-3 md:grid-cols-3">
                            <div className="space-y-2">
                              <Label>State</Label>
                              <Select
                                value={onboardingNumberState}
                                onValueChange={(value) => {
                                  setOnboardingNumberState(value);
                                  setOnboardingNumberAreaCode('');
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="State" />
                                </SelectTrigger>
                                <SelectContent>
                                  {STATE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label} ({option.value})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-2">
                              <Label>Area Code</Label>
                              <Input
                                placeholder="415"
                                value={onboardingNumberAreaCode}
                                onChange={(event) => {
                                  setOnboardingNumberAreaCode(event.target.value.replace(/\D/g, '').slice(0, 3));
                                  setOnboardingNumberState('');
                                }}
                                leftIcon={<MapPin className="h-4 w-4" />}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Contains</Label>
                              <Input
                                placeholder="1234"
                                value={onboardingNumberContains}
                                onChange={(event) => setOnboardingNumberContains(event.target.value.replace(/\D/g, '').slice(0, 7))}
                                leftIcon={<Search className="h-4 w-4" />}
                              />
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleOnboardingNumberSearch}
                            isLoading={isSearchingOnboardingNumbers}
                            leftIcon={<Search className="h-4 w-4" />}
                          >
                            Search Numbers
                          </Button>

                          {onboardingNumberError ? (
                            <p className="text-sm text-destructive">{onboardingNumberError}</p>
                          ) : null}

                          {onboardingProviderBlocked ? (
                            <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
                              {onboardingProviderBlocked}
                            </div>
                          ) : null}

                          {onboardingNumbers.length > 0 ? (
                            <div className="grid max-h-[320px] gap-2 overflow-y-auto pr-1">
                              {onboardingNumbers.map((number) => {
                                const selected = selectedOnboardingNumber?.phoneNumber === number.phoneNumber;

                                return (
                                  <button
                                    key={number.phoneNumber}
                                    type="button"
                                    onClick={() => setSelectedOnboardingNumber(number)}
                                    className={cn(
                                      'rounded-[8px] border px-4 py-3 text-left transition-colors',
                                      selected
                                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700'
                                    )}
                                  >
                                    <span className="flex items-center justify-between gap-3">
                                      <span className="font-mono text-base font-semibold text-slate-950 dark:text-slate-50">
                                        {number.formattedNumber}
                                      </span>
                                      <span className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                                        {formatCurrency(selectedPricingTier?.phoneNumberMonthlyRate ?? 0)}/mo
                                      </span>
                                    </span>
                                    <span className="mt-2 flex flex-wrap items-center gap-2">
                                      {number.capabilities.sms ? (
                                        <Badge variant="outline" className="gap-1 text-xs">
                                          <MessageSquareMore className="h-3 w-3" /> SMS
                                        </Badge>
                                      ) : null}
                                      {number.capabilities.mms ? (
                                        <Badge variant="outline" className="gap-1 text-xs">
                                          <Image className="h-3 w-3" /> MMS
                                        </Badge>
                                      ) : null}
                                      {number.capabilities.voice ? (
                                        <Badge variant="outline" className="gap-1 text-xs">
                                          <PhoneCall className="h-3 w-3" /> Voice
                                        </Badge>
                                      ) : null}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Friendly Name</Label>
                              <Input
                                placeholder="Main business line"
                                value={onboardingFriendlyName}
                                onChange={(event) => setOnboardingFriendlyName(event.target.value)}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Campaign</Label>
                              <Select value={onboardingCampaignId} onValueChange={setOnboardingCampaignId}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Leave unassigned" />
                                </SelectTrigger>
                                <SelectContent>
                                  {onboardingCampaigns.map((campaign) => (
                                    <SelectItem key={campaign.id} value={campaign.id}>
                                      {campaign.name} - {campaignStatusLabel(campaign.status)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {onboardingCampaignId ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setOnboardingCampaignId('')}
                                >
                                  Leave unassigned
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </PageInset>
                    ) : null}
                  </div>

                  <div className="space-y-4">
                    <PageInset className="p-4">
                      <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Optional Add-ons</p>
                      <div className="mt-4 space-y-3">
                        {onboardingDisplayCart.optionalLineItems.map((item) => {
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
                      disabled={requiresFirstNumberSelection && !selectedOnboardingNumber}
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
