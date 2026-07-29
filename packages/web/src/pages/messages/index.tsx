import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
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
import { api, ApiError } from '@/lib/api';
import { sanitizePlatformBranding } from '@/lib/platform-branding';
import { formatPhoneNumber, formatDateTime, normalizePhoneNumber } from '@/lib/utils';
import {
  formatProvisioningCountdown,
  formatProvisioningWait,
  getPhoneNumberProvisioningLock,
  getRemainingProvisioningMs,
  useProvisioningLocks,
} from '@/lib/phone-number-provisioning';
import { notify } from '@/stores/notification.store';

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  type: 'sms' | 'mms';
  from: string;
  to: string;
  body: string;
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'received';
  errorMessage: string | null;
  signalmashMessageId: string | null;
  platformConnectionId: string | null;
  campaignId: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
}

interface SenderNumber {
  id: string;
  phoneNumber: string;
  formattedNumber: string;
  friendlyName: string | null;
  status: 'active' | 'pending' | 'suspended' | 'released';
  isDefaultSender?: boolean;
  campaign: {
    id: string;
    name: string;
    status: string;
  } | null;
}

interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

const statusConfig = {
  queued: { label: 'Queued', icon: Clock, variant: 'secondary' as const },
  sending: { label: 'Sending', icon: Send, variant: 'warning' as const },
  sent: { label: 'Sent', icon: Send, variant: 'warning' as const },
  delivered: { label: 'Delivered', icon: CheckCircle, variant: 'success' as const },
  failed: { label: 'Failed', icon: XCircle, variant: 'destructive' as const },
  undelivered: { label: 'Undelivered', icon: XCircle, variant: 'destructive' as const },
  received: { label: 'Received', icon: ArrowDownLeft, variant: 'default' as const },
};

const getSendErrorMessage = (error: unknown) => {
  if (!(error instanceof ApiError)) {
    return 'The SMS could not be sent.';
  }

  const validationErrors = error.details?.errors;
  if (validationErrors && typeof validationErrors === 'object') {
    const firstError = Object.entries(validationErrors as Record<string, unknown>)
      .flatMap(([field, messages]) => {
        if (!Array.isArray(messages)) return [];
        return messages
          .filter((message): message is string => typeof message === 'string')
          .map((message) => sanitizePlatformBranding(`${field}: ${message}`));
      })[0];

    if (firstError) return firstError;
  }

  return sanitizePlatformBranding(error.message || 'The SMS could not be sent.');
};

export function MessagesPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [senderNumbers, setSenderNumbers] = useState<SenderNumber[]>([]);
  const [campaignOptions, setCampaignOptions] = useState<CampaignOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showComposeDialog, setShowComposeDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [directionFilter, setDirectionFilter] = useState('all');
  const provisioningLocks = useProvisioningLocks();
  const [composeForm, setComposeForm] = useState({
    phoneNumberId: '',
    from: '',
    to: '',
    campaignId: '',
    body: '',
  });

  const loadMessages = async () => {
    try {
      const response = await api.getMessages();
      if (response.success && response.data) {
        setMessages(response.data);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      notify.error('Loading failed', 'The message log could not be loaded.');
    }
  };

  const loadComposerOptions = async () => {
    try {
      const [numbersResponse, campaignsResponse] = await Promise.all([
        api.getPhoneNumbers({ status: 'active', limit: 100 }),
        api.getCampaigns({ status: 'approved' }),
      ]);

      if (numbersResponse.success && numbersResponse.data) {
        setSenderNumbers(numbersResponse.data);
      }

      if (campaignsResponse.success && campaignsResponse.data) {
        setCampaignOptions(campaignsResponse.data);
      }
    } catch (error) {
      console.error('Failed to load message composer options:', error);
      notify.error('Composer unavailable', 'Sender numbers or approved campaigns could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([loadMessages(), loadComposerOptions()]);
    };

    loadData();
  }, []);

  const senderProvisioningState = useMemo(() => {
    return new Map(
      senderNumbers.map((number) => {
        const lock = getPhoneNumberProvisioningLock({
          phoneNumberId: number.id,
          phoneNumber: number.phoneNumber,
        }, provisioningLocks);
        const remainingMs = lock ? getRemainingProvisioningMs(lock) : 0;

        return [number.id, { lock, remainingMs }];
      })
    );
  }, [provisioningLocks, senderNumbers]);

  const unlockedSenderNumbers = senderNumbers.filter(
    (number) => (senderProvisioningState.get(number.id)?.remainingMs ?? 0) <= 0
  );
  const lockedSenderRemainingMs = senderNumbers
    .map((number) => senderProvisioningState.get(number.id)?.remainingMs ?? 0)
    .filter((remainingMs) => remainingMs > 0);
  const soonestLockedSenderRemainingMs = lockedSenderRemainingMs.length > 0
    ? Math.min(...lockedSenderRemainingMs)
    : 0;
  const selectedSenderProvisioning = senderProvisioningState.get(composeForm.phoneNumberId);
  const selectedSenderLocked = (selectedSenderProvisioning?.remainingMs ?? 0) > 0;
  const hasActiveSenders = senderNumbers.length > 0;
  const hasUnlockedSenders = unlockedSenderNumbers.length > 0;
  const everySenderLocked = hasActiveSenders && !hasUnlockedSenders;
  const hasApprovedCampaigns = campaignOptions.length > 0;
  const hasCampaignAssignedSender = unlockedSenderNumbers.some((number) => number.campaign?.status === 'approved');
  const canRunSmsSend = hasUnlockedSenders && (hasApprovedCampaigns || hasCampaignAssignedSender);
  const sendSmsDisabledReason = everySenderLocked
    ? `Available in ${formatProvisioningWait(soonestLockedSenderRemainingMs)} while newly purchased numbers finish provisioning.`
    : !hasActiveSenders
      ? 'There are no active sender numbers yet.'
      : 'There is no approved campaign available for SMS yet.';

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadMessages();
    setIsRefreshing(false);
  };

  const openComposeDialog = () => {
    if (!canRunSmsSend) {
      notify.error(
        'Send SMS unavailable',
        sendSmsDisabledReason ?? 'Complete sender and campaign setup before sending SMS.'
      );
      return;
    }

    const defaultNumber = unlockedSenderNumbers[0];

    setComposeForm({
      phoneNumberId: defaultNumber?.id || '',
      from: defaultNumber?.phoneNumber || '',
      to: '',
      campaignId: defaultNumber?.campaign?.status === 'approved' ? defaultNumber.campaign.id : '',
      body: '',
    });
    setShowComposeDialog(true);
  };

  const handleSendMessage = async () => {
    const selectedSender = senderNumbers.find((number) => number.id === composeForm.phoneNumberId);
    const senderState = selectedSender ? senderProvisioningState.get(selectedSender.id) : null;
    if ((senderState?.remainingMs ?? 0) > 0) {
      notify.error(
        'Number provisioning',
        `Please wait ${formatProvisioningWait(senderState?.remainingMs ?? 0)} before sending SMS from this number.`
      );
      return;
    }

    setIsSending(true);

    try {
      const response = await api.sendMessage({
        phoneNumberId: composeForm.phoneNumberId || undefined,
        from: normalizePhoneNumber(composeForm.from),
        to: normalizePhoneNumber(composeForm.to),
        body: composeForm.body,
        campaignId: composeForm.campaignId || undefined,
      });

      if (response.success && response.data) {
        setMessages((current) => [response.data, ...current]);
        setShowComposeDialog(false);
        notify.success('Message queued', 'The outbound message was accepted and added to the log.');
        await loadMessages();
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      notify.error('Send failed', getSendErrorMessage(error));
    } finally {
      setIsSending(false);
    }
  };

  const filteredMessages = messages.filter((message) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      message.body.toLowerCase().includes(query) ||
      message.from.includes(searchQuery) ||
      message.to.includes(searchQuery) ||
      (message.signalmashMessageId || '').toLowerCase().includes(query);

    const matchesStatus = statusFilter === 'all' || message.status === statusFilter;
    const matchesDirection = directionFilter === 'all' || message.direction === directionFilter;

    return matchesSearch && matchesStatus && matchesDirection;
  });

  const summary = {
    total: messages.length,
    delivered: messages.filter((message) => message.status === 'delivered').length,
    failed: messages.filter((message) => message.status === 'failed' || message.status === 'undelivered').length,
    inbound: messages.filter((message) => message.direction === 'inbound').length,
  };

  return (
    <div>
      <Header
        title="Messages"
        subtitle="Track message flow, delivery state, and webhook-driven status updates."
        action={{
          label: 'Send SMS',
          onClick: openComposeDialog,
          disabled: !canRunSmsSend,
          disabledReason: sendSmsDisabledReason,
          disabledText: everySenderLocked
            ? formatProvisioningCountdown(soonestLockedSenderRemainingMs)
            : undefined,
        }}
      />

      <PageShell>
        <PageSection className="px-6 py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-2">
              <Badge variant="outline" className="w-fit border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                Message Log
              </Badge>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Delivery visibility without invented metadata
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                This screen now reflects the raw backend message records: direction, status,
                message identifiers, and send or delivery timestamps.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Total</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.total}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Delivered</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.delivered}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Failed</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.failed}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Inbound</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{summary.inbound}</p>
              </div>
            </div>
          </div>
        </PageSection>

        {!canRunSmsSend && (
          <Card className="border-border bg-accent shadow-card">
            <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <Badge variant="warning" className="w-fit">Send SMS Blocked</Badge>
                <h3 className="text-lg font-semibold text-foreground">
                  {everySenderLocked
                    ? 'New sender numbers are still provisioning'
                    : 'Complete sender and campaign setup before sending SMS'}
                </h3>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  {everySenderLocked
                    ? `Send SMS will be available in ${formatProvisioningWait(soonestLockedSenderRemainingMs)}.`
                    : !hasActiveSenders
                    ? 'There are no active sender numbers yet. Finish number purchase or assignment first.'
                    : 'There is no approved campaign available for SMS yet. Finish campaign approval or assign a number to an approved campaign first.'}
                </p>
              </div>
              <div className="flex gap-3">
                {!hasApprovedCampaigns && (
                  <Button variant="outline" onClick={() => navigate('/campaigns')}>
                    Review Campaigns
                  </Button>
                )}
                <Button onClick={() => navigate(hasActiveSenders ? '/campaigns' : '/phone-numbers')}>
                  {hasActiveSenders ? 'Fix Campaign Setup' : 'Manage Numbers'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <PageSection className="p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="w-full max-w-md">
              <Input
                placeholder="Search by body, phone number, or message ID"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
                className="border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={openComposeDialog}
                leftIcon={<Send className="h-4 w-4" />}
                disabled={!canRunSmsSend}
              >
                Send SMS
              </Button>

              <select
                value={directionFilter}
                onChange={(e) => setDirectionFilter(e.target.value)}
                className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                <option value="all">All Directions</option>
                <option value="outbound">Outbound</option>
                <option value="inbound">Inbound</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                <option value="all">All Statuses</option>
                <option value="queued">Queued</option>
                <option value="sending">Sending</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="failed">Failed</option>
                <option value="undelivered">Undelivered</option>
                <option value="received">Received</option>
              </select>

              <Button variant="outline" size="icon" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </PageSection>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-4">
                  <div className="flex animate-pulse items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-slate-200 dark:bg-slate-800" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-3 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredMessages.length === 0 ? (
          <Card className="border-dashed border-slate-300 bg-slate-50/80 shadow-none dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="p-10 text-center">
              <div className="mx-auto mb-4 inline-flex rounded-2xl border border-slate-200 bg-white p-4 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <MessageSquare className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">No messages found</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                {searchQuery || statusFilter !== 'all' || directionFilter !== 'all'
                  ? 'Adjust your filters to review a broader set of messages.'
                  : canRunSmsSend
                    ? 'Messages will appear here once your organization starts sending or receiving traffic.'
                    : 'Finish sender and campaign readiness first, then use Send SMS to generate initial traffic.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredMessages.map((message) => {
              const status = statusConfig[message.status];
              const StatusIcon = status.icon;
              const isOutbound = message.direction === 'outbound';

              return (
                <Card key={message.id} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <CardContent className="p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-4">
                        <div className={`rounded-2xl p-3 ${isOutbound ? 'bg-sky-100 dark:bg-sky-500/15' : 'bg-emerald-100 dark:bg-emerald-500/15'}`}>
                          {isOutbound ? (
                            <ArrowUpRight className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                          ) : (
                            <ArrowDownLeft className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                          )}
                        </div>
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-950 dark:text-slate-50">
                              {isOutbound ? 'To' : 'From'} {formatPhoneNumber(isOutbound ? message.to : message.from)}
                            </span>
                            <Badge variant="outline">{message.type.toUpperCase()}</Badge>
                            <Badge variant={status.variant} className="gap-1">
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </Badge>
                          </div>
                          <p className="max-w-3xl text-sm leading-6 text-slate-700 dark:text-slate-300">
                            {message.body}
                          </p>
                          {message.errorMessage && (message.status === 'failed' || message.status === 'undelivered') && (
                            <p className="text-sm text-destructive">
                              Error: {sanitizePlatformBranding(message.errorMessage)}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-2 text-sm text-slate-600 dark:text-slate-400 lg:min-w-[280px]">
                        <div className="flex justify-between gap-3">
                          <span>Created</span>
                          <span className="font-medium text-slate-950 dark:text-slate-50">{formatDateTime(message.createdAt)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Sent</span>
                          <span className="font-medium text-slate-950 dark:text-slate-50">
                            {message.sentAt ? formatDateTime(message.sentAt) : 'Not sent'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Delivered</span>
                          <span className="font-medium text-slate-950 dark:text-slate-50">
                            {message.deliveredAt ? formatDateTime(message.deliveredAt) : 'Not delivered'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Campaign ID</span>
                          <span className="max-w-[150px] truncate font-medium text-slate-950 dark:text-slate-50">
                            {message.campaignId || 'None'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Message ID</span>
                          <span className="max-w-[150px] truncate font-medium text-slate-950 dark:text-slate-50">
                            {message.signalmashMessageId || message.id}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageShell>

      <Dialog open={showComposeDialog} onOpenChange={setShowComposeDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send SMS</DialogTitle>
            <DialogDescription>
              Send an outbound SMS using an active owned number and, if needed, an approved campaign.
            </DialogDescription>
          </DialogHeader>

          {senderNumbers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              No active phone numbers are available yet. Purchase and activate a number before sending SMS.
            </div>
          ) : (
            <div className="grid gap-5">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">From Number</label>
                  <select
                    value={composeForm.phoneNumberId}
                    onChange={(e) => {
                      const nextPhoneNumberId = e.target.value;
                      const selectedNumber = senderNumbers.find((number) => number.id === nextPhoneNumberId);

                      setComposeForm((current) => ({
                        ...current,
                        phoneNumberId: nextPhoneNumberId,
                        from: selectedNumber?.phoneNumber || '',
                        campaignId: selectedNumber?.campaign?.status === 'approved'
                          ? selectedNumber.campaign.id
                          : '',
                      }));
                    }}
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  >
                    {senderNumbers.map((number) => {
                      const provisioningState = senderProvisioningState.get(number.id);
                      const remainingMs = provisioningState?.remainingMs ?? 0;
                      const isLocked = remainingMs > 0;

                      return (
                        <option key={number.id} value={number.id} disabled={isLocked}>
                          {number.isDefaultSender ? '[Default] ' : ''}
                          {number.friendlyName ? `${number.friendlyName} - ` : ''}{number.formattedNumber}
                          {isLocked ? ` - provisioning ${formatProvisioningCountdown(remainingMs)}` : ''}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                    The default sender for outbound traffic in the embedded app is managed from the Phone Numbers screen.
                  </p>
                  {selectedSenderLocked ? (
                    <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                      This number is still provisioning. Try again in {formatProvisioningWait(selectedSenderProvisioning?.remainingMs ?? 0)}.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">To Number</label>
                  <Input
                    value={composeForm.to}
                    onChange={(e) => setComposeForm((current) => ({ ...current, to: e.target.value }))}
                    onBlur={() => setComposeForm((current) => ({ ...current, to: normalizePhoneNumber(current.to) }))}
                    placeholder="+15551234567"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Campaign</label>
                <select
                  value={composeForm.campaignId}
                  onChange={(e) => setComposeForm((current) => ({ ...current, campaignId: e.target.value }))}
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                >
                  <option value="">No campaign</option>
                  {campaignOptions.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Only approved campaigns are offered here because the backend rejects non-approved campaign traffic.
                </p>
              </div>

              {!hasApprovedCampaigns && (
                <div className="rounded-2xl border border-border bg-accent px-4 py-4 text-sm text-foreground">
                  No approved campaigns are available yet. Return to the campaign flow, complete approval, and then retry Send SMS.
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Message Body</label>
                <textarea
                  value={composeForm.body}
                  onChange={(e) => setComposeForm((current) => ({ ...current, body: e.target.value }))}
                  className="min-h-[140px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  placeholder="Write the outbound SMS content."
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowComposeDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendMessage}
              isLoading={isSending}
              disabled={!canRunSmsSend || selectedSenderLocked || !composeForm.from || !composeForm.to || !composeForm.body.trim()}
            >
              Send SMS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
