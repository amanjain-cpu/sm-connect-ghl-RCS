import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, User, Lock, Mail, Key, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { adminApi, useAdminStore } from '@/stores/admin.store';

const setupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Please enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[a-z]/, 'Must contain lowercase letter')
    .regex(/[0-9]/, 'Must contain number'),
  confirmPassword: z.string(),
  signalmashApiKey: z.string().min(1, 'Signalmash API key is required'),
  signalmashApiUrl: z.string().url('Please enter a valid URL').optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type SetupForm = z.infer<typeof setupSchema>;

export function AdminSetupPage() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetupForm>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      signalmashApiUrl: 'https://api.signalmash.com',
    },
  });

  const onSubmit = async (data: SetupForm) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await adminApi.setup({
        email: data.email,
        password: data.password,
        name: data.name,
        signalmashApiKey: data.signalmashApiKey,
        signalmashApiUrl: data.signalmashApiUrl,
      });

      localStorage.setItem('adminAccessToken', result.data.tokens.accessToken);
      localStorage.setItem('adminRefreshToken', result.data.tokens.refreshToken);
      localStorage.setItem('adminProfile', JSON.stringify(result.data.admin));
      useAdminStore.setState({
        admin: result.data.admin,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      navigate('/admin/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-4 py-10 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8">
        <section className="space-y-6">
          <div className="inline-flex rounded-2xl bg-slate-950 p-4 text-white dark:bg-slate-100 dark:text-slate-950">
            <Shield className="h-7 w-7" />
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Initial Setup
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              Create the first admin and seed runtime configuration
            </h1>
            <p className="max-w-xl text-base leading-7 text-slate-600 dark:text-slate-400">
              This one-time flow provisions the super admin account and stores the Signalmash credentials
              required for the platform to start operating.
            </p>
          </div>
        </section>

        <Card className="border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
          <CardContent className="p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Create Admin Account</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Complete the initial setup and store the API configuration used by the backend.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {error && (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Admin Credentials</h3>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                  <Input {...register('name')} error={errors.name?.message} placeholder="Your Name" leftIcon={<User className="h-4 w-4" />} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
                  <Input {...register('email')} type="email" error={errors.email?.message} placeholder="admin@example.com" leftIcon={<Mail className="h-4 w-4" />} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                    <Input {...register('password')} type="password" error={errors.password?.message} placeholder="••••••••" leftIcon={<Lock className="h-4 w-4" />} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Confirm Password</label>
                    <Input {...register('confirmPassword')} type="password" error={errors.confirmPassword?.message} placeholder="••••••••" leftIcon={<Lock className="h-4 w-4" />} />
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Signalmash Configuration</h3>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">API Key</label>
                  <Input {...register('signalmashApiKey')} type="password" error={errors.signalmashApiKey?.message} placeholder="Your Signalmash API key" leftIcon={<Key className="h-4 w-4" />} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">API URL</label>
                  <Input {...register('signalmashApiUrl')} error={errors.signalmashApiUrl?.message} placeholder="https://api.signalmash.com" />
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" isLoading={isSubmitting} rightIcon={<CheckCircle2 className="h-4 w-4" />}>
                Complete Setup
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
