import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Users,
  MessageSquare,
  Megaphone,
  Award,
  Activity,
  Key,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { adminApi } from '@/stores/admin.store';
import { AdminHeader } from '@/components/layout/admin-header';
import { formatNumber } from '@/lib/utils';

interface DashboardStats {
  totalOrganizations: number;
  totalUsers: number;
  totalBrands: number;
  totalCampaigns: number;
  totalMessages: number;
  messagesLast24h: number;
}

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const response = await adminApi.getDashboard();
        if (response.success) {
          setStats(response.data);
        }
      } catch (error) {
        console.error('Failed to load stats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadStats();
  }, []);

  const statCards = [
    { title: 'Organizations', value: stats?.totalOrganizations ?? 0, icon: Building2 },
    { title: 'Users', value: stats?.totalUsers ?? 0, icon: Users },
    { title: 'Brands', value: stats?.totalBrands ?? 0, icon: Award },
    { title: 'Campaigns', value: stats?.totalCampaigns ?? 0, icon: Megaphone },
    { title: 'Total Messages', value: stats?.totalMessages ?? 0, icon: MessageSquare },
    { title: 'Messages (24h)', value: stats?.messagesLast24h ?? 0, icon: Activity },
  ];

  const quickActions = [
    {
      title: 'Runtime Settings',
      description: 'Manage Signalmash and platform OAuth configuration stored in app settings.',
      href: '/admin/settings',
      icon: Key,
    },
    {
      title: 'Organizations',
      description: 'Review connected organizations, usage footprint, and growth across the platform.',
      href: '/admin/organizations',
      icon: Building2,
    },
    {
      title: 'Admin Users',
      description: 'Invite app administrators, reset temporary passwords, and deactivate access.',
      href: '/admin/users',
      icon: Users,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <AdminHeader title="Admin Portal" subtitle="Platform administration and runtime controls" />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <section className="rounded-[28px] border border-primary/20 bg-primary/5 px-6 py-6 shadow-sm dark:border-primary/25 dark:bg-primary/10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
                Platform Overview
              </p>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Administrative visibility across tenants and runtime activity
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                The admin dashboard now matches the main product shell: clean surfaces, readable metrics,
                and direct paths into configuration and tenant management.
              </p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {statCards.map((stat) => (
            <Card key={stat.title} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6">
                <div className="mb-5 flex items-start justify-between">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                    <stat.icon className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                  </div>
                </div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{stat.title}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                  {isLoading ? (
                    <span className="inline-block h-9 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                  ) : (
                    formatNumber(stat.value)
                  )}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {quickActions.map((action) => (
            <Card
              key={action.title}
              className="cursor-pointer border-slate-200 bg-white shadow-sm transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700"
              onClick={() => navigate(action.href)}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-4">
                    <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                      <action.icon className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">{action.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                        {action.description}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-400" />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}
