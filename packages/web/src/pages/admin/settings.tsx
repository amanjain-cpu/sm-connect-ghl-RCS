import { useEffect, useState } from 'react';
import {
  Key,
  Globe,
  Save,
  Eye,
  EyeOff,
  Check,
  RefreshCw,
  Activity,
  AlertTriangle,
  Building2,
  Link2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sanitizePlatformBranding } from '@/lib/platform-branding';
import { adminApi } from '@/stores/admin.store';
import { AdminHeader } from '@/components/layout/admin-header';
import { formatDateTime } from '@/lib/utils';
import { notify } from '@/stores/notification.store';

interface Setting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  isEncrypted: boolean;
  updatedAt: string;
}

interface SignalmashDiagnostic {
  id?: string;
  createdAt?: string;
  testedAt: string;
  method: string;
  requestUrl: string;
  status: number | null;
  ok: boolean;
  responseBody: string;
  apiBaseUrl?: string;
  tokenFingerprint?: string;
  balanceStatus?: number | null;
  balanceBody?: string;
  sampleBrandIds?: string[];
  sampleCampaignIds?: string[];
  brandLookup?: {
    requestedId: string;
    found: boolean;
    status?: string;
    message?: string;
  };
  campaignLookup?: {
    requestedId: string;
    found: boolean;
    status?: string;
    message?: string;
  };
}

interface AdminOrganizationOption {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'suspended';
  suspensionReason?: string | null;
}

interface SignalmashBrandOption {
  brandId: string;
  displayName?: string;
  status?: string;
  assignable: boolean;
}

interface SignalmashCampaignOption {
  campaignId: string;
  brandId?: string;
  name?: string;
  status?: string;
  providerMessage?: string;
  assignable: boolean;
}

const SETTING_LABELS: Record<string, { label: string; description: string; placeholder: string }> = {
  signalmash_api_key: {
    label: 'Signalmash API Key',
    description: 'Primary Signalmash API credential used for runtime messaging operations.',
    placeholder: 'Enter your Signalmash API key',
  },
  signalmash_api_url: {
    label: 'Signalmash API URL',
    description: 'Base URL used by the backend for Signalmash API requests.',
    placeholder: 'https://api.signalmash.com',
  },
  signalmash_webhook_secret: {
    label: 'Webhook Secret',
    description: 'Secret used to verify Signalmash webhook signatures.',
    placeholder: 'Webhook secret',
  },
  simplyrcs_api_key: {
    label: 'SimplyRCS API Key',
    description: 'API key of the SimplyRCS workspace used for RCS messaging (Developer Portal → API Keys).',
    placeholder: 'Enter your SimplyRCS API key',
  },
  simplyrcs_api_url: {
    label: 'SimplyRCS API URL',
    description: 'Base URL for SimplyRCS API requests.',
    placeholder: 'https://simplyrcs.signalmash.com',
  },
  simplyrcs_webhook_secret: {
    label: 'SimplyRCS Webhook Secret',
    description: 'Signing secret returned when the SimplyRCS webhook endpoint was registered. Filled automatically by "Register webhook".',
    placeholder: 'Set by Register webhook',
  },
  stripe_secret_key: {
    label: 'Stripe Secret Key',
    description: 'Secret API key used for Stripe wallet top-ups, saved cards, and automatic MRC charges.',
    placeholder: 'sk_live_...',
  },
  stripe_webhook_secret: {
    label: 'Stripe Webhook Secret',
    description: 'Signing secret for the Stripe webhook endpoint.',
    placeholder: 'whsec_...',
  },
  stripe_price_starter_monthly: {
    label: 'Starter Price ID',
    description: 'Recurring monthly Stripe Price ID for the Starter plan.',
    placeholder: 'price_...',
  },
  stripe_price_growth_monthly: {
    label: 'Growth Price ID',
    description: 'Recurring monthly Stripe Price ID for the Growth plan.',
    placeholder: 'price_...',
  },
  stripe_price_scale_monthly: {
    label: 'Scale Price ID',
    description: 'Recurring monthly Stripe Price ID for the Scale plan.',
    placeholder: 'price_...',
  },
  ghl_app_client_id: {
    label: 'OAuth Client ID',
    description: 'Marketplace application client ID.',
    placeholder: 'OAuth client ID',
  },
  ghl_app_client_secret: {
    label: 'OAuth Client Secret',
    description: 'Marketplace application client secret.',
    placeholder: 'OAuth client secret',
  },
  ghl_app_sso_key: {
    label: 'Embedded SSO Shared Secret',
    description: 'Shared secret used to decrypt embedded user context. During app version transitions you can store multiple secrets separated by commas or new lines.',
    placeholder: 'Embedded SSO shared secret(s)',
  },
  ghl_app_custom_page_link_id: {
    label: 'Embedded Custom Page Link ID',
    description: 'GHL custom page link ID for the primary embedded Signalmash app entry. Used to send installs directly into the embedded workspace page.',
    placeholder: 'Custom page link ID',
  },
  app_name: {
    label: 'Application Name',
    description: 'Display name used by the platform.',
    placeholder: 'Signalmash Connect',
  },
  support_email: {
    label: 'Support Email',
    description: 'Support contact shown in operational messaging and admin references.',
    placeholder: 'support@example.com',
  },
};

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isTestingSimplyRcs, setIsTestingSimplyRcs] = useState(false);
  const [simplyRcsDiagnostic, setSimplyRcsDiagnostic] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<SignalmashDiagnostic | null>(null);
  const [lookupBrandId, setLookupBrandId] = useState('');
  const [lookupCampaignId, setLookupCampaignId] = useState('');
  const [organizations, setOrganizations] = useState<AdminOrganizationOption[]>([]);
  const [providerBrands, setProviderBrands] = useState<SignalmashBrandOption[]>([]);
  const [providerCampaigns, setProviderCampaigns] = useState<SignalmashCampaignOption[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [isAssigningAssets, setIsAssigningAssets] = useState(false);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');

  const loadSettings = async () => {
    try {
      const response = await adminApi.getSettings();
      if (response.success) {
        setSettings(response.data);
        const initial: Record<string, string> = {};
        response.data.forEach((setting: Setting) => {
          initial[setting.key] = setting.value;
        });
        setEditedValues(initial);
      }
    } catch (loadError) {
      console.error('Failed to load settings:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDiagnostic = async () => {
    try {
      const response = await adminApi.getSignalmashDiagnostic();
      if (response.success) {
        setDiagnostic(response.data);
      }
    } catch (loadError) {
      console.error('Failed to load Signalmash diagnostic:', loadError);
    }
  };

  const loadAssignmentOptions = async () => {
    setIsLoadingAssignments(true);
    try {
      const [organizationResponse, brandResponse] = await Promise.all([
        adminApi.getOrganizations(1, 200),
        adminApi.getSignalmashBrands(),
      ]);

      if (organizationResponse.success) {
        setOrganizations(organizationResponse.data);
      }

      if (brandResponse.success) {
        setProviderBrands(brandResponse.data);
      }
    } catch (loadError) {
      console.error('Failed to load Signalmash assignment options:', loadError);
      notify.error(
        'Unable to load Signalmash assets',
        loadError instanceof Error ? loadError.message : 'Provider-backed assignment options could not be loaded.'
      );
    } finally {
      setIsLoadingAssignments(false);
    }
  };

  const loadBrandCampaigns = async (brandId: string) => {
    if (!brandId) {
      setProviderCampaigns([]);
      return;
    }

    setIsLoadingCampaigns(true);
    try {
      const response = await adminApi.getSignalmashBrandCampaigns(brandId);
      if (response.success) {
        setProviderCampaigns(response.data);
      }
    } catch (loadError) {
      console.error('Failed to load Signalmash campaigns:', loadError);
      notify.error(
        'Unable to load campaigns',
        loadError instanceof Error ? loadError.message : 'The selected brand campaigns could not be loaded.'
      );
      setProviderCampaigns([]);
    } finally {
      setIsLoadingCampaigns(false);
    }
  };

  useEffect(() => {
    loadSettings();
    loadDiagnostic();
    loadAssignmentOptions();
  }, []);

  useEffect(() => {
    setSelectedCampaignId('');
    setProviderCampaigns([]);

    if (selectedBrandId) {
      loadBrandCampaigns(selectedBrandId);
    }
  }, [selectedBrandId]);

  const handleSave = async (key: string) => {
    setSavingKey(key);
    setError(null);
    setSuccessKey(null);

    try {
      const metadata = SETTING_LABELS[key];
      await adminApi.updateSetting(key, editedValues[key], metadata?.description);
      setSuccessKey(key);
      setTimeout(() => setSuccessKey(null), 2500);
      notify.success('Setting saved', `${metadata?.label || key} was updated.`);
      await loadSettings();
    } catch (saveError) {
      notify.error('Unable to save setting', saveError instanceof Error ? saveError.message : 'Failed to save setting');
      setError(saveError instanceof Error ? saveError.message : 'Failed to save setting');
    } finally {
      setSavingKey(null);
    }
  };

  const isChanged = (key: string) => {
    const setting = settings.find((entry) => entry.key === key);
    if (!setting) return editedValues[key]?.trim() !== '';
    return editedValues[key] !== setting.value;
  };

  const knownKeys = Object.keys(SETTING_LABELS);
  const existingKeys = settings.map((setting) => setting.key);
  const missingKeys = knownKeys.filter((key) => !existingKeys.includes(key));

  const handleTestSimplyRcs = async () => {
    setIsTestingSimplyRcs(true);
    try {
      const response = await adminApi.testSimplyRcsConnection();
      if (response.success) {
        setSimplyRcsDiagnostic(response.data);
        notify.success(response.data.ok ? 'SimplyRCS connection succeeded' : 'SimplyRCS connection failed', response.data.message);
      }
    } catch (testError) {
      notify.error('Unable to test SimplyRCS connection', testError instanceof Error ? testError.message : 'Request failed');
    } finally {
      setIsTestingSimplyRcs(false);
    }
  };

  const handleRegisterSimplyRcsWebhook = async () => {
    setIsTestingSimplyRcs(true);
    try {
      const response = await adminApi.registerSimplyRcsWebhook();
      if (response.success) {
        notify.success(
          response.data.alreadyRegistered ? 'Webhook already registered' : 'Webhook registered',
          response.data.secretStored ? 'The signing secret was stored in runtime settings.' : `SimplyRCS will post to ${response.data.url}.`
        );
        await loadSettings();
      }
    } catch (registerError) {
      notify.error('Unable to register the SimplyRCS webhook', registerError instanceof Error ? registerError.message : 'Request failed');
    } finally {
      setIsTestingSimplyRcs(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setError(null);

    try {
      const response = await adminApi.testSignalmashConnection({
        brandId: lookupBrandId.trim() || undefined,
        campaignId: lookupCampaignId.trim() || undefined,
      });
      if (response.success) {
        setDiagnostic(response.data);
        notify.success(
          response.data.ok ? 'Signalmash connection succeeded' : 'Signalmash connection failed',
          response.data.ok
            ? 'The read-only provider diagnostic completed successfully.'
            : 'Captured the latest provider response for review below.'
        );
      }
      await loadSettings();
      await loadDiagnostic();
    } catch (testError) {
      notify.error('Unable to test Signalmash connection', testError instanceof Error ? testError.message : 'Request failed');
      setError(testError instanceof Error ? testError.message : 'Failed to test Signalmash connection');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleAssignBrandCampaign = async () => {
    if (!selectedOrganizationId || !selectedBrandId || !selectedCampaignId) {
      notify.error('Assignment incomplete', 'Choose an organization, brand, and campaign before assigning.');
      return;
    }

    setIsAssigningAssets(true);
    try {
      const response = await adminApi.assignSignalmashBrandCampaign({
        organizationId: selectedOrganizationId,
        signalmashBrandId: selectedBrandId,
        signalmashCampaignId: selectedCampaignId,
      });

      if (response.success) {
        notify.success(
          'Assets assigned',
          response.message || 'The verified Signalmash brand and campaign are now linked to the selected organization.'
        );
        await loadAssignmentOptions();
        await loadBrandCampaigns(selectedBrandId);
      }
    } catch (assignError) {
      notify.error(
        'Assignment failed',
        assignError instanceof Error ? assignError.message : 'The verified Signalmash assets could not be assigned.'
      );
    } finally {
      setIsAssigningAssets(false);
    }
  };

  const selectedOrganization = organizations.find((organization) => organization.id === selectedOrganizationId) ?? null;
  const selectedBrand = providerBrands.find((brand) => brand.brandId === selectedBrandId) ?? null;
  const selectedCampaign = providerCampaigns.find((campaign) => campaign.campaignId === selectedCampaignId) ?? null;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <AdminHeader title="Runtime Settings" subtitle="Configuration stored in app settings" showBack />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        {error && (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Settings Registry
              </p>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Manage runtime secrets and integration configuration
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                These values are pulled by the backend at runtime. Encrypted settings are masked in the UI
                and can be updated here without redeploying the application.
              </p>
            </div>
            <Button variant="outline" onClick={loadSettings}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-500" />
                <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">SimplyRCS Connectivity</h2>
              </div>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                RCS messaging runs through SimplyRCS. Test the API key, and register this server&apos;s callback URL so delivery receipts and replies arrive.
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" onClick={handleTestSimplyRcs} isLoading={isTestingSimplyRcs}>Test SimplyRCS Connection</Button>
                <Button variant="outline" onClick={handleRegisterSimplyRcsWebhook} isLoading={isTestingSimplyRcs}>Register webhook</Button>
              </div>
              {simplyRcsDiagnostic && (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={simplyRcsDiagnostic.ok ? 'default' : 'destructive'}>{simplyRcsDiagnostic.ok ? 'Reachable' : 'Blocked'}</Badge>
                    <span className="text-slate-600 dark:text-slate-400">{simplyRcsDiagnostic.message}</span>
                  </div>
                  {simplyRcsDiagnostic.ok && (
                    <p className="mt-2 text-slate-600 dark:text-slate-400">
                      {simplyRcsDiagnostic.rcsChannels ?? 0} RCS channels · {simplyRcsDiagnostic.rcsAgents ?? 0} agents · {simplyRcsDiagnostic.webhookEndpoints ?? 0} webhook endpoints
                    </p>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 pt-6">
                <Activity className="h-4 w-4 text-sky-500" />
                <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                  Signalmash Connectivity
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                Run a read-only provider diagnostic against the live Signalmash runtime. The latest result is stored
                and visible here so upstream issues can be checked without opening the terminal.
              </p>
            </div>
            <div className="w-full max-w-md space-y-3">
              <Input
                value={lookupBrandId}
                onChange={(e) => setLookupBrandId(e.target.value)}
                placeholder="Optional brand ID to inspect"
              />
              <Input
                value={lookupCampaignId}
                onChange={(e) => setLookupCampaignId(e.target.value)}
                placeholder="Optional campaign ID to inspect"
              />
              <Button onClick={handleTestConnection} isLoading={isTestingConnection} className="w-full">
                <Activity className="mr-2 h-4 w-4" />
                Test Signalmash Connection
              </Button>
            </div>
          </div>

          {diagnostic ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={diagnostic.ok ? 'default' : 'destructive'}>
                      {diagnostic.ok ? 'Reachable' : 'Blocked'}
                    </Badge>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {diagnostic.status !== null ? `HTTP ${diagnostic.status}` : 'No HTTP status'}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{diagnostic.method} {diagnostic.requestUrl}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Tested {formatDateTime(diagnostic.testedAt || diagnostic.createdAt || '')}
                  </p>
                </div>
                {!diagnostic.ok && (
                  <div className="flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Provider contract still needs confirmation
                  </div>
                )}
              </div>

              {(diagnostic.apiBaseUrl || diagnostic.tokenFingerprint || diagnostic.sampleBrandIds?.length || diagnostic.sampleCampaignIds?.length) && (
                <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-950/70 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">API Base</p>
                    <p className="mt-1 text-slate-900 dark:text-slate-100">{diagnostic.apiBaseUrl || 'Unavailable'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Token Fingerprint</p>
                    <p className="mt-1 font-mono text-slate-900 dark:text-slate-100">{diagnostic.tokenFingerprint || 'Unavailable'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Visible Brand IDs</p>
                    <p className="mt-1 break-all text-slate-900 dark:text-slate-100">
                      {diagnostic.sampleBrandIds?.length ? diagnostic.sampleBrandIds.join(', ') : 'None returned'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Visible Campaign IDs</p>
                    <p className="mt-1 break-all text-slate-900 dark:text-slate-100">
                      {diagnostic.sampleCampaignIds?.length ? diagnostic.sampleCampaignIds.join(', ') : 'None returned'}
                    </p>
                  </div>
                </div>
              )}

              {(diagnostic.brandLookup || diagnostic.campaignLookup || diagnostic.balanceBody) && (
                <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-950/70 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Balance Check</p>
                    <p className="mt-1 text-slate-900 dark:text-slate-100">
                      {diagnostic.balanceStatus !== null && diagnostic.balanceStatus !== undefined
                        ? `HTTP ${diagnostic.balanceStatus}`
                        : 'No HTTP status'}
                    </p>
                    <p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">{diagnostic.balanceBody || 'No response body'}</p>
                  </div>
                  {diagnostic.brandLookup && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Brand Lookup</p>
                      <p className="mt-1 text-slate-900 dark:text-slate-100">
                        {diagnostic.brandLookup.requestedId}: {diagnostic.brandLookup.found ? diagnostic.brandLookup.status || 'found' : 'not found'}
                      </p>
                      <p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">{diagnostic.brandLookup.message || 'No provider message'}</p>
                    </div>
                  )}
                  {diagnostic.campaignLookup && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Campaign Lookup</p>
                      <p className="mt-1 text-slate-900 dark:text-slate-100">
                        {diagnostic.campaignLookup.requestedId}: {diagnostic.campaignLookup.found ? diagnostic.campaignLookup.status || 'found' : 'not found'}
                      </p>
                      <p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">{diagnostic.campaignLookup.message || 'No provider message'}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Response Snapshot
                </p>
                <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
{diagnostic.responseBody || '(empty response)'}
                </pre>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              No Signalmash diagnostic has been recorded yet.
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-emerald-500" />
                <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                  Signalmash Org Assignment
                </h2>
              </div>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                Fetch live Signalmash brands and campaigns, then assign only verified and approved assets to a GHL organization without manually typing provider IDs.
              </p>
            </div>
            <Button variant="outline" onClick={loadAssignmentOptions} isLoading={isLoadingAssignments}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Assets
            </Button>
          </div>

          <div className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-900/60 md:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Organizations</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-50">{organizations.length}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Visible Brands</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-50">{providerBrands.length}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {providerBrands.filter((brand) => brand.assignable).length} assignable
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Brand Campaigns</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-50">{providerCampaigns.length}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {providerCampaigns.filter((campaign) => campaign.assignable).length} assignable
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Organization</p>
              <Select value={selectedOrganizationId} onValueChange={setSelectedOrganizationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a GHL organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedOrganization && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedOrganization.email}
                  {selectedOrganization.status === 'suspended' && selectedOrganization.suspensionReason
                    ? ` • Suspended: ${selectedOrganization.suspensionReason}`
                    : selectedOrganization.status === 'suspended'
                      ? ' • Suspended'
                      : ' • Active'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Verified Brand</p>
              <Select value={selectedBrandId} onValueChange={setSelectedBrandId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a Signalmash brand" />
                </SelectTrigger>
                <SelectContent>
                  {providerBrands.map((brand) => (
                    <SelectItem key={brand.brandId} value={brand.brandId}>
                      {(brand.displayName || brand.brandId)} • {brand.status || 'UNKNOWN'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedBrand && (
                <div className="flex items-center gap-2">
                  <Badge variant={selectedBrand.assignable ? 'default' : 'secondary'}>
                    {selectedBrand.status || 'UNKNOWN'}
                  </Badge>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedBrand.assignable ? 'Eligible for assignment' : 'Not assignable until provider verification completes'}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Approved Campaign</p>
              <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId} disabled={!selectedBrandId || isLoadingCampaigns}>
                <SelectTrigger>
                  <SelectValue placeholder={selectedBrandId ? 'Select a Signalmash campaign' : 'Select a brand first'} />
                </SelectTrigger>
                <SelectContent>
                  {providerCampaigns.map((campaign) => (
                    <SelectItem key={campaign.campaignId} value={campaign.campaignId}>
                      {(campaign.name || campaign.campaignId)} • {campaign.status || 'UNKNOWN'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCampaign && (
                <div className="flex items-center gap-2">
                  <Badge variant={selectedCampaign.assignable ? 'default' : 'secondary'}>
                    {selectedCampaign.status || 'UNKNOWN'}
                  </Badge>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedCampaign.providerMessage || (selectedCampaign.assignable
                      ? 'Eligible for assignment'
                      : 'Not assignable until provider approval completes')}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/70 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <Building2 className="h-4 w-4 text-sky-500" />
                <span className="font-medium">
                  {selectedOrganization?.name || 'Choose an organization'} 
                  {selectedBrand ? ` ← ${selectedBrand.displayName || selectedBrand.brandId}` : ''}
                  {selectedCampaign ? ` ← ${selectedCampaign.name || selectedCampaign.campaignId}` : ''}
                </span>
              </div>
              <p>
                This links the verified brand and approved campaign into the selected org. Phone numbers are handled separately.
              </p>
            </div>
            <Button
              onClick={handleAssignBrandCampaign}
              isLoading={isAssigningAssets}
              disabled={
                !selectedOrganizationId ||
                !selectedBrandId ||
                !selectedCampaignId ||
                !selectedBrand?.assignable ||
                !selectedCampaign?.assignable
              }
            >
              <Link2 className="mr-2 h-4 w-4" />
              Assign Brand and Campaign
            </Button>
          </div>
        </section>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(4)].map((_, index) => (
              <Card key={index} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <div className="space-y-3 animate-pulse">
                    <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-10 rounded bg-slate-200 dark:bg-slate-800" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {settings.map((setting) => {
                const info = SETTING_LABELS[setting.key] || {
                  label: sanitizePlatformBranding(setting.key),
                  description: sanitizePlatformBranding(setting.description || ''),
                  placeholder: '',
                };

                return (
                  <Card key={setting.key} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                    <CardContent className="p-6">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            {setting.isEncrypted ? (
                              <Key className="h-4 w-4 text-amber-500" />
                            ) : (
                              <Globe className="h-4 w-4 text-sky-500" />
                            )}
                            <h3 className="font-semibold text-slate-950 dark:text-slate-50">{info.label}</h3>
                            {setting.isEncrypted && <Badge variant="outline">Encrypted</Badge>}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{info.description}</p>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Updated {formatDateTime(setting.updatedAt)}
                        </p>
                      </div>

                      <div className="flex flex-col gap-3 md:flex-row">
                        <div className="relative flex-1">
                          <Input
                            type={setting.isEncrypted && !showValues[setting.key] ? 'password' : 'text'}
                            value={editedValues[setting.key] ?? ''}
                            onChange={(e) => setEditedValues({ ...editedValues, [setting.key]: e.target.value })}
                            placeholder={info.placeholder}
                            className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                          />
                          {setting.isEncrypted && (
                            <button
                              type="button"
                              onClick={() => setShowValues({ ...showValues, [setting.key]: !showValues[setting.key] })}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                            >
                              {showValues[setting.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                        <Button
                          onClick={() => handleSave(setting.key)}
                          disabled={!isChanged(setting.key) || savingKey === setting.key}
                          isLoading={savingKey === setting.key}
                        >
                          {successKey === setting.key ? (
                            <>
                              <Check className="h-4 w-4 mr-2" />
                              Saved
                            </>
                          ) : (
                            <>
                              <Save className="h-4 w-4 mr-2" />
                              Save
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {missingKeys.length > 0 && (
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Missing Settings</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  These known settings are not currently present in the database.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {missingKeys.map((key) => (
                    <Badge key={key} variant="secondary">{SETTING_LABELS[key].label}</Badge>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
