import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  MessageSquare,
  FileText,
  CheckCircle2,
} from 'lucide-react';
import {
  CAMPAIGN_SUB_USE_CASE_VALUES,
  CAMPAIGN_USE_CASE_DESCRIPTIONS,
  CAMPAIGN_USE_CASES,
  CAMPAIGN_USE_CASES_REQUIRING_SUB_USE_CASES,
  CAMPAIGN_USE_CASE_VALUES,
} from '@signalmash-connect/shared';
import { Header } from '@/components/layout/header';
import { PageShell } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { notify } from '@/stores/notification.store';

const useCaseOptions = CAMPAIGN_USE_CASE_VALUES.map((value) => ({
  value,
  label: CAMPAIGN_USE_CASES[value],
  description: CAMPAIGN_USE_CASE_DESCRIPTIONS[value],
})) as Array<{
  value: (typeof CAMPAIGN_USE_CASE_VALUES)[number];
  label: string;
  description: string;
}>;

const subUseCaseOptions = CAMPAIGN_SUB_USE_CASE_VALUES.map((value) => ({
  value,
  label: CAMPAIGN_USE_CASES[value],
})) as Array<{
  value: (typeof CAMPAIGN_SUB_USE_CASE_VALUES)[number];
  label: string;
}>;

const useCasesRequiringSubUsecases = new Set<string>(CAMPAIGN_USE_CASES_REQUIRING_SUB_USE_CASES);

const campaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  brandId: z.string().min(1, 'Please select a verified brand'),
  useCase: z.enum(CAMPAIGN_USE_CASE_VALUES),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  messageFlow: z.string().min(10, 'Message flow must be at least 10 characters'),
  subUsecases: z.array(z.enum(CAMPAIGN_SUB_USE_CASE_VALUES)).default([]),
  referenceId: z.string().optional(),
  tags: z.string().optional(),
  privacyPolicyLink: z.string().url('Enter a valid URL').or(z.literal('')),
  termsAndConditionsLink: z.string().url('Enter a valid URL').or(z.literal('')),
  embeddedLinkSample: z.string().optional(),
  embeddedLink: z.boolean().default(false),
  embeddedPhone: z.boolean().default(false),
  affiliateMarketing: z.boolean().default(false),
  termsAndConditions: z.boolean().default(true),
  numberPool: z.boolean().default(false),
  ageGated: z.boolean().default(false),
  directLending: z.boolean().default(false),
  subscriberOptin: z.boolean().default(true),
  subscriberOptout: z.boolean().default(true),
  subscriberHelp: z.boolean().default(true),
  autoRenewal: z.boolean().default(true),
  sampleMessages: z.array(z.string().min(10, 'Sample message must be at least 10 characters')).min(1).max(5),
  optInKeywords: z.string().optional(),
  optOutKeywords: z.string().optional(),
  helpKeywords: z.string().optional(),
  optInMessage: z.string().optional(),
  optOutMessage: z.string().optional(),
  helpMessage: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.useCase === 'mixed' && value.subUsecases.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['subUsecases'],
      message: 'Select at least 2 sub-use-cases for a mixed campaign',
    });
  }

  if (value.useCase === 'low_volume' && value.subUsecases.length < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['subUsecases'],
      message: 'Select at least 1 sub-use-case for a low-volume campaign',
    });
  }
});

type CampaignForm = z.infer<typeof campaignSchema>;

interface Brand {
  id: string;
  displayName: string;
  legalName: string;
  status: string;
}

const selectClassName =
  'h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50';

export function NewCampaignPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedBrandId = searchParams.get('brandId') || '';

  const [brands, setBrands] = useState<Brand[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sampleMessages, setSampleMessages] = useState<string[]>(['']);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CampaignForm>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      brandId: preselectedBrandId,
      useCase: 'marketing',
      messageFlow: '',
      subUsecases: [],
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
      sampleMessages: [''],
      optInKeywords: 'START, YES, SUBSCRIBE',
      optOutKeywords: 'STOP, UNSUBSCRIBE, CANCEL',
      helpKeywords: 'HELP, INFO',
      optInMessage: 'You have been subscribed to receive messages. Reply STOP to unsubscribe.',
      optOutMessage: 'You have been unsubscribed and will no longer receive messages from us.',
      helpMessage: 'For assistance, please contact support@example.com',
    },
  });

  const selectedUseCase = watch('useCase');
  const selectedSubUsecases = watch('subUsecases') ?? [];
  const requiresSubUsecases = useCasesRequiringSubUsecases.has(selectedUseCase);
  const minimumSubUsecases = selectedUseCase === 'mixed' ? 2 : requiresSubUsecases ? 1 : 0;

  useEffect(() => {
    const loadBrands = async () => {
      try {
        const response = await api.getBrands();
        if (response.success && response.data) {
          setBrands(response.data.filter((brand: Brand) => brand.status === 'verified'));
        }
      } catch (error) {
        console.error('Failed to load brands:', error);
      }
    };

    loadBrands();
  }, []);

  useEffect(() => {
    setValue('sampleMessages', sampleMessages.filter((message) => message.trim().length > 0));
  }, [sampleMessages, setValue]);

  useEffect(() => {
    if (!requiresSubUsecases) {
      setValue('subUsecases', []);
    }
  }, [requiresSubUsecases, setValue]);

  const updateSampleMessage = (index: number, value: string) => {
    const next = [...sampleMessages];
    next[index] = value;
    setSampleMessages(next);
  };

  const toggleSubUsecase = (value: (typeof CAMPAIGN_SUB_USE_CASE_VALUES)[number]) => {
    const next = selectedSubUsecases.includes(value)
      ? selectedSubUsecases.filter((item) => item !== value)
      : [...selectedSubUsecases, value];

    setValue('subUsecases', next, { shouldValidate: true });
  };

  const addSampleMessage = () => {
    if (sampleMessages.length < 5) {
      setSampleMessages([...sampleMessages, '']);
    }
  };

  const removeSampleMessage = (index: number) => {
    if (sampleMessages.length > 1) {
      setSampleMessages(sampleMessages.filter((_, messageIndex) => messageIndex !== index));
    }
  };

  const onSubmit = async (data: CampaignForm) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await api.createCampaign({
        name: data.name,
        brandId: data.brandId,
        useCase: data.useCase,
        description: data.description,
        subUsecases: requiresSubUsecases ? data.subUsecases : [],
        embeddedLink: data.embeddedLink,
        embeddedPhone: data.embeddedPhone,
        affiliateMarketing: data.affiliateMarketing,
        termsAndConditions: data.termsAndConditions,
        numberPool: data.numberPool,
        ageGated: data.ageGated,
        directLending: data.directLending,
        subscriberOptin: data.subscriberOptin,
        subscriberOptout: data.subscriberOptout,
        subscriberHelp: data.subscriberHelp,
        sampleMessages: data.sampleMessages,
        messageFlow: data.messageFlow,
        referenceId: data.referenceId || undefined,
        tags: data.tags?.split(',').map((value) => value.trim()).filter(Boolean),
        autoRenewal: data.autoRenewal,
        optInKeywords: data.optInKeywords?.split(',').map((value) => value.trim()).filter(Boolean),
        optOutKeywords: data.optOutKeywords?.split(',').map((value) => value.trim()).filter(Boolean),
        helpKeywords: data.helpKeywords?.split(',').map((value) => value.trim()).filter(Boolean),
        optInMessage: data.optInMessage,
        optOutMessage: data.optOutMessage,
        helpMessage: data.helpMessage,
        privacyPolicyLink: data.privacyPolicyLink || undefined,
        termsAndConditionsLink: data.termsAndConditionsLink || undefined,
        embeddedLinkSample: data.embeddedLinkSample || undefined,
      });

      if (response.success && response.data) {
        notify.success('Campaign created', 'The campaign draft was created successfully.');
        navigate(`/campaigns/${response.data.id}`);
        return;
      }

      setSubmitError(response.error?.message || 'Failed to create campaign');
    } catch (error) {
      console.error('Failed to create campaign:', error);
      notify.error('Unable to create campaign', 'Check the campaign details and try again.');
      setSubmitError('An unexpected error occurred while creating the campaign.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <Header
        title="Create Campaign"
        subtitle="Set up a campaign using the actual backend approval schema."
      />

      <PageShell contentClassName="max-w-5xl gap-6">
        <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-2">
              <Badge variant="outline" className="w-fit border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                Campaign Setup
              </Badge>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Build a campaign that matches compliance and approval requirements
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                This screen now only exposes supported use cases and fields that the backend
                actually accepts for campaign creation and Signalmash submission.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Verified Brands Available</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-slate-50">{brands.length}</p>
            </div>
          </div>
        </section>

        {brands.length === 0 && (
          <Card className="border-border bg-accent shadow-card">
            <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <Badge variant="warning" className="w-fit">Blocked</Badge>
                <h3 className="text-lg font-semibold text-foreground">
                  Campaign creation is blocked until a brand is verified
                </h3>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  The embedded rollout cannot continue from brand setup into campaign setup until at least
                  one business brand is verified. Register the brand first, submit it, and return here after approval.
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => navigate('/brands')}>
                  Review Brands
                </Button>
                <Button onClick={() => navigate('/brands/new')}>
                  Register Brand
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <CardContent className="p-6 sm:p-8">
            {submitError && (
              <div className="mb-6 flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
              <section className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Campaign Basics</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Tie the campaign to a verified brand and define the approved messaging intent.
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Campaign Name</label>
                    <Input {...register('name')} error={errors.name?.message} placeholder="Spring Customer Updates" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Verified Brand</label>
                    <select {...register('brandId')} className={selectClassName}>
                      <option value="">Select a verified brand</option>
                      {brands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.displayName} ({brand.legalName})
                        </option>
                      ))}
                    </select>
                    {errors.brandId && <p className="text-sm text-destructive">{errors.brandId.message}</p>}
                    {brands.length === 0 && (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        No verified brands are available yet. Register and verify a brand first.
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Use Case</label>
                  <div className="grid gap-3 md:grid-cols-2">
                    {useCaseOptions.map((useCase) => (
                      <label
                        key={useCase.value}
                        className={`cursor-pointer rounded-2xl border px-4 py-4 transition ${
                          selectedUseCase === useCase.value
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <input type="radio" value={useCase.value} {...register('useCase')} className="sr-only" />
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium">{useCase.label}</p>
                            <p className="mt-1 text-sm opacity-80">{useCase.description}</p>
                          </div>
                          {selectedUseCase === useCase.value && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                        </div>
                      </label>
                    ))}
                  </div>
                  {errors.useCase && <p className="text-sm text-destructive">{errors.useCase.message}</p>}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Sub-usecases</label>
                  {requiresSubUsecases ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        {subUseCaseOptions.map((option) => {
                          const checked = selectedSubUsecases.includes(option.value);

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
                                onChange={() => toggleSubUsecase(option.value)}
                                className="sr-only"
                              />
                              <div className="flex items-center justify-between gap-4">
                                <span className="font-medium">{option.label}</span>
                                {checked ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : null}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Select at least {minimumSubUsecases} sub-use-case{minimumSubUsecases === 1 ? '' : 's'} for this campaign type.
                      </p>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                      Standard campaign types are submitted under their primary use case automatically. Sub-use-cases are only required for low-volume and mixed campaigns.
                    </div>
                  )}
                  {errors.subUsecases && <p className="text-sm text-destructive">{errors.subUsecases.message}</p>}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
                  <textarea
                    {...register('description')}
                    className="min-h-[110px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    placeholder="Describe the messaging purpose, subscriber relationship, and expected campaign behavior."
                  />
                  {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Message Flow</label>
                  <textarea
                    {...register('messageFlow')}
                    className="min-h-[110px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    placeholder="Describe how users opt in, where consent is captured, and how messages are triggered."
                  />
                  {errors.messageFlow && <p className="text-sm text-destructive">{errors.messageFlow.message}</p>}
                </div>
              </section>

              <section className="space-y-5 border-t border-slate-200 pt-8 dark:border-slate-800">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
                    <MessageSquare className="h-5 w-5" />
                    Sample Messages
                  </h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Provide up to five realistic examples that reflect the messages subscribers will receive.
                  </p>
                </div>

                <div className="space-y-4">
                  {sampleMessages.map((message, index) => (
                    <div key={index} className="flex gap-3">
                      <textarea
                        value={message}
                        onChange={(event) => updateSampleMessage(index, event.target.value)}
                        className="min-h-[96px] flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                        placeholder={`Sample message ${index + 1}. Include realistic wording and opt-out language when appropriate.`}
                      />
                      {sampleMessages.length > 1 && (
                        <Button type="button" variant="outline" onClick={() => removeSampleMessage(index)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                  {errors.sampleMessages && (
                    <p className="text-sm text-destructive">
                      {errors.sampleMessages.message}
                    </p>
                  )}
                </div>

                {sampleMessages.length < 5 && (
                  <Button type="button" variant="outline" onClick={addSampleMessage}>
                    Add Sample Message
                  </Button>
                )}
              </section>

              <section className="space-y-5 border-t border-slate-200 pt-8 dark:border-slate-800">
                <div>
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Registry Controls</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Optional registry metadata and links used in the provider submission payload.
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Reference ID</label>
                    <Input {...register('referenceId')} placeholder="Optional external reference" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Tags</label>
                    <Input {...register('tags')} placeholder="Comma-separated tags" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Embedded Link Sample</label>
                    <Input {...register('embeddedLinkSample')} placeholder="Example link included in messages" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Privacy Policy Link</label>
                    <Input {...register('privacyPolicyLink')} placeholder="https://example.com/privacy" />
                    {errors.privacyPolicyLink && <p className="text-sm text-destructive">{errors.privacyPolicyLink.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Terms & Conditions Link</label>
                    <Input {...register('termsAndConditionsLink')} placeholder="https://example.com/terms" />
                    {errors.termsAndConditionsLink && <p className="text-sm text-destructive">{errors.termsAndConditionsLink.message}</p>}
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
                    <label key={field} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                      <input type="checkbox" {...register(field as keyof CampaignForm)} className="h-4 w-4 rounded border-slate-300" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="space-y-5 border-t border-slate-200 pt-8 dark:border-slate-800">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
                    <FileText className="h-5 w-5" />
                    Compliance Settings
                  </h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Set the standard keywords and auto-replies used for compliance handling.
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Opt-In Keywords</label>
                    <Input {...register('optInKeywords')} placeholder="START, YES, SUBSCRIBE" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Opt-Out Keywords</label>
                    <Input {...register('optOutKeywords')} placeholder="STOP, UNSUBSCRIBE, CANCEL" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Help Keywords</label>
                    <Input {...register('helpKeywords')} placeholder="HELP, INFO" />
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Opt-In Message</label>
                    <Input {...register('optInMessage')} placeholder="You have been subscribed..." />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Opt-Out Message</label>
                    <Input {...register('optOutMessage')} placeholder="You have been unsubscribed..." />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Help Message</label>
                    <Input {...register('helpMessage')} placeholder="For assistance, contact support@example.com" />
                  </div>
                </div>
              </section>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-50">Before you submit</h4>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  <li>Only verified brands can be attached to new campaigns.</li>
                  <li>Use cases must match approved 10DLC categories exposed by the backend.</li>
                  <li>Sample messages should be real and consistent with subscriber consent.</li>
                </ul>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 pt-6 dark:border-slate-800">
                <Button type="button" variant="ghost" onClick={() => navigate('/campaigns')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
                  Cancel
                </Button>

                <Button type="submit" isLoading={isSubmitting} disabled={brands.length === 0} rightIcon={<ArrowRight className="h-4 w-4" />}>
                  Create Campaign
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </PageShell>
    </div>
  );
}
