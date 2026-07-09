import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/layout/header';
import { api } from '@/lib/api';

const SUPPORT_AGENT_ASSET_VERSION = '20260710-enterprise-chat-v3';

declare global {
  interface Window {
    SignalmashSupportWidget?: {
      mount: (element: HTMLElement, props: { apiBaseUrl: string; token: string }) => void;
    };
  }
}

export function HelpPage() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [supportAgentStatus, setSupportAgentStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [supportAgentConfig, setSupportAgentConfig] = useState<{ apiBaseUrl: string; token: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSupportAgent = async () => {
      try {
        const response = await api.createSupportAgentSession({
          page: '/help',
          appStep: 'help',
        });

        if (cancelled || !response.success || !response.data) {
          return;
        }

        await loadSupportAgentAssets(response.data.widgetAssetBaseUrl);

        if (cancelled) {
          return;
        }

        setSupportAgentConfig({
          apiBaseUrl: response.data.apiBaseUrl,
          token: response.data.token,
        });
        setSupportAgentStatus('ready');
      } catch (error) {
        if (!cancelled) {
          console.error('Support chat failed to initialize', error);
          setSupportAgentStatus('unavailable');
        }
      }
    };

    void loadSupportAgent();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (supportAgentStatus !== 'ready' || !supportAgentConfig) {
      return;
    }

    const mountPoint = mountRef.current;
    if (!mountPoint || !window.SignalmashSupportWidget) {
      console.error('Support chat mount point or widget global was unavailable');
      setSupportAgentStatus('unavailable');
      return;
    }

    try {
      mountPoint.innerHTML = '';
      window.SignalmashSupportWidget.mount(mountPoint, supportAgentConfig);
    } catch (error) {
      console.error('Support chat widget mount failed', error);
      setSupportAgentStatus('unavailable');
    }
  }, [supportAgentConfig, supportAgentStatus]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header title="Help & Support" />

      <section className="flex flex-1 px-4 py-4 sm:px-6">
        <div
          id="sm-connect-support-agent"
          ref={mountRef}
          className="min-h-[calc(100vh-8rem)] w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950"
        >
          {supportAgentStatus === 'loading' ? (
            <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Loading support chat...
            </div>
          ) : supportAgentStatus === 'unavailable' ? (
            <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-6 text-center text-sm text-slate-600 dark:text-slate-400">
              Support chat is unavailable right now.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

async function loadSupportAgentAssets(assetBaseUrl: string) {
  const stylesheetUrl = `${assetBaseUrl}/widget.css?v=${SUPPORT_AGENT_ASSET_VERSION}`;
  const scriptUrl = `${assetBaseUrl}/signalmash-support-widget.iife.js?v=${SUPPORT_AGENT_ASSET_VERSION}`;

  await Promise.all([
    loadStylesheet(stylesheetUrl).catch((error) => {
      console.warn('Support chat styles failed to load; continuing without widget stylesheet', error);
    }),
    loadScript(scriptUrl),
  ]);

  await waitForSupportWidget();
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-support-agent="true"][src="${src}"]`);
  if (existing) {
    if (window.SignalmashSupportWidget) {
      return Promise.resolve();
    }

    existing.remove();
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

function waitForSupportWidget(): Promise<void> {
  if (window.SignalmashSupportWidget) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (window.SignalmashSupportWidget) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > 1500) {
        reject(new Error('Support widget global was not registered'));
        return;
      }

      window.setTimeout(check, 50);
    };

    check();
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
