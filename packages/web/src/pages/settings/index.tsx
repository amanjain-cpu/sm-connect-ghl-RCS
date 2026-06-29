import { useEffect, useState } from 'react';
import {
  User,
  Building2,
  Shield,
  Bell,
  CreditCard,
  Users,
  Mail,
  Phone,
  Globe,
  Calendar,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/auth.store';
import { api } from '@/lib/api';
import { sanitizePlatformBranding } from '@/lib/platform-branding';
import { formatDateTime } from '@/lib/utils';
import { notify } from '@/stores/notification.store';

interface OrganizationUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarUrl?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
}

interface OrganizationDetails {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  users: OrganizationUser[];
  _count: {
    brands: number;
    campaigns: number;
    platformConnections: number;
    phoneNumbers: number;
    messages: number;
  };
}

interface BillingSummary {
  cycleMonth: string;
  smsOutbound: number;
  smsInbound: number;
  mmsOutbound: number;
  mmsInbound: number;
  pending: number;
  posted: number;
  failed: number;
  ignored: number;
  totalBillableEvents: number;
}

interface BillingEvent {
  id: string;
  billingKey: string;
  direction: 'inbound' | 'outbound';
  unit: 'sms' | 'mms' | 'phone_number';
  quantity: number;
  status: 'pending' | 'posted' | 'failed' | 'ignored';
  source: string;
  cycleMonth: string;
  metadata?: {
    statusReason?: string | null;
    statusUpdatedAt?: string | null;
  } | null;
  createdAt: string;
  message?: {
    id: string;
    from: string;
    to: string;
    status: string;
    createdAt: string;
  } | null;
}

interface DeadLetterJob {
  id: string;
  queueName: string;
  jobName: string;
  error: string;
  status: 'pending' | 'replayed' | 'ignored';
  createdAt: string;
  replayedAt?: string | null;
}

interface PortOrder {
  id: string;
  losingCarrier?: string | null;
  status: 'draft' | 'submitted' | 'awaiting_documents' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';
  requestedFocAt?: string | null;
  completedAt?: string | null;
  rejectionReason?: string | null;
  phoneNumber?: {
    id: string;
    phoneNumber: string;
    formattedNumber: string;
    status: string;
  } | null;
}

const navItems = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'billing', label: 'Billing', icon: CreditCard },
] as const;

export function SettingsPage() {
  const { user, organization } = useAuthStore();
  const [activeTab, setActiveTab] = useState<(typeof navItems)[number]['id']>('account');
  const [organizationDetails, setOrganizationDetails] = useState<OrganizationDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingOrganization, setIsSavingOrganization] = useState(false);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [billingEvents, setBillingEvents] = useState<BillingEvent[]>([]);
  const [deadLetters, setDeadLetters] = useState<DeadLetterJob[]>([]);
  const [portOrders, setPortOrders] = useState<PortOrder[]>([]);
  const [isReplayingDeadLetter, setIsReplayingDeadLetter] = useState<string | null>(null);
  const [isProcessingBilling, setIsProcessingBilling] = useState(false);
  const [isUpdatingBillingEvent, setIsUpdatingBillingEvent] = useState<string | null>(null);
  const [organizationForm, setOrganizationForm] = useState({
    name: '',
    email: '',
    phone: '',
    website: '',
  });

  useEffect(() => {
    const loadOrganization = async () => {
      try {
        const [organizationResponse, billingResponse, billingEventsResponse, deadLetterResponse, portOrdersResponse] = await Promise.all([
          api.getOrganization(),
          api.getBillingSummary(),
          api.getBillingEvents(),
          api.getDeadLetters(),
          api.getPortOrders(),
        ]);
        if (organizationResponse.success && organizationResponse.data) {
          setOrganizationDetails(organizationResponse.data);
          setOrganizationForm({
            name: organizationResponse.data.name || '',
            email: organizationResponse.data.email || '',
            phone: organizationResponse.data.phone || '',
            website: organizationResponse.data.website || '',
          });
        }
        if (billingResponse.success && billingResponse.data) setBillingSummary(billingResponse.data);
        if (billingEventsResponse.success && billingEventsResponse.data) setBillingEvents(billingEventsResponse.data);
        if (deadLetterResponse.success && deadLetterResponse.data) setDeadLetters(deadLetterResponse.data);
        if (portOrdersResponse.success && portOrdersResponse.data) setPortOrders(portOrdersResponse.data);
      } catch (error) {
        console.error('Failed to load organization settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadOrganization();
  }, []);

  const handleOrganizationSave = async () => {
    setIsSavingOrganization(true);
    try {
      const response = await api.updateOrganization({
        name: organizationForm.name,
        email: organizationForm.email,
        phone: organizationForm.phone || undefined,
        website: organizationForm.website || undefined,
      });

      if (response.success && response.data) {
        setOrganizationDetails((current) => current ? { ...current, ...response.data } : response.data);
        notify.success('Organization updated', 'Organization settings were saved successfully.');
      }
    } catch (error) {
      console.error('Failed to update organization:', error);
      notify.error('Update failed', 'Organization settings could not be saved.');
    } finally {
      setIsSavingOrganization(false);
    }
  };

  const handleReplayDeadLetter = async (id: string) => {
    setIsReplayingDeadLetter(id);
    try {
      const response = await api.replayDeadLetter(id);
      if (response.success) {
        setDeadLetters((current) =>
          current.map((job) => job.id === id
            ? { ...job, status: 'replayed', replayedAt: new Date().toISOString() }
            : job)
        );
        notify.success('Replay queued', 'The dead-letter job was sent back to the queue.');
      }
    } catch (error) {
      console.error('Failed to replay dead letter:', error);
      notify.error('Replay failed', 'The dead-letter job could not be replayed.');
    } finally {
      setIsReplayingDeadLetter(null);
    }
  };

  const handleProcessBilling = async () => {
    setIsProcessingBilling(true);
    try {
      const response = await api.processBillingEvents();
      if (response.success) {
        const [billingResponse, billingEventsResponse] = await Promise.all([
          api.getBillingSummary(),
          api.getBillingEvents(),
        ]);
        if (billingResponse.success && billingResponse.data) setBillingSummary(billingResponse.data);
        if (billingEventsResponse.success && billingEventsResponse.data) setBillingEvents(billingEventsResponse.data);
        notify.success('Billing processed', 'Pending billing events were processed using the local meter rules.');
      }
    } catch (error) {
      console.error('Failed to process billing events:', error);
      notify.error('Billing process failed', 'Pending billing events could not be processed.');
    } finally {
      setIsProcessingBilling(false);
    }
  };

  const handleIgnoreBillingEvent = async (id: string) => {
    setIsUpdatingBillingEvent(id);
    try {
      const response = await api.updateBillingEventStatus(id, {
        status: 'ignored',
        reason: 'Ignored manually from operator settings',
      });
      if (response.success && response.data) {
        setBillingEvents((current) =>
          current.map((event) => (event.id === id ? response.data : event))
        );
        notify.success('Billing event updated', 'The billing event was marked as ignored.');
      }
    } catch (error) {
      console.error('Failed to update billing event:', error);
      notify.error('Billing update failed', 'The billing event could not be updated.');
    } finally {
      setIsUpdatingBillingEvent(null);
    }
  };

  return (
    <div>
      <Header
        title="Settings"
        subtitle="Review account, organization, and operational configuration using supported backend data."
      />

      <PageShell>
        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside>
            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-3">
                <nav className="space-y-1">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-50'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-6">
            {activeTab === 'account' && (
              <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Account Overview</h3>
                  <div className="mt-6 grid gap-5 md:grid-cols-2">
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Name</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                        {user?.firstName} {user?.lastName}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Email</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{user?.email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Role</p>
                      <p className="mt-1 font-medium capitalize text-slate-950 dark:text-slate-50">{user?.role}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Organization</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{organization?.name}</p>
                    </div>
                  </div>
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    Profile editing and password-change endpoints are not currently exposed by the backend.
                    This screen now reflects supported data instead of presenting broken controls.
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'organization' && (
              <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Organization Details</h3>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        Update the organization fields supported by the backend route.
                      </p>
                    </div>
                    <Button onClick={handleOrganizationSave} isLoading={isSavingOrganization}>
                      Save Changes
                    </Button>
                  </div>
                  {isLoading ? (
                    <div className="mt-6 h-48 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
                  ) : organizationDetails ? (
                    <>
                      <div className="mt-6 grid gap-5 md:grid-cols-2">
                        <div className="flex items-start gap-3">
                          <Building2 className="mt-0.5 h-4 w-4 text-slate-400" />
                          <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Name</p>
                            <Input
                              value={organizationForm.name}
                              onChange={(e) => setOrganizationForm({ ...organizationForm, name: e.target.value })}
                              className="mt-2 border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                            />
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <Mail className="mt-0.5 h-4 w-4 text-slate-400" />
                          <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Email</p>
                            <Input
                              value={organizationForm.email}
                              onChange={(e) => setOrganizationForm({ ...organizationForm, email: e.target.value })}
                              className="mt-2 border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                            />
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <Phone className="mt-0.5 h-4 w-4 text-slate-400" />
                          <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Phone</p>
                            <Input
                              value={organizationForm.phone}
                              onChange={(e) => setOrganizationForm({ ...organizationForm, phone: e.target.value })}
                              placeholder="Not provided"
                              className="mt-2 border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                            />
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <Globe className="mt-0.5 h-4 w-4 text-slate-400" />
                          <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Website</p>
                            <Input
                              value={organizationForm.website}
                              onChange={(e) => setOrganizationForm({ ...organizationForm, website: e.target.value })}
                              placeholder="Not provided"
                              className="mt-2 border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                            />
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                          <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Created</p>
                            <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{formatDateTime(organizationDetails.createdAt)}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                          <div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Updated</p>
                            <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{formatDateTime(organizationDetails.updatedAt)}</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        {[
                          ['Brands', organizationDetails._count.brands],
                          ['Campaigns', organizationDetails._count.campaigns],
                          ['Platforms', organizationDetails._count.platformConnections],
                          ['Numbers', organizationDetails._count.phoneNumbers],
                          ['Messages', organizationDetails._count.messages],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
                            <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">Organization details are unavailable.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === 'team' && (
              <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Team Members</h3>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        Current organization users returned by the backend.
                      </p>
                    </div>
                    <Badge variant="outline">{organizationDetails?.users.length ?? 0} users</Badge>
                  </div>

                  <div className="mt-6 space-y-3">
                    {organizationDetails?.users.map((member) => (
                      <div key={member.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                        <div>
                          <p className="font-medium text-slate-950 dark:text-slate-50">
                            {member.firstName} {member.lastName}
                          </p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{member.email}</p>
                        </div>
                        <div className="text-right">
                          <Badge variant="secondary" className="capitalize">{member.role}</Badge>
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {member.lastLoginAt ? `Last login ${formatDateTime(member.lastLoginAt)}` : 'No login recorded'}
                          </p>
                        </div>
                      </div>
                    ))}
                    {!organizationDetails?.users.length && (
                      <p className="text-sm text-slate-600 dark:text-slate-400">No team members available.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'security' && (
              <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Security</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    This section is intentionally read-only for now because the current backend
                    does not expose stable endpoints for these controls. The UI no longer pretends
                    these actions are available when they are not.
                  </p>
                  <div className="mt-6 max-w-md">
                    <Input value="Backend support required before this section becomes editable" disabled />
                  </div>
                  <Button className="mt-4" variant="outline" disabled>
                    Not available yet
                  </Button>
                </CardContent>
              </Card>
            )}

            {activeTab === 'notifications' && (
              <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Notifications</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    This section now reflects live operational items instead of a dead placeholder control set.
                  </p>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      ['Pending dead letters', deadLetters.filter((job) => job.status === 'pending').length],
                      ['Pending billing posts', billingSummary?.pending ?? 0],
                      ['Port orders in progress', portOrders.filter((order) => ['submitted', 'awaiting_documents', 'in_progress'].includes(order.status)).length],
                      ['Recent billing events', billingEvents.length],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    Use the notification bell in the top bar for quick operational alerts. Use Help &amp; Support for troubleshooting guidance tied to this organization.
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'billing' && (
              <div className="space-y-6">
                <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Billing Summary</h3>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                          Usage is tracked locally by cycle while platform billing integration is being completed.
                        </p>
                      </div>
                      <Button onClick={handleProcessBilling} isLoading={isProcessingBilling}>
                        Process Pending
                      </Button>
                    </div>
                    {billingSummary ? (
                      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        {[
                          ['SMS Outbound', billingSummary.smsOutbound],
                          ['SMS Inbound', billingSummary.smsInbound],
                          ['MMS Outbound', billingSummary.mmsOutbound],
                          ['MMS Inbound', billingSummary.mmsInbound],
                          ['Pending Posts', billingSummary.pending],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
                            <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">Billing summary unavailable.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Billing Events</h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      Review local meter events and apply operator overrides when a pending event should not be billed.
                    </p>
                    <div className="mt-6 space-y-3">
                      {billingEvents.map((event) => (
                        <div key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-slate-950 dark:text-slate-50">
                                  {event.direction} {event.unit.toUpperCase()} x{event.quantity}
                                </p>
                                <Badge variant={event.status === 'posted' ? 'success' : event.status === 'pending' ? 'warning' : event.status === 'failed' ? 'destructive' : 'secondary'}>
                                  {event.status}
                                </Badge>
                              </div>
                              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                                {event.source} • {event.billingKey}
                              </p>
                              {event.message && (
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                  Message {event.message.status} • {event.message.from} {'->'} {event.message.to}
                                </p>
                              )}
                              {event.metadata?.statusReason && (
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                  Reason: {sanitizePlatformBranding(event.metadata.statusReason)}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleIgnoreBillingEvent(event.id)}
                                isLoading={isUpdatingBillingEvent === event.id}
                                disabled={event.status !== 'pending'}
                              >
                                Ignore
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {billingEvents.length === 0 && (
                        <p className="text-sm text-slate-600 dark:text-slate-400">No billing events recorded.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Dead Letters</h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      Failed queue jobs are persisted here so they can be replayed safely.
                    </p>
                    <div className="mt-6 space-y-3">
                      {deadLetters.map((job) => (
                        <div key={job.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="font-medium text-slate-950 dark:text-slate-50">
                                {sanitizePlatformBranding(job.jobName)}
                              </p>
                              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{job.queueName}</p>
                              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                {sanitizePlatformBranding(job.error)}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge variant={job.status === 'pending' ? 'warning' : 'secondary'}>{job.status}</Badge>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleReplayDeadLetter(job.id)}
                                isLoading={isReplayingDeadLetter === job.id}
                                disabled={job.status !== 'pending'}
                              >
                                Replay
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {deadLetters.length === 0 && (
                        <p className="text-sm text-slate-600 dark:text-slate-400">No dead-letter jobs recorded.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Port Orders</h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      Porting is still operationally managed, but orders are now tracked in-app.
                    </p>
                    <div className="mt-6 space-y-3">
                      {portOrders.map((order) => (
                        <div key={order.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="font-medium text-slate-950 dark:text-slate-50">
                                {order.phoneNumber?.formattedNumber || 'Unassigned number'}
                              </p>
                              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                                {order.losingCarrier || 'Carrier not set'}
                              </p>
                              {order.requestedFocAt && (
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                  Requested FOC {formatDateTime(order.requestedFocAt)}
                                </p>
                              )}
                            </div>
                            <Badge variant="secondary">{order.status}</Badge>
                          </div>
                        </div>
                      ))}
                      {portOrders.length === 0 && (
                        <p className="text-sm text-slate-600 dark:text-slate-400">No port orders tracked yet.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </PageShell>
    </div>
  );
}
