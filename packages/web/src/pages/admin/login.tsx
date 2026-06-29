import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useAdminStore } from '@/stores/admin.store';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

export function AdminLoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAdminStore();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    try {
      await login(data.email, data.password);
      navigate('/admin/dashboard');
    } catch {
      // store handles error state
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-4 py-10 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8">
        <section className="space-y-6">
          <div className="inline-flex rounded-2xl bg-slate-950 p-4 text-white dark:bg-slate-100 dark:text-slate-950">
            <Shield className="h-7 w-7" />
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Admin Portal
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              Operational control for Signalmash Connect
            </h1>
            <p className="max-w-xl text-base leading-7 text-slate-600 dark:text-slate-400">
              Sign in to manage runtime settings, monitor platform usage, and review connected organizations
              from the cleaned-up admin surface.
            </p>
          </div>
        </section>

        <Card className="border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
          <CardContent className="p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Sign in</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Restricted access for platform administrators only.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {error && (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
                <Input
                  {...register('email')}
                  type="email"
                  placeholder="admin@example.com"
                  error={errors.email?.message}
                  leftIcon={<Mail className="h-4 w-4" />}
                  onChange={() => clearError()}
                  className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                <Input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  error={errors.password?.message}
                  leftIcon={<Lock className="h-4 w-4" />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="focus:outline-none text-slate-400"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                  onChange={() => clearError()}
                  className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                isLoading={isLoading}
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
