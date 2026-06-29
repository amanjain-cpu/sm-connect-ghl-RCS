// ===========================================
// Connect Page
// Entry point for users - initiates platform OAuth
// ===========================================

import { motion } from 'framer-motion';
import { ExternalLink, Shield, Zap, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth.store';

const features = [
  {
    icon: Zap,
    title: 'Instant Setup',
    description: 'Connect your CRM workspace in seconds with secure OAuth',
  },
  {
    icon: MessageSquare,
    title: 'SMS Campaigns',
    description: 'Send bulk SMS campaigns through Signalmash',
  },
  {
    icon: Shield,
    title: 'Secure & Reliable',
    description: 'Enterprise-grade security for your messaging needs',
  },
];

export function ConnectPage() {
  const { initiatePlatformOAuth, isLoading, error } = useAuthStore();

  const handleConnect = async () => {
    try {
      await initiatePlatformOAuth();
    } catch {
      // Error is handled by the store
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/12 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/8 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-lg"
      >
        <div className="text-center mb-8">
          <div className="mb-4 inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-3xl font-bold text-primary-foreground shadow-pop">
            <span>SM</span>
          </div>
          <h1 className="text-3xl font-bold">Signalmash Connect</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Power your CRM with SMS messaging
          </p>
        </div>

        <Card className="border-border shadow-pop">
          <CardContent className="p-8">
            <div className="space-y-4 mb-8">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 + 0.2 }}
                  className="flex items-start gap-4"
                >
                  <div className="p-2 rounded-lg bg-primary/10">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mb-6 p-3 rounded-xl bg-destructive/10 text-destructive text-sm"
              >
                {error}
              </motion.div>
            )}

            {/* Connect Button */}
            <Button
              onClick={handleConnect}
              className="h-14 w-full text-lg"
              isLoading={isLoading}
            >
              <ExternalLink className="h-5 w-5 mr-2" />
              Connect your CRM
            </Button>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              You'll be redirected to your CRM to authorize access
            </p>
          </CardContent>
        </Card>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          By connecting, you agree to our{' '}
          <a href="#" className="underline hover:text-foreground">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href="#" className="underline hover:text-foreground">
            Privacy Policy
          </a>
        </p>
      </motion.div>
    </div>
  );
}
