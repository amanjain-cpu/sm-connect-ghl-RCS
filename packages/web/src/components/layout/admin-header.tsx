// ===========================================
// Admin Header Component
// ===========================================

import { useNavigate } from 'react-router-dom';
import { Shield, LogOut, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAdminStore } from '@/stores/admin.store';

interface AdminHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  backTo?: string;
}

export function AdminHeader({ title, subtitle, showBack, backTo = '/admin/dashboard' }: AdminHeaderProps) {
  const navigate = useNavigate();
  const { admin, logout } = useAdminStore();

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-slate-800 dark:bg-slate-950/95 dark:supports-[backdrop-filter]:bg-slate-950/80">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            {showBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(backTo)}
                className="text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-50"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}
            <div className="rounded-2xl bg-slate-950 p-3 text-white dark:bg-slate-100 dark:text-slate-950">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">{title}</h1>
              {subtitle && <p className="text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
              <span className="text-slate-500 dark:text-slate-400">Admin</span>{' '}
              <span className="font-medium text-slate-950 dark:text-slate-50">{admin?.name || admin?.email}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
