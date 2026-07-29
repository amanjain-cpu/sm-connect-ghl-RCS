import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDot,
  Megaphone,
  Phone,
  Plug,
  Send,
  Users,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell, PageSection } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { sanitizePlatformBranding } from '@/lib/platform-branding';

const crmPlatformId = `${'lead'}connector` as const;

interface PlatformConnection {
  id: string;
  platform: typeof crmPlatformId | 'shopify' | 'hubspot' | 'salesforce' | 'zoho';
  platformAccountId: string;
  platformAccountName: string | null;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  installation: {
    id: string;
    lifecycleState:
      | 'installed'
      | 'business_details_needed'
      | 'connection_pending'
      | 'brand_pending'
      | 'campaign_pending'
      | 'campaign_approved'
      | 'number_setup_required'
      | 'port_in_progress'
      | 'provider_not_activated'
      | 'ready'
      | 'error_attention_required';
    resourceCounts: {
      totalBrands: number;
      pendingBrands: number;
      rejectedBrands: number;
      totalCampaigns: number;
      pendingCampaigns: number;
      rejectedCampaigns: number;
      approvedCampaigns: number;
      activeNumbers: number;
      outboundMessages: number;
      activePortOrders: number;
    };
    checklist: Array<{
      key: string;
      label: string;
      complete: boolean;
      helper: string;
    }>;
  } | null;
}

interface BrandSummary {
  id: string;
  legalName: string;
  displayName: string;
  status: 'draft' | 'pending_verification' | 'verified' | 'unverified' | 'rejected' | 'suspended';
  brandRelationship: 'BASIC_ACCOUNT' | 'SMALL_ACCOUNT' | 'MEDIUM_ACCOUNT' | 'LARGE_ACCOUNT' | 'KEY_ACCOUNT' | null;
  businessContactEmail: string | null;
  providerVertical: string | null;
  referenceId: string | null;
}

const lifecycleLabels: Record<
  NonNullable<PlatformConnection['installation']>['lifecycleState'],
  string
> = {
  installed: 'Installed',
  business_details_needed: 'Business details needed',
  connection_pending: 'Connection pending',
  brand_pending: 'Brand pending',
  campaign_pending: 'Campaign pending',
  campaign_approved: 'Campaign approved',
  number_setup_required: 'Number setup required',
  port_in_progress: 'Port in progress',
  provider_not_activated: 'Embedded rollout active',
  ready: 'Ready',
  error_attention_required: 'Needs attention',
};

export function OnboardingPage() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadConnections = async () => {
      try {
        const [connectionsResponse, brandsResponse] = await Promise.all([
          api.getPlatformConnections(),
          api.getBrands(),
        ]);

        if (connectionsResponse.success && connectionsResponse.data) {
          setConnections(connectionsResponse.data);
        }

        if (brandsResponse.success && brandsResponse.data) {
          setBrands(brandsResponse.data);
        }
      } catch (error) {
        console.error('Failed to load onboarding data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadConnections();
  }, []);

  const crmConnection = useMemo(
    () => connections.find((connection) => connection.platform === crmPlatformId) ?? null,
    [connections]
  );

  const onboardingBrand = useMemo(
    () => brands.find((brand) => brand.status === 'verified')
      ?? brands.find((brand) => brand.status === 'pending_verification')
      ?? brands[0]
      ?? null,
    [brands]
  );

  const nextAction = useMemo(() => {
    if (!crmConnection) {
      return {
        title: 'Connect your CRM',
        description: 'Start by linking the CRM workspace that should use the embedded Signalmash workflow.',
        href: '/platforms',
        cta: 'Open platforms',
        icon: Plug,
      };
    }

    const lifecycle = crmConnection.installation?.lifecycleState;
    const installationCounts = crmConnection.installation?.resourceCounts;

    if (!crmConnection.installation || lifecycle === 'installed' || lifecycle === 'business_details_needed') {
      return {
        title: 'Register the business brand',
        description: 'The embedded rollout starts with business details and brand registration for A2P compliance.',
        href: '/brands/new',
        cta: 'Create brand',
        icon: Building2,
      };
    }

    if (lifecycle === 'brand_pending') {
      const hasRejectedBrand = brands.some((brand) => ['rejected', 'suspended'].includes(brand.status));
      const hasSubmittedBrand = brands.some((brand) => brand.status === 'pending_verification');

      if (hasRejectedBrand) {
        return {
          title: 'Fix the rejected brand',
          description: 'At least one brand needs correction before campaign registration can continue.',
          href: '/brands',
          cta: 'Fix brand',
          icon: Building2,
        };
      }

      if (hasSubmittedBrand) {
        return {
          title: 'Monitor brand review',
          description: 'Brand verification is in progress. Keep the brand record accurate and watch for approval or rejection updates.',
          href: '/brands',
          cta: 'Review brands',
          icon: Building2,
        };
      }

      return {
        title: 'Review and submit the brand',
        description: 'A verified brand is not available yet. Finish any missing business details and submit the brand before campaigns can be created.',
        href: '/brands',
        cta: 'Review brands',
        icon: Building2,
      };
    }

    if (lifecycle === 'campaign_pending') {
      return {
        title: installationCounts?.totalCampaigns ? 'Review campaign submission' : 'Create the primary campaign',
        description: installationCounts?.totalCampaigns
          ? 'The next blocker is campaign approval. Review the campaign, finish any missing compliance fields, and submit it to Signalmash.'
          : 'Create the first approved messaging campaign for this workspace so sender numbers can be provisioned against it.',
        href: installationCounts?.totalCampaigns ? '/campaigns' : '/campaigns/new',
        cta: installationCounts?.totalCampaigns ? 'Review campaigns' : 'Create campaign',
        icon: Megaphone,
      };
    }

    if (lifecycle === 'number_setup_required' || lifecycle === 'port_in_progress') {
      return {
        title: 'Provision numbers',
        description: 'Purchase or track ported numbers inside the embedded app before live traffic begins.',
        href: '/phone-numbers',
        cta: 'Manage numbers',
        icon: Phone,
      };
    }

    if (lifecycle === 'provider_not_activated' || lifecycle === 'ready') {
      return {
        title: 'Send SMS',
        description: 'Use the embedded messaging flow to validate outbound traffic, compliance state, and number readiness.',
        href: '/messages',
        cta: 'Open messages',
        icon: Send,
      };
    }

    return {
      title: 'Review installation state',
      description: 'The install needs attention before the embedded rollout can continue.',
      href: '/platforms',
      cta: 'View platforms',
      icon: Plug,
    };
  }, [crmConnection]);

  const quickLinks = [
    {
      title: 'Brands',
      description: 'Register and review the customer business identity.',
      href: '/brands',
      icon: Building2,
    },
    {
      title: 'Campaigns',
      description: 'Create the A2P campaign tied to the approved brand.',
      href: '/campaigns',
      icon: Megaphone,
    },
    {
      title: 'Phone Numbers',
      description: 'Buy, assign, and track sender numbers or active port requests.',
      href: '/phone-numbers',
      icon: Phone,
    },
    {
      title: 'Messages',
      description: 'Validate outbound traffic through the linked Signalmash sender path.',
      href: '/messages',
      icon: Send,
    },
  ];

  return (
    <div>
      <Header
        title="Onboarding"
        subtitle="Guide the embedded CRM rollout from app install through compliant messaging readiness."
      />

      <PageShell>
        <PageSection className="border-0 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 px-6 py-6 text-slate-50 shadow-xl shadow-slate-950/10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <Badge className="w-fit bg-white/10 text-slate-100" variant="outline">
                Embedded CRM Rollout
              </Badge>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  Connect your CRM, complete compliance onboarding, and validate messaging
                </h2>
                <p className="max-w-xl text-sm leading-6 text-slate-300 md:text-base">
                  This workflow covers the live self-serve path: connect your CRM, register the brand,
                  submit the campaign, attach a sender number, and validate outbound traffic.
                </p>
              </div>
            </div>

            {crmConnection?.installation ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Current State</p>
                <p className="mt-2 text-2xl font-semibold">
                  {lifecycleLabels[crmConnection.installation.lifecycleState]}
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  {crmConnection.platformAccountName || crmConnection.platformAccountId}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Current State</p>
                <p className="mt-2 text-2xl font-semibold">Connect your CRM</p>
                <p className="mt-2 text-sm text-slate-300">
                  No platform installation is linked to this workspace yet.
                </p>
              </div>
            )}
          </div>
        </PageSection>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <CardContent className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Next Action</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    The guided next step for the currently connected workspace.
                  </p>
                </div>
                {crmConnection?.status === 'connected' && <Badge variant="success">Connected</Badge>}
              </div>

              {onboardingBrand && (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Brand in focus</Badge>
                    <Badge variant={onboardingBrand.status === 'verified' ? 'success' : onboardingBrand.status === 'pending_verification' ? 'warning' : 'secondary'}>
                      {onboardingBrand.status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <h4 className="mt-3 text-base font-semibold text-slate-950 dark:text-slate-50">
                    {onboardingBrand.legalName}
                  </h4>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="text-sm">
                      <p className="text-slate-500 dark:text-slate-400">Display Name</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{onboardingBrand.displayName}</p>
                    </div>
                    <div className="text-sm">
                      <p className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                        <Users className="h-4 w-4" />
                        Relationship
                      </p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{onboardingBrand.brandRelationship || 'Not set'}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-slate-500 dark:text-slate-400">Provider Vertical</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                        {onboardingBrand.providerVertical?.replace(/_/g, ' ') || 'Not set'}
                      </p>
                    </div>
                    <div className="text-sm">
                      <p className="text-slate-500 dark:text-slate-400">Business Contact Email</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                        {onboardingBrand.businessContactEmail || 'Not set'}
                      </p>
                    </div>
                    <div className="text-sm md:col-span-2">
                      <p className="text-slate-500 dark:text-slate-400">Reference ID</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                        {onboardingBrand.referenceId || 'Not set'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-slate-950 p-3 text-white dark:bg-slate-100 dark:text-slate-950">
                    <nextAction.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xl font-semibold text-slate-950 dark:text-slate-50">{nextAction.title}</h4>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                      {nextAction.description}
                    </p>
                    <Button className="mt-5" onClick={() => navigate(nextAction.href)}>
                      {nextAction.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {quickLinks.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => navigate(item.href)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700 dark:hover:bg-slate-900"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-slate-100 p-2 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-950 dark:text-slate-50">{item.title}</p>
                        <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-400">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Readiness Checklist</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Each step reflects the current embedded rollout state for the connected workspace.
              </p>

              {isLoading ? (
                <div className="mt-6 h-56 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
              ) : !crmConnection?.installation ? (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Connect a CRM workspace first. After OAuth completes, the embedded onboarding checklist will appear here automatically.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {crmConnection.installation.checklist.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {item.complete ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          ) : (
                            <CircleDot className="h-5 w-5 text-amber-600" />
                          )}
                          <p className="font-medium text-slate-950 dark:text-slate-50">
                            {sanitizePlatformBranding(item.label)}
                          </p>
                        </div>
                        <Badge variant={item.complete ? 'success' : 'secondary'}>
                          {item.complete ? 'Done' : 'Pending'}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                        {sanitizePlatformBranding(item.helper)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </PageShell>
    </div>
  );
}
