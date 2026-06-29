import { useEffect } from 'react';
import { useAppChrome, type AppChromeConfig } from './app-layout';
import { Button } from '@/components/ui/button';

interface HeaderProps extends AppChromeConfig {}

export function Header({ title, subtitle, action, mode = 'default', onRefresh }: HeaderProps) {
  const { setConfig, clearConfig } = useAppChrome();

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
          <Button onClick={action.onClick} className="shrink-0">
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
