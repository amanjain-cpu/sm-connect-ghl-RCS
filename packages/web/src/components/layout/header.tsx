import { useEffect } from 'react';
import { useAppChrome, type AppChromeConfig } from './app-layout';
import { Button } from '@/components/ui/button';
import { Clock } from 'lucide-react';
import {
  formatProvisioningCountdown,
  getRemainingProvisioningMs,
  getSoonestActiveProvisioningLock,
  useProvisioningLocks,
} from '@/lib/phone-number-provisioning';

interface HeaderProps extends AppChromeConfig {}

export function Header({ title, subtitle, action, mode = 'default', onRefresh }: HeaderProps) {
  const { setConfig, clearConfig } = useAppChrome();
  const provisioningLocks = useProvisioningLocks();
  const activeProvisioningLock = getSoonestActiveProvisioningLock(provisioningLocks);
  const activeProvisioningRemainingMs = activeProvisioningLock
    ? getRemainingProvisioningMs(activeProvisioningLock)
    : 0;
  const provisioningCountdown = activeProvisioningRemainingMs > 0
    ? formatProvisioningCountdown(activeProvisioningRemainingMs)
    : null;

  useEffect(() => {
    setConfig({ title, subtitle, action, mode, onRefresh });

    return () => {
      clearConfig();
    };
  }, [title, subtitle, action, mode, onRefresh, setConfig, clearConfig]);

  return (
    <div className="border-b border-black/5 bg-white/90 px-4 py-4 backdrop-blur lg:hidden">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-[#111827]">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-[#6B7280]">{subtitle}</p>
          ) : null}
        </div>
        {action ? (
          <Button
            onClick={action.onClick}
            className="shrink-0"
            disabled={action.disabled}
            title={action.disabledReason}
          >
            {action.label}
          </Button>
        ) : null}
      </div>
      {provisioningCountdown ? (
        <div
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
          title={activeProvisioningLock?.phoneNumber}
        >
          <Clock className="h-3.5 w-3.5" />
          <span>Number provisioning</span>
          <span>{provisioningCountdown}</span>
        </div>
      ) : null}
    </div>
  );
}
