import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone,
  Search,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell, PageSection } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatNumber, formatDate } from '@/lib/utils';
import { SearchNumbersDialog } from './search-dialog';
import { notify } from '@/stores/notification.store';

interface PhoneNumber {
  id: string;
  phoneNumber: string;
  formattedNumber: string;
  friendlyName: string | null;
  areaCode: string | null;
  smsCapable: boolean;
  mmsCapable: boolean;
  voiceCapable: boolean;
  status: 'active' | 'pending' | 'suspended' | 'released';
  isDefaultSender?: boolean;
  campaign: {
    id: string;
    name: string;
    status: string;
  } | null;
  _count: {
    messages: number;
  };
  createdAt: string;
}

interface Stats {
  total: number;
  active: number;
  pending: number;
  released: number;
  byAreaCode: Array<{ areaCode: string; count: number }>;
}

interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

const statusConfig = {
  active: { label: 'Active', icon: CheckCircle, variant: 'success' as const },
  pending: { label: 'Pending', icon: Clock, variant: 'warning' as const },
  suspended: { label: 'Suspended', icon: AlertTriangle, variant: 'destructive' as const },
  released: { label: 'Released', icon: XCircle, variant: 'secondary' as const },
};

export function PhoneNumbersPage() {
  const navigate = useNavigate();
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [showReleaseDialog, setShowReleaseDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<PhoneNumber | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaignOptions, setCampaignOptions] = useState<CampaignOption[]>([]);
  const [editForm, setEditForm] = useState({
    friendlyName: '',
    campaignId: '',
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        setError(null);
        const params = new URLSearchParams(window.location.search);
        const checkoutStatus = params.get('checkout');
        const sessionId = params.get('session_id');

        if (checkoutStatus === 'success' && sessionId) {
          const response = await api.completePhoneNumberCheckout({ sessionId });
          if (response.success && response.data && 'pending' in response.data && response.data.pending) {
            notify.success('Checkout completed', response.data.message);
          } else {
            notify.success('Number purchased', 'The selected phone number was added to your inventory.');
          }
          window.history.replaceState({}, '', '/phone-numbers');
        } else if (checkoutStatus === 'cancelled') {
          notify.error('Checkout cancelled', 'The phone number purchase was not completed.');
          window.history.replaceState({}, '', '/phone-numbers');
        }

        const [numbersRes, statsRes] = await Promise.all([
          api.getPhoneNumbers(),
          api.getPhoneNumberStats(),
        ]);

        if (numbersRes.success && numbersRes.data) {
          setPhoneNumbers(numbersRes.data);
        }
        if (statsRes.success && statsRes.data) {
          setStats(statsRes.data);
        }

        const campaignsRes = await api.getCampaigns({ status: 'approved' });
        if (campaignsRes.success && campaignsRes.data) {
          setCampaignOptions(campaignsRes.data);
        }
      } catch (loadError) {
        console.error('Failed to load phone numbers:', loadError);
        setError('Unable to load phone number inventory right now.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  const reloadData = async () => {
    setIsLoading(true);
    try {
      const [numbersRes, statsRes] = await Promise.all([
        api.getPhoneNumbers(),
        api.getPhoneNumberStats(),
      ]);

      if (numbersRes.success && numbersRes.data) {
        setPhoneNumbers(numbersRes.data);
      }
      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data);
      }

      const campaignsRes = await api.getCampaigns({ status: 'approved' });
      if (campaignsRes.success && campaignsRes.data) {
        setCampaignOptions(campaignsRes.data);
      }
    } catch (loadError) {
      console.error('Failed to reload phone numbers:', loadError);
      setError('Unable to refresh phone number inventory.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReleaseNumber = async () => {
    if (!selectedNumber) return;

    setIsReleasing(true);
    try {
      await api.releasePhoneNumber(selectedNumber.id);
      await reloadData();
      setShowReleaseDialog(false);
      setSelectedNumber(null);
      notify.success('Number deprovisioned', 'The phone number was released from the provider and removed from active sending inventory.');
    } catch (releaseError) {
      console.error('Failed to release number:', releaseError);
      notify.error('Deprovision failed', 'The selected phone number could not be released from the provider.');
      setError('Failed to release the selected phone number.');
    } finally {
      setIsReleasing(false);
    }
  };

  const openEditDialog = (number: PhoneNumber) => {
    setSelectedNumber(number);
    setEditForm({
      friendlyName: number.friendlyName || '',
      campaignId: number.campaign?.id || '',
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedNumber) return;

    setIsSavingEdit(true);
    try {
      const response = await api.updatePhoneNumber(selectedNumber.id, {
        friendlyName: editForm.friendlyName || undefined,
        campaignId: editForm.campaignId ? editForm.campaignId : null,
      });

      if (response.success) {
        await reloadData();
        setShowEditDialog(false);
        setSelectedNumber(null);
        notify.success('Number updated', 'Friendly name and campaign assignment were saved.');
      }
    } catch (saveError) {
      console.error('Failed to update number:', saveError);
      notify.error('Update failed', 'The phone number changes could not be saved.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleMakeDefaultSender = async (number: PhoneNumber) => {
    try {
      const response = await api.updatePhoneNumber(number.id, {
        friendlyName: number.friendlyName || undefined,
        campaignId: number.campaign?.id || null,
        makeDefault: true,
      });

      if (response.success) {
        await reloadData();
        notify.success('Default sender updated', `${number.formattedNumber} is now the default sender for outbound traffic in the embedded app.`);
      }
    } catch (saveError) {
      console.error('Failed to update default sender:', saveError);
      notify.error('Default sender update failed', 'The selected number could not be set as the outbound default.');
    }
  };

  const filteredNumbers = phoneNumbers.filter((number) => {
    const query = searchQuery.toLowerCase();
    return (
      number.phoneNumber.includes(searchQuery) ||
      number.formattedNumber.toLowerCase().includes(query) ||
      number.friendlyName?.toLowerCase().includes(query) ||
      number.campaign?.name.toLowerCase().includes(query)
    );
  });

  const hasApprovedCampaigns = campaignOptions.length > 0;
  const buyNumberLabel = hasApprovedCampaigns ? 'Buy Number' : 'Create Approved Campaign';

  return (
    <div>
      <Header
        title="Phone Numbers"
        subtitle="Manage owned numbers, assignment readiness, and current DID inventory."
        action={{
          label: buyNumberLabel,
          onClick: () => {
            if (hasApprovedCampaigns) {
              setShowSearchDialog(true);
              return;
            }
            navigate('/campaigns');
          },
        }}
      />

      <PageShell>
        <PageSection className="px-6 py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-2">
              <Badge variant="outline" className="w-fit border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                DID Inventory
              </Badge>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Professional control over owned and assignable numbers
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                Review available capacity, see campaign assignment state, and keep
                provisioning decisions visible without the old low-contrast list styling.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Total</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{stats?.total ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Active</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{stats?.active ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Pending</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{stats?.pending ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Released</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{stats?.released ?? 0}</p>
              </div>
            </div>
          </div>
        </PageSection>

        {!hasApprovedCampaigns && (
          <Card className="border-border bg-accent shadow-card">
            <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <Badge variant="warning" className="w-fit">Blocked</Badge>
                <h3 className="text-lg font-semibold text-foreground">
                  Number provisioning is blocked until a campaign is approved
                </h3>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  The embedded onboarding flow needs at least one approved campaign before a number
                  can be bought and assigned for compliant traffic. Finish campaign approval first.
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => navigate('/brands')}>
                  Review Brands
                </Button>
                <Button onClick={() => navigate('/campaigns/new')}>
                  Create Campaign
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <PageSection className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="w-full max-w-md">
              <Input
                placeholder="Search by number, friendly name, or campaign"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
                className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            {error && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        </PageSection>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <div className="flex animate-pulse items-center gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-slate-200 dark:bg-slate-800" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredNumbers.length === 0 ? (
          <Card className="border-dashed border-slate-300 bg-slate-50/80 shadow-none dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="p-10 text-center">
              <div className="mx-auto mb-4 inline-flex rounded-2xl border border-slate-200 bg-white p-4 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <Phone className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">No phone numbers found</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                {hasApprovedCampaigns
                  ? 'Purchase a number to start routing approved campaign traffic through Signalmash.'
                  : 'Once a campaign is approved, you can purchase or assign a number here.'}
              </p>
              <Button
                className="mt-6"
                onClick={() => {
                  if (hasApprovedCampaigns) {
                    setShowSearchDialog(true);
                    return;
                  }
                  navigate('/campaigns');
                }}
              >
                {buyNumberLabel}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredNumbers.map((number) => {
              const status = statusConfig[number.status];
              const StatusIcon = status.icon;

              return (
                <Card
                  key={number.id}
                  className="border-slate-200 bg-white shadow-sm transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700"
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                          <Phone className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="font-mono text-lg font-semibold text-slate-950 dark:text-slate-50">
                              {number.formattedNumber}
                            </h3>
                            <Badge variant={status.variant} className="gap-1">
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </Badge>
                            {number.isDefaultSender ? (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                                Default Sender
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            {number.friendlyName || 'No friendly name assigned'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {number.smsCapable && <Badge variant="outline">SMS</Badge>}
                        {number.mmsCapable && <Badge variant="outline">MMS</Badge>}
                        {number.voiceCapable && <Badge variant="outline">Voice</Badge>}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900 md:grid-cols-4">
                      <div className="text-sm">
                        <p className="text-slate-500 dark:text-slate-400">Campaign</p>
                        <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                          {number.campaign?.name || 'Unassigned'}
                        </p>
                      </div>
                      <div className="text-sm">
                        <p className="text-slate-500 dark:text-slate-400">Area Code</p>
                        <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                          {number.areaCode || 'N/A'}
                        </p>
                      </div>
                      <div className="text-sm">
                        <p className="text-slate-500 dark:text-slate-400">Messages</p>
                        <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                          {formatNumber(number._count.messages)}
                        </p>
                      </div>
                      <div className="text-sm">
                        <p className="text-slate-500 dark:text-slate-400">Purchased</p>
                        <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                          {formatDate(number.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 flex justify-end">
                      <div className="flex gap-2">
                        {!number.isDefaultSender && number.status === 'active' ? (
                          <Button
                            variant="outline"
                            onClick={() => handleMakeDefaultSender(number)}
                          >
                            Make Default Sender
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          onClick={() => openEditDialog(number)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          className="border-slate-300 text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                          onClick={() => {
                            setSelectedNumber(number);
                            setShowReleaseDialog(true);
                          }}
                          leftIcon={<Trash2 className="h-4 w-4" />}
                        >
                          Deprovision Number
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {stats?.byAreaCode && stats.byAreaCode.length > 0 && (
          <PageSection className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-slate-400" />
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Top Area Codes</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {stats.byAreaCode.slice(0, 8).map((entry) => (
                <div key={entry.areaCode} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Area Code</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">{entry.areaCode}</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{entry.count} owned</p>
                </div>
              ))}
            </div>
          </PageSection>
        )}
      </PageShell>

      <SearchNumbersDialog
        open={showSearchDialog}
        onClose={() => setShowSearchDialog(false)}
        onPurchased={reloadData}
      />

      <Dialog open={showReleaseDialog} onOpenChange={setShowReleaseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deprovision Phone Number</DialogTitle>
            <DialogDescription>
              This releases {selectedNumber?.formattedNumber} at the provider level and marks it inactive in Signalmash Connect. It will no longer be available for outbound sending.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReleaseDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReleaseNumber} isLoading={isReleasing}>
              Deprovision Number
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Phone Number</DialogTitle>
            <DialogDescription>
              Update the friendly name, assign this number to an approved campaign, or make it the embedded app's default outbound sender from the list view.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Friendly Name</label>
              <Input
                value={editForm.friendlyName}
                onChange={(e) => setEditForm({ ...editForm, friendlyName: e.target.value })}
                placeholder="Customer Success Line"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Approved Campaign</label>
              <select
                value={editForm.campaignId}
                onChange={(e) => setEditForm({ ...editForm, campaignId: e.target.value })}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                <option value="">Unassigned</option>
                {campaignOptions.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} isLoading={isSavingEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
