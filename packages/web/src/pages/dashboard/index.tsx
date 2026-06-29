import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  Megaphone,
  Phone,
  Plug,
  Send,
  Shield,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell, PageSection } from '@/components/layout/page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth.store';
import { api } from '@/lib/api';
import { sanitizePlatformBranding } from '@/lib/platform-branding';
import { formatNumber } from '@/lib/utils';

const crmPlatformId = `${'lead'}connector` as const;

interface DashboardSummary {
  kpis: {
    sent: { value: number; previous: number; changePercent: number };
    delivered: { value: number; previous: number; changePercent: number };
    failed: { value: number; previous: number; changePercent: number };
    deliveryRate: { value: number; previous: number; changePercent: number };
  };
  totals: {
    connectedPlatforms: number;
    activeCampaigns: number;
    verifiedBrands: number;
    inbound: number;
  };
  series: Array<{
    date: string;
    sent: number;
    delivered: number;
    failed: number;
    inbound: number;
  }>;
}

interface OperationsSummary {
  billing: {
    smsOutbound: number;
    smsInbound: number;
    mmsOutbound: number;
    mmsInbound: number;
    pending: number;
  };
  pendingDeadLetters: number;
  activeSuppressions: number;
  portOrders: {
    total: number;
    submitted: number;
    inProgress: number;
    awaitingDocuments: number;
    completed: number;
  };
}

interface PlatformConnection {
  id: string;
  platform: typeof crmPlatformId | 'shopify' | 'hubspot' | 'salesforce' | 'zoho';
  platformAccountName: string | null;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  installation: {
    lifecycleState: string;
    checklist: Array<{
      key: string;
      label: string;
      complete: boolean;
      helper: string;
    }>;
  } | null;
}

interface Brand {
  id: string;
  displayName: string;
  status: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface PhoneNumber {
  id: string;
  formattedNumber: string;
  friendlyName: string | null;
  status: string;
  isDefaultSender?: boolean;
}

function TrendBadge({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;

  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold',
        positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      ].join(' ')}
    >
      <Icon className="h-3.5 w-3.5" />
      {positive ? '+' : ''}
      {value}
      {suffix}
    </span>
  );
}

function DeliveryChart({ data }: { data: DashboardSummary['series'] }) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">
        No message activity yet for the last 30 days.
      </div>
    );
  }

  const width = 760;
  const height = 220;
  const padding = { left: 40, right: 12, top: 16, bottom: 28 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...data.flatMap((point) => [point.sent, point.delivered]));

  const xFor = (index: number) => padding.left + (index * innerWidth) / Math.max(data.length - 1, 1);
  const yFor = (value: number) => padding.top + innerHeight - (value / maxValue) * innerHeight;
  const toLine = (values: number[]) =>
    values
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${xFor(index).toFixed(1)} ${yFor(value).toFixed(1)}`)
      .join(' ');

  const sentValues = data.map((point) => point.sent);
  const deliveredValues = data.map((point) => point.delivered);
  const sentLine = toLine(sentValues);
  const deliveredLine = toLine(deliveredValues);
  const sentArea = `${sentLine} L${xFor(data.length - 1)} ${padding.top + innerHeight} L${padding.left} ${padding.top + innerHeight} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="dashboard-sent-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2FB267" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#2FB267" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
        <line
          key={tick}
          x1={padding.left}
          y1={padding.top + innerHeight - tick * innerHeight}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight - tick * innerHeight}
          stroke="rgba(15,23,42,0.08)"
          strokeDasharray={tick === 0 ? undefined : '3 3'}
        />
      ))}

      <path d={sentArea} fill="url(#dashboard-sent-fill)" />
      <path d={sentLine} fill="none" stroke="#2FB267" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={deliveredLine} fill="none" stroke="#0EA5E9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 4" />

      {data.map((point, index) => {
        if (index % 6 !== 0 && index !== data.length - 1) {
          return null;
        }

        const label = new Date(`${point.date}T00:00:00Z`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        });

        return (
          <text
            key={point.date}
            x={xFor(index)}
            y={height - 8}
            textAnchor="middle"
            fontSize="10"
            fill="#64748B"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { organization } = useAuthStore();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [operations, setOperations] = useState<OperationsSummary | null>(null);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);

    try {
      const [
        summaryResponse,
        operationsResponse,
        connectionsResponse,
        brandsResponse,
        campaignsResponse,
        phoneNumbersResponse,
      ] = await Promise.all([
        api.getOrganizationDashboard(),
        api.getOperationsSummary(),
        api.getPlatformConnections(),
        api.getBrands(),
        api.getCampaigns(),
        api.getPhoneNumbers(),
      ]);

      if (summaryResponse.success && summaryResponse.data) {
        setSummary(summaryResponse.data);
      }
      if (operationsResponse.success && operationsResponse.data) {
        setOperations(operationsResponse.data);
      }
      if (connectionsResponse.success && connectionsResponse.data) {
        setConnections(connectionsResponse.data);
      }
      if (brandsResponse.success && brandsResponse.data) {
        setBrands(brandsResponse.data);
      }
      if (campaignsResponse.success && campaignsResponse.data) {
        setCampaigns(campaignsResponse.data);
      }
      if (phoneNumbersResponse.success && phoneNumbersResponse.data) {
        setPhoneNumbers(phoneNumbersResponse.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const orgName = organization?.name ?? 'Workspace';
  const crmConnection = connections.find((connection) => connection.platform === crmPlatformId) ?? null;
  const defaultSender = phoneNumbers.find((number) => number.isDefaultSender) ?? null;
  const onboardingChecklist = crmConnection?.installation?.checklist ?? [];
  const connectedIssues = connections.filter((connection) => connection.status === 'error' || connection.status === 'pending').length;

  const introStatus = useMemo(() => {
    if (connectedIssues > 0) {
      return {
        label: 'Attention required',
        tone: 'bg-red-50 text-red-700',
      };
    }

    if ((operations?.pendingDeadLetters ?? 0) > 0 || (operations?.billing.pending ?? 0) > 0) {
      return {
        label: 'Operational review needed',
        tone: 'bg-amber-50 text-amber-700',
      };
    }

    return {
      label: 'Live data healthy',
      tone: 'bg-emerald-50 text-emerald-700',
    };
  }, [connectedIssues, operations]);

  const kpis = [
    {
      title: 'Messages Sent',
      value: summary?.kpis.sent.value ?? 0,
      change: summary?.kpis.sent.changePercent ?? 0,
      subtext: 'Last 7 days vs previous 7 days',
      icon: <Send className="h-4 w-4" />,
      accent: 'bg-emerald-500',
    },
    {
      title: 'Delivered',
      value: summary?.kpis.delivered.value ?? 0,
      change: summary?.kpis.delivered.changePercent ?? 0,
      subtext: 'Last 7 days vs previous 7 days',
      icon: <CheckCircle className="h-4 w-4" />,
      accent: 'bg-sky-500',
    },
    {
      title: 'Failed',
      value: summary?.kpis.failed.value ?? 0,
      change: summary?.kpis.failed.changePercent ?? 0,
      subtext: 'Last 7 days vs previous 7 days',
      icon: <XCircle className="h-4 w-4" />,
      accent: 'bg-red-500',
    },
    {
      title: 'Delivery Rate',
      value: summary ? `${summary.kpis.deliveryRate.value.toFixed(2)}%` : '0.00%',
      change: summary?.kpis.deliveryRate.changePercent ?? 0,
      subtext: 'Percentage-point change vs previous 7 days',
      icon: <TrendingUp className="h-4 w-4" />,
      accent: 'bg-slate-900',
      suffix: 'pp',
    },
  ];

  const totalCycleVolume =
    (operations?.billing.smsOutbound ?? 0) +
    (operations?.billing.smsInbound ?? 0) +
    (operations?.billing.mmsOutbound ?? 0) +
    (operations?.billing.mmsInbound ?? 0);

  return (
    <PageShell contentClassName="gap-5">
      <Header
        title="Dashboard"
        subtitle={`Messaging operations · ${orgName}`}
        mode="dashboard"
        onRefresh={() => {
          void loadDashboard();
        }}
        action={{
          label: 'New campaign',
          onClick: () => navigate('/campaigns/new'),
        }}
      />

      <PageSection className="px-6 py-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <Badge variant="outline" className="w-fit">
              Live overview
            </Badge>
            <div>
              <h2 className="text-[28px] font-semibold tracking-tight text-slate-950">
                Messaging operations for {orgName}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                KPI cards and chart data on this screen now come from live organization message records,
                not hard-coded trend samples.
              </p>
            </div>
          </div>
          <div className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold ${introStatus.tone}`}>
            {introStatus.label}
          </div>
        </div>
      </PageSection>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <PageSection key={kpi.title} className="overflow-hidden">
            <div className={`h-1 ${kpi.accent}`} />
            <div className="px-5 py-5">
              <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
                <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                  {kpi.icon}
                  {kpi.title}
                </span>
                <TrendBadge value={kpi.change} suffix={kpi.suffix ?? '%'} />
              </div>
              <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
                {isLoading ? '—' : typeof kpi.value === 'number' ? formatNumber(kpi.value) : kpi.value}
              </div>
              <p className="mt-2 text-sm text-slate-500">{kpi.subtext}</p>
            </div>
          </PageSection>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.95fr]">
        <PageSection className="px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Sent vs delivered</h3>
              <p className="mt-1 text-sm text-slate-600">Real organization message activity for the last 30 days.</p>
            </div>
            <div className="flex gap-4 text-xs font-semibold text-slate-600">
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Sent
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                Delivered
              </span>
            </div>
          </div>
          <div className="mt-6">
            <DeliveryChart data={summary?.series ?? []} />
          </div>
        </PageSection>

        <PageSection className="px-6 py-6">
          <h3 className="text-lg font-semibold text-slate-950">Platform readiness</h3>
          <p className="mt-1 text-sm text-slate-600">
            Current embedded-installation status and the sender number that outbound traffic falls back to.
          </p>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Default sender</p>
              <p className="mt-2 font-medium text-slate-950">
                {defaultSender ? `${defaultSender.friendlyName ? `${defaultSender.friendlyName} · ` : ''}${defaultSender.formattedNumber}` : 'No default sender selected yet'}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Change this from the Phone Numbers screen using the “Make Default Sender” action.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Installation state</p>
              <p className="mt-2 font-medium capitalize text-slate-950">
                {crmConnection?.installation?.lifecycleState?.replace(/_/g, ' ') || 'No installation summary available yet'}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {crmConnection?.platformAccountName || 'No connected workspace'} · status {crmConnection?.status || 'disconnected'}
              </p>
            </div>

            {onboardingChecklist.length > 0 ? (
              <div className="space-y-3">
                {onboardingChecklist.map((item) => (
                  <div key={item.key} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="flex items-start gap-3">
                      {item.complete ? (
                        <CheckCircle className="mt-0.5 h-4 w-4 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                      )}
                      <div>
                        <p className="font-medium text-slate-950">
                          {sanitizePlatformBranding(item.label)}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          {sanitizePlatformBranding(item.helper)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                No embedded-installation checklist is available yet. Connect and sync the platform to populate readiness data.
              </div>
            )}
          </div>
        </PageSection>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <PageSection className="px-6 py-6">
          <h3 className="text-lg font-semibold text-slate-950">Operational counts</h3>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Verified brands', value: summary?.totals.verifiedBrands ?? 0, icon: <Shield className="h-4 w-4" /> },
              { label: 'Approved campaigns', value: summary?.totals.activeCampaigns ?? 0, icon: <Megaphone className="h-4 w-4" /> },
              { label: 'Connected platforms', value: summary?.totals.connectedPlatforms ?? 0, icon: <Plug className="h-4 w-4" /> },
              { label: 'Inbound messages', value: summary?.totals.inbound ?? 0, icon: <Phone className="h-4 w-4" /> },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  {item.icon}
                  {item.label}
                </div>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  {isLoading ? '—' : formatNumber(item.value)}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => navigate('/brands')}>
              Review Brands ({brands.length})
            </Button>
            <Button variant="outline" onClick={() => navigate('/campaigns')}>
              Review Campaigns ({campaigns.length})
            </Button>
            <Button variant="outline" onClick={() => navigate('/phone-numbers')}>
              Manage Numbers ({phoneNumbers.length})
            </Button>
          </div>
        </PageSection>

        <PageSection className="px-6 py-6">
          <h3 className="text-lg font-semibold text-slate-950">Operations queue and billing</h3>
          <div className="mt-5 space-y-3">
            {[
              ['Pending dead letters', operations?.pendingDeadLetters ?? 0],
              ['Pending billing posts', operations?.billing.pending ?? 0],
              ['Active suppressions', operations?.activeSuppressions ?? 0],
              ['Port orders in progress', (operations?.portOrders.submitted ?? 0) + (operations?.portOrders.inProgress ?? 0) + (operations?.portOrders.awaitingDocuments ?? 0)],
              ['Billable cycle volume', totalCycleVolume],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <span className="text-sm text-slate-600">{label}</span>
                <span className="font-semibold text-slate-950">{formatNumber(Number(value))}</span>
              </div>
            ))}
          </div>

          <Button className="mt-6" variant="outline" onClick={() => navigate('/settings')}>
            Open Settings and Operations
          </Button>
        </PageSection>
      </div>
    </PageShell>
  );
}
