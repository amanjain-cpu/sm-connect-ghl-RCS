import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Megaphone,
  Search,
  CheckCircle,
  Clock,
  XCircle,
  Pause,
  ArrowRight,
  BadgeCheck,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell, PageSection } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Campaign {
  id: string;
  name: string;
  brand: {
    id: string;
    displayName: string;
    status: string;
  };
  useCase: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'suspended' | 'expired';
  createdAt: string;
}

const statusConfig = {
  draft: { label: 'Draft', icon: Megaphone, variant: 'secondary' as const },
  pending_approval: { label: 'Pending Approval', icon: Clock, variant: 'warning' as const },
  approved: { label: 'Approved', icon: CheckCircle, variant: 'success' as const },
  suspended: { label: 'Suspended', icon: Pause, variant: 'destructive' as const },
  rejected: { label: 'Rejected', icon: XCircle, variant: 'destructive' as const },
  expired: { label: 'Expired', icon: Clock, variant: 'destructive' as const },
};

export function CampaignsPage() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const loadCampaigns = async () => {
      try {
        const response = await api.getCampaigns();
        if (response.success && response.data) {
          setCampaigns(response.data);
        }
      } catch (error) {
        console.error('Failed to load campaigns:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadCampaigns();
  }, []);

  const filteredCampaigns = campaigns.filter((campaign) => {
    const query = searchQuery.toLowerCase();
    return (
      campaign.name.toLowerCase().includes(query) ||
      campaign.brand.displayName.toLowerCase().includes(query) ||
      campaign.useCase.toLowerCase().includes(query)
    );
  });

  const summary = {
    total: campaigns.length,
    approved: campaigns.filter((campaign) => campaign.status === 'approved').length,
    pending: campaigns.filter((campaign) => campaign.status === 'pending_approval').length,
  };

  return (
    <div>
      <Header
        title="Campaigns"
        subtitle="Track campaign readiness, approval state, and brand alignment in one place."
        action={{
          label: 'Create Campaign',
          onClick: () => navigate('/campaigns/new'),
        }}
      />

      <PageShell>
        <PageSection className="px-6 py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-2">
              <Badge variant="outline" className="w-fit border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                Campaign Registry
              </Badge>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Campaign approvals and brand dependencies at a glance
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                The refreshed view focuses on approval status and linked brands so teams can
                spot blockers before they affect messaging launches.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Total</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.total}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Approved</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.approved}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Pending</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.pending}</p>
              </div>
            </div>
          </div>
        </PageSection>

        <PageSection className="p-4">
          <div className="max-w-md">
            <Input
              placeholder="Search campaigns by name, brand, or use case"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
              className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        </PageSection>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <div className="flex animate-pulse items-start gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-slate-200 dark:bg-slate-800" />
                    <div className="flex-1 space-y-3">
                      <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-10 rounded-2xl bg-slate-100 dark:bg-slate-900" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <Card className="border-dashed border-slate-300 bg-slate-50/80 shadow-none dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="p-10 text-center">
              <div className="mx-auto mb-4 inline-flex rounded-2xl border border-slate-200 bg-white p-4 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <Megaphone className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                No campaigns found
              </h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                Create a campaign after you have at least one verified brand ready for submission.
              </p>
              <Button className="mt-6" onClick={() => navigate('/campaigns/new')}>
                Create Campaign
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredCampaigns.map((campaign) => {
              const status = statusConfig[campaign.status];
              const StatusIcon = status.icon;

              return (
                <Card
                  key={campaign.id}
                  className="cursor-pointer border-slate-200 bg-white shadow-sm transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700"
                  onClick={() => navigate(`/campaigns/${campaign.id}`)}
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-4">
                        <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                          <Megaphone className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                              {campaign.name}
                            </h3>
                            <Badge variant={status.variant} className="gap-1">
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            Use case: {campaign.useCase.replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                        <BadgeCheck className="h-4 w-4" />
                        Brand: {campaign.brand.displayName}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900 md:grid-cols-3">
                      <div className="flex items-center justify-between gap-3 text-sm md:block">
                        <p className="text-slate-500 dark:text-slate-400">Brand Status</p>
                        <p className="mt-1 font-medium capitalize text-slate-950 dark:text-slate-50">
                          {campaign.brand.status.replace(/_/g, ' ')}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm md:block">
                        <p className="text-slate-500 dark:text-slate-400">Created</p>
                        <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                          {formatDate(campaign.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm md:block">
                        <p className="text-slate-500 dark:text-slate-400">Readiness</p>
                        <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                          {campaign.status === 'approved' ? 'Live' : campaign.status === 'pending_approval' ? 'Awaiting review' : 'Needs action'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-end text-sm font-medium text-slate-600 dark:text-slate-300">
                      Open campaign
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageShell>
    </div>
  );
}
