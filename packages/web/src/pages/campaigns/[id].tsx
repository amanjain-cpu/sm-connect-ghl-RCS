import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import {
  CAMPAIGN_SUB_USE_CASE_VALUES,
  CAMPAIGN_USE_CASES,
  CAMPAIGN_USE_CASES_REQUIRING_SUB_USE_CASES,
  CAMPAIGN_USE_CASE_VALUES,
} from '@signalmash-connect/shared';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/utils';
import { notify } from '@/stores/notification.store';

interface PhoneNumber {
  id: string;
  phoneNumber: string;
  formattedNumber: string;
  status: string;
  friendlyName?: string | null;
  campaign?: {
    id: string;
    name: string;
    status: string;
  } | null;
}

interface AvailableNumber {
  phoneNumber: string;
  formattedNumber: string;
  areaCode: string;
  capabilities: {
    sms: boolean;
    mms: boolean;
    voice: boolean;
  };
  monthlyPrice: number;
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
  numberLinkStatus: 'none' | 'requested' | 'checkout_required' | 'linked' | 'failed';
  numberLinkError: string | null;
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

interface SubscriptionSummary {
  subscription: {
    plan: string | null;
    phoneNumbersIncluded: number;
  };
  usage: {
    activePhoneNumbers: number;
    phoneNumbersIncluded: number;
  };
}

const statusConfig = {
  draft: { label: 'Draft', icon: FileText, variant: 'secondary' as const },
  pending_approval: { label: 'Pending Approval', icon: Clock, variant: 'warning' as const },
  approved: { label: 'Approved', icon: CheckCircle, variant: 'success' as const },
  rejected: { label: 'Rejected', icon: XCircle, variant: 'destructive' as const },
  suspended: { label: 'Suspended', icon: AlertCircle, variant: 'destructive' as const },
  expired: { label: 'Expired', icon: AlertCircle, variant: 'destructive' as const },
};

const useCaseOptions = CAMPAIGN_USE_CASE_VALUES;
const subUseCaseOptions = CAMPAIGN_SUB_USE_CASE_VALUES.map((value) => ({
  value,
  label: CAMPAIGN_USE_CASES[value],
})) as Array<{
  value: (typeof CAMPAIGN_SUB_USE_CASE_VALUES)[number];
  label: string;
}>;
const useCasesRequiringSubUsecases = new Set<string>(CAMPAIGN_USE_CASES_REQUIRING_SUB_USE_CASES);

function formatUseCaseLabel(value: string): string {
  const key = value in CAMPAIGN_USE_CASES ? value : value.toLowerCase();
  return CAMPAIGN_USE_CASES[key] ?? value.replace(/_/g, ' ');
}

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [brand, setBrand] = useState<BrandSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [numberFlowMode, setNumberFlowMode] = useState<'none' | 'existing' | 'buy_new'>('none');
  const [existingNumbers, setExistingNumbers] = useState<PhoneNumber[]>([]);
  const [selectedExistingNumberId, setSelectedExistingNumberId] = useState('');
  const [numberFriendlyName, setNumberFriendlyName] = useState('');
  const [numberSearch, setNumberSearch] = useState({
    state: '',
    areaCode: '',
    contains: '',
  });
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [selectedAvailableNumber, setSelectedAvailableNumber] = useState('');
  const [isSearchingNumbers, setIsSearchingNumbers] = useState(false);
  const [subscriptionSummary, setSubscriptionSummary] = useState<SubscriptionSummary | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    useCase: 'marketing',
    subUsecases: [] as string[],
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
  const requiresEditSubUsecases = useCasesRequiringSubUsecases.has(editForm.useCase);
  const minimumEditSubUsecases = editForm.useCase === 'mixed' ? 2 : requiresEditSubUsecases ? 1 : 0;
  const selectedExistingNumber = existingNumbers.find((number) => number.id === selectedExistingNumberId) ?? null;

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

  const loadNumberSetupData = async () => {
    try {
      const [numbersResponse, billingResponse] = await Promise.all([
        api.getPhoneNumbers({ status: 'active', limit: 100 }),
        api.getSubscriptionBillingSummary(),
      ]);

      if (numbersResponse.success && numbersResponse.data) {
        setExistingNumbers(numbersResponse.data);
      }

      if (billingResponse.success && billingResponse.data) {
        setSubscriptionSummary(billingResponse.data);
      }
    } catch (error) {
      console.error('Failed to load campaign number setup data:', error);
    }
  };

  useEffect(() => {
    loadCampaign();
  }, [id]);

  useEffect(() => {
    loadNumberSetupData();
  }, [id]);

  useEffect(() => {
    const handlePhoneCheckoutReturn = async () => {
      if (!id) return;

      const checkoutStatus = searchParams.get('number_checkout');
      const sessionId = searchParams.get('session_id');

      if (checkoutStatus === 'success' && sessionId) {
        try {
          const response = await api.completePhoneNumberCheckout({ sessionId });
          if (response.success && response.data && 'pending' in response.data && response.data.pending) {
            notify.success('Checkout completed', response.data.message);
          } else {
            notify.success(
              'Number linked',
              campaign?.status === 'pending_approval'
                ? 'The phone number purchase completed and was saved as the default sender. SMS/MMS starts after campaign approval.'
                : 'The phone number purchase completed and was saved as the default sender.'
            );
          }
          await Promise.all([loadCampaign(), loadNumberSetupData()]);
        } catch (error) {
          console.error('Failed to complete campaign number checkout:', error);
          notify.error('Number checkout failed', 'The Stripe checkout completed, but the phone number could not be linked automatically.');
        } finally {
          window.history.replaceState({}, '', `/campaigns/${id}`);
        }
      } else if (checkoutStatus === 'cancelled') {
        notify.error('Checkout cancelled', 'The campaign number purchase was not completed.');
        window.history.replaceState({}, '', `/campaigns/${id}`);
      }
    };

    handlePhoneCheckoutReturn();
  }, [id, searchParams]);

  const openSubmitDialog = async () => {
    setNumberFlowMode('none');
    setSelectedExistingNumberId('');
    setNumberFriendlyName('');
    setAvailableNumbers([]);
    setSelectedAvailableNumber('');
    setShowSubmitDialog(true);
    await loadNumberSetupData();
  };

  const handleSearchNumbers = async () => {
    if (!numberSearch.state && !numberSearch.areaCode && !numberSearch.contains) {
      notify.error('Search required', 'Enter a state, area code, or digit pattern before searching.');
      return;
    }

    setIsSearchingNumbers(true);
    try {
      const response = await api.searchAvailableNumbers({
        state: numberSearch.state || undefined,
        areaCode: numberSearch.areaCode || undefined,
        contains: numberSearch.contains || undefined,
        limit: 20,
      });

      if (response.success && response.data) {
        setAvailableNumbers(response.data);
      }
    } catch (error) {
      console.error('Failed to search numbers for campaign:', error);
      notify.error('Number search failed', error instanceof Error ? error.message : 'Unable to load available numbers.');
    } finally {
      setIsSearchingNumbers(false);
    }
  };

  const buildNumberLinkIntent = () => {
    if (numberFlowMode === 'none') {
      return undefined;
    }

    if (numberFlowMode === 'existing') {
      if (!selectedExistingNumberId) {
        notify.error('Number required', 'Select an active number to link to this campaign.');
        return null;
      }

      const requiresReassignment =
        selectedExistingNumber?.campaign && selectedExistingNumber.campaign.id !== campaign?.id;

      if (
        requiresReassignment &&
        !window.confirm(
          `This will move ${selectedExistingNumber.formattedNumber} from ${selectedExistingNumber.campaign?.name} to ${campaign?.name}. Continue?`
        )
      ) {
        return null;
      }

      return {
        mode: 'existing' as const,
        phoneNumberId: selectedExistingNumberId,
        friendlyName: numberFriendlyName || undefined,
        makeDefaultSender: true,
        ...(requiresReassignment ? { confirmReassignment: true } : {}),
      };
    }

    if (!selectedAvailableNumber) {
      notify.error('Number required', 'Select an available 10DLC number to buy for this campaign.');
      return null;
    }

    return {
      mode: 'buy_new' as const,
      phoneNumber: selectedAvailableNumber,
      friendlyName: numberFriendlyName || undefined,
      makeDefaultSender: true,
    };
  };

  const handleNumberLinkResponse = async (responseData: any, successMessage: string) => {
    if (responseData?.numberLinkAction?.mode === 'checkout' && responseData.numberLinkAction.checkoutUrl) {
      window.location.href = responseData.numberLinkAction.checkoutUrl;
      return;
    }

    await Promise.all([loadCampaign(), loadNumberSetupData()]);

    if (responseData?.numberLinkAction?.mode === 'linked') {
      notify.success(successMessage, 'The campaign and phone number are now linked and saved as the default sender.');
      return;
    }

    if (responseData?.numberLinkAction?.mode === 'reassigned') {
      notify.success(
        successMessage,
        responseData.numberLinkAction.previousCampaignName
          ? `The number was moved from ${responseData.numberLinkAction.previousCampaignName}, linked to this campaign, and saved as the default sender.`
          : 'The existing number was reassigned, linked to this campaign, and saved as the default sender.'
      );
      return;
    }

    if (responseData?.numberLinkAction?.mode === 'blocked_until_campaign_approved') {
      notify.success(successMessage, responseData.numberLinkAction.message);
      return;
    }

    if (responseData?.numberLinkAction?.mode === 'pending_provider') {
      notify.success(successMessage, responseData.numberLinkAction.message);
      return;
    }

    if (responseData?.numberLinkAction?.mode === 'failed') {
      notify.error('Number link needs attention', responseData.numberLinkAction.message);
      return;
    }

    notify.success(successMessage, 'The campaign request was saved successfully.');
  };

  const handleSubmitForApproval = async () => {
    if (!campaign) return;

    const numberLinkIntent = buildNumberLinkIntent();
    if (numberLinkIntent === null) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.submitCampaign(campaign.id, numberLinkIntent ? { numberLinkIntent } : undefined);
      if (response.success && response.data) {
        setShowSubmitDialog(false);
        await handleNumberLinkResponse(
          response.data,
          'Campaign submitted'
        );
      }
    } catch (error) {
      console.error('Failed to submit campaign:', error);
      notify.error('Submission failed', 'The campaign could not be submitted for approval.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkPhoneNumber = async () => {
    if (!campaign) return;

    const numberLinkIntent = buildNumberLinkIntent();
    if (!numberLinkIntent) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.linkCampaignPhoneNumber(campaign.id, numberLinkIntent);
      if (response.success && response.data) {
        setShowSubmitDialog(false);
        await handleNumberLinkResponse(
          response.data,
          'Campaign number link updated'
        );
      }
    } catch (error) {
      console.error('Failed to link campaign phone number:', error);
      notify.error('Number link failed', error instanceof Error ? error.message : 'The campaign phone number could not be linked.');
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
      subUsecases: campaign.subUsecases,
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
        subUsecases: requiresEditSubUsecases ? editForm.subUsecases : [],
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

  const toggleEditSubUsecase = (value: (typeof CAMPAIGN_SUB_USE_CASE_VALUES)[number]) => {
    const next = editForm.subUsecases.includes(value)
      ? editForm.subUsecases.filter((item) => item !== value)
      : [...editForm.subUsecases, value];

    setEditForm({ ...editForm, subUsecases: next });
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
        subtitle={`Use case: ${formatUseCaseLabel(campaign.useCase)}`}
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
                  onClick={openSubmitDialog}
                  isLoading={isSubmitting}
                  leftIcon={<Send className="h-4 w-4" />}
                >
                  Register Campaign
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
                    Review the campaign, then register it with an optional sender number
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    This campaign is still editable. Once the use case, description, sample messages,
                    and compliance wording are correct, submit it to Signalmash and optionally link an existing number or buy a new 10DLC sender in the same flow.
                  </p>
                </>
              ) : null}
              {campaign.status === 'pending_approval' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Campaign review is in progress
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    Signalmash/TCR is still reviewing this campaign. If a new number was selected during registration and provider provisioning is not ready yet, the app will retry it automatically after approval.
                  </p>
                </>
              ) : null}
              {campaign.status === 'approved' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Campaign approved. Manage the sender number from this page
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    This campaign is ready for sender assignment. Link an existing active number or buy a new 10DLC long-code number directly against this campaign.
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
              {['pending_approval', 'approved'].includes(campaign.status) ? (
                <Button onClick={openSubmitDialog} leftIcon={<Phone className="h-4 w-4" />}>
                  {campaign.phoneNumbers.length > 0 ? 'Update Number Link' : 'Link Phone Number'}
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
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{formatUseCaseLabel(campaign.useCase)}</p>
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
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">
                      {campaign.subUsecases.length
                        ? campaign.subUsecases.map((value) => formatUseCaseLabel(value)).join(', ')
                        : 'None'}
                    </p>
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

                {campaign.numberLinkStatus !== 'none' && (
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    <p className="font-medium text-slate-950 dark:text-slate-50">
                      Number link status: {campaign.numberLinkStatus.replace(/_/g, ' ')}
                    </p>
                    <p className="mt-1">
                      {campaign.numberLinkError
                        ? campaign.numberLinkError
                        : campaign.numberLinkStatus === 'linked'
                          ? campaign.status === 'approved'
                            ? 'A sender number is linked to this campaign.'
                            : 'A sender number is linked, but SMS/MMS stays blocked until this campaign is approved.'
                          : campaign.numberLinkStatus === 'checkout_required'
                            ? 'This campaign is waiting on the extra-number Stripe checkout before the new number can be provisioned.'
                            : 'A number selection is saved for this campaign and will be retried automatically when provider conditions are met.'}
                    </p>
                  </div>
                )}

                {campaign.phoneNumbers.length === 0 ? (
                  <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    {campaign.status === 'approved'
                      ? 'No phone numbers are assigned yet. This campaign is ready for the number provisioning step.'
                      : 'No phone numbers are assigned yet. You can buy or link a sender now; SMS/MMS starts after campaign approval.'}
                  </div>
                ) : (
                  <div className="mt-5 space-y-3">
                    {campaign.phoneNumbers.map((phoneNumber) => (
                      <div key={phoneNumber.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                        <div>
                          <p className="font-medium text-slate-950 dark:text-slate-50">{phoneNumber.formattedNumber}</p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{phoneNumber.phoneNumber}</p>
                          {campaign.status !== 'approved' ? (
                            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                              Traffic stays blocked until this campaign is approved.
                            </p>
                          ) : null}
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

      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {campaign.status === 'draft' ? 'Register Campaign' : 'Link Campaign Number'}
            </DialogTitle>
            <DialogDescription>
              {campaign.status === 'draft'
                ? 'Submit this campaign to Signalmash and optionally link an existing sender or buy a new 10DLC number.'
                : 'Link an existing active sender or buy a new 10DLC number for this campaign. SMS/MMS starts after approval if review is still pending.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1">
            {subscriptionSummary && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <p className="font-medium text-slate-950 dark:text-slate-50">
                  Plan: {subscriptionSummary.subscription.plan || 'No active plan'}
                </p>
                <p className="mt-1">
                  Active numbers: {subscriptionSummary.usage.activePhoneNumbers} / {subscriptionSummary.usage.phoneNumbersIncluded}
                </p>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              {[
                ['none', 'No number now', 'Register the campaign first and handle number setup later.'],
                ['existing', 'Use existing number', 'Link an active number that already belongs to this organization.'],
                ['buy_new', 'Buy new number', 'Search 10DLC long-code inventory and buy a new sender.'],
              ].map(([value, label, helper]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNumberFlowMode(value as 'none' | 'existing' | 'buy_new')}
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    numberFlowMode === value
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <p className="font-medium">{label}</p>
                  <p className={`mt-2 text-sm ${numberFlowMode === value ? 'text-white/80 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>
                    {helper}
                  </p>
                </button>
              ))}
            </div>

            {numberFlowMode === 'existing' && (
              <div className="grid gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Existing Active Number</label>
                  <select
                    value={selectedExistingNumberId}
                    onChange={(e) => setSelectedExistingNumberId(e.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                  >
                    <option value="">Select a number</option>
                    {existingNumbers.map((number) => (
                      <option key={number.id} value={number.id}>
                        {number.formattedNumber} {number.campaign ? `- currently ${number.campaign.name}` : '- unassigned'}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedExistingNumber?.campaign && selectedExistingNumber.campaign.id !== campaign.id ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    {selectedExistingNumber.formattedNumber} is currently linked to{' '}
                    <span className="font-medium">{selectedExistingNumber.campaign.name}</span>. Continuing will reassign it to this campaign.
                  </div>
                ) : null}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Friendly Name (optional)</label>
                  <Input
                    value={numberFriendlyName}
                    onChange={(e) => setNumberFriendlyName(e.target.value)}
                    placeholder="Support line, onboarding, default sender"
                  />
                </div>
              </div>
            )}

            {numberFlowMode === 'buy_new' && (
              <div className="grid gap-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">State</label>
                    <Input
                      value={numberSearch.state}
                      onChange={(e) => setNumberSearch((current) => ({ ...current, state: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) }))}
                      placeholder="CA"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Area Code</label>
                    <Input
                      value={numberSearch.areaCode}
                      onChange={(e) => setNumberSearch((current) => ({ ...current, areaCode: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
                      placeholder="415"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Contains</label>
                    <Input
                      value={numberSearch.contains}
                      onChange={(e) => setNumberSearch((current) => ({ ...current, contains: e.target.value.replace(/\D/g, '').slice(0, 7) }))}
                      placeholder="1234"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-950 dark:text-slate-50">10DLC inventory only</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Toll-free and short-code inventory is excluded from this search.
                    </p>
                  </div>
                  <Button variant="outline" onClick={handleSearchNumbers} isLoading={isSearchingNumbers}>
                    Search Numbers
                  </Button>
                </div>

                <div className="space-y-3">
                  {availableNumbers.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                      Search provider inventory to select a 10DLC long-code sender.
                    </div>
                  ) : (
                    availableNumbers.map((number) => (
                      <button
                        key={number.phoneNumber}
                        type="button"
                        onClick={() => setSelectedAvailableNumber(number.phoneNumber)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition ${
                          selectedAvailableNumber === number.phoneNumber
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <p className="font-medium">{number.formattedNumber}</p>
                          <p className={`mt-1 text-sm ${selectedAvailableNumber === number.phoneNumber ? 'text-white/80 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>
                            {number.phoneNumber} · Area code {number.areaCode}
                          </p>
                        </div>
                        <Badge variant={selectedAvailableNumber === number.phoneNumber ? 'success' : 'secondary'}>
                          {number.monthlyPrice ? `$${number.monthlyPrice.toFixed(2)}/mo` : 'Provider rate'}
                        </Badge>
                      </button>
                    ))
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Friendly Name (optional)</label>
                  <Input
                    value={numberFriendlyName}
                    onChange={(e) => setNumberFriendlyName(e.target.value)}
                    placeholder="Primary sender, customer care, onboarding"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={campaign.status === 'draft' ? handleSubmitForApproval : handleLinkPhoneNumber}
              isLoading={isSubmitting}
            >
              {campaign.status === 'draft' ? 'Submit Campaign' : 'Save Number Link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    useCase: e.target.value,
                    subUsecases: useCasesRequiringSubUsecases.has(e.target.value) ? editForm.subUsecases : [],
                  })
                }
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                {useCaseOptions.map((option) => (
                  <option key={option} value={option}>{formatUseCaseLabel(option)}</option>
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
                {requiresEditSubUsecases ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      {subUseCaseOptions.map((option) => {
                        const checked = editForm.subUsecases.includes(option.value);

                        return (
                          <label
                            key={option.value}
                            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
                              checked
                                ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleEditSubUsecase(option.value)}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-between gap-4">
                              <span className="font-medium">{option.label}</span>
                              {checked ? <CheckCircle className="h-4 w-4 shrink-0" /> : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Select at least {minimumEditSubUsecases} sub-use-case{minimumEditSubUsecases === 1 ? '' : 's'} for this campaign type.
                    </p>
                  </>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    Standard campaign types are submitted under their primary use case automatically.
                  </div>
                )}
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
