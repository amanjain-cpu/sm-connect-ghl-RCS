import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Search,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  FileText,
  ArrowRight,
  Globe,
  Mail,
  Phone,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell, PageSection } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Brand {
  id: string;
  legalName: string;
  displayName: string;
  vertical: string;
  providerVertical: string | null;
  brandRelationship: 'BASIC_ACCOUNT' | 'SMALL_ACCOUNT' | 'MEDIUM_ACCOUNT' | 'LARGE_ACCOUNT' | 'KEY_ACCOUNT' | null;
  businessContactEmail: string | null;
  phone: string;
  referenceId: string | null;
  status: 'draft' | 'pending_verification' | 'verified' | 'unverified' | 'rejected' | 'suspended';
  createdAt: string;
  website: string;
}

const statusConfig = {
  draft: { label: 'Draft', icon: FileText, variant: 'secondary' as const },
  pending_verification: { label: 'Pending Review', icon: Clock, variant: 'warning' as const },
  verified: { label: 'Verified', icon: CheckCircle, variant: 'success' as const },
  unverified: { label: 'Unverified', icon: AlertCircle, variant: 'warning' as const },
  rejected: { label: 'Rejected', icon: XCircle, variant: 'destructive' as const },
  suspended: { label: 'Suspended', icon: AlertCircle, variant: 'destructive' as const },
};

export function BrandsPage() {
  const navigate = useNavigate();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const loadBrands = async () => {
      try {
        const response = await api.getBrands();
        if (response.success && response.data) {
          setBrands(response.data);
        }
      } catch (error) {
        console.error('Failed to load brands:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadBrands();
  }, []);

  const filteredBrands = brands.filter((brand) => {
    const query = searchQuery.toLowerCase();
    return (
      brand.legalName.toLowerCase().includes(query) ||
      brand.displayName.toLowerCase().includes(query) ||
      brand.vertical.toLowerCase().includes(query) ||
      brand.brandRelationship?.toLowerCase().includes(query) ||
      brand.businessContactEmail?.toLowerCase().includes(query) ||
      brand.referenceId?.toLowerCase().includes(query)
    );
  });

  const summary = {
    total: brands.length,
    verified: brands.filter((brand) => brand.status === 'verified').length,
    pending: brands.filter((brand) => brand.status === 'pending_verification').length,
    draft: brands.filter((brand) => brand.status === 'draft' || brand.status === 'unverified').length,
  };

  return (
    <div>
      <Header
        title="Brands"
        subtitle="Manage 10DLC brand registrations with clearer status visibility."
        action={{
          label: 'Register Brand',
          onClick: () => navigate('/brands/new'),
        }}
      />

      <PageShell>
        <PageSection className="px-6 py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-2">
              <Badge variant="outline" className="w-fit border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                Brand Registry
              </Badge>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Professional visibility for brand registration progress
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                Review brand readiness, search quickly, and move into registration without
                the low-contrast visual noise from the previous layout.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Total</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.total}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Verified</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.verified}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Pending</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.pending}</p>
              </div>
            </div>
          </div>
        </PageSection>

        {summary.verified === 0 && (
          <Card className="border-border bg-accent shadow-card">
            <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <Badge variant="warning" className="w-fit">Onboarding blocker</Badge>
                <h3 className="text-lg font-semibold text-foreground">
                  No verified brand is available yet
                </h3>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  The embedded rollout cannot proceed into campaign approval or number provisioning
                  until at least one business brand is verified. Create a draft, submit it, and return
                  here to monitor approval.
                </p>
              </div>
              <div className="flex gap-3">
                {summary.draft > 0 && (
                  <Button variant="outline" onClick={() => navigate('/brands')}>
                    Review Drafts
                  </Button>
                )}
                <Button onClick={() => navigate('/brands/new')}>
                  Register Brand
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <PageSection className="p-4">
          <div className="max-w-md">
            <Input
              placeholder="Search brands by legal name, display name, vertical, relationship, or reference"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
              className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        </PageSection>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <div className="space-y-4 animate-pulse">
                    <div className="h-12 w-12 rounded-2xl bg-slate-200 dark:bg-slate-800" />
                    <div className="space-y-2">
                      <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                    </div>
                    <div className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-900" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredBrands.length === 0 ? (
          <Card className="border-dashed border-slate-300 bg-slate-50/80 shadow-none dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="p-10 text-center">
              <div className="mx-auto mb-4 inline-flex rounded-2xl border border-slate-200 bg-white p-4 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <Building2 className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                No brands found
              </h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                Register your first brand to start the compliance workflow required for messaging.
              </p>
              <Button className="mt-6" onClick={() => navigate('/brands/new')}>
                Register Brand
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredBrands.map((brand) => {
              const status = statusConfig[brand.status];
              const StatusIcon = status.icon;

              return (
                <Card
                  key={brand.id}
                  className="cursor-pointer border-slate-200 bg-white shadow-sm transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700"
                  onClick={() => navigate(`/brands/${brand.id}`)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-4">
                        <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                          <Building2 className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                            {brand.legalName}
                          </h3>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                            Display name: {brand.displayName}
                          </p>
                        </div>
                      </div>
                      <Badge variant={status.variant} className="gap-1">
                        <StatusIcon className="h-3 w-3" />
                        {status.label}
                      </Badge>
                    </div>

                    <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-500 dark:text-slate-400">Vertical</span>
                        <span className="font-medium capitalize text-slate-950 dark:text-slate-50">
                          {(brand.providerVertical || brand.vertical).replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <Users className="h-4 w-4" />
                          Relationship
                        </span>
                        <span className="font-medium text-slate-950 dark:text-slate-50">
                          {brand.brandRelationship || 'Not set'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-500 dark:text-slate-400">Created</span>
                        <span className="font-medium text-slate-950 dark:text-slate-50">
                          {formatDate(brand.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <Globe className="h-4 w-4" />
                          Website
                        </span>
                        <span className="max-w-[60%] truncate font-medium text-slate-950 dark:text-slate-50">
                          {brand.website}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <Mail className="h-4 w-4" />
                          Business Email
                        </span>
                        <span className="max-w-[60%] truncate font-medium text-slate-950 dark:text-slate-50">
                          {brand.businessContactEmail || 'Not set'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <Phone className="h-4 w-4" />
                          Support Phone
                        </span>
                        <span className="max-w-[60%] truncate font-medium text-slate-950 dark:text-slate-50">
                          {brand.phone || 'Not set'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <ShieldCheck className="h-4 w-4" />
                          Reference
                        </span>
                        <span className="max-w-[60%] truncate font-medium text-slate-950 dark:text-slate-50">
                          {brand.referenceId || 'Not set'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-end text-sm font-medium text-slate-600 dark:text-slate-300">
                      Review details
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
