import { useEffect, useState } from 'react';
import {
  Building2,
  Users,
  Award,
  Megaphone,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Link2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AdminHeader } from '@/components/layout/admin-header';
import { adminApi } from '@/stores/admin.store';
import { formatNumber, formatDate } from '@/lib/utils';
import { notify } from '@/stores/notification.store';

interface Organization {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  _count: {
    users: number;
    brands: number;
    campaigns: number;
    messages: number;
  };
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function AdminOrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [linkForm, setLinkForm] = useState({
    brandName: '',
    signalmashBrandId: '',
    tcrBrandId: '',
    campaignName: '',
    signalmashCampaignId: '',
    tcrCampaignId: '',
    phoneNumber: '',
    signalmashNumberId: '',
    friendlyName: '',
    configureWebhook: true,
    makeDefaultSender: true,
  });

  const loadOrganizations = async () => {
    setIsLoading(true);
    try {
      const response = await adminApi.getOrganizations(page);
      if (response.success) {
        setOrganizations(response.data);
        setMeta(response.meta);
      }
    } catch (error) {
      console.error('Failed to load organizations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrganizations();
  }, [page]);

  const openLinkDialog = (organization: Organization) => {
    setSelectedOrganization(organization);
    setLinkForm({
      brandName: organization.name,
      signalmashBrandId: '',
      tcrBrandId: '',
      campaignName: `${organization.name} Existing Campaign`,
      signalmashCampaignId: '',
      tcrCampaignId: '',
      phoneNumber: '',
      signalmashNumberId: '',
      friendlyName: `${organization.name} Default Sender`,
      configureWebhook: true,
      makeDefaultSender: true,
    });
    setShowLinkDialog(true);
  };

  const handleLinkExistingAssets = async () => {
    if (!selectedOrganization) return;
    if (linkForm.configureWebhook && !linkForm.signalmashNumberId.trim()) {
      notify.error(
        'Signalmash Number ID required',
        'Enter the provider number ID before linking when webhook configuration is enabled. Without it, inbound replies cannot sync back into the connected workspace.'
      );
      return;
    }

    setIsLinking(true);
    try {
      const response = await adminApi.linkExistingSignalmashAssets({
        organizationId: selectedOrganization.id,
        brandName: linkForm.brandName,
        signalmashBrandId: linkForm.signalmashBrandId,
        tcrBrandId: linkForm.tcrBrandId || undefined,
        campaignName: linkForm.campaignName,
        signalmashCampaignId: linkForm.signalmashCampaignId,
        tcrCampaignId: linkForm.tcrCampaignId || undefined,
        phoneNumber: linkForm.phoneNumber,
        signalmashNumberId: linkForm.signalmashNumberId || undefined,
        friendlyName: linkForm.friendlyName || undefined,
        configureWebhook: linkForm.configureWebhook,
        makeDefaultSender: linkForm.makeDefaultSender,
      });

      if (response.success) {
        await loadOrganizations();
        setShowLinkDialog(false);
        setSelectedOrganization(null);
        notify.success(
          'Assets linked',
          response.data?.webhookError
            ? 'Brand, campaign, and number are linked. Review webhook configuration before inbound testing.'
            : 'Brand, campaign, and number are ready for send-flow testing.'
        );
      }
    } catch (error) {
      console.error('Failed to link existing assets:', error);
      notify.error('Link failed', error instanceof Error ? error.message : 'The existing Signalmash assets could not be linked.');
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <AdminHeader title="Organizations" subtitle="Connected tenants across the platform" showBack />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Tenant Directory
              </p>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Review organization footprint and adoption
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                Organizations returned by the admin API with aggregate counts for users, brands, campaigns, and messages.
              </p>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {meta ? `Showing ${organizations.length} of ${meta.total} organizations` : 'Loading organizations...'}
            </p>
          </div>
        </section>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[...Array(4)].map((_, index) => (
              <Card key={index} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <div className="animate-pulse space-y-3">
                    <div className="h-6 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-16 rounded bg-slate-200 dark:bg-slate-800" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : organizations.length === 0 ? (
          <Card className="border-dashed border-slate-300 bg-slate-50/80 shadow-none dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="p-10 text-center">
              <div className="mx-auto mb-4 inline-flex rounded-2xl border border-slate-200 bg-white p-4 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <Building2 className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">No organizations yet</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Organizations will appear here after users connect the platform.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {organizations.map((org) => (
              <Card key={org.id} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">{org.name}</h3>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{org.email}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                      <Building2 className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900">
                    <div className="text-center">
                      <Users className="mx-auto h-4 w-4 text-slate-400" />
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(org._count.users)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Users</p>
                    </div>
                    <div className="text-center">
                      <Award className="mx-auto h-4 w-4 text-slate-400" />
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(org._count.brands)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Brands</p>
                    </div>
                    <div className="text-center">
                      <Megaphone className="mx-auto h-4 w-4 text-slate-400" />
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(org._count.campaigns)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Campaigns</p>
                    </div>
                    <div className="text-center">
                      <MessageSquare className="mx-auto h-4 w-4 text-slate-400" />
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{formatNumber(org._count.messages)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Messages</p>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Calendar className="h-4 w-4" />
                    Created {formatDate(org.createdAt)}
                  </div>

                  <div className="mt-5 flex justify-end">
                    <Button variant="outline" onClick={() => openLinkDialog(org)} leftIcon={<Link2 className="h-4 w-4" />}>
                      Link Existing Assets
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Page {page} of {meta.totalPages}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))} disabled={page === meta.totalPages}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </main>

      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Link Existing Signalmash Assets</DialogTitle>
            <DialogDescription>
              Attach an approved provider brand, campaign, and number to {selectedOrganization?.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Brand Name</label>
              <Input value={linkForm.brandName} onChange={(e) => setLinkForm({ ...linkForm, brandName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Signalmash Brand ID</label>
              <Input value={linkForm.signalmashBrandId} onChange={(e) => setLinkForm({ ...linkForm, signalmashBrandId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">TCR Brand ID</label>
              <Input value={linkForm.tcrBrandId} onChange={(e) => setLinkForm({ ...linkForm, tcrBrandId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Campaign Name</label>
              <Input value={linkForm.campaignName} onChange={(e) => setLinkForm({ ...linkForm, campaignName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Signalmash Campaign ID</label>
              <Input value={linkForm.signalmashCampaignId} onChange={(e) => setLinkForm({ ...linkForm, signalmashCampaignId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">TCR Campaign ID</label>
              <Input value={linkForm.tcrCampaignId} onChange={(e) => setLinkForm({ ...linkForm, tcrCampaignId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Phone Number</label>
              <Input value={linkForm.phoneNumber} onChange={(e) => setLinkForm({ ...linkForm, phoneNumber: e.target.value })} placeholder="+15551234567" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Signalmash Number ID</label>
              <Input value={linkForm.signalmashNumberId} onChange={(e) => setLinkForm({ ...linkForm, signalmashNumberId: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Friendly Name</label>
              <Input value={linkForm.friendlyName} onChange={(e) => setLinkForm({ ...linkForm, friendlyName: e.target.value })} />
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={linkForm.configureWebhook}
                onChange={(e) => setLinkForm({ ...linkForm, configureWebhook: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              Configure number webhook
            </label>
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={linkForm.makeDefaultSender}
                onChange={(e) => setLinkForm({ ...linkForm, makeDefaultSender: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              Use as default sender
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleLinkExistingAssets}
              isLoading={isLinking}
              disabled={!linkForm.brandName || !linkForm.signalmashBrandId || !linkForm.campaignName || !linkForm.signalmashCampaignId || !linkForm.phoneNumber}
            >
              Link Assets
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
