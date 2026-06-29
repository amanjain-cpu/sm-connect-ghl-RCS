import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Building2,
  ArrowLeft,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  FileText,
  MapPin,
  Globe,
  Calendar,
  Megaphone,
  Plus,
  Send,
  Mail,
  Phone,
  ShieldCheck,
  Pencil,
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

interface Brand {
  id: string;
  legalName: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  ein: string | null;
  einIssuingCountry: string | null;
  entityType: string;
  providerEntityType: string | null;
  vertical: string;
  providerVertical: string | null;
  brandRelationship: 'BASIC_ACCOUNT' | 'SMALL_ACCOUNT' | 'MEDIUM_ACCOUNT' | 'LARGE_ACCOUNT' | 'KEY_ACCOUNT' | null;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  website: string;
  phone: string;
  mobilePhone: string | null;
  email: string;
  businessContactEmail: string | null;
  stockSymbol: string | null;
  stockExchange: string | null;
  ipAddress: string | null;
  altBusinessId: string | null;
  altBusinessIdType: string | null;
  referenceId: string | null;
  tags: string[];
  signalmashBrandId: string | null;
  tcrBrandId: string | null;
  status: 'draft' | 'pending_verification' | 'verified' | 'unverified' | 'rejected' | 'suspended';
  verificationScore: number | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  campaigns: Array<{
    id: string;
    name: string;
    useCase: string;
    status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'suspended' | 'expired';
  }>;
}

const statusConfig = {
  draft: { label: 'Draft', icon: FileText, variant: 'secondary' as const },
  pending_verification: { label: 'Pending Verification', icon: Clock, variant: 'warning' as const },
  verified: { label: 'Verified', icon: CheckCircle, variant: 'success' as const },
  unverified: { label: 'Unverified', icon: AlertCircle, variant: 'warning' as const },
  rejected: { label: 'Rejected', icon: XCircle, variant: 'destructive' as const },
  suspended: { label: 'Suspended', icon: AlertCircle, variant: 'destructive' as const },
};

const campaignStatusVariant: Record<Brand['campaigns'][number]['status'], 'secondary' | 'warning' | 'success' | 'destructive'> = {
  draft: 'secondary',
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'destructive',
  suspended: 'destructive',
  expired: 'destructive',
};

const entityTypeOptions = [
  'sole_proprietor',
  'partnership',
  'corporation',
  'llc',
  'non_profit',
  'government',
] as const;

const verticalOptions = [
  'retail',
  'healthcare',
  'financial',
  'education',
  'hospitality',
  'real_estate',
  'technology',
  'professional_services',
  'other',
] as const;

const brandRelationshipOptions = [
  'BASIC_ACCOUNT',
  'SMALL_ACCOUNT',
  'MEDIUM_ACCOUNT',
  'LARGE_ACCOUNT',
  'KEY_ACCOUNT',
] as const;

export function BrandDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    legalName: '',
    displayName: '',
    firstName: '',
    lastName: '',
    ein: '',
    einIssuingCountry: 'US',
    entityType: 'llc',
    providerEntityType: 'PRIVATE_PROFIT',
    vertical: 'professional_services',
    providerVertical: 'PROFESSIONAL_SERVICES',
    brandRelationship: 'BASIC_ACCOUNT',
    streetAddress: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'US',
    website: '',
    phone: '',
    email: '',
    mobilePhone: '',
    businessContactEmail: '',
    stockSymbol: '',
    stockExchange: '',
    ipAddress: '',
    altBusinessId: '',
    altBusinessIdType: '',
    referenceId: '',
  });

  const loadBrand = async () => {
    if (!id) return;

    try {
      const response = await api.getBrand(id);
      if (response.success && response.data) {
        setBrand(response.data);
      }
    } catch (error) {
      console.error('Failed to load brand:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBrand();
  }, [id]);

  const handleSubmitForVerification = async () => {
    if (!brand) return;

    setIsSubmitting(true);
    try {
      const response = await api.submitBrand(brand.id);
      if (response.success && response.data) {
        setBrand(response.data);
        notify.success('Brand submitted', 'The brand is now pending verification. Wait for approval before creating campaigns.');
      }
    } catch (error) {
      console.error('Failed to submit brand:', error);
      notify.error('Submission failed', 'The brand could not be submitted for verification.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = () => {
    if (!brand) return;

    setEditForm({
      legalName: brand.legalName,
      displayName: brand.displayName,
      firstName: brand.firstName || '',
      lastName: brand.lastName || '',
      ein: brand.ein || '',
      einIssuingCountry: brand.einIssuingCountry || 'US',
      entityType: brand.entityType,
      providerEntityType: brand.providerEntityType || 'PRIVATE_PROFIT',
      vertical: brand.vertical,
      providerVertical: brand.providerVertical || 'PROFESSIONAL_SERVICES',
      brandRelationship: brand.brandRelationship || 'BASIC_ACCOUNT',
      streetAddress: brand.streetAddress,
      city: brand.city,
      state: brand.state,
      postalCode: brand.postalCode,
      country: brand.country,
      website: brand.website,
      phone: brand.phone,
      email: brand.email,
      mobilePhone: brand.mobilePhone || '',
      businessContactEmail: brand.businessContactEmail || '',
      stockSymbol: brand.stockSymbol || '',
      stockExchange: brand.stockExchange || '',
      ipAddress: brand.ipAddress || '',
      altBusinessId: brand.altBusinessId || '',
      altBusinessIdType: brand.altBusinessIdType || '',
      referenceId: brand.referenceId || '',
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!brand) return;

    setIsSavingEdit(true);
    try {
      const response = await api.updateBrand(brand.id, {
        legalName: editForm.legalName,
        displayName: editForm.displayName,
        firstName: editForm.firstName || undefined,
        lastName: editForm.lastName || undefined,
        ein: editForm.ein || undefined,
        einIssuingCountry: editForm.einIssuingCountry || undefined,
        entityType: editForm.entityType,
        providerEntityType: editForm.providerEntityType || undefined,
        vertical: editForm.vertical,
        providerVertical: editForm.providerVertical || undefined,
        brandRelationship: editForm.brandRelationship || undefined,
        streetAddress: editForm.streetAddress,
        city: editForm.city,
        state: editForm.state.toUpperCase(),
        postalCode: editForm.postalCode,
        country: editForm.country,
        website: editForm.website,
        phone: editForm.phone,
        email: editForm.email,
        mobilePhone: editForm.mobilePhone || undefined,
        businessContactEmail: editForm.businessContactEmail || undefined,
        stockSymbol: editForm.stockSymbol || undefined,
        stockExchange: editForm.stockExchange || undefined,
        ipAddress: editForm.ipAddress || undefined,
        altBusinessId: editForm.altBusinessId || undefined,
        altBusinessIdType: editForm.altBusinessIdType || undefined,
        referenceId: editForm.referenceId || undefined,
      });

      if (response.success) {
        await loadBrand();
        setShowEditDialog(false);
        notify.success('Brand updated', 'Brand details were saved successfully.');
      }
    } catch (error) {
      console.error('Failed to update brand:', error);
      notify.error('Update failed', 'The brand details could not be saved.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  if (isLoading) {
    return (
      <div>
        <Header title="Brand Details" />
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

  if (!brand) {
    return (
      <div>
        <Header title="Brand Not Found" />
        <div className="p-6 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400">The requested brand could not be found.</p>
          <Button className="mt-4" onClick={() => navigate('/brands')}>Back to Brands</Button>
        </div>
      </div>
    );
  }

  const status = statusConfig[brand.status];
  const StatusIcon = status.icon;

  return (
    <div>
      <Header
        title={brand.legalName}
        subtitle={`Display name: ${brand.displayName}`}
      />

      <PageShell>
        <Button
          variant="ghost"
          onClick={() => navigate('/brands')}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          Back to Brands
        </Button>

        <PageSection className="px-6 py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                  <Building2 className="h-6 w-6 text-slate-700 dark:text-slate-200" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                      {brand.legalName}
                    </h2>
                    <Badge variant={status.variant} className="gap-1">
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {brand.entityType.replace(/_/g, ' ')} • {brand.vertical.replace(/_/g, ' ')}
                  </p>
                </div>
              </div>

              {brand.rejectionReason && (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                  <strong className="font-semibold">Rejection reason:</strong> {brand.rejectionReason}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              {brand.status === 'verified' && (
                <Button
                  variant="outline"
                  onClick={() => navigate(`/campaigns/new?brandId=${brand.id}`)}
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  Create Campaign
                </Button>
              )}
              {['draft', 'unverified', 'rejected'].includes(brand.status) && (
                <Button
                  variant="outline"
                  onClick={openEditDialog}
                  leftIcon={<Pencil className="h-4 w-4" />}
                >
                  Edit Brand
                </Button>
              )}
              {['draft', 'unverified', 'rejected'].includes(brand.status) && (
                <Button
                  onClick={handleSubmitForVerification}
                  isLoading={isSubmitting}
                  leftIcon={<Send className="h-4 w-4" />}
                >
                  Submit for Verification
                </Button>
              )}
            </div>
          </div>
        </PageSection>

        <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <Badge variant="outline" className="w-fit">Next step</Badge>
              {brand.status === 'draft' || brand.status === 'unverified' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Review the draft and submit it for verification
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    This brand is still editable. Once the legal and contact details look correct,
                    submit it for verification so the embedded rollout can move toward campaign setup.
                  </p>
                </>
              ) : null}
              {brand.status === 'pending_verification' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Wait for verification before creating campaigns
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    The business identity is in review. Campaign creation should wait until this brand
                    reaches a verified state or comes back with a rejection reason to fix.
                  </p>
                </>
              ) : null}
              {brand.status === 'verified' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Brand approved. Move to campaign creation
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    The business identity is verified, so the next embedded onboarding step is to create
                    a campaign tied to this brand.
                  </p>
                </>
              ) : null}
              {brand.status === 'rejected' || brand.status === 'suspended' ? (
                <>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Fix the brand details and resubmit
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                    A blocking issue is preventing this brand from moving forward. Update the record using
                    the rejection feedback, then resubmit for verification.
                  </p>
                </>
              ) : null}
            </div>

            <div className="flex gap-3">
              {(brand.status === 'draft' || brand.status === 'unverified' || brand.status === 'rejected') && (
                <Button variant="outline" onClick={openEditDialog} leftIcon={<Pencil className="h-4 w-4" />}>
                  Edit Brand
                </Button>
              )}
              {brand.status === 'verified' ? (
                <Button onClick={() => navigate(`/campaigns/new?brandId=${brand.id}`)} leftIcon={<Plus className="h-4 w-4" />}>
                  Create Campaign
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Business Profile</h3>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Legal Name</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.legalName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Display Name</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.displayName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Primary Contact</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                      {[brand.firstName, brand.lastName].filter(Boolean).join(' ') || 'Not provided'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Entity Type</p>
                    <p className="mt-1 font-medium capitalize text-slate-950 dark:text-slate-50">{brand.entityType.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Provider Entity Type</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.providerEntityType || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Vertical</p>
                    <p className="mt-1 font-medium capitalize text-slate-950 dark:text-slate-50">{brand.vertical.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Provider Vertical</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.providerVertical || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">EIN</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.ein || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">EIN Issuing Country</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.einIssuingCountry || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Brand Relationship</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.brandRelationship || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Verification Score</p>
                    <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                      {brand.verificationScore ?? 'Not available'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Contact & Address</h3>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="flex items-start gap-3">
                    <Mail className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Support Email</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.email}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Support Phone</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Business Contact Email</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.businessContactEmail || 'Not provided'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Mobile Phone</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{brand.mobilePhone || 'Not provided'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 md:col-span-2">
                    <Globe className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Website</p>
                      <a href={brand.website} target="_blank" rel="noreferrer" className="mt-1 inline-block font-medium text-sky-700 hover:underline dark:text-sky-300">
                        {brand.website}
                      </a>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 md:col-span-2">
                    <MapPin className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Registered Address</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">
                        {brand.streetAddress}
                        <br />
                        {brand.city}, {brand.state} {brand.postalCode}
                        <br />
                        {brand.country}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Campaigns</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      Campaigns linked to this brand record.
                    </p>
                  </div>
                  {brand.status === 'verified' && (
                    <Button
                      variant="outline"
                      onClick={() => navigate(`/campaigns/new?brandId=${brand.id}`)}
                      leftIcon={<Plus className="h-4 w-4" />}
                    >
                      New Campaign
                    </Button>
                  )}
                </div>

                {brand.campaigns.length === 0 ? (
                  <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    {brand.status === 'verified'
                      ? 'No campaigns are linked yet. This brand is ready for the next onboarding step.'
                      : 'No campaigns are linked yet. Campaign setup begins after brand verification.'}
                  </div>
                ) : (
                  <div className="mt-6 space-y-3">
                    {brand.campaigns.map((campaign) => (
                      <button
                        key={campaign.id}
                        type="button"
                        onClick={() => navigate(`/campaigns/${campaign.id}`)}
                        className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-950 dark:text-slate-50">{campaign.name}</p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                            {campaign.useCase.replace(/_/g, ' ')}
                          </p>
                        </div>
                        <Badge variant={campaignStatusVariant[campaign.status]}>
                          {campaign.status.replace(/_/g, ' ')}
                        </Badge>
                      </button>
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
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Reference ID</p>
                      <p className="mt-1 break-all font-medium text-slate-950 dark:text-slate-50">{brand.referenceId || 'Not assigned'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Alt Business ID</p>
                      <p className="mt-1 break-all font-medium text-slate-950 dark:text-slate-50">
                        {brand.altBusinessId ? `${brand.altBusinessIdType || 'ID'}: ${brand.altBusinessId}` : 'Not assigned'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Stock Listing</p>
                      <p className="mt-1 break-all font-medium text-slate-950 dark:text-slate-50">
                        {brand.stockSymbol || brand.stockExchange ? `${brand.stockSymbol || 'N/A'} • ${brand.stockExchange || 'N/A'}` : 'Not assigned'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Created</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{formatDate(brand.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Last Updated</p>
                      <p className="mt-1 font-medium text-slate-950 dark:text-slate-50">{formatDateTime(brand.updatedAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Signalmash Brand ID</p>
                      <p className="mt-1 break-all font-medium text-slate-950 dark:text-slate-50">
                        {brand.signalmashBrandId || 'Not assigned'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Megaphone className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">TCR Brand ID</p>
                      <p className="mt-1 break-all font-medium text-slate-950 dark:text-slate-50">
                        {brand.tcrBrandId || 'Not assigned'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">IP Address</p>
                      <p className="mt-1 break-all font-medium text-slate-950 dark:text-slate-50">
                        {brand.ipAddress || 'Not assigned'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </PageShell>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Brand</DialogTitle>
            <DialogDescription>
              Update the draft or resubmittable brand details that are supported by the backend.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Legal Name</label>
              <Input value={editForm.legalName} onChange={(e) => setEditForm({ ...editForm, legalName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Display Name</label>
              <Input value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">First Name</label>
              <Input value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Last Name</label>
              <Input value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">EIN</label>
              <Input value={editForm.ein} onChange={(e) => setEditForm({ ...editForm, ein: e.target.value })} placeholder="12-3456789" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">EIN Issuing Country</label>
              <Input value={editForm.einIssuingCountry} onChange={(e) => setEditForm({ ...editForm, einIssuingCountry: e.target.value.toUpperCase() })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Entity Type</label>
              <select
                value={editForm.entityType}
                onChange={(e) => setEditForm({ ...editForm, entityType: e.target.value })}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                {entityTypeOptions.map((option) => (
                  <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Provider Entity Type</label>
              <Input value={editForm.providerEntityType} onChange={(e) => setEditForm({ ...editForm, providerEntityType: e.target.value.toUpperCase() })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Vertical</label>
              <select
                value={editForm.vertical}
                onChange={(e) => setEditForm({ ...editForm, vertical: e.target.value })}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                {verticalOptions.map((option) => (
                  <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Provider Vertical</label>
              <Input value={editForm.providerVertical} onChange={(e) => setEditForm({ ...editForm, providerVertical: e.target.value.toUpperCase() })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Brand Relationship</label>
              <select
                value={editForm.brandRelationship}
                onChange={(e) => setEditForm({ ...editForm, brandRelationship: e.target.value })}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              >
                {brandRelationshipOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Website</label>
              <Input value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone</label>
              <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mobile Phone</label>
              <Input value={editForm.mobilePhone} onChange={(e) => setEditForm({ ...editForm, mobilePhone: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Business Contact Email</label>
              <Input value={editForm.businessContactEmail} onChange={(e) => setEditForm({ ...editForm, businessContactEmail: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Street Address</label>
              <Input value={editForm.streetAddress} onChange={(e) => setEditForm({ ...editForm, streetAddress: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">City</label>
              <Input value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">State</label>
              <Input value={editForm.state} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Postal Code</label>
              <Input value={editForm.postalCode} onChange={(e) => setEditForm({ ...editForm, postalCode: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Country</label>
              <Input value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Stock Symbol</label>
              <Input value={editForm.stockSymbol} onChange={(e) => setEditForm({ ...editForm, stockSymbol: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Stock Exchange</label>
              <Input value={editForm.stockExchange} onChange={(e) => setEditForm({ ...editForm, stockExchange: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Alt Business ID</label>
              <Input value={editForm.altBusinessId} onChange={(e) => setEditForm({ ...editForm, altBusinessId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Alt Business ID Type</label>
              <Input value={editForm.altBusinessIdType} onChange={(e) => setEditForm({ ...editForm, altBusinessIdType: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reference ID</label>
              <Input value={editForm.referenceId} onChange={(e) => setEditForm({ ...editForm, referenceId: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">IP Address</label>
              <Input value={editForm.ipAddress} onChange={(e) => setEditForm({ ...editForm, ipAddress: e.target.value })} />
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
