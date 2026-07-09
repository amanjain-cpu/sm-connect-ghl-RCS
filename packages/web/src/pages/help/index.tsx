import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, BookOpen, LifeBuoy, MessageSquareWarning, Plug, Settings } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell, PageSection } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

declare global {
  interface Window {
    SignalmashSupportWidget?: {
      mount: (element: HTMLElement, props: { apiBaseUrl: string; token: string }) => void;
    };
  }
}

interface OperationsSummary {
  billing: {
    pending: number;
  };
  pendingDeadLetters: number;
  activeSuppressions: number;
  portOrders: {
    submitted: number;
    inProgress: number;
    awaitingDocuments: number;
  };
}

interface PlatformConnection {
  id: string;
  platform: string;
  platformAccountName: string | null;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  installation: {
    lifecycleState: string;
  } | null;
}

export function HelpPage() {
  const navigate = useNavigate();
  const { organization } = useAuthStore();
  const [operations, setOperations] = useState<OperationsSummary | null>(null);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [supportAgentStatus, setSupportAgentStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    const loadData = async () => {
      try {
        const [operationsResponse, connectionsResponse] = await Promise.all([
          api.getOperationsSummary(),
          api.getPlatformConnections(),
        ]);

        if (operationsResponse.success && operationsResponse.data) {
          setOperations(operationsResponse.data);
        }

        if (connectionsResponse.success && connectionsResponse.data) {
          setConnections(connectionsResponse.data);
        }
      } catch {
        // Keep the page usable even if support diagnostics fail to load.
      }
    };

    void loadData();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const mountSupportAgent = async () => {
      try {
        const response = await api.createSupportAgentSession({
          page: '/help',
          appStep: 'help',
          onboardingStatus: connections[0]?.installation?.lifecycleState,
        });

        if (cancelled || !response.success || !response.data) {
          return;
        }

        await loadSupportAgentAssets(response.data.widgetAssetBaseUrl);

        if (cancelled) {
          return;
        }

        const mountPoint = document.getElementById('sm-connect-support-agent');
        if (!mountPoint || !window.SignalmashSupportWidget) {
          throw new Error('Support widget did not load');
        }

        mountPoint.innerHTML = '';
        window.SignalmashSupportWidget.mount(mountPoint, {
          apiBaseUrl: response.data.apiBaseUrl,
          token: response.data.token,
        });
        setSupportAgentStatus('ready');
      } catch {
        if (!cancelled) {
          setSupportAgentStatus('unavailable');
        }
      }
    };

    void mountSupportAgent();

    return () => {
      cancelled = true;
    };
  }, [connections]);

  const connectionNeedsAttention = connections.filter(
    (connection) => connection.status === 'error' || connection.status === 'pending'
  );
  const pendingPortWork =
    (operations?.portOrders.submitted ?? 0) +
    (operations?.portOrders.inProgress ?? 0) +
    (operations?.portOrders.awaitingDocuments ?? 0);

  return (
    <div>
      <Header
        title="Help & Support"
        subtitle="Operational guidance and live diagnostics for the current embedded workspace."
      />

      <PageShell>
        <PageSection className="px-6 py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <Badge variant="outline" className="w-fit">
                Support
              </Badge>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                Get unstuck without guessing which screen controls what
              </h2>
              <p className="text-sm leading-6 text-slate-600">
                This page is wired to the current organization so operators can see whether the issue is
                onboarding, message operations, phone-number readiness, or platform setup.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
              <p className="font-medium text-slate-950">{organization?.name ?? 'Current organization'}</p>
              <p className="mt-1">Primary contact: {organization?.email ?? 'Not available'}</p>
            </div>
          </div>
        </PageSection>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                  <LifeBuoy className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-950">Platform health</h3>
                  <p className="text-sm text-slate-600">
                    {connectionNeedsAttention.length === 0
                      ? 'No current platform alerts.'
                      : `${connectionNeedsAttention.length} platform connection issues detected.`}
                  </p>
                </div>
              </div>
              <Button className="mt-5" variant="outline" onClick={() => navigate('/platforms')}>
                Review Platforms
              </Button>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
                  <MessageSquareWarning className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-950">Message operations</h3>
                  <p className="text-sm text-slate-600">
                    {operations?.pendingDeadLetters ?? 0} dead-letter jobs, {operations?.billing.pending ?? 0} pending billing events.
                  </p>
                </div>
              </div>
              <Button className="mt-5" variant="outline" onClick={() => navigate('/settings')}>
                Open Operations Settings
              </Button>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-950">Number and compliance</h3>
                  <p className="text-sm text-slate-600">
                    {pendingPortWork} port orders in progress, {operations?.activeSuppressions ?? 0} active opt-outs.
                  </p>
                </div>
              </div>
              <Button className="mt-5" variant="outline" onClick={() => navigate('/phone-numbers')}>
                Manage Numbers
              </Button>
            </CardContent>
          </Card>
        </div>

        <PageSection className="px-6 py-6">
          <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div id="sm-connect-support-agent" className="min-h-[560px]">
              {supportAgentStatus === 'loading' ? (
                <div className="flex min-h-[560px] items-center justify-center text-sm text-slate-500">
                  Loading support chat...
                </div>
              ) : supportAgentStatus === 'unavailable' ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                  Support chat is unavailable right now. The diagnostics and operator guidance below are still available.
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-slate-500" />
                <h3 className="font-semibold text-slate-950">Common operator questions</h3>
              </div>
              <div className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
                <p>
                  Use <span className="font-medium text-slate-950">Phone Numbers</span> to choose the default outbound sender for the embedded app. The number marked as default is the one the queue uses when the connected workspace sends outbound traffic without an explicit sender.
                </p>
                <p>
                  <span className="font-medium text-slate-950">Deprovision Number</span> means the number is released from the provider and removed from active sending inventory. It is not just a UI hide action.
                </p>
                <p>
                  Dashboard KPI cards now reflect live message records for this organization. If counts look off, compare them against the Messages screen filters for the same time window.
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-slate-500" />
                <h3 className="font-semibold text-slate-950">Where to go next</h3>
              </div>
              <div className="mt-4 grid gap-3">
                <Button variant="outline" onClick={() => navigate('/dashboard')}>
                  Open Dashboard
                </Button>
                <Button variant="outline" onClick={() => navigate('/messages')}>
                  Review Message Log
                </Button>
                <Button variant="outline" onClick={() => navigate('/settings')}>
                  Open Settings
                </Button>
                <Button variant="outline" onClick={() => navigate('/platforms')}>
                  Check Installation State
                </Button>
                <Button variant="outline" onClick={() => navigate('/campaigns')}>
                  Review Campaign Approval
                </Button>
              </div>
            </div>
          </div>
        </PageSection>

        {connections.length > 0 ? (
          <PageSection className="px-6 py-6">
            <div className="mb-4 flex items-center gap-2">
              <Plug className="h-4 w-4 text-slate-500" />
              <h3 className="font-semibold text-slate-950">Connected platforms</h3>
            </div>
            <div className="space-y-3">
              {connections.map((connection) => (
                <div key={connection.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-medium capitalize text-slate-950">{connection.platform}</p>
                      <p className="text-sm text-slate-600">
                        {connection.platformAccountName || 'Unnamed account'} · {connection.installation?.lifecycleState || 'no installation summary'}
                      </p>
                    </div>
                    <Badge variant={connection.status === 'connected' ? 'success' : connection.status === 'error' ? 'destructive' : 'warning'}>
                      {connection.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </PageSection>
        ) : null}
      </PageShell>
    </div>
  );
}

async function loadSupportAgentAssets(assetBaseUrl: string) {
  await Promise.all([
    loadStylesheet(`${assetBaseUrl}/widget.css`),
    loadScript(`${assetBaseUrl}/signalmash-support-widget.iife.js`),
  ]);
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-support-agent="true"][src="${src}"]`);
  if (existing) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.supportAgent = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Support widget script failed to load'));
    document.head.appendChild(script);
  });
}

function loadStylesheet(href: string): Promise<void> {
  const existing = document.querySelector<HTMLLinkElement>(`link[data-support-agent="true"][href="${href}"]`);
  if (existing) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.supportAgent = 'true';
    link.onload = () => resolve();
    link.onerror = () => reject(new Error('Support widget styles failed to load'));
    document.head.appendChild(link);
  });
}
