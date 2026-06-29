import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Bell, LifeBuoy, Plus, RefreshCcw, Settings } from 'lucide-react';
import { Sidebar } from './sidebar';
import { safeGetItem, safeSetItem } from '@/lib/storage';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type HeaderAction = {
  label: string;
  onClick: () => void;
};

export type AppChromeConfig = {
  title: string;
  subtitle?: string;
  action?: HeaderAction;
  mode?: 'default' | 'dashboard';
  onRefresh?: () => void;
};

type AppChromeContextValue = {
  config: AppChromeConfig;
  setConfig: (config: AppChromeConfig) => void;
  clearConfig: () => void;
};

const defaultChromeConfig: AppChromeConfig = {
  title: '',
  subtitle: '',
  mode: 'default',
};

const AppChromeContext = createContext<AppChromeContextValue | null>(null);

export function useAppChrome() {
  const context = useContext(AppChromeContext);

  if (!context) {
    throw new Error('useAppChrome must be used within AppLayout');
  }

  return context;
}

export function AppLayout() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => safeGetItem('sm-v3-sidebar-collapsed') === '1');
  const [config, setConfigState] = useState<AppChromeConfig>(defaultChromeConfig);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationSummary, setNotificationSummary] = useState<{
    pendingDeadLetters: number;
    pendingBilling: number;
    activeSuppressions: number;
    portOrdersInProgress: number;
    platformAttention: number;
  }>({
    pendingDeadLetters: 0,
    pendingBilling: 0,
    activeSuppressions: 0,
    portOrdersInProgress: 0,
    platformAttention: 0,
  });

  const setConfig = useCallback((nextConfig: AppChromeConfig) => {
    setConfigState(nextConfig);
  }, []);

  const clearConfig = useCallback(() => {
    setConfigState(defaultChromeConfig);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      safeSetItem('sm-v3-sidebar-collapsed', next ? '1' : '0');
      return next;
    });
  }, []);

  const contextValue = useMemo(
    () => ({ config, setConfig, clearConfig }),
    [config, setConfig, clearConfig]
  );

  useEffect(() => {
    const loadNotificationSummary = async () => {
      try {
        const [operationsResponse, connectionsResponse] = await Promise.all([
          api.getOperationsSummary(),
          api.getPlatformConnections(),
        ]);

        const pendingDeadLetters = operationsResponse.data?.pendingDeadLetters ?? 0;
        const pendingBilling = operationsResponse.data?.billing?.pending ?? 0;
        const activeSuppressions = operationsResponse.data?.activeSuppressions ?? 0;
        const portOrdersInProgress =
          (operationsResponse.data?.portOrders?.submitted ?? 0) +
          (operationsResponse.data?.portOrders?.inProgress ?? 0) +
          (operationsResponse.data?.portOrders?.awaitingDocuments ?? 0);
        const platformAttention = (connectionsResponse.data ?? []).filter(
          (connection: { status?: string }) => connection.status === 'error' || connection.status === 'pending'
        ).length;

        setNotificationSummary({
          pendingDeadLetters,
          pendingBilling,
          activeSuppressions,
          portOrdersInProgress,
          platformAttention,
        });
      } catch {
        // Keep the bell usable even if the summary cannot be loaded.
      }
    };

    void loadNotificationSummary();
  }, []);

  const notificationItems = useMemo(() => {
    const items = [];

    if (notificationSummary.pendingDeadLetters > 0) {
      items.push({
        title: 'Queue failures need review',
        description: `${notificationSummary.pendingDeadLetters} dead-letter job${notificationSummary.pendingDeadLetters === 1 ? '' : 's'} waiting in operations.`,
        action: () => navigate('/settings'),
        label: 'Open Settings',
      });
    }

    if (notificationSummary.pendingBilling > 0) {
      items.push({
        title: 'Billing events are pending',
        description: `${notificationSummary.pendingBilling} local billing event${notificationSummary.pendingBilling === 1 ? '' : 's'} still need processing.`,
        action: () => navigate('/settings'),
        label: 'Review Billing',
      });
    }

    if (notificationSummary.platformAttention > 0) {
      items.push({
        title: 'Platform setup needs attention',
        description: `${notificationSummary.platformAttention} connected platform${notificationSummary.platformAttention === 1 ? '' : 's'} ${notificationSummary.platformAttention === 1 ? 'has' : 'have'} a pending or error state.`,
        action: () => navigate('/platforms'),
        label: 'Review Platforms',
      });
    }

    if (notificationSummary.portOrdersInProgress > 0) {
      items.push({
        title: 'Port orders still in flight',
        description: `${notificationSummary.portOrdersInProgress} port order${notificationSummary.portOrdersInProgress === 1 ? '' : 's'} are still being processed.`,
        action: () => navigate('/settings'),
        label: 'Open Settings',
      });
    }

    if (notificationSummary.activeSuppressions > 0) {
      items.push({
        title: 'Active opt-outs on record',
        description: `${notificationSummary.activeSuppressions} contacts are currently suppressed from outbound messaging.`,
        action: () => navigate('/settings'),
        label: 'Review Operations',
      });
    }

    return items;
  }, [navigate, notificationSummary]);

  const notificationCount = notificationItems.length;

  return (
    <AppChromeContext.Provider value={contextValue}>
      <div className="min-h-screen bg-[#F4F6F8] text-[#111827] lg:hidden">
        <Sidebar collapsed={false} onToggle={() => undefined} mobileOnly />
        <main className="relative min-h-screen bg-[#F4F6F8]">
          <Outlet />
        </main>
      </div>

      <div className="hidden h-screen overflow-hidden bg-[#F4F6F8] text-[#111827] lg:flex lg:flex-col">
        <div className="flex h-16 shrink-0 bg-white/85 backdrop-blur-[30px]">
          <div
            className={[
              'flex h-16 shrink-0 items-center border-b border-r border-black/5 bg-white transition-all duration-200',
              collapsed ? 'w-[72px] justify-center px-0' : 'w-[228px] px-3.5',
            ].join(' ')}
          >
            <img src="/icon-color.png" alt="" className="h-[46px] w-[46px] shrink-0" />
            {!collapsed && (
              <div className="ml-[-4px] whitespace-nowrap text-[20px] font-bold leading-none tracking-[-0.015em]">
                <span className="text-[#2FB267]">Mash</span>
                <span className="text-[#111827]">Connect</span>
              </div>
            )}
          </div>

          <div className="flex h-16 flex-1 items-center gap-3 border-b border-black/5 px-5">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold leading-[1.2] text-[#111827]">
                {config.title}
              </div>
              {config.subtitle ? (
                <div className="mt-0.5 truncate text-[11.5px] font-medium leading-[1.2] text-[#6B7280]">
                  {config.subtitle}
                </div>
              ) : null}
            </div>

            <div className="flex-1" />

            {config.mode === 'dashboard' ? (
              <div className="inline-flex rounded-[10px] bg-black/[0.06] p-[3px]">
                <button className="h-[26px] rounded-[7px] px-3 text-xs font-semibold text-[#6B7280]">
                  24h
                </button>
                <button className="h-[26px] rounded-[7px] bg-white px-3 text-xs font-semibold text-[#111827] shadow-[0_0_0_1px_rgba(17,24,39,0.06),0_1px_2px_rgba(17,24,39,0.06)]">
                  7d
                </button>
                <button className="h-[26px] rounded-[7px] px-3 text-xs font-semibold text-[#6B7280]">
                  30d
                </button>
              </div>
            ) : null}

            {config.mode === 'dashboard' ? (
              <button
                type="button"
                onClick={config.onRefresh}
                className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-black/[0.09] bg-white px-3 text-[12.5px] font-semibold text-[#1F2937] transition-colors hover:bg-black/[0.03]"
              >
                <RefreshCcw className="h-3.5 w-3.5 text-[#6B7280]" />
                <span>Refresh</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setShowNotifications(true)}
              aria-label="Open notification center"
              className="relative flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/[0.09] bg-white text-[#6B7280] transition-colors hover:bg-black/[0.03] hover:text-[#1F2937]"
            >
              <Bell className="h-[15px] w-[15px]" />
              {notificationCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full border-[1.5px] border-white bg-[#EF543C]" />
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => navigate('/settings')}
              aria-label="Open settings"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/[0.09] bg-white text-[#6B7280] transition-colors hover:bg-black/[0.03] hover:text-[#1F2937]"
            >
              <Settings className="h-[15px] w-[15px]" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/help')}
              aria-label="Open help and support"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/[0.09] bg-white text-[#6B7280] transition-colors hover:bg-black/[0.03] hover:text-[#1F2937]"
            >
              <LifeBuoy className="h-[15px] w-[15px]" />
            </button>

            {config.action ? (
              <button
                type="button"
                onClick={config.action.onClick}
                className="inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-[#2FB267] px-3 text-[12.5px] font-semibold text-white shadow-[0_2px_6px_-1px_rgba(47,178,103,0.35),0_1px_2px_rgba(47,178,103,0.20)] transition-colors hover:bg-[#258A50]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{config.action.label}</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
            <div className="h-full flex-1 overflow-y-auto overflow-x-hidden bg-[#F4F6F8]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <Dialog open={showNotifications} onOpenChange={setShowNotifications}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Notification Center</DialogTitle>
            <DialogDescription>
              Live operational alerts for the current organization.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {notificationItems.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                No active operational alerts right now.
              </div>
            ) : (
              notificationItems.map((item) => (
                <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="font-medium text-slate-950">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    onClick={() => {
                      setShowNotifications(false);
                      item.action();
                    }}
                  >
                    {item.label}
                  </Button>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNotifications(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppChromeContext.Provider>
  );
}
