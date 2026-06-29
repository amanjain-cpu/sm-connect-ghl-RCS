import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { Button } from './button';
import { useNotificationStore } from '@/stores/notification.store';
import { sanitizePlatformBranding } from '@/lib/platform-branding';

const variantConfig = {
  success: {
    icon: CheckCircle2,
    card: 'border-primary/20 bg-primary/10 text-foreground',
    iconColor: 'text-primary',
  },
  error: {
    icon: AlertCircle,
    card: 'border-destructive/20 bg-destructive/10 text-foreground',
    iconColor: 'text-destructive',
  },
  info: {
    icon: Info,
    card: 'border-border bg-card text-foreground',
    iconColor: 'text-primary',
  },
} as const;

export function Toaster() {
  const { notifications, dismiss } = useNotificationStore();

  useEffect(() => {
    const timers = notifications.map((notification) =>
      window.setTimeout(() => dismiss(notification.id), 4500)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [notifications, dismiss]);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-3">
      <AnimatePresence>
        {notifications.map((notification) => {
          const config = variantConfig[notification.variant];
          const Icon = config.icon;
          const title = sanitizePlatformBranding(notification.title);
          const description = notification.description
            ? sanitizePlatformBranding(notification.description)
            : null;

          return (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              className={`pointer-events-auto rounded-2xl border shadow-card ${config.card}`}
            >
              <div className="flex items-start gap-3 p-4">
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${config.iconColor}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{title}</p>
                  {description && (
                    <p className="mt-1 text-sm opacity-90">{description}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7 rounded-full"
                  onClick={() => dismiss(notification.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
