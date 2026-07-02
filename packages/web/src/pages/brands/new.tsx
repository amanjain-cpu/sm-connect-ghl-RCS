import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Building2,
  CheckCircle2,
  Globe,
  Landmark,
  Mail,
  MapPin,
  Phone,
  Users,
} from 'lucide-react';
import {
  SIGNALMASH_PROVIDER_VERTICAL_LABELS,
  SIGNALMASH_PROVIDER_VERTICALS,
} from '@signalmash-connect/shared';
import { Header } from '@/components/layout/header';
import { PageShell } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { notify } from '@/stores/notification.store';

const legalForms = [
  { value: 'publicly_traded_company', label: 'Publicly Traded Company' },
  { value: 'private_company', label: 'Private Company' },
  { value: 'non_profit_organization', label: 'Non-Profit Organization' },
  { value: 'government', label: 'Government' },
  { value: 'sole_proprietor', label: 'Sole Proprietor' },
  { value: 'platform_free_trial', label: 'Platform Free Trial' },
] as const;

const providerVerticalOptions = SIGNALMASH_PROVIDER_VERTICALS.map((value) => ({
  value,
  label: SIGNALMASH_PROVIDER_VERTICAL_LABELS[value],
})) as Array<{
  value: (typeof SIGNALMASH_PROVIDER_VERTICALS)[number];
  label: string;
}>;

const identifierTypes = [
  { value: 'duns', label: 'DUNS' },
  { value: 'giin', label: 'GIIN' },
  { value: 'lei', label: 'LEI' },
] as const;

const brandRelationshipOptions = [
  { value: 'BASIC_ACCOUNT', label: 'BASIC_ACCOUNT', description: 'No business history with the CSP' },
  { value: 'SMALL_ACCOUNT', label: 'SMALL_ACCOUNT', description: 'Some business history with the CSP' },
  { value: 'MEDIUM_ACCOUNT', label: 'MEDIUM_ACCOUNT', description: 'Good standing with the CSP and solid business history' },
  { value: 'LARGE_ACCOUNT', label: 'LARGE_ACCOUNT', description: 'Dedicated account manager and highly trusted relationship' },
  { value: 'KEY_ACCOUNT', label: 'KEY_ACCOUNT', description: 'Strategic value with a dedicated account team' },
] as const;

type CountryOption = {
  value: string;
  label: string;
};

const fallbackCountryCodes = [
  'US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'LU', 'CH', 'AT',
  'SE', 'NO', 'DK', 'FI', 'IS', 'PT', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'CY', 'MT',
  'EE', 'LV', 'LT', 'SI', 'HR', 'JP', 'SG', 'IN', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'IL',
  'ZA', 'NG', 'KE', 'EG', 'MA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'UY', 'CR', 'PA', 'DO',
  'GT', 'SV', 'HN', 'NI', 'BZ', 'JM', 'TT', 'KR', 'HK', 'TW', 'MY', 'TH', 'PH', 'ID', 'VN',
  'PK', 'BD', 'LK', 'NP',
] as const;

const countryNameFormatter =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

const countryCodes = [...fallbackCountryCodes];

const countries: CountryOption[] = countryCodes
  .map((code: string) => ({
    value: code,
    label: countryNameFormatter?.of(code) ?? code,
  }))
  .sort((a: CountryOption, b: CountryOption) => a.label.localeCompare(b.label));

const formSchema = z.object({
  legalCompanyName: z.string().min(1, 'Legal company name is required'),
  dbaBrandName: z.string().optional(),
  legalForm: z.enum(legalForms.map((item) => item.value) as [string, ...string[]]),
  registrationCountry: z.string().min(2, 'Country of registration is required'),
  taxNumber: z.string().min(1, 'Tax Number/ID/EIN is required'),
  taxIssuingCountry: z.string().optional(),
  businessIdentifierType: z.enum(identifierTypes.map((item) => item.value) as [string, ...string[]]).optional(),
  businessIdentifierValue: z.string().optional(),
  streetAddress1: z.string().min(1, 'Address/Street is required'),
  streetAddress2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(2, 'State is required').max(100),
  postalCode: z.string().min(1, 'Zip Code is required'),
  country: z.string().min(2, 'Country is required'),
  website: z.string().url('Valid website URL is required'),
  verticalType: z.enum(SIGNALMASH_PROVIDER_VERTICALS),
  referenceId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  mobilePhone: z.string().optional(),
  email: z.union([z.string().email('Valid email is required'), z.literal('')]).optional(),
  brandRelationship: z.enum(brandRelationshipOptions.map((item) => item.value) as [string, ...string[]]),
  supportEmail: z.string().email('Valid support email is required'),
  supportPhone: z.string().min(1, 'Support phone is required'),
  businessEmailAddress: z.string().email('Valid business email address is required'),
}).superRefine((data, ctx) => {
  if (data.businessIdentifierValue?.trim() && !data.businessIdentifierType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['businessIdentifierType'],
      message: 'Select DUNS, GIIN, or LEI before entering the identifier number',
    });
  }
});

type BrandForm = z.infer<typeof formSchema>;

interface PlatformConnectionPrefill {
  platform: 'leadconnector' | 'shopify' | 'hubspot' | 'salesforce' | 'zoho';
  platformAccountName?: string | null;
  metadata?: {
    address?: string;
    city?: string;
    state?: string;
    country?: string;
  } | null;
}

const steps = [
  {
    id: 1,
    title: 'Brand Details',
    description: 'Capture the organization profile, tax identity, address, and classification details.',
    icon: Building2,
    fields: [
      'legalCompanyName',
      'legalForm',
      'registrationCountry',
      'taxNumber',
      'streetAddress1',
      'city',
      'state',
      'postalCode',
      'country',
      'website',
      'verticalType',
    ] as (keyof BrandForm)[],
  },
  {
    id: 2,
    title: 'Brand Relationship',
    description: 'Capture the current trust tier and relationship history with the CSP.',
    icon: Users,
    fields: ['brandRelationship'] as (keyof BrandForm)[],
  },
  {
    id: 3,
    title: 'Contact Details',
    description: 'Provide the operational and support contact details required for the brand record.',
    icon: Landmark,
    fields: ['supportEmail', 'supportPhone', 'businessEmailAddress'] as (keyof BrandForm)[],
  },
] as const;

const legalFormToProviderEntityType: Record<BrandForm['legalForm'], 'PRIVATE_PROFIT' | 'PUBLIC_PROFIT' | 'NON_PROFIT' | 'GOVERNMENT' | 'SOLE_PROPRIETOR' | 'LLC'> = {
  publicly_traded_company: 'PUBLIC_PROFIT',
  private_company: 'PRIVATE_PROFIT',
  non_profit_organization: 'NON_PROFIT',
  government: 'GOVERNMENT',
  sole_proprietor: 'SOLE_PROPRIETOR',
  platform_free_trial: 'PRIVATE_PROFIT',
};

const selectClassName =
  'h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50';

function requiredLabel(label: string) {
  return (
    <>
      {label} <span className="text-destructive">*</span>
    </>
  );
}

export function NewBrandPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<BrandForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      country: 'US',
      registrationCountry: 'US',
      taxIssuingCountry: 'US',
      legalForm: 'private_company',
      verticalType: 'PROFESSIONAL',
      businessIdentifierType: 'duns',
      email: '',
      brandRelationship: 'BASIC_ACCOUNT',
      supportEmail: '',
      supportPhone: '',
      businessEmailAddress: '',
    },
  });

  useEffect(() => {
    const prefillOrganization = async () => {
      try {
        const [organizationResponse, connectionsResponse] = await Promise.all([
          api.getOrganization(),
          api.getPlatformConnections(),
        ]);

        const organization = organizationResponse.success ? organizationResponse.data : null;
        const crmConnection = connectionsResponse.success
          ? (connectionsResponse.data as PlatformConnectionPrefill[] | undefined)?.find(
              (connection) => connection.platform === 'leadconnector'
            ) ?? null
          : null;

        const metadata = crmConnection?.metadata ?? null;
        const orgName = organization?.name || crmConnection?.platformAccountName || '';
        const orgWebsite = organization?.website || '';
        const orgEmail = organization?.email || '';
        const orgPhone = organization?.phone || '';
        const country = metadata?.country || 'US';

        setValue('legalCompanyName', orgName);
        setValue('dbaBrandName', orgName);
        setValue('website', orgWebsite);
        setValue('supportEmail', orgEmail);
        setValue('businessEmailAddress', orgEmail);
        setValue('supportPhone', orgPhone);
        setValue('streetAddress1', metadata?.address || '');
        setValue('city', metadata?.city || '');
        setValue('state', metadata?.state || '');
        setValue('country', country);
        setValue('registrationCountry', country);
        setValue('taxIssuingCountry', country);
      } catch (error) {
        console.error('Failed to prefill organization details:', error);
      }
    };

    prefillOrganization();
  }, [setValue]);

  const onSubmit = async (data: BrandForm) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await api.createBrand({
        entityType: legalFormToProviderEntityType[data.legalForm],
        firstName: data.firstName?.trim() || undefined,
        lastName: data.lastName?.trim() || undefined,
        displayName: data.dbaBrandName?.trim() || data.legalCompanyName,
        companyName: data.legalCompanyName,
        ein: data.taxNumber.replace(/\D/g, '') || undefined,
        einIssuingCountry: data.taxIssuingCountry || data.registrationCountry,
        phone: data.supportPhone.replace(/\D/g, ''),
        street: [data.streetAddress1, data.streetAddress2].filter(Boolean).join(', '),
        city: data.city,
        state: data.state.trim().toUpperCase(),
        postalCode: data.postalCode,
        country: data.country,
        email: data.supportEmail.trim(),
        stockSymbol: 'NONE',
        stockExchange: 'NONE',
        ipAddress: '',
        brandRelationship: data.brandRelationship,
        website: data.website.trim(),
        vertical: data.verticalType,
        altBusinessId: data.businessIdentifierValue?.trim() || 'NONE',
        altBusinessIdType: data.businessIdentifierType?.toUpperCase() || 'NONE',
        referenceId: data.referenceId?.trim() || 'NONE',
        tag: [],
        mobilePhone: data.mobilePhone?.trim() || 'NONE',
        businessContactEmail: data.businessEmailAddress.trim(),
      });

      if (response.success && response.data) {
        notify.success('Brand created', 'Your brand draft was created successfully.');
        navigate(`/brands/${response.data.id}`);
        return;
      }

      setSubmitError(response.error?.message || 'Failed to create brand');
    } catch (error) {
      console.error('Failed to create brand:', error);
      notify.error('Unable to create brand', 'Check the entered details and try again.');
      setSubmitError('An unexpected error occurred while creating the brand.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = async () => {
    const step = steps[currentStep - 1];
    const isValid = step.fields.length === 0 ? true : await trigger(step.fields);
    if (isValid) {
      setCurrentStep((value) => Math.min(value + 1, steps.length));
    }
  };

  const currentStepConfig = steps[currentStep - 1];

  return (
    <div>
      <Header
        title="Register Brand"
        subtitle="Capture the compliance profile for a self-serve Signalmash brand submission."
      />

      <PageShell contentClassName="max-w-6xl gap-6">
        <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <Badge variant="outline" className="w-fit border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                Brand Registration Wizard
              </Badge>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Structured intake for production brand onboarding
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                This wizard saves the business identity, relationship tier, and operational contacts that feed
                the Signalmash brand-verification flow.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {steps.map((step) => {
                const Icon = step.icon;
                const isActive = currentStep === step.id;
                const isComplete = currentStep > step.id;

                return (
                  <div
                    key={step.id}
                    className={`rounded-2xl border px-4 py-4 ${
                      isActive
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                        : isComplete
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                          : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="inline-flex rounded-xl bg-white/10 p-2 dark:bg-black/10">
                        {isComplete ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{step.title}</p>
                        <p className="text-xs opacity-80">Step {step.id}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <CardContent className="p-6 sm:p-8">
            <div className="mb-8 max-w-2xl">
              <h3 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
                {currentStepConfig.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                {currentStepConfig.description}
              </p>
            </div>

            {submitError && (
              <div className="mb-6 flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
              {currentStep === 1 && (
                <div className="space-y-8">
                  <section className="space-y-5">
                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Company Identity</h4>
                    </div>
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Legal Company Name')}</label>
                        <Input {...register('legalCompanyName')} error={errors.legalCompanyName?.message} placeholder="Acme Holdings LLC" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">DBA Brand Name, if different from legal name</label>
                        <Input {...register('dbaBrandName')} error={errors.dbaBrandName?.message} placeholder="Acme Health" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('What type of legal form is the organization')}</label>
                        <select {...register('legalForm')} className={selectClassName}>
                          {legalForms.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {errors.legalForm && <p className="text-sm text-destructive">{errors.legalForm.message}</p>}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Country of registration')}</label>
                        <select {...register('registrationCountry')} className={selectClassName}>
                          {countries.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.value})
                            </option>
                          ))}
                        </select>
                        {errors.registrationCountry && <p className="text-sm text-destructive">{errors.registrationCountry.message}</p>}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Tax Number/ID/EIN')}</label>
                        <Input {...register('taxNumber')} error={errors.taxNumber?.message} placeholder="12-3456789" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Tax Number/ID/EIN Issuing Country</label>
                        <select {...register('taxIssuingCountry')} className={selectClassName}>
                          {countries.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.value})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">DUNS or GIIN or LEI Number Type</label>
                        <select {...register('businessIdentifierType')} className={selectClassName}>
                          {identifierTypes.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {errors.businessIdentifierType && (
                          <p className="text-sm text-destructive">{errors.businessIdentifierType.message}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">DUNS or GIIN or LEI Number</label>
                        <Input {...register('businessIdentifierValue')} error={errors.businessIdentifierValue?.message} placeholder="Identifier number" />
                      </div>
                    </div>
                  </section>

                  <section className="space-y-5 border-t border-slate-200 pt-8 dark:border-slate-800">
                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Address And Classification</h4>
                    </div>
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Address/Street')}</label>
                        <Input
                          {...register('streetAddress1')}
                          error={errors.streetAddress1?.message}
                          placeholder="100 Mission Street"
                          leftIcon={<MapPin className="h-4 w-4" />}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Address/Street</label>
                        <Input
                          {...register('streetAddress2')}
                          error={errors.streetAddress2?.message}
                          placeholder="Suite 400"
                          leftIcon={<MapPin className="h-4 w-4" />}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('City')}</label>
                        <Input {...register('city')} error={errors.city?.message} placeholder="San Francisco" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('State')}</label>
                        <Input {...register('state')} error={errors.state?.message} placeholder="CA" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Zip Code')}</label>
                        <Input {...register('postalCode')} error={errors.postalCode?.message} placeholder="94105" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Country')}</label>
                        <select {...register('country')} className={selectClassName}>
                          {countries.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.value})
                            </option>
                          ))}
                        </select>
                        {errors.country && <p className="text-sm text-destructive">{errors.country.message}</p>}
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Website/Online Presence')}</label>
                        <Input
                          {...register('website')}
                          error={errors.website?.message}
                          placeholder="https://www.acmehealth.com"
                          leftIcon={<Globe className="h-4 w-4" />}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Vertical Type')}</label>
                        <select {...register('verticalType')} className={selectClassName}>
                          {providerVerticalOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {errors.verticalType && <p className="text-sm text-destructive">{errors.verticalType.message}</p>}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Reference ID</label>
                        <Input {...register('referenceId')} error={errors.referenceId?.message} placeholder="Optional internal reference" />
                      </div>
                    </div>
                  </section>

                  <section className="space-y-5 border-t border-slate-200 pt-8 dark:border-slate-800">
                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Primary Contact Snapshot</h4>
                    </div>
                    <div className="grid gap-5 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">First Name</label>
                        <Input {...register('firstName')} error={errors.firstName?.message} placeholder="Jane" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Last Name</label>
                        <Input {...register('lastName')} error={errors.lastName?.message} placeholder="Doe" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Mobile Phone</label>
                        <Input
                          {...register('mobilePhone')}
                          error={errors.mobilePhone?.message}
                          placeholder="+1 415 555 0148"
                          leftIcon={<Phone className="h-4 w-4" />}
                        />
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-6">
                  <section className="space-y-5">
                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Relationship Tier</h4>
                    </div>

                    <div className="space-y-3">
                      {brandRelationshipOptions.map((option) => (
                        <label
                          key={option.value}
                          className="flex cursor-pointer items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-950"
                        >
                          <input
                            type="radio"
                            value={option.value}
                            {...register('brandRelationship')}
                            className="mt-1 h-4 w-4 border-slate-300 text-primary focus:ring-primary"
                          />
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">{option.label}</p>
                            <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">{option.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>

                    {errors.brandRelationship && (
                      <p className="text-sm text-destructive">{errors.brandRelationship.message}</p>
                    )}
                  </section>
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-6">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Support Email')}</label>
                      <Input
                        {...register('supportEmail')}
                        type="email"
                        error={errors.supportEmail?.message}
                        placeholder="support@acmehealth.com"
                        leftIcon={<Mail className="h-4 w-4" />}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Support Phone')}</label>
                      <Input
                        {...register('supportPhone')}
                        error={errors.supportPhone?.message}
                        placeholder="+1 415 555 0199"
                        leftIcon={<Phone className="h-4 w-4" />}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{requiredLabel('Business Email Address')}</label>
                      <Input
                        {...register('businessEmailAddress')}
                        type="email"
                        error={errors.businessEmailAddress?.message}
                        placeholder="operations@acmehealth.com"
                        leftIcon={<Mail className="h-4 w-4" />}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-50">Before you continue</h4>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  <li>The wizard prefills from your connected CRM workspace when that data is available.</li>
                  <li>Brand relationship, business contact email, and provider mappings are all persisted to the backend.</li>
                  <li>You can save a draft now, then submit the brand to Signalmash from the detail page when the record is complete.</li>
                  <li>Country of registration, tax issuing country, and operating country all support the full ISO region list.</li>
                </ul>
              </div>

              {currentStep === steps.length && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 dark:border-sky-500/30 dark:bg-sky-500/10">
                  <h4 className="text-sm font-semibold text-sky-950 dark:text-sky-100">What happens next</h4>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-sky-900/80 dark:text-sky-100/80">
                    <li>This saves the brand draft in the live backend with the provider-facing fields intact.</li>
                    <li>After review, submit the draft from the brand detail page to start Signalmash verification.</li>
                    <li>Once the brand is verified, campaign creation and approval can continue inside the same workspace.</li>
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-slate-200 pt-6 dark:border-slate-800">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={currentStep === 1 ? () => navigate('/brands') : () => setCurrentStep((value) => Math.max(1, value - 1))}
                  leftIcon={<ArrowLeft className="h-4 w-4" />}
                >
                  {currentStep === 1 ? 'Cancel' : 'Back'}
                </Button>

                {currentStep < steps.length ? (
                  <Button type="button" onClick={handleNext} rightIcon={<ArrowRight className="h-4 w-4" />}>
                    Continue
                  </Button>
                ) : (
                  <Button type="submit" isLoading={isSubmitting} rightIcon={<CheckCircle2 className="h-4 w-4" />}>
                    Create Brand Draft
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </PageShell>
    </div>
  );
}
