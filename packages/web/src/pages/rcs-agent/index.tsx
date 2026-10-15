import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Globe,
  Mail,
  Palette,
  Phone,
  RefreshCw,
  Rocket,
  Send,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { PageShell, PageSection } from '@/components/layout/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { notify } from '@/stores/notification.store';

type AgentStatus = 'draft' | 'submitted' | 'ready_for_testing' | 'in_testing' | 'pending_launch' | 'live' | 'suspended' | 'rejected';

interface RcsAgent {
  id: string;
  status: AgentStatus;
  senderName: string;
  displayName: string;
  description: string;
  logoUrl: string;
  bannerUrl: string;
  color: string;
  billingCategory: string;
  useCase: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  simplyrcsSenderIdId: string | null;
  providerStatus: string | null;
  providerMessage: string | null;
  lastSubmissionError: string | null;
  testDevices: Array<{ phoneNumber: string; status: string }> | null;
  submittedAt: string | null;
  launchedAt: string | null;
  lastStatusSyncedAt: string | null;
}

interface RcsStats {
  rcs: { sent: number; delivered: number; read: number; failed: number };
  sms: { sent: number; delivered: number; failed: number };
  fallbackReasons: Array<{ reason: string; count: number }>;
  capability: { checked: number; capable: number };
}

const agentSchema = z.object({
  senderName: z.string().min(2, 'Sender name is required').max(60).regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, dashes and underscores only'),
  displayName: z.string().min(2, 'Display name is required').max(100),
  description: z.string().min(20, 'Describe the business in at least 20 characters').max(1000),
  logoUrl: z.string().url('Enter the logo image URL'),
  bannerUrl: z.string().url('Enter the banner image URL'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Hex colour such as #2FB267'),
  billingCategory: z.enum(['CONVERSATIONAL', 'NON_CONVERSATIONAL']),
  useCase: z.enum(['MULTI_USE', 'TRANSACTIONAL', 'PROMOTIONAL', 'OTP']),
  phone: z.string().optional(),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  website: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  privacyUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  termsUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
});

type AgentForm = z.infer<typeof agentSchema>;

const STEPS: Array<{ key: AgentStatus[]; title: string; helper: string }> = [
  { key: ['draft', 'rejected'], title: 'Agent profile', helper: 'Name, logo, banner, colour, and contact links.' },
  { key: ['submitted', 'ready_for_testing'], title: 'Review', helper: 'SimplyRCS checks the profile and Google provisions it.' },
  { key: ['in_testing'], title: 'Testing', helper: 'Send to invited test phones before launch.' },
  { key: ['pending_launch', 'live'], title: 'Live', helper: 'Customers receive branded RCS; SMS stays the fallback.' },
];

const STATUS_LABELS: Record<AgentStatus, { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive' | 'info' }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  submitted: { label: 'Submitted', variant: 'warning' },
  ready_for_testing: { label: 'Ready for testing', variant: 'info' },
  in_testing: { label: 'In testing', variant: 'info' },
  pending_launch: { label: 'Launch pending', variant: 'warning' },
  live: { label: 'Live', variant: 'success' },
  suspended: { label: 'Suspended', variant: 'destructive' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

const stepIndexFor = (status: AgentStatus) => Math.max(0, STEPS.findIndex((step) => step.key.includes(status)));

export function RcsAgentPage() {
  const [agent, setAgent] = useState<RcsAgent | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [stats, setStats] = useState<RcsStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [existingAgents, setExistingAgents] = useState<Array<{ senderName: string; displayName: string | null; status: string | null; hasSenderId: boolean }>>([]);
  const [existingChoice, setExistingChoice] = useState('');

  const form = useForm<AgentForm>({
    resolver: zodResolver(agentSchema),
    defaultValues: { senderName: '', displayName: '', description: '', logoUrl: '', bannerUrl: '', color: '#2FB267', billingCategory: 'CONVERSATIONAL', useCase: 'MULTI_USE', phone: '', email: '', website: '', privacyUrl: '', termsUrl: '' },
  });

  const load = useCallback(async () => {
    try {
      const [agentResponse, statsResponse] = await Promise.all([api.getRcsAgent(), api.getRcsStats().catch(() => null)]);
      if (agentResponse.success && agentResponse.data) {
        setAgent(agentResponse.data.agent);
        setProviderConfigured(agentResponse.data.providerConfigured);
        const current = agentResponse.data.agent as RcsAgent | null;
        if (current) {
          form.reset({
            senderName: current.senderName,
            displayName: current.displayName,
            description: current.description,
            logoUrl: current.logoUrl,
            bannerUrl: current.bannerUrl,
            color: current.color,
            billingCategory: current.billingCategory as AgentForm['billingCategory'],
            useCase: current.useCase as AgentForm['useCase'],
            phone: current.phone ?? '',
            email: current.email ?? '',
            website: current.website ?? '',
            privacyUrl: current.privacyUrl ?? '',
            termsUrl: current.termsUrl ?? '',
          });
        }
      }
      if (statsResponse?.success) setStats(statsResponse.data);
      const current = agentResponse.success ? (agentResponse.data?.agent as RcsAgent | null) : null;
      if (!current || current.status === 'draft' || current.status === 'rejected') {
        const available = await api.listAvailableRcsAgents().catch(() => null);
        setExistingAgents(available?.success && available.data ? available.data.filter((item) => item.hasSenderId) : []);
      } else {
        setExistingAgents([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the RCS agent');
    } finally {
      setIsLoading(false);
    }
  }, [form]);

  useEffect(() => { void load(); }, [load]);

  const run = async (name: string, action: () => Promise<{ success: boolean; message?: string }>, successTitle: string, successText: string) => {
    setBusy(name);
    setError(null);
    try {
      const response = await action();
      if (response.success) notify.success(successTitle, successText);
      await load();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'The request failed';
      setError(message);
      notify.error(`${successTitle} failed`, message);
    } finally {
      setBusy(null);
    }
  };

  const onSave = form.handleSubmit((values) => run('save', () => api.saveRcsAgent(values), 'Agent saved', 'Submit it for review when the profile is complete.'));

  const status = agent?.status ?? 'draft';
  const stepIndex = useMemo(() => stepIndexFor(status), [status]);
  const editable = !agent || status === 'draft' || status === 'rejected';
  const rcsShare = stats && stats.rcs.sent + stats.sms.sent > 0 ? Math.round((stats.rcs.sent / (stats.rcs.sent + stats.sms.sent)) * 100) : null;

  return (
    <>
      <Header title="RCS Agent" subtitle="Your verified business profile for RCS. Messages fall back to SMS until it is live." />
      <PageShell contentClassName="max-w-6xl gap-6">
        <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Badge variant="outline" className="border-slate-300 text-slate-600">RCS Agent</Badge>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Branded messaging with SMS as the safety net</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                In RCS your customers see your name, logo and a verified tick instead of a phone number. Register the agent once; every message then tries RCS first and uses your 10DLC number when the phone cannot receive RCS.
              </p>
            </div>
            <div className="grid min-w-[280px] gap-3 sm:grid-cols-3">
              {[
                { label: 'RCS delivered', value: stats ? stats.rcs.delivered : '—' },
                { label: 'Sent as SMS', value: stats ? stats.sms.sent : '—' },
                { label: 'RCS share', value: rcsShare === null ? '—' : `${rcsShare}%` },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-950">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {!providerConfigured && (
          <Card className="border-border bg-accent shadow-card">
            <CardContent className="flex flex-col gap-3 p-6 md:flex-row md:items-center md:justify-between">
              <div>
                <Badge variant="warning">Provider not configured</Badge>
                <h3 className="mt-2 text-lg font-semibold">SimplyRCS is not connected yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">You can prepare the agent profile now. Submitting it needs the SimplyRCS API key, which an administrator sets in Runtime Settings.</p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          {STEPS.map((step, index) => {
            const complete = index < stepIndex || status === 'live';
            const active = index === stepIndex && status !== 'live';
            return (
              <div key={step.title} className={`rounded-2xl border px-4 py-4 ${active ? 'border-slate-900 bg-slate-900 text-white' : complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                <div className="flex items-center gap-3">
                  <span className={`rounded-xl p-2 ${active ? 'bg-white/10' : 'bg-white/60'}`}>{complete ? <CheckCircle2 className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}</span>
                  <div>
                    <p className="text-sm font-semibold">{step.title}</p>
                    <p className="text-xs opacity-80">Step {index + 1}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 opacity-90">{step.helper}</p>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-6 sm:p-8">
              <div className="mb-8 max-w-2xl">
                <h3 className="text-xl font-semibold text-slate-950">{editable ? 'Agent profile' : 'Agent profile (locked during review)'}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">What customers see at the top of the conversation. Use the business's real name, logo and links; Google checks them against the website.</p>
              </div>
              <form onSubmit={onSave} className="space-y-8">
                <div className="space-y-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Identity</p>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label="Sender name" required error={form.formState.errors.senderName?.message} help="Internal id, no spaces. Example: signalmash-support">
                      <Input {...form.register('senderName')} placeholder="signalmash-support" disabled={!editable} />
                    </Field>
                    <Field label="Display name" required error={form.formState.errors.displayName?.message} help="Shown to customers.">
                      <Input {...form.register('displayName')} placeholder="Signalmash" disabled={!editable} />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="Description" required error={form.formState.errors.description?.message}>
                        <textarea {...form.register('description')} disabled={!editable} rows={3} className="min-h-[90px] w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50" placeholder="What the business does and what customers will hear from you." />
                      </Field>
                    </div>
                    <Field label="Logo image URL" required error={form.formState.errors.logoUrl?.message} help="Square PNG, at least 224×224.">
                      <Input {...form.register('logoUrl')} placeholder="https://cdn.example.com/logo.png" disabled={!editable} />
                    </Field>
                    <Field label="Banner image URL" required error={form.formState.errors.bannerUrl?.message} help="1440×448 PNG or JPG.">
                      <Input {...form.register('bannerUrl')} placeholder="https://cdn.example.com/banner.png" disabled={!editable} />
                    </Field>
                    <Field label="Brand colour" required error={form.formState.errors.color?.message}>
                      <div className="flex items-center gap-3">
                        <Input {...form.register('color')} placeholder="#2FB267" disabled={!editable} leftIcon={<Palette className="h-4 w-4" />} />
                        <span className="h-10 w-10 shrink-0 rounded-xl border border-slate-200" style={{ background: form.watch('color') || '#ffffff' }} />
                      </div>
                    </Field>
                    <Field label="Use case" required>
                      <select {...form.register('useCase')} disabled={!editable} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50">
                        <option value="MULTI_USE">Multi-use (notifications and promotions)</option>
                        <option value="TRANSACTIONAL">Transactional only</option>
                        <option value="PROMOTIONAL">Promotional only</option>
                        <option value="OTP">One-time passcodes</option>
                      </select>
                    </Field>
                    <Field label="Conversation type" required help="Conversational agents can reply to customers; non-conversational only notify.">
                      <select {...form.register('billingCategory')} disabled={!editable} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50">
                        <option value="CONVERSATIONAL">Conversational</option>
                        <option value="NON_CONVERSATIONAL">Non-conversational</option>
                      </select>
                    </Field>
                  </div>
                </div>

                <div className="space-y-5 border-t border-slate-200 pt-8">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Contact and legal links</p>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label="Support phone" error={form.formState.errors.phone?.message}><Input {...form.register('phone')} placeholder="+15551234567" disabled={!editable} leftIcon={<Phone className="h-4 w-4" />} /></Field>
                    <Field label="Support email" error={form.formState.errors.email?.message}><Input {...form.register('email')} placeholder="support@example.com" disabled={!editable} leftIcon={<Mail className="h-4 w-4" />} /></Field>
                    <Field label="Website" error={form.formState.errors.website?.message}><Input {...form.register('website')} placeholder="https://example.com" disabled={!editable} leftIcon={<Globe className="h-4 w-4" />} /></Field>
                    <Field label="Privacy policy URL" error={form.formState.errors.privacyUrl?.message}><Input {...form.register('privacyUrl')} placeholder="https://example.com/privacy" disabled={!editable} /></Field>
                    <Field label="Terms of service URL" error={form.formState.errors.termsUrl?.message}><Input {...form.register('termsUrl')} placeholder="https://example.com/terms" disabled={!editable} /></Field>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">{agent ? `Last saved ${new Date(agent.lastStatusSyncedAt ?? agent.submittedAt ?? Date.now()).toLocaleString()}` : 'Not saved yet'}</p>
                  <div className="flex gap-3">
                    {editable && <Button type="submit" variant="outline" isLoading={busy === 'save'}>Save profile</Button>}
                    {editable && agent && (
                      <Button type="button" rightIcon={<Send className="h-4 w-4" />} isLoading={busy === 'submit'} disabled={!providerConfigured} onClick={() => run('submit', () => api.submitRcsAgent(), 'Agent submitted', 'SimplyRCS will review the profile; check back here for the status.')}>
                        Submit for review
                      </Button>
                    )}
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {editable && existingAgents.length > 0 && (
              <Card className="border-primary/30 bg-primary/5 shadow-sm">
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950">Already have an agent?</h3>
                  <p className="mt-1 text-sm text-slate-600">Agents that exist on your SimplyRCS account can be used here without a new review. Its profile and test devices are pulled in.</p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <select value={existingChoice} onChange={(event) => setExistingChoice(event.target.value)} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20">
                      <option value="">Choose an agent</option>
                      {existingAgents.map((item) => (
                        <option key={item.senderName} value={item.senderName}>{item.displayName ? `${item.displayName} (${item.senderName})` : item.senderName}{item.status ? ` – ${item.status.toLowerCase().replace(/_/g, ' ')}` : ''}</option>
                      ))}
                    </select>
                    <Button type="button" isLoading={busy === 'link'} disabled={!existingChoice} onClick={() => run('link', () => api.linkRcsAgent(existingChoice), 'Agent linked', 'Messages to approved test devices now go as RCS; everything else stays SMS until launch.')}>Use this agent</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">Status</h3>
                    <p className="mt-1 text-sm text-slate-600">Where the agent is in the approval path.</p>
                  </div>
                  <Badge variant={STATUS_LABELS[status].variant} dot>{STATUS_LABELS[status].label}</Badge>
                </div>
                <div className="mt-5 space-y-3 text-sm">
                  <Row label="Provider status" value={agent?.providerStatus ?? 'not submitted'} />
                  <Row label="Sender id" value={agent?.simplyrcsSenderIdId ?? 'n/a'} mono />
                  <Row label="Submitted" value={agent?.submittedAt ? new Date(agent.submittedAt).toLocaleString() : 'n/a'} />
                  <Row label="Live since" value={agent?.launchedAt ? new Date(agent.launchedAt).toLocaleString() : 'n/a'} />
                </div>
                {(agent?.providerMessage || agent?.lastSubmissionError) && (
                  <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{agent.providerMessage ?? agent.lastSubmissionError}</div>
                )}
                {agent && !editable && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" leftIcon={<RefreshCw className="h-4 w-4" />} isLoading={busy === 'refresh'} onClick={() => run('refresh', () => api.refreshRcsAgent(), 'Status refreshed', 'The latest provider state was loaded.')}>Refresh</Button>
                    {(status === 'in_testing' || status === 'ready_for_testing') && (
                      <Button size="sm" leftIcon={<Rocket className="h-4 w-4" />} isLoading={busy === 'launch'} onClick={() => run('launch', () => api.launchRcsAgent(), 'Launch requested', 'The agent goes live once the provider confirms.')}>Request launch</Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {agent && !editable && (
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold text-slate-950">Test devices</h3>
                  <p className="mt-1 text-sm text-slate-600">Phones that can receive the agent's messages before launch. Each gets an invite to accept; approved phones already get RCS from this app.</p>
                  <div className="mt-4 flex gap-2">
                    <Input value={testPhone} onChange={(event) => setTestPhone(event.target.value)} placeholder="+15551234567" leftIcon={<Smartphone className="h-4 w-4" />} />
                    <Button variant="outline" isLoading={busy === 'device'} disabled={!testPhone.trim()} onClick={() => run('device', () => api.addRcsTestDevice(testPhone.trim()), 'Test device invited', 'Accept the invite on the phone, then send a test message.').then(() => setTestPhone(''))}>Invite</Button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {(agent.testDevices ?? []).length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">No test devices yet.</p>}
                    {(agent.testDevices ?? []).map((device) => (
                      <div key={device.phoneNumber} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                        <span className="font-mono">{device.phoneNumber}</span>
                        <Badge variant={device.status === 'ACCEPTED' || device.status === 'APPROVED' ? 'success' : 'warning'}>{device.status.toLowerCase().replace(/_/g, ' ')}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="text-lg font-semibold text-slate-950">How routing works</h3></div>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <li>Each recipient's phone is checked once a week for RCS support.</li>
                  <li>RCS-capable phones get the branded message; everyone else gets the same text as SMS from your 10DLC number.</li>
                  <li>If RCS rejects a message, it is re-sent as SMS in the same moment.</li>
                  <li>Replies and button taps land in your CRM inbox like any text.</li>
                </ul>
                {stats && stats.fallbackReasons.length > 0 && (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
                    <p className="font-semibold uppercase tracking-[0.16em] text-slate-400">Why messages went as SMS (30 days)</p>
                    {stats.fallbackReasons.map((row) => <p key={row.reason} className="mt-2 flex justify-between"><span>{row.reason.replace(/_/g, ' ')}</span><span className="font-medium text-slate-950">{row.count}</span></p>)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
        {isLoading && <PageSection className="p-6 text-sm text-slate-500">Loading RCS agent...</PageSection>}
      </PageShell>
    </>
  );
}

function Field({ label, required, help, error, children }: { label: string; required?: boolean; help?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700">{label}{required && <span className="text-destructive"> *</span>}</label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : help ? <p className="text-xs text-slate-500">{help}</p> : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium text-slate-950 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}
