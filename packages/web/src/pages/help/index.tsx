import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/layout/header';
import { PageShell } from '@/components/layout/page-shell';
import { api } from '@/lib/api';

declare global {
  interface Window {
    SignalmashSupportWidget?: {
      mount: (element: HTMLElement, props: { apiBaseUrl: string; token: string }) => void;
    };
  }
}

const SUPPORT_AGENT_ASSET_VERSION = '20260721-help-agent-only';
const SUPPORT_WIDGET_READY_TIMEOUT_MS = 5000;

export function HelpPage() {
  const supportAgentMountRef = useRef<HTMLDivElement | null>(null);
  const supportAgentMountedRef = useRef(false);
  const [supportAgentStatus, setSupportAgentStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let cancelled = false;

    const mountSupportAgent = async () => {
      try {
        if (supportAgentMountedRef.current) {
          setSupportAgentStatus('ready');
          return;
        }

        const response = await api.createSupportAgentSession({
          page: '/help',
          appStep: 'help',
        });

        if (cancelled) {
          return;
        }
        if (!response.success || !response.data) {
          throw new Error('Support agent session could not be created');
        }

        const supportWidget = await loadSupportAgentAssets(response.data.widgetAssetBaseUrl);

        if (cancelled) {
          return;
        }

        const mountPoint = supportAgentMountRef.current;
        if (!mountPoint) {
          throw new Error('Support widget did not load');
        }

        if (supportAgentMountedRef.current) {
          setSupportAgentStatus('ready');
          return;
        }

        supportWidget.mount(mountPoint, {
          apiBaseUrl: response.data.apiBaseUrl,
          token: response.data.token,
        });
        supportAgentMountedRef.current = true;
        setSupportAgentStatus('ready');
      } catch (error) {
        console.error('Support agent widget unavailable', error);
        if (!cancelled) {
          setSupportAgentStatus('unavailable');
        }
      }
    };

    void mountSupportAgent();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Header
        title="AI Support Agent"
        subtitle="Ask questions about setup, numbers, campaigns, billing, and delivery."
      />

      <PageShell className="flex-1" contentClassName="max-w-none">
        <section className="relative min-h-[calc(100vh-8rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div
            id="sm-connect-support-agent"
            ref={supportAgentMountRef}
            aria-busy={supportAgentStatus === 'loading'}
            className="min-h-[calc(100vh-8rem)] w-full"
          />

          {supportAgentStatus === 'loading' ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-slate-500">
              Loading AI support agent...
            </div>
          ) : supportAgentStatus === 'unavailable' ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white px-6 text-center text-sm text-slate-600">
              AI support agent is unavailable right now.
            </div>
          ) : null}
        </section>
      </PageShell>
    </div>
  );
}

async function loadSupportAgentAssets(
  assetBaseUrl: string
): Promise<NonNullable<Window['SignalmashSupportWidget']>> {
  const baseUrl = trimSlash(assetBaseUrl);
  await Promise.all([
    loadStylesheet(buildSupportAgentAssetUrl(baseUrl, 'widget.css')).catch((error) => {
      console.warn('Support widget styles failed to load; continuing without widget stylesheet', error);
    }),
    loadScript(buildSupportAgentAssetUrl(baseUrl, 'signalmash-support-widget.iife.js')),
  ]);

  return waitForSupportWidget();
}

function buildSupportAgentAssetUrl(assetBaseUrl: string, file: string): string {
  return `${assetBaseUrl}/${file}?v=${SUPPORT_AGENT_ASSET_VERSION}`;
}

function waitForSupportWidget(): Promise<NonNullable<Window['SignalmashSupportWidget']>> {
  if (window.SignalmashSupportWidget) {
    return Promise.resolve(window.SignalmashSupportWidget);
  }

  const start = Date.now();

  return new Promise((resolve, reject) => {
    const poll = () => {
      if (window.SignalmashSupportWidget) {
        resolve(window.SignalmashSupportWidget);
        return;
      }

      if (Date.now() - start >= SUPPORT_WIDGET_READY_TIMEOUT_MS) {
        reject(new Error('Support widget did not register'));
        return;
      }

      window.setTimeout(poll, 50);
    };

    poll();
  });
}

function loadScript(src: string): Promise<void> {
  const existing = findSupportAgentScript(src);
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
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Support widget script failed to load'));
    };
    document.head.appendChild(script);
  });
}

function loadStylesheet(href: string): Promise<void> {
  const existing = findSupportAgentStylesheet(href);
  if (existing) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.supportAgent = 'true';
    link.onload = () => {
      link.dataset.loaded = 'true';
      resolve();
    };
    link.onerror = () => {
      link.remove();
      reject(new Error('Support widget styles failed to load'));
    };
    document.head.appendChild(link);
  });
}

function findSupportAgentScript(src: string): HTMLScriptElement | undefined {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-support-agent="true"]')).find(
    (script) => script.getAttribute('src') === src
  );
}

function findSupportAgentStylesheet(href: string): HTMLLinkElement | undefined {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-support-agent="true"]')).find(
    (link) => link.getAttribute('href') === href
  );
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
