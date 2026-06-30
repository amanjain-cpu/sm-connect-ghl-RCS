import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Megaphone,
  ArrowLeft,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  FileText,
  Calendar,
  BarChart3,
  MessageSquare,
  Phone,
  Send,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell, PageSection } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/utils';
import { notify } from '@/stores/notification.store';

interface PhoneNumber {
  id: string;
  phoneNumber: string;
  formattedNumber: string;
  status: string;
}

interface Campaign {
  id: string;
  brandId: string;
  name: string;
  description: string;
  useCase: string;
  subUsecases: string[];
  embeddedLink: boolean;
  embeddedPhone: boolean;
  affiliateMarketing: boolean;
  termsAndConditions: boolean;
  numberPool: boolean;
  ageGated: boolean;
  directLending: boolean;
  subscriberOptin: boolean;
  subscriberOptout: boolean;
  subscriberHelp: boolean;
  sampleMessages: string[];
  messageFlow: string;
  mnoIds: string[];
  referenceId: string | null;
  tags: string[];
  autoRenewal: boolean;
  optInKeywords: string[];
  optOutKeywords: string[];
  helpKeywords: string[];
  optInMessage: string;
  optOutMessage: string;
  helpMessage: string;
  privacyPolicyLink: string | null;
  termsAndConditionsLink: string | null;
  embeddedLinkSample: string | null;
  signalmashCampaignId: string | null;
  tcrCampaignId: string | null;
  providerStatus: string | null;
  providerMessage: string | null;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'suspended' | 'expired';
  rejectionReason: string | null;
  dailyMessageLimit: number | null;
  messagesPerSecond: number | null;
  submitAttempts: number;
  lastSubmittedAt: string | null;
  lastSubmissionError: string | null;
  lastStatusSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  phoneNumbers: PhoneNumber[];
}

interface BrandSummary {
  id: string;
  legalName: string;
  displayName: string;
}

const statusConfig = {
  draft: { label: 'Draft', icon: FileText, variant: 'secondary' as const },
  pending_approval: { label: 'Pending Approval', icon: Clock, variant: 'warning' as const },
  approved: { label: 'Approved', icon: CheckCircle, variant: 'success' as const },
  rejected: { label: 'Rejected', icon: XCircle, variant: 'destructive' as const },
  suspended: { label: 'Suspended', icon: AlertCircle, variant: 'destructive' as const },
  expired: { label: 'Expired', icon: AlertCircle, variant: 'destructive' as const },
};

const useCaseOptions = [
  'two_factor_auth',
  'account_notifications',
  'customer_care',
  'delivery_notifications',
  'fraud_alerts',
  'higher_education',
  'low_volume',
  'marketing',
  'mixed',
  'polling_voting',
  'public_service_announcement',
  'security_alerts',
] as const;

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [brand, setBrand] = useState<BrandSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    useCase: 'marketing',
    subUsecases: '',
    messageFlow: '',
    referenceId: '',
    tags: '',
    privacyPolicyLink: '',
    termsAndConditionsLink: '',
    embeddedLinkSample: '',
    embeddedLink: false,
    embeddedPhone: false,
    affiliateMarketing: false,
    termsAndConditions: true,
    numberPool: false,
    ageGated: false,
    directLending: false,
    subscriberOptin: true,
    subscriberOptout: true,
    subscriberHelp: true,
    autoRenewal: true,
    sampleMessagesText: '',
    optInKeywords: '',
    optOutKeywords: '',
    helpKeywords: '',
    optInMessage: '',
    optOutMessage: '',
    helpMessage: '',
  });

  const loadCampaign = async () => {
    if (!id) return;

    try {
      const response = await api.getCampaign(id);
      if (response.success && response.data) {
        setCampaign(response.data);

        if (response.data.brandId) {
          try {
            const brandResponse = await api.getBrand(response.data.brandId);
            if (brandResponse.success && brandResponse.data) {
              setBrand({
                id: brandResponse.data.id,
                legalName: brandResponse.data.legalName,
                displayName: brandResponse.data.displayName,
              });
            }
          } catch (error) {
            console.error('Failed to load related brand:', error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load campaign:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCampaign();
  }, [id]);

  const handleSubmitForApproval = async () => {
    if (!campaign) return;

    setIsSubmitting(true);
    try {
      const response = await api.submitCampaign(campaign.id);
      if (response.success && response.data) {
        await loadCampaign();
        notify.success('Campaign submitted', 'The campaign was submitted to Signalmash. Approval can take time, so refresh the provider state while it is in review.');
      }
    } catch (error) {
      console.error('Failed to submit campaign:', error);
      notify.error('Submission failed', 'The campaign could not be submitted for approval.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefreshStatus = async () => {
    if (!campaign?.signalmashCampaignId) return;

    setIsRefreshing(true);
    try {
      const response = await api.refreshCampaignStatus(campaign.id);
      if (response.success && response.data) {
        setCampaign(response.data);
        notify.success('Campaign status refreshed', 'The latest provider approval state was loaded successfully.');
      }
    } catch (error) {
      console.error('Failed to refresh campaign status:', error);
      notify.error('Refresh failed', 'The latest provider status could not be fetched right now.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const openEditDialog = () => {
    if (!campaign) return;

    setEditForm({
      name: campaign.name,
      description: campaign.description,
      useCase: campaign.useCase,
      subUsecases: campaign.subUsecases.join(', '),
      messageFlow: campaign.messageFlow,
      referenceId: campaign.referenceId ?? '',
      tags: campaign.tags.join(', '),
      privacyPolicyLink: campaign.privacyPolicyLink ?? '',
      termsAndConditionsLink: campaign.termsAndConditionsLink ?? '',
      embeddedLinkSample: campaign.embeddedLinkSample ?? '',
      embeddedLink: campaign.embeddedLink,
      embeddedPhone: campaign.embeddedPhone,
      affiliateMarketing: campaign.affiliateMarketing,
      termsAndConditions: campaign.termsAndConditions,
      numberPool: campaign.numberPool,
      ageGated: campaign.ageGated,
      directLending: campaign.directLending,
      subscriberOptin: campaign.subscriberOptin,
      subscriberOptout: campaign.subscriberOptout,
      subscriberHelp: campaign.subscriberHelp,
      autoRenewal: campaign.autoRenewal,
      sampleMessagesText: campaign.sampleMessages.join('\n\n'),
      optInKeywords: campaign.optInKeywords.join(', '),
      optOutKeywords: campaign.optOutKeywords.join(', '),
      helpKeywords: campaign.helpKeywords.join(', '),
      optInMessage: campaign.optInMessage,
      optOutMessage: campaign.optOutMessage,
      helpMessage: campaign.helpMessage,
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!campaign) return;

    setIsSavingEdit(true);
    try {
      const sampleMessages = editForm.sampleMessagesText
        .split(/\n{2,}/)
        .map((message) => message.trim())
        .filter(Boolean);

      const response = await api.updateCampaign(campaign.id, {
        name: editForm.name,
        description: editForm.description,
        useCase: editForm.useCase,
        subUsecases: editForm.subUsecases.split(',').map((value) => value.trim()).filter(Boolean),
        messageFlow: editForm.messageFlow,
        referenceId: editForm.referenceId || undefined,
        tags: editForm.tags.split(',').map((value) => value.trim()).filter(Boolean),
        privacyPolicyLink: editForm.privacyPolicyLink || undefined,
        termsAndConditionsLink: editForm.termsAndConditionsLink || undefined,
        embeddedLinkSample: editForm.embeddedLinkSample || undefined,
        embeddedLink: editForm.embeddedLink,
        embeddedPhone: editForm.embeddedPhone,
        affiliateMarketing: editForm.affiliateMarketing,
        termsAndConditions: editForm.termsAndConditions,
        numberPool: editForm.numberPool,
        ageGated: editForm.ageGated,
        directLending: editForm.directLending,
        subscriberOptin: editForm.subscriberOptin,
        subscriberOptout: editForm.subscriberOptout,
        subscriberHelp: editForm.subscriberHelp,
        autoRenewal: editForm.autoRenewal,
        sampleMessages,
        optInKeywords: editForm.optInKeywords.split(',').map((value) => value.trim()).filter(Boolean),
        optOutKeywords: editForm.optOutKeywords.split(',').map((value) => value.trim()).filter(Boolean),
        helpKeywords: editForm.helpKeywords.split(',').map((value) => value.trim()).filter(Boolean),
        optInMessage: editForm.optInMessage,
        optOutMessage: editForm.optOutMessage,
        helpMessage: editForm.helpMessage,
      });

      if (response.success) {
        await loadCampaign();
        setShowEditDialog(false);
        notify.success('Campaign updated', 'Campaign details were saved successfully.');
      }
    } catch (error) {
      console.error('Failed to update campaign:', error);
      notify.error('Update failed', 'The campaign details could not be saved.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  if (isLoading) {
    return (
      <div>
        <Header title="Campaign Details" />
        <PageShell>
          <div className="h-40 animate-pulse rounded-[28px] bg-slate-200 dark:bg-slate-800" />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="h-64 animate-pulse rounded-3xl bg-slate-200 dark:bg-slate-800 lg:col-span-2" />
            <div className="h-64 animate-pulse rounded-3xl bg-slate-200 dark:bg-slate-800" />
          </div>
        </PageShell>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div>
        <Header title="Campaign Not Found" />
        <div className="p-6 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400">The requested campaign could not be found.</p>
          <Button className="mt-4" onClick={() => navigate('/campaigns')}>Back to Campaigns</Button>
        </div>
      </div>
    );
  }

  const status = statusConfig[campaign.status];
  const StatusIcon = status.icon;

  return (
    <div>
      <Header
        title={campaign.name}
        subtitle={`Use case: ${campaign.useCase.replace(/_/g, ' ')}`}
      />

      <PageShell>
        <Button
          variant="ghost"
          onClick={() => navigate('/campaigns')}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          Back to Campaigns
        </Button>

        <PageSection className="px-6 py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                  <Megaphone className="h-6 w-6 text-slate-700 dark:text-slate-200" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                      {campaign.name}
                    </h2>
                    <Badge variant={status.variant} className="gap-1">
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {brand ? `${brand.displayName} (${brand.legalName})` : `Brand ID: ${campaign.brandId}`}
                  </p>
                </div>
              </div>

              {campaign.rejectionReason && (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                  <strong className="font-semibold">Rejection reason:</strong> {campaign.rejectionReason}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              {['draft', 'rejected'].includes(campaign.status) && (
                <Button
                  variant="outline"
                  onClick={openEditDialog}
                  leftIcon={<Pencil className="h-4 w-4" />}
                >
                  Edit Campaign
                </Button>
              )}
              {campaign.status === 'draft' && (
                <Button
                  onClick={handleSubmitForApproval}
                  isLoading={isSubmitting}
                  leftIcon={<Send className="h-4 w-4" />}
                >
                  Submit for Approval
                </Button>
              )}
              {campaign.signalmashCampaignId && (
                <Button
                  variant="outline"
                  onClick={handleRefreshStatus}
                  isLoading={isRefreshing}
                  leftIcon={<RefreshCw className="h-4 w-4" />}
                >
                  Refresh Status
                </Button>
              )}
            </div>
          </div>
        </PageSection>

        <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <Badge variant="outline" className="w-fit">Next step</Badge>
              {campaign.status === 'draft' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Review the campaign and submit it for approval
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    This campaign is still editable. Once the use case, description, sample messages,
                    and compliance wording are correct, submit it to Signalmash for approval.
                  </p>
                </>
              ) : null}
              {campaign.status === 'pending_approval' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Wait for campaign approval before provisioning numbers
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    The campaign is in review with Signalmash/TCR. Number purchase and assignment
                    should wait until approval is complete or the campaign comes back with corrections to make.
                  </p>
                </>
              ) : null}
              {campaign.status === 'approved' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Campaign approved. Assign or buy sender numbers next
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    The campaign is ready for number assignment. Move into phone number management
                    to buy a number or attach an existing sender to this campaign.
                  </p>
                </>
              ) : null}
              {campaign.status === 'rejected' || campaign.status === 'suspended' || campaign.status === 'expired' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Fix the campaign details and resubmit
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    This campaign cannot move forward in its current state. Use the provider feedback
                    to correct the record, then submit again when it is ready.
                  </p>
                </>
              ) : null}
            </div>

            <div className="flex gap-3">
              {['draft', 'rejected'].includes(campaign.status) && (
                <Button variant="outline" onClick={openEditDialog} leftIcon={<Pencil className="h-4 w-4" />}>
                  Edit Campaign
                </Button>
              )}
              {campaign.status === 'approved' ? (
                <Button onClick={() => navigate('/phone-numbers')} leftIcon={<Phone className="h-4 w-4" />}>
                  Manage Numbers
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Campaign Overview</h3>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Use Case</p>
                    <p className="mt-1 font-medium capitalize text-slate-950 dark:text-slate-50">{campaign.useCase.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Daily Message Limit</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{campaign.dailyMessageLimit ?? 'Not assigned'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Messages Per Second</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{campaign.messagesPerSecond ?? 'Not assigned'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Phone Numbers</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{campaign.phoneNumbers.length}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Description</p>
                    <p className="mt-1 font-medium leading-6 text-slate-950 dark:text-slate-50">{campaign.description}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Message Flow</p>
                    <p className="mt-1 font-medium leading-6 text-slate-950 dark:text-slate-50">{campaign.messageFlow || 'Not provided'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
                  <MessageSquare className="h-5 w-5" />
                  Sample Messages
                </h3>
                <div className="mt-5 space-y-3">
                  {campaign.sampleMessages.map((message, index) => (
                    <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                      {message}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Compliance Settings</h3>
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Opt-In Keywords</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {campaign.optInKeywords.map((keyword) => (
                        <Badge key={keyword} variant="secondary">{keyword}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Opt-Out Keywords</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {campaign.optOutKeywords.map((keyword) => (
                        <Badge key={keyword} variant="secondary">{keyword}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Help Keywords</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {campaign.helpKeywords.map((keyword) => (
                        <Badge key={keyword} variant="secondary">{keyword}</Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Opt-In Message</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{campaign.optInMessage}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Opt-Out Message</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{campaign.optOutMessage}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Help Message</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{campaign.helpMessage}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Reference ID</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{campaign.referenceId || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Sub-usecases</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{campaign.subUsecases.length ? campaign.subUsecases.join(', ') : 'None'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Privacy Policy</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{campaign.privacyPolicyLink || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Terms & Conditions Link</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{campaign.termsAndConditionsLink || 'Not provided'}</p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {([
                    campaign.embeddedLink && 'Embedded link',
                    campaign.embeddedPhone && 'Embedded phone',
                    campaign.affiliateMarketing && 'Affiliate marketing',
                    campaign.termsAndConditions && 'Terms and conditions',
                    campaign.numberPool && 'Number pool',
                    campaign.ageGated && 'Age gated',
                    campaign.directLending && 'Direct lending',
                    campaign.subscriberOptin && 'Opt-in',
                    campaign.subscriberOptout && 'Opt-out',
                    campaign.subscriberHelp && 'Help',
                    campaign.autoRenewal && 'Auto renewal',
                  ].filter((label): label is string => Boolean(label))).map((label) => (
                    <Badge key={label} variant="secondary">{label}</Badge>
                  ))}
                  {campaign.tags.map((tag) => (
                    <Badge key={tag} variant="outline">{tag}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
                  <Phone className="h-5 w-5" />
                  Assigned Phone Numbers
                </h3>

                {campaign.phoneNumbers.length === 0 ? (
                  <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    {campaign.status === 'approved'
                      ? 'No phone numbers are assigned yet. This campaign is ready for the number provisioning step.'
                      : 'No phone numbers are assigned yet. Number assignment begins after campaign approval.'}
                  </div>
                ) : (
                  <div className="mt-5 space-y-3">
                    {campaign.phoneNumbers.map((phoneNumber) => (
                      <div key={phoneNumber.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                        <div>
                          <p className="font-medium text-slate-950 dark:text-slate-50">{phoneNumber.formattedNumber}</p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{phoneNumber.phoneNumber}</p>
                        </div>
                        <Badge variant="secondary">{phoneNumber.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Registry Metadata</h3>
                <div className="mt-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <RefreshCw className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Provider Status</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                        {campaign.providerStatus || 'Not submitted'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <RefreshCw className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Provider Message</p>
                      <p className="mt-1 break-words font-medium text-slate-950 dark:text-slate-50">
                        {campaign.providerMessage || 'No provider message recorded'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <RefreshCw className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Submit Attempts</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{campaign.submitAttempts}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Last Submitted</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                        {campaign.lastSubmittedAt ? formatDateTime(campaign.lastSubmittedAt) : 'Not submitted'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Last Status Sync</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                        {campaign.lastStatusSyncedAt ? formatDateTime(campaign.lastStatusSyncedAt) : 'Not synced yet'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Last Submission Error</p>
                      <p className="mt-1 break-words font-medium text-slate-950 dark:text-slate-50">
                        {campaign.lastSubmissionError || 'No submission error recorded'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Created</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{formatDate(campaign.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Last Updated</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{formatDateTime(campaign.updatedAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <BarChart3 className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Signalmash Campaign ID</p>
                      <p className="mt-1 break-all font-medium text-slate-950 dark:text-slate-50">
                        {campaign.signalmashCampaignId || 'Not assigned'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <BarChart3 className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">TCR Campaign ID</p>
                      <p className="mt-1 break-all font-medium text-slate-950 dark:text-slate-50">
                        {campaign.tcrCampaignId || 'Not assigned'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <BarChart3 className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Embedded Link Sample</p>
                      <p className="mt-1 break-all font-medium text-slate-950 dark:text-slate-50">
                        {campaign.embeddedLinkSample || 'Not assigned'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {brand && (
              <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Linked Brand</h3>
                  <p className="mt-3 font-medium text-slate-950 dark:text-slate-50">{brand.displayName}</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{brand.legalName}</p>
                  <Button className="mt-5 w-full" variant="outline" onClick={() => navigate(`/brands/${brand.id}`)}>
                    Open Brand
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </PageShell>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>
              Update draft or rejected campaign details supported by the backend.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">Campaign Name</label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Use Case</label>
              <select
                value={editForm.useCase}
                onChange={(e) => setEditForm({ ...editForm, useCase: e.target.value })}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                {useCaseOptions.map((option) => (
                  <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                className="min-h-[100px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Message Flow</label>
              <textarea
                value={editForm.messageFlow}
                onChange={(e) => setEditForm({ ...editForm, messageFlow: e.target.value })}
                className="min-h-[100px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              />
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Sub-usecases</label>
                <Input value={editForm.subUsecases} onChange={(e) => setEditForm({ ...editForm, subUsecases: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reference ID</label>
                <Input value={editForm.referenceId} onChange={(e) => setEditForm({ ...editForm, referenceId: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tags</label>
                <Input value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Embedded Link Sample</label>
                <Input value={editForm.embeddedLinkSample} onChange={(e) => setEditForm({ ...editForm, embeddedLinkSample: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Privacy Policy Link</label>
                <Input value={editForm.privacyPolicyLink} onChange={(e) => setEditForm({ ...editForm, privacyPolicyLink: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Terms & Conditions Link</label>
                <Input value={editForm.termsAndConditionsLink} onChange={(e) => setEditForm({ ...editForm, termsAndConditionsLink: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Sample Messages</label>
              <textarea
                value={editForm.sampleMessagesText}
                onChange={(e) => setEditForm({ ...editForm, sampleMessagesText: e.target.value })}
                className="min-h-[180px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                placeholder="Separate multiple sample messages with a blank line."
              />
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Opt-In Keywords</label>
                <Input value={editForm.optInKeywords} onChange={(e) => setEditForm({ ...editForm, optInKeywords: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Opt-Out Keywords</label>
                <Input value={editForm.optOutKeywords} onChange={(e) => setEditForm({ ...editForm, optOutKeywords: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Help Keywords</label>
                <Input value={editForm.helpKeywords} onChange={(e) => setEditForm({ ...editForm, helpKeywords: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Opt-In Message</label>
                <Input value={editForm.optInMessage} onChange={(e) => setEditForm({ ...editForm, optInMessage: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Opt-Out Message</label>
                <Input value={editForm.optOutMessage} onChange={(e) => setEditForm({ ...editForm, optOutMessage: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Help Message</label>
                <Input value={editForm.helpMessage} onChange={(e) => setEditForm({ ...editForm, helpMessage: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ['embeddedLink', 'Contains embedded links'],
                ['embeddedPhone', 'Contains embedded phone numbers'],
                ['affiliateMarketing', 'Includes affiliate marketing'],
                ['termsAndConditions', 'Terms and conditions enabled'],
                ['numberPool', 'Uses number pool'],
                ['ageGated', 'Age gated'],
                ['directLending', 'Direct lending'],
                ['subscriberOptin', 'Subscriber opt-in supported'],
                ['subscriberOptout', 'Subscriber opt-out supported'],
                ['subscriberHelp', 'Subscriber help supported'],
                ['autoRenewal', 'Auto renewal'],
              ].map(([field, label]) => (
                <label key={field} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                  <input
                    type="checkbox"
                    checked={Boolean(editForm[field as keyof typeof editForm])}
                    onChange={(e) => setEditForm({ ...editForm, [field]: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>{label}</span>
                </label>
              ))}
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
