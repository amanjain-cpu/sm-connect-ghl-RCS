import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plug,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  ArrowRight,
  Building2,
  ShieldCheck,
  Link2,
  Sparkles,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell, PageSection } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { sanitizePlatformBranding } from '@/lib/platform-branding';
import { formatDateTime } from '@/lib/utils';

const crmPlatformId = `${'lead'}connector` as const;

interface PlatformConnection {
  id: string;
  platform: typeof crmPlatformId | 'shopify' | 'hubspot' | 'salesforce' | 'zoho';
  platformAccountId: string;
  platformAccountName: string | null;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  lastSyncAt: string | null;
  createdAt: string;
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
    connectedAt: string | null;
    lastSyncAt: string | null;
    providerActivation: {
      activatedAt: string | null;
      source: string | null;
      isActivated: boolean;
    };
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

interface AvailablePlatform {
  id: string;
  name: string;
  description: string;
  available: boolean;
  statusNote: string;
}

const platformConfigs: Record<
  string,
  {
    name: string;
    accent: string;
    surface: string;
    border: string;
  }
> = {
  [crmPlatformId]: {
    name: 'CRM Platform',
    accent: 'text-primary',
    surface: 'bg-primary/10',
    border: 'border-primary/20',
  },
  shopify: {
    name: 'Shopify',
    accent: 'text-primary',
    surface: 'bg-primary/10',
    border: 'border-primary/20',
  },
  hubspot: {
    name: 'HubSpot',
    accent: 'text-muted-foreground',
    surface: 'bg-muted',
    border: 'border-border',
  },
  salesforce: {
    name: 'Salesforce',
    accent: 'text-primary',
    surface: 'bg-primary/10',
    border: 'border-primary/20',
  },
  zoho: {
    name: 'Zoho',
    accent: 'text-destructive',
    surface: 'bg-destructive/10',
    border: 'border-destructive/20',
  },
};

const statusConfig = {
  connected: { label: 'Connected', icon: CheckCircle, variant: 'success' as const },
  disconnected: { label: 'Disconnected', icon: XCircle, variant: 'secondary' as const },
  pending: { label: 'Pending', icon: Clock, variant: 'warning' as const },
  error: { label: 'Error', icon: XCircle, variant: 'destructive' as const },
};

const lifecycleConfig: Record<
  NonNullable<PlatformConnection['installation']>['lifecycleState'],
  { label: string; tone: string; helper: string }
> = {
  installed: {
    label: 'Installed',
    tone: 'text-slate-700 dark:text-slate-300',
    helper: 'The app is installed, but customer setup has not started yet.',
  },
  business_details_needed: {
    label: 'Business details needed',
    tone: 'text-muted-foreground',
    helper: 'Brand registration cannot start until business details are completed.',
  },
  connection_pending: {
    label: 'Connection pending',
    tone: 'text-muted-foreground',
    helper: 'The provider connection is still being finalized.',
  },
  brand_pending: {
    label: 'Brand pending',
    tone: 'text-primary',
    helper: 'A verified brand is not available yet. Save, submit, or correct the brand before campaign setup can continue.',
  },
  campaign_pending: {
    label: 'Campaign pending',
    tone: 'text-primary',
    helper: 'A2P campaign setup is not approved yet.',
  },
  campaign_approved: {
    label: 'Campaign approved',
    tone: 'text-primary',
    helper: 'Campaign approval is complete. Sender numbers are the next step.',
  },
  number_setup_required: {
    label: 'Number setup required',
    tone: 'text-muted-foreground',
    helper: 'An approved campaign exists, but no active sender number is attached yet.',
  },
  port_in_progress: {
    label: 'Port in progress',
    tone: 'text-sky-700 dark:text-sky-300',
    helper: 'A port order is underway before the install can go live.',
  },
  provider_not_activated: {
    label: 'Sender validation needed',
    tone: 'text-muted-foreground',
    helper: 'Approved assets are linked. Send an embedded test message to confirm the outbound path.',
  },
  ready: {
    label: 'Ready',
    tone: 'text-emerald-700 dark:text-emerald-300',
    helper: 'The install is configured and has already handled outbound traffic.',
  },
  error_attention_required: {
    label: 'Needs attention',
    tone: 'text-destructive',
    helper: 'A rejected brand or campaign is blocking the install.',
  },
};

const availablePlatforms: AvailablePlatform[] = [
  {
    id: crmPlatformId,
    name: 'CRM Platform',
    description: 'Connect your CRM workspace to enable SMS conversations',
    available: true,
    statusNote: 'Live now',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Reserved for a future dedicated commerce adapter.',
    available: false,
    statusNote: 'Coming soon',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Reserved for a future CRM adapter with its own workflow model.',
    available: false,
    statusNote: 'Coming soon',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'Reserved for a future enterprise adapter once the core workflow is stable.',
    available: false,
    statusNote: 'Coming soon',
  },
  {
    id: 'zoho',
    name: 'Zoho',
    description: 'Reserved for a future Zoho CRM adapter after the platform core hardens.',
    available: false,
    statusNote: 'Coming soon',
  },
];

export function PlatformsPage() {
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      setError(null);
      const response = await api.getPlatformConnections();
      if (response.success && response.data) {
        setConnections(response.data);
      }
    } catch (error) {
      console.error('Failed to load connections:', error);
      setError('Unable to load platform connections right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async (platformId: string) => {
    setIsConnecting(platformId);
    try {
      const response = await api.getOAuthUrl(platformId);
      if (response.success && response.data?.authUrl) {
        window.location.href = response.data.authUrl;
      }
    } catch (error) {
      console.error('Failed to get OAuth URL:', error);
    } finally {
      setIsConnecting(null);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm('Are you sure you want to disconnect this platform?')) return;

    try {
      const response = await api.disconnectPlatform(connectionId);
      if (response.success) {
        loadConnections();
      }
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  const connectedPlatformIds = new Set(connections.map((c) => c.platform));
  const connectedCount = connections.filter((connection) => connection.status === 'connected').length;
  const pendingCount = connections.filter((connection) => connection.status === 'pending').length;

  return (
    <div>
      <Header
        title="Platforms"
        subtitle="Connect the systems your team actually uses and keep messaging infrastructure visible."
      />

      <PageShell contentClassName="gap-8">
        <PageSection className="border-0 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 px-6 py-6 text-slate-50 shadow-2xl shadow-slate-950/10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-4">
              <Badge className="w-fit bg-white/10 text-slate-100" variant="outline">
                <Sparkles className="h-3.5 w-3.5" />
                Integration Hub
              </Badge>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  Professional control over platform connections
                </h2>
                <p className="max-w-xl text-sm leading-6 text-slate-300 md:text-base">
                  Review connection health, manage the embedded rollout, and keep the
                  provider-mode backlog visible while the native provider path remains under review.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Connected</p>
                <p className="mt-2 text-3xl font-semibold">{connectedCount}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Pending</p>
                <p className="mt-2 text-3xl font-semibold">{pendingCount}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Available Now</p>
                <p className="mt-2 text-3xl font-semibold">
                  {availablePlatforms.filter((platform) => platform.available).length}
                </p>
              </div>
            </div>
          </div>
        </PageSection>

        {/* Connected Platforms */}
        <section className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Active Connections
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Each connection is tied to an organization workspace and OAuth installation.
              </p>
            </div>
            {error && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(2)].map((_, i) => (
                <Card key={i} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <CardContent className="p-6">
                    <div className="animate-pulse flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-slate-200 dark:bg-slate-800" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : connections.length === 0 ? (
            <Card className="border-dashed border-slate-300 bg-slate-50/80 shadow-none dark:border-slate-700 dark:bg-slate-900/60">
              <CardContent className="p-10 text-center">
                <div className="mx-auto mb-4 inline-flex rounded-2xl border border-slate-200 bg-white p-4 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <Plug className="h-8 w-8" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  No platforms connected
                </h3>
                <p className="mx-auto max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                  Start by connecting your CRM workspace to enable OAuth-based account linking
                  and route messaging activity through Signalmash.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {connections.map((connection, index) => {
                const platform = platformConfigs[connection.platform];
                const status = statusConfig[connection.status];
                const StatusIcon = status.icon;
                const lifecycle = connection.installation
                  ? lifecycleConfig[connection.installation.lifecycleState]
                  : null;

                return (
                  <motion.div
                    key={connection.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Card className="overflow-hidden border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 items-center gap-4">
                            <div className={`rounded-2xl border p-3 ${platform.surface} ${platform.border}`}>
                              <Link2 className={`h-5 w-5 ${platform.accent}`} />
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                                {platform.name}
                              </h3>
                              <p className="truncate text-sm text-slate-600 dark:text-slate-400">
                                {connection.platformAccountName || connection.platformAccountId}
                              </p>
                            </div>
                          </div>
                          <Badge variant={status.variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </Badge>
                        </div>

                        <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/80">
                          {lifecycle && (
                            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950">
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    Onboarding State
                                  </p>
                                  <p className={`mt-2 text-sm font-semibold ${lifecycle.tone}`}>
                                    {lifecycle.label}
                                  </p>
                                </div>
                                <Badge variant="secondary">Embedded rollout</Badge>
                              </div>
                              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                                {lifecycle.helper}
                              </p>
                            </div>
                          )}
                          <div className="flex items-center gap-3 text-sm">
                            <Building2 className="h-4 w-4 text-slate-400" />
                            <span className="text-slate-500 dark:text-slate-400">Account ID</span>
                            <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                              {connection.platformAccountId}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <ShieldCheck className="h-4 w-4 text-slate-400" />
                            <span className="text-slate-500 dark:text-slate-400">Connected On</span>
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {formatDateTime(connection.createdAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <Clock className="h-4 w-4 text-slate-400" />
                            <span className="text-slate-500 dark:text-slate-400">Lifecycle Sync</span>
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {connection.installation?.lastSyncAt
                                ? formatDateTime(connection.installation.lastSyncAt)
                                : 'No sync recorded'}
                            </span>
                          </div>
                          {connection.installation && (
                            <div className="grid grid-cols-3 gap-3 pt-1 text-sm">
                              <div className="rounded-xl bg-white px-3 py-3 dark:bg-slate-950">
                                <p className="text-slate-500 dark:text-slate-400">Brands</p>
                                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                                  {connection.installation.resourceCounts.totalBrands}
                                </p>
                              </div>
                              <div className="rounded-xl bg-white px-3 py-3 dark:bg-slate-950">
                                <p className="text-slate-500 dark:text-slate-400">Campaigns</p>
                                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                                  {connection.installation.resourceCounts.totalCampaigns}
                                </p>
                              </div>
                              <div className="rounded-xl bg-white px-3 py-3 dark:bg-slate-950">
                                <p className="text-slate-500 dark:text-slate-400">Numbers</p>
                                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                                  {connection.installation.resourceCounts.activeNumbers}
                                </p>
                              </div>
                            </div>
                          )}
                          {connection.installation?.checklist?.length ? (
                            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950">
                              <div className="flex items-center justify-between gap-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  Readiness Checklist
                                </p>
                                <Badge variant="outline">
                                  {connection.installation.checklist.filter((item) => item.complete).length}/
                                  {connection.installation.checklist.length} complete
                                </Badge>
                              </div>
                              <div className="mt-4 space-y-3">
                                {connection.installation.checklist.map((item) => (
                                  <div
                                    key={item.key}
                                    className="rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                        {sanitizePlatformBranding(item.label)}
                                      </p>
                                      <Badge variant={item.complete ? 'success' : 'secondary'}>
                                        {item.complete ? 'Done' : 'Pending'}
                                      </Badge>
                                    </div>
                                    <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">
                                      {sanitizePlatformBranding(item.helper)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-5 flex items-center justify-end">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => handleDisconnect(connection.id)}
                              className="border-slate-300 text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                            >
                              <Trash2 className="h-4 w-4" />
                              Disconnect
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>

        {/* Available Platforms */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Available Integrations
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Only platforms with production-ready backend support can be connected here.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availablePlatforms.map((platform, index) => {
              const isConnected = connectedPlatformIds.has(platform.id as any);
              const platformConfig = platformConfigs[platform.id];

              return (
                <motion.div
                  key={platform.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card
                    className={`border shadow-sm ${
                      platform.available && !isConnected
                        ? 'cursor-pointer border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950'
                        : 'border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/60'
                    }`}
                  >
                    <CardContent className="p-6">
                      <div className="mb-5 flex items-start justify-between gap-4">
                        <div className={`rounded-2xl border p-3 ${platformConfig.surface} ${platformConfig.border}`}>
                          <Plug className={`h-5 w-5 ${platformConfig.accent}`} />
                        </div>
                        {!platform.available && (
                          <Badge variant="secondary">Coming Soon</Badge>
                        )}
                        {isConnected && (
                          <Badge variant="success">Connected</Badge>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{platform.name}</h3>
                          <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                            {platform.statusNote}
                          </span>
                        </div>
                      </div>
                      <p className="mt-3 min-h-[3rem] text-sm leading-6 text-slate-600 dark:text-slate-400">
                        {platform.description}
                      </p>
                      {platform.available && !isConnected && (
                        <Button
                          className="mt-5 w-full"
                          onClick={() => handleConnect(platform.id)}
                          isLoading={isConnecting === platform.id}
                          rightIcon={<ArrowRight className="h-4 w-4" />}
                        >
                          Connect {platform.name}
                        </Button>
                      )}
                      {isConnected && (
                        <Button
                          variant="outline"
                          className="mt-5 w-full border-slate-300 dark:border-slate-700"
                        >
                          Already connected
                        </Button>
                      )}
                      {!platform.available && (
                        <Button variant="outline" className="mt-5 w-full border-slate-300 dark:border-slate-700" disabled>
                          Not available yet
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </section>
      </PageShell>
    </div>
  );
}
