import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  useGetBillingOverview, useSaveBillingProfile, useCreateTimeEntry, useUpdateBillingDraft,
  useGetDocumentOverview, useRequestDocumentUpload, useCompleteDocumentUpload, useAnalyzeDocument,
  useDeleteMatterDocument, useReviewDocumentSuggestion, useUpdatePlannerItem,
  useMarkMatterDocumentReviewed,
  useGetClientUpdateOverview, useSaveClientUpdateSchedule, useCreateClientUpdateDraft,
  useUpdateClientUpdateDraft, useListMatters, useListClients, useSetDocumentClientVisibility,
  useListPortalUpdates, usePublishClientUpdate, useSendReviewedClientUpdateEmail,
  useGetPortalRequests, useCreatePortalRequest, useClosePortalRequest,
  getGetBillingOverviewQueryKey, getGetDocumentOverviewQueryKey, getGetClientUpdateOverviewQueryKey, getListPortalUpdatesQueryKey,
  getGetPortalRequestsQueryKey,
  getGetMatterDocumentFileUrl,
} from '@workspace/api-client-react';
import type { BillingProfileInput, ClientUpdateDraft, Matter, PortalRequest } from '@workspace/api-client-react';
import {
  Activity, ArrowDownToLine, ArrowRight, CalendarDays, Check, CheckCheck, Clipboard,
  Clock3, FileText, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2, UploadCloud,
  WalletCards, X, Inbox,
} from 'lucide-react';

type Tab = 'billing' | 'documents' | 'updates' | 'requests';
const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
const dateLabel = (date?: string | null) => date ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not scheduled';
const shortError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const positiveId = z.string().regex(/^[1-9]\d*$/, 'Choose a matter.');
const nonNegativeAmount = z.string().min(1, 'Enter an amount.').refine(value => Number.isFinite(Number(value)) && Number(value) >= 0, 'Enter a valid non-negative amount.');
const billingProfileFormSchema = z.object({
  matterId: positiveId,
  feeType: z.enum(['hourly', 'fixed']),
  currency: z.string().regex(/^[a-zA-Z]{3}$/, 'Use a 3-letter currency code.'),
  rate: nonNegativeAmount,
  feeDescription: z.string().max(240).refine(value => value.trim().length > 0, 'Enter a fee description.'),
  billingCycle: z.enum(['weekly', 'monthly', 'quarterly']),
  taxRate: z.string().min(1, 'Enter a tax rate.').refine(value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100, 'Enter a rate from 0 to 100.'),
  nextDraftAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the next draft date.'),
  scheduleEnabled: z.boolean(),
});
const timeEntryFormSchema = z.object({
  matterId: positiveId,
  description: z.string().max(1000).refine(value => value.trim().length > 0, 'Describe the work completed.'),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a work date.'),
  durationMinutes: z.string().min(1, 'Enter the duration.').refine(value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 1440, 'Use a whole number from 1 to 1,440.'),
  billable: z.boolean(),
});
type BillingProfileFormValues = { matterId: string; feeType: 'hourly' | 'fixed'; currency: string; rate: string; feeDescription: string; billingCycle: 'weekly' | 'monthly' | 'quarterly'; taxRate: string; nextDraftAt: string; scheduleEnabled: boolean };
type TimeEntryFormValues = { matterId: string; description: string; workDate: string; durationMinutes: string; billable: boolean };

export default function Workflows() {
  const [tab, setTab] = useState<Tab>('billing');
  const billing = useGetBillingOverview();
  const documents = useGetDocumentOverview();
  const updates = useGetClientUpdateOverview();
  const matters = useListMatters();
  const clients = useListClients();
  const qc = useQueryClient();
  const refreshBilling = () => qc.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() });
  const refreshDocuments = () => qc.invalidateQueries({ queryKey: getGetDocumentOverviewQueryKey() });
  const refreshUpdates = () => qc.invalidateQueries({ queryKey: getGetClientUpdateOverviewQueryKey() });
  const refreshRequests = () => qc.invalidateQueries({ queryKey: getGetPortalRequestsQueryKey() });

  const tabs = [
    { id: 'billing' as const, label: 'Bill drafts', icon: WalletCards, detail: 'Scheduled billing' },
    { id: 'documents' as const, label: 'Document actions', icon: FileText, detail: 'Source-backed suggestions' },
    { id: 'updates' as const, label: 'Client updates', icon: Activity, detail: 'Matter-based correspondence' },
    { id: 'requests' as const, label: 'Portal requests', icon: Inbox, detail: 'Client response workflow' },
  ];
  return <div data-testid="page-workflows">
    <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
      <div><div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#987747]">Matter operations / assisted, never automatic</div>
        <h1 className="serif text-3xl font-bold md:text-[38px]" data-testid="text-page-title">Workflow center</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#72807f]">Keep routine matter work moving. Every bill, calendar suggestion, and client update stays in draft until a professional reviews it.</p>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-[#dcd7ca] bg-[#fbfaf5] px-3 py-2.5 text-xs text-[#5f716d]" data-testid="notice-manual-review"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#e7eee8] text-[#4c735f]"><CheckCheck className="h-3.5 w-3.5" /></span> Nothing is sent or synced automatically</div>
    </div>
    <div className="mb-7 grid grid-cols-3 gap-2 border-b border-[#ded9cd] sm:flex sm:gap-1" role="tablist" aria-label="Workflow types">
      {tabs.map(({ id, label, icon: Icon, detail }) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-workflow-${id}`}
        className={`flex min-w-0 items-center gap-2 border-b-2 px-3 py-3 text-left transition sm:px-5 ${tab === id ? 'border-[#a77e47] text-[#294651]' : 'border-transparent text-[#78837f] hover:text-[#294651]'}`}>
        <Icon className="h-4 w-4 shrink-0" /><span><span className="block text-xs font-bold sm:text-sm">{label}</span><span className="hidden text-[10px] text-[#929993] sm:block">{detail}</span></span>
      </button>)}
    </div>
    {tab === 'billing' && <BillingPanel overview={billing.data} isLoading={billing.isLoading} error={billing.isError ? shortError(billing.error) : ''} retry={() => billing.refetch()} matters={matters.data || []} refresh={refreshBilling} />}
    {tab === 'documents' && <DocumentsPanel overview={documents.data} isLoading={documents.isLoading} error={documents.isError ? shortError(documents.error) : ''} retry={() => documents.refetch()} matters={matters.data || []} refresh={refreshDocuments} />}
    {tab === 'updates' && <UpdatesPanel overview={updates.data} isLoading={updates.isLoading} error={updates.isError ? shortError(updates.error) : ''} retry={() => updates.refetch()} matters={matters.data || []} clients={clients.data || []} refresh={refreshUpdates} />}
    {tab === 'requests' && <RequestsPanel matters={matters.data||[]} refresh={refreshRequests} />}
    {(matters.isError || clients.isError) && <p className="mt-4 text-xs text-[#9a554d]" data-testid="status-matter-selector-error">Matter and client selectors could not be fully loaded. Retry by refreshing this page.</p>}
    <div className="mt-9 flex items-center gap-2 border-t border-[#e1ddd2] pt-4 text-[11px] text-[#818c87]"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#e9eee8] text-[#4f765f]"><Check className="h-3 w-3" /></span>Private to this firm · Human review remains part of every workflow</div>
  </div>;
}

function PanelLoading() {
  return <div className="space-y-4" aria-label="Loading workflow records" data-testid="loading-workflow-skeleton"><div className="h-28 animate-pulse rounded-md bg-[#e9e5da]" /><div className="h-52 animate-pulse rounded-md bg-[#eeebe2]" /><div className="h-44 animate-pulse rounded-md bg-[#eeebe2]" /></div>;
}
function PanelError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="rounded-md border border-[#e6c7c1] bg-[#fff9f6] p-6" role="alert" data-testid="status-workflow-error"><p className="text-sm font-semibold text-[#843f38]">We couldn’t load this workflow.</p><p className="mt-1 text-xs text-[#7d7470]">{message}</p><button type="button" onClick={retry} className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-[#405c60]" data-testid="button-retry-workflow"><RefreshCw className="h-3.5 w-3.5" />Try again</button></div>;
}
function SectionTitle({ number, title, body, action }: { number: string; title: string; body: string; action?: ReactNode }) {
  return <div className="flex flex-col justify-between gap-3 border-b border-[#e9e4d9] px-5 py-4 sm:flex-row sm:items-center"><div className="flex items-start gap-3"><span className="mono mt-0.5 text-[10px] text-[#a38250]">{number}</span><div><h2 className="serif text-lg font-bold">{title}</h2><p className="mt-1 text-xs text-[#87918d]">{body}</p></div></div>{action}</div>;
}
function PanelCard({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`scroll-mt-6 overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5] ${className}`}>{children}</section>;
}
function Field({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return <label className="block text-xs font-semibold text-[#526568]" data-testid={testId}><span className="mb-1.5 block">{label}</span>{children}</label>;
}
const inputClass = 'field';
function ActionButton({ children, onClick, disabled, kind = 'primary', testId, type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'primary' | 'outline' | 'quiet' | 'danger'; testId: string; type?: 'button' | 'submit' }) {
  const colors = { primary: 'bg-[#294651] text-[#f9f6ed] hover:bg-[#1c3943]', outline: 'border border-[#d9d4c8] bg-[#fbfaf5] text-[#334a50] hover:bg-[#f0ece2]', quiet: 'text-[#526568] hover:bg-[#eeece4]', danger: 'border border-[#e5c8c2] text-[#98483f] hover:bg-[#fff1ed]' };
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${colors[kind]}`} data-testid={testId}>{children}</button>;
}
function Badge({ children, tone = 'muted', testId }: { children: ReactNode; tone?: 'muted' | 'green' | 'gold' | 'red'; testId?: string }) {
  const colors = { muted: 'bg-[#ecebe5] text-[#687371]', green: 'bg-[#e5eee7] text-[#47725b]', gold: 'bg-[#f3eddd] text-[#8d713e]', red: 'bg-[#f7e6e1] text-[#9d5045]' };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${colors[tone]}`} data-testid={testId}>{children}</span>;
}
function Empty({ title, body }: { title: string; body: string }) {
  return <div className="grid min-h-36 place-items-center px-5 py-8 text-center" data-testid="status-workflow-empty"><div><span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-[#e8eee8] text-[#4d7463]"><FileText className="h-4 w-4" /></span><h3 className="serif mt-3 text-base font-bold">{title}</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[#788581]">{body}</p></div></div>;
}
function matterOption(matter: Matter) { return `${matter.reference} · ${matter.title} — ${matter.clientName}`; }

function BillingPanel({ overview, isLoading, error, retry, matters, refresh }: { overview?: any; isLoading: boolean; error: string; retry: () => void; matters: Matter[]; refresh: () => void }) {
  const saveProfile = useSaveBillingProfile();
  const createEntry = useCreateTimeEntry();
  const updateDraft = useUpdateBillingDraft();
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [busyDraft, setBusyDraft] = useState<number | null>(null);
  const [timeEntryFilter, setTimeEntryFilter] = useState<'recent' | 'unbilled'>('recent');
  const dateDefault = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const profileForm = useForm<BillingProfileFormValues>({
    resolver: zodResolver(billingProfileFormSchema) as unknown as Resolver<BillingProfileFormValues>,
    defaultValues: { matterId: '', feeType: 'hourly', currency: 'USD', rate: '', feeDescription: '', billingCycle: 'monthly', taxRate: '0', nextDraftAt: dateDefault, scheduleEnabled: true },
  });
  const entryForm = useForm<TimeEntryFormValues>({
    resolver: zodResolver(timeEntryFormSchema) as unknown as Resolver<TimeEntryFormValues>,
    defaultValues: { matterId: '', description: '', workDate: new Date().toISOString().slice(0, 10), durationMinutes: '', billable: true },
  });
  const profiles = overview?.profiles || [];
  const entries = overview?.timeEntries || [];
  const drafts = overview?.drafts || [];
  const unbilledEntries = entries.filter((entry: any) => entry.billable && !entry.billingDraftId);
  const billable = unbilledEntries.length;
  const visibleTimeEntries = timeEntryFilter === 'unbilled' ? unbilledEntries : entries.slice(0, 6);
  const blankProfileValues: BillingProfileFormValues = { matterId: '', feeType: 'hourly', currency: 'USD', rate: '', feeDescription: '', billingCycle: 'monthly', taxRate: '0', nextDraftAt: dateDefault, scheduleEnabled: true };
  const closeProfile = () => { setProfileOpen(false); setEditingProfileId(null); setFormError(''); profileForm.reset(blankProfileValues); };
  const openProfile = () => { setFormError(''); setEditingProfileId(null); profileForm.reset(blankProfileValues); setProfileOpen(true); };
  const openProfileEdit = (profile: any) => {
    setFormError('');
    setEditingProfileId(profile.id);
    profileForm.reset({
      matterId: String(profile.matterId),
      feeType: profile.feeType,
      currency: profile.currency,
      rate: String(((profile.feeType === 'hourly' ? profile.hourlyRateCents : profile.fixedFeeCents) || 0) / 100),
      feeDescription: profile.feeDescription,
      billingCycle: profile.billingCycle,
      taxRate: String(profile.taxRateBps / 100),
      nextDraftAt: new Date(profile.nextDraftAt).toISOString().slice(0, 10),
      scheduleEnabled: profile.scheduleEnabled,
    });
    setProfileOpen(true);
  };
  const openEntry = () => { setFormError(''); entryForm.reset({ matterId: '', description: '', workDate: new Date().toISOString().slice(0, 10), durationMinutes: '', billable: true }); setEntryOpen(true); };
  const onProfile = profileForm.handleSubmit(values => {
    const input: BillingProfileInput = { matterId: Number(values.matterId), feeType: values.feeType, currency: values.currency.toUpperCase(), hourlyRateCents: values.feeType === 'hourly' ? Math.round(Number(values.rate) * 100) : null, fixedFeeCents: values.feeType === 'fixed' ? Math.round(Number(values.rate) * 100) : null, feeDescription: values.feeDescription.trim(), billingCycle: values.billingCycle, taxRateBps: Math.round(Number(values.taxRate) * 100), scheduleEnabled: values.scheduleEnabled, nextDraftAt: new Date(values.nextDraftAt).toISOString() };
    saveProfile.mutate({ data: input }, { onSuccess: () => { refresh(); closeProfile(); }, onError: err => setFormError(shortError(err)) });
  });
  const onEntry = entryForm.handleSubmit(values => {
    createEntry.mutate({ data: { matterId: Number(values.matterId), description: values.description.trim(), workDate: values.workDate, durationMinutes: Number(values.durationMinutes), billable: values.billable } }, { onSuccess: () => { refresh(); setEntryOpen(false); }, onError: err => setFormError(shortError(err)) });
  });
  if (isLoading) return <PanelLoading />;
  if (error) return <PanelError message={error} retry={retry} />;
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Enabled schedules" value={profiles.filter((p: any) => p.scheduleEnabled).length} sub="matter billing profiles" icon={CalendarDays} targetId="billing-schedules" />
      <Metric label="Unbilled entries" value={billable} sub="ready for a draft" icon={Clock3} targetId="billing-time-entries" onClick={() => setTimeEntryFilter('unbilled')} />
      <Metric label="Drafts for review" value={drafts.filter((d: any) => d.status === 'draft').length} sub="never sent automatically" icon={WalletCards} targetId="billing-drafts" />
    </div>
    <PanelCard id="billing-schedules"><SectionTitle number="01" title="Scheduled bill drafts" body="Fee profiles and upcoming draft dates" action={<ActionButton onClick={openProfile} testId="button-add-billing-profile"><Plus className="h-3.5 w-3.5" />Add fee profile</ActionButton>} />
      {!profiles.length ? <Empty title="No billing schedules yet" body="Set a fee profile on a matter to begin preparing recurring drafts." /> : <div className="divide-y divide-[#eee9df]">{profiles.map((p: any) => <article key={p.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center" data-testid={`billing-profile-${p.id}`}>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{p.matterTitle}</h3><Badge tone={p.scheduleEnabled ? 'green' : 'muted'}>{p.scheduleEnabled ? 'Scheduled' : 'Paused'}</Badge></div><p className="mt-1 text-xs text-[#7c8984]">{p.clientName} <span className="mx-1">·</span>{p.feeDescription}</p><p className="mono mt-2 text-[10px] text-[#929993]">{p.feeType === 'hourly' ? `${money(p.hourlyRateCents || 0, p.currency)} / hour` : money(p.fixedFeeCents || 0, p.currency)} <span className="mx-1">·</span>{p.billingCycle} <span className="mx-1">·</span>Next draft {dateLabel(p.nextDraftAt)}</p></div>
        <div className="flex items-center justify-between gap-5 sm:justify-end"><div className="text-right"><div className="mono text-[9px] uppercase text-[#929993]">Tax</div><div className="mt-1 text-sm font-semibold">{(p.taxRateBps / 100).toFixed(2)}%</div></div><ActionButton onClick={() => openProfileEdit(p)} kind="outline" testId={`button-edit-billing-profile-${p.id}`}>Edit</ActionButton></div>
      </article>)}</div>}
    </PanelCard>
    <PanelCard id="billing-drafts"><SectionTitle number="02" title="Time & billing drafts" body="Record work, then review server-calculated draft totals" action={<ActionButton onClick={openEntry} testId="button-add-time-entry"><Plus className="h-3.5 w-3.5" />Log time</ActionButton>} />
      {drafts.length ? <div className="divide-y divide-[#eee9df]">{drafts.map((draft: any) => <BillingDraftRow key={draft.id} draft={draft} busy={busyDraft === draft.id} onReview={() => { setBusyDraft(draft.id); updateDraft.mutate({ id: draft.id, data: { status: 'reviewed' } }, { onSuccess: refresh, onSettled: () => setBusyDraft(null) }); }} />)}</div> : <Empty title="No bill drafts waiting" body="When scheduled fees or unbilled entries are ready, their draft bills will appear here for review." />}
      <div className="border-t border-[#eee9df] bg-[#f5f2e9] px-5 py-3 text-[11px] leading-5 text-[#697873]" data-testid="notice-billing-review">Draft amounts and tax are calculated by the server. Review all line items before use; invoices are never sent from ClientGuard.</div>
    </PanelCard>
    <PanelCard id="billing-time-entries"><SectionTitle number="03" title={timeEntryFilter === 'unbilled' ? 'Unbilled time entries' : 'Recent time entries'} body={timeEntryFilter === 'unbilled' ? `${unbilledEntries.length} billable entries ready for a draft` : 'Entries remain editable in the billing process only by creating a new entry'} action={timeEntryFilter === 'unbilled' ? <ActionButton onClick={() => setTimeEntryFilter('recent')} kind="quiet" testId="button-show-recent-time-entries">Show recent entries</ActionButton> : undefined} />
      {!visibleTimeEntries.length ? <Empty title={timeEntryFilter === 'unbilled' ? 'No unbilled entries' : 'No time entries'} body="Log work against a matter to begin preparing accurate bill drafts." /> : <div className="divide-y divide-[#eee9df]">{visibleTimeEntries.map((entry: any) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" data-testid={`time-entry-${entry.id}`}><div><div className="text-xs font-semibold">{entry.description}</div><div className="mt-1 text-[10px] text-[#88938e]">{entry.matterTitle} · {dateLabel(entry.workDate)}</div></div><div className="flex items-center gap-3 text-xs"><span className="mono">{Math.floor(entry.durationMinutes / 60)}h {entry.durationMinutes % 60}m</span><Badge tone={entry.billable ? 'green' : 'muted'}>{entry.billable ? 'Billable' : 'Non-billable'}</Badge></div></div>)}</div>}
    </PanelCard>
    {profileOpen && <Modal title={editingProfileId === null ? 'Create a fee profile' : 'Edit fee profile'} close={closeProfile} testId="dialog-billing-profile"><Form {...profileForm}><form onSubmit={onProfile} className="space-y-4" noValidate>
      <FormField control={profileForm.control} name="matterId" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Matter</FormLabel><FormControl><select {...field} disabled={editingProfileId !== null} className={inputClass} data-testid="select-billing-matter"><option value="">Choose a matter</option>{matters.map(m => <option key={m.id} value={m.id}>{matterOption(m)}</option>)}</select></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} />
      <div className="grid gap-3 sm:grid-cols-2"><FormField control={profileForm.control} name="feeType" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Fee structure</FormLabel><FormControl><select {...field} className={inputClass} data-testid="select-fee-type"><option value="hourly">Hourly</option><option value="fixed">Fixed fee</option></select></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} /><FormField control={profileForm.control} name="currency" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Currency (ISO code)</FormLabel><FormControl><input {...field} className={inputClass} maxLength={3} data-testid="input-billing-currency" /></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} /></div>
      <FormField control={profileForm.control} name="rate" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Rate or fee amount</FormLabel><FormControl><input {...field} className={inputClass} type="number" min="0" step="0.01" placeholder="0.00" data-testid="input-billing-rate" /></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} />
      <FormField control={profileForm.control} name="feeDescription" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Fee description</FormLabel><FormControl><input {...field} className={inputClass} maxLength={240} placeholder="e.g. Advisory services" data-testid="input-fee-description" /></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} />
      <div className="grid gap-3 sm:grid-cols-2"><FormField control={profileForm.control} name="billingCycle" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Billing cycle</FormLabel><FormControl><select {...field} className={inputClass} data-testid="select-billing-cycle"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="quarterly">Quarterly</option></select></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} /><FormField control={profileForm.control} name="taxRate" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Tax rate (%)</FormLabel><FormControl><input {...field} type="number" min="0" max="100" step="0.01" className={inputClass} data-testid="input-tax-rate" /></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} /></div>
      <FormField control={profileForm.control} name="nextDraftAt" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Next draft date</FormLabel><FormControl><input {...field} type="date" className={inputClass} data-testid="input-next-bill-date" /></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} />
      <FormField control={profileForm.control} name="scheduleEnabled" render={({ field }) => <FormItem className="flex items-center gap-2 space-y-0 text-xs font-normal text-[#526568]"><FormControl><input type="checkbox" checked={field.value} onChange={field.onChange} onBlur={field.onBlur} name={field.name} ref={field.ref} data-testid="checkbox-schedule-billing" /></FormControl><FormLabel className="cursor-pointer">Enable scheduled draft preparation</FormLabel></FormItem>} />
      {formError && <FormError message={formError} />}{matters.length === 0 && <p className="text-xs text-[#9a554d]">Create a matter before adding a billing profile.</p>}<ModalActions close={closeProfile} busy={saveProfile.isPending} disabled={!matters.length} submitTestId={editingProfileId === null ? 'button-save-billing-profile' : 'button-update-billing-profile'} />
    </form></Form></Modal>}
    {entryOpen && <Modal title="Log matter time" close={() => setEntryOpen(false)} testId="dialog-time-entry"><Form {...entryForm}><form onSubmit={onEntry} className="space-y-4" noValidate>
      <FormField control={entryForm.control} name="matterId" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Matter</FormLabel><FormControl><select {...field} className={inputClass} data-testid="select-time-matter"><option value="">Choose a matter</option>{matters.map(m => <option key={m.id} value={m.id}>{matterOption(m)}</option>)}</select></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} />
      <FormField control={entryForm.control} name="description" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Work description</FormLabel><FormControl><textarea {...field} rows={3} maxLength={1000} className={`${inputClass} h-auto py-2`} placeholder="Describe the work completed" data-testid="input-time-description" /></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} />
      <div className="grid gap-3 sm:grid-cols-2"><FormField control={entryForm.control} name="workDate" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Work date</FormLabel><FormControl><input {...field} type="date" className={inputClass} data-testid="input-time-date" /></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} /><FormField control={entryForm.control} name="durationMinutes" render={({ field }) => <FormItem className="block space-y-0 text-xs font-semibold text-[#526568]"><FormLabel className="mb-1.5 block">Duration (minutes)</FormLabel><FormControl><input {...field} type="number" min="1" max="1440" className={inputClass} placeholder="60" data-testid="input-time-duration" /></FormControl><FormMessage className="mt-1 text-[11px]" /></FormItem>} /></div>
      <FormField control={entryForm.control} name="billable" render={({ field }) => <FormItem className="flex items-center gap-2 space-y-0 text-xs font-normal text-[#526568]"><FormControl><input type="checkbox" checked={field.value} onChange={field.onChange} onBlur={field.onBlur} name={field.name} ref={field.ref} data-testid="checkbox-time-billable" /></FormControl><FormLabel className="cursor-pointer">Billable time</FormLabel></FormItem>} />
      {formError && <FormError message={formError} />}<ModalActions close={() => setEntryOpen(false)} busy={createEntry.isPending} disabled={!matters.length} submitTestId="button-save-time-entry" />
    </form></Form></Modal>}
  </div>;
}
function Metric({ label, value, sub, icon: Icon, targetId, onClick }: { label: string; value: number; sub: string; icon: typeof Clock3; targetId: string; onClick?: () => void }) {
  return <a href={`#${targetId}`} onClick={onClick} aria-label={`${label}: ${value}. View details.`} className="group block rounded-md border border-[#e0dace] bg-[#fbfaf5] p-4 transition hover:border-[#b99a65] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#294651]" data-testid={`metric-workflow-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.12em] text-[#75817e]"><span>{label}</span><Icon className="h-4 w-4 text-[#9a825a]" /></div><div className="serif mt-2 text-3xl font-semibold">{value}</div><div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[#85908c]"><span>{sub}</span><ArrowRight className="h-3 w-3 shrink-0 text-[#405c60] transition-transform group-hover:translate-x-0.5" /></div></a>;
}
function BillingDraftRow({ draft, busy, onReview }: { draft: any; busy: boolean; onReview: () => void }) {
  return <article className="px-5 py-4" data-testid={`billing-draft-${draft.id}`}><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{draft.matterTitle}</h3><Badge tone={draft.status === 'reviewed' ? 'green' : 'gold'} testId={`status-billing-draft-${draft.id}`}>{draft.status}</Badge></div><p className="mt-1 text-[11px] text-[#83908b]">{draft.clientName} · {dateLabel(draft.periodStartAt)} – {dateLabel(draft.periodEndAt)}</p></div><div className="sm:text-right"><div className="mono text-lg font-medium">{money(draft.totalCents, draft.currency)}</div><div className="text-[10px] text-[#8b9691]">Total incl. tax</div></div></div>
    <p className="mt-3 max-w-3xl whitespace-pre-wrap text-xs leading-5 text-[#667571]">{draft.narrative}</p>
    <div className="mt-3 overflow-x-auto rounded border border-[#e9e4d9]"><table className="w-full min-w-[520px] text-left text-[11px]"><thead className="bg-[#f2efe6] text-[9px] uppercase tracking-wide text-[#89918b]"><tr><th className="px-3 py-2">Description</th><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Time</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Amount</th></tr></thead><tbody>{draft.lineItems.map((item: any, i: number) => <tr key={`${i}-${item.description}`} className="border-t border-[#eee9df]"><td className="px-3 py-2.5 font-medium">{item.description}</td><td className="px-3 py-2.5 text-[#7b8883]">{dateLabel(item.workDate)}</td><td className="mono px-3 py-2.5 text-right">{item.durationMinutes == null ? '—' : `${item.durationMinutes} min`}</td><td className="mono px-3 py-2.5 text-right">{item.rateCents == null ? '—' : money(item.rateCents, draft.currency)}</td><td className="mono px-3 py-2.5 text-right font-semibold">{money(item.amountCents, draft.currency)}</td></tr>)}</tbody></table></div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="text-[10px] text-[#77837e]">Subtotal {money(draft.subtotalCents, draft.currency)} <span className="mx-1">·</span> Tax {money(draft.taxCents, draft.currency)}</div>{draft.status === 'draft' && <ActionButton onClick={onReview} disabled={busy} kind="outline" testId={`button-review-bill-${draft.id}`}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Mark reviewed</ActionButton>}</div>
  </article>;
}

function DocumentsPanel({ overview, isLoading, error, retry, matters, refresh }: { overview?: any; isLoading: boolean; error: string; retry: () => void; matters: Matter[]; refresh: () => void }) {
  const requestUpload = useRequestDocumentUpload();
  const completeUpload = useCompleteDocumentUpload();
  const analyze = useAnalyzeDocument();
  const remove = useDeleteMatterDocument();
  const review = useReviewDocumentSuggestion();
  const updatePlanner = useUpdatePlannerItem();
  const setVisibility = useSetDocumentClientVisibility();
  const markDocumentReviewed = useMarkMatterDocumentReviewed();
  const [uploadMatter, setUploadMatter] = useState('');
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const documents = overview?.documents || [];
  const suggestions = overview?.suggestions || [];
  const planner = overview?.plannerItems || [];
  const pending = suggestions.filter((s: any) => s.status === 'pending').length;
  const uploadInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setLocalError('');
    const supported: Record<string, string> = { 'application/pdf': 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain': 'text/plain' };
    const type = file.type || (file.name.toLowerCase().endsWith('.txt') ? 'text/plain' : file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.name.toLowerCase().endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '');
    if (!supported[type]) { setLocalError('Choose a PDF, DOCX, or TXT file.'); event.target.value = ''; return; }
    if (file.size > 15 * 1024 * 1024) { setLocalError('The file must be 15 MB or smaller.'); event.target.value = ''; return; }
    if (!uploadMatter) { setLocalError('Choose the matter this document belongs to.'); event.target.value = ''; return; }
    setUploading(true);
    try {
      const reservation = await requestUpload.mutateAsync({ data: { matterId: Number(uploadMatter), name: file.name, size: file.size, contentType: type as any } });
      await refresh();
      const response = await fetch(reservation.uploadURL, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
      if (!response.ok) throw new Error('The private file upload did not complete. Please try again.');
      await completeUpload.mutateAsync({ id: reservation.id });
      await refresh();
    } catch (err) { setLocalError(shortError(err)); }
    finally { setUploading(false); event.target.value = ''; }
  };
  const analyzeDoc = (id: number) => {
    if (!window.confirm('The document text will be sent to the AI service for analysis. Continue?')) return;
    setAnalyzingId(id);
    analyze.mutate({ id }, { onSuccess: refresh, onError: err => setLocalError(shortError(err)), onSettled: () => setAnalyzingId(null) });
  };
  if (isLoading) return <PanelLoading />;
  if (error) return <PanelError message={error} retry={retry} />;
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Matter documents" value={documents.length} sub="private firm records" icon={FileText} targetId="document-records" /><Metric label="Suggestions to review" value={pending} sub="requires your decision" icon={Sparkles} targetId="document-suggestions" /><Metric label="Planner items" value={planner.length} sub="confirmed from evidence" icon={CalendarDays} targetId="document-planner" /></div>
    <PanelCard id="document-records"><SectionTitle number="01" title="Matter documents" body="Client portal uploads stay private until you explicitly share them · PDF, DOCX, or TXT up to 15 MB" action={<label className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-[#294651] px-3.5 py-2.5 text-xs font-bold text-[#f9f6ed] transition hover:bg-[#1c3943] ${uploading ? 'pointer-events-none opacity-50' : ''}`} data-testid="label-upload-document"><UploadCloud className="h-3.5 w-3.5" />{uploading ? 'Uploading…' : 'Upload document'}<input type="file" accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={uploadInput} disabled={uploading} data-testid="input-upload-document" /></label>} />
      <div className="border-b border-[#eee9df] bg-[#f5f2e9] px-5 py-3"><Field label="Matter for this upload"><select value={uploadMatter} onChange={e => setUploadMatter(e.target.value)} className={`${inputClass} max-w-xl`} data-testid="select-upload-matter"><option value="">Choose a matter first</option>{matters.map(m => <option key={m.id} value={m.id}>{matterOption(m)}</option>)}</select></Field></div>
      {(localError || remove.isError) && <div className="px-5 pt-3"><FormError message={localError || shortError(remove.error)} /></div>}
      {!documents.length
        ? <Empty title="No documents attached" body="Choose a matter and upload a source document to prepare suggestions from its contents." />
        : <div className="divide-y divide-[#eee9df]">{documents.map((doc: any) => <article key={doc.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" data-testid={`client-document-${doc.id}`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-[#e9eee8] text-[#4d7463]"><FileText className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-bold">{doc.originalName}</h3>
              {doc.uploadedFromPortal && <Badge tone="gold" testId={`source-document-${doc.id}`}>Client upload</Badge>}
              <Badge tone={doc.status === 'analyzed' ? 'green' : doc.status === 'failed' ? 'red' : 'muted'} testId={`status-document-${doc.id}`}>{doc.status}</Badge>
              {doc.uploadedFromPortal
                ? <Badge tone={doc.clientVisible || doc.reviewedAt ? 'green' : 'gold'} testId={`review-document-${doc.id}`}>
                    {doc.clientVisible ? 'Shared with client' : doc.reviewedAt ? 'Reviewed · private' : 'Needs review'}
                  </Badge>
                : <Badge tone={doc.clientVisible ? 'green' : 'muted'}>{doc.clientVisible ? 'Shared with client' : 'Private'}</Badge>}
            </div>
            <p className="mt-1 text-[10px] text-[#86918c]">{doc.matterTitle} · {(doc.sizeBytes / 1024 / 1024).toFixed(2)} MB · Added {dateLabel(doc.createdAt)}</p>
            {doc.lastAnalysisError && <p className="mt-1 text-[10px] text-[#9a554d]">{doc.lastAnalysisError}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={getGetMatterDocumentFileUrl(doc.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded px-2.5 py-2 text-[10px] font-bold text-[#405c60] hover:bg-[#eeece4]" data-testid={`link-open-document-${doc.id}`}><ArrowDownToLine className="h-3.5 w-3.5" />Open source</a>
            {doc.uploadedFromPortal && !doc.reviewedAt && !doc.clientVisible && doc.status !== 'uploading' && <ActionButton onClick={() => markDocumentReviewed.mutate({ id: doc.id }, { onSuccess: refresh, onError: err => setLocalError(shortError(err)) })} disabled={markDocumentReviewed.isPending} kind="outline" testId={`button-mark-document-reviewed-${doc.id}`}>Mark reviewed</ActionButton>}
            <ActionButton onClick={() => { if (!doc.clientVisible && !window.confirm(`Share ${doc.originalName} with this matter's client?`)) return; setVisibility.mutate({id:doc.id,data:{visible:!doc.clientVisible}},{onSuccess:refresh,onError:err=>setLocalError(shortError(err))}); }} disabled={setVisibility.isPending || doc.status === 'uploading'} kind="outline" testId={`button-toggle-client-visibility-${doc.id}`}>{doc.clientVisible?'Stop sharing':'Share with client'}</ActionButton>
            {doc.status === 'ready' || doc.status === 'failed' ? <ActionButton onClick={() => analyzeDoc(doc.id)} disabled={analyzingId === doc.id} kind="outline" testId={`button-analyze-document-${doc.id}`}>{analyzingId === doc.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}Analyze</ActionButton> : null}
            <ActionButton onClick={() => setDeleteId(doc.id)} kind="quiet" testId={`button-delete-document-${doc.id}`}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only">Delete {doc.originalName}</span></ActionButton>
          </div>
        </article>)}</div>}
      <div className="border-t border-[#eee9df] px-5 py-3 text-[10px] leading-5 text-[#74817c]" data-testid="notice-document-disclosure">Before you request analysis, know that document text is sent to the AI service for source-backed suggestions. No analysis starts until you press Analyze.</div>
    </PanelCard>
    <PanelCard id="document-suggestions"><SectionTitle number="02" title="Suggestions from documents" body="Each suggestion includes the exact source passage and page. Confirm or reject it." />
      {!suggestions.length ? <Empty title="No suggestions to review" body="After explicitly analyzing a document, its possible tasks and events will appear here with their source evidence." /> : <div className="divide-y divide-[#eee9df]">{suggestions.map((s: any) => <article key={s.id} className="px-5 py-4" data-testid={`document-suggestion-${s.id}`}><div className="flex flex-col justify-between gap-3 sm:flex-row"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge tone={s.kind === 'event' ? 'gold' : 'green'}>{s.kind}</Badge><Badge tone={s.status === 'pending' ? 'gold' : s.status === 'confirmed' ? 'green' : 'muted'} testId={`status-suggestion-${s.id}`}>{s.status}</Badge><span className="text-[10px] text-[#8a948f]">{Math.round(s.confidence * 100)}% confidence</span></div><h3 className="mt-2 text-sm font-bold">{s.title}</h3><p className="mt-1 text-xs leading-5 text-[#71807c]">{s.details}</p><p className="mt-1 text-[10px] text-[#87918d]">{s.matterTitle} · {s.documentName}{s.dueAt ? ` · ${dateLabel(s.dueAt)}` : ''}</p></div>{s.status === 'pending' && <div className="flex shrink-0 gap-2"><ActionButton onClick={() => review.mutate({ id: s.id, data: { status: 'confirmed' } }, { onSuccess: refresh })} kind="outline" testId={`button-confirm-suggestion-${s.id}`}><Check className="h-3.5 w-3.5" />Confirm</ActionButton><ActionButton onClick={() => review.mutate({ id: s.id, data: { status: 'rejected' } }, { onSuccess: refresh })} kind="quiet" testId={`button-reject-suggestion-${s.id}`}><X className="h-3.5 w-3.5" />Reject</ActionButton></div>}</div><blockquote className="mt-3 border-l-2 border-[#b99a65] bg-[#f5f2e9] px-3 py-2 text-xs leading-5 text-[#5d6d69]" data-testid={`evidence-suggestion-${s.id}`}><span className="mono mr-2 text-[9px] uppercase tracking-wide text-[#987747]">Page {s.sourcePage}</span>“{s.sourceQuote}”</blockquote></article>)}</div>}
    </PanelCard>
    <PanelCard id="document-planner"><SectionTitle number="03" title="Confirmed Planner items" body="Tasks and calendar suggestions accepted by a professional" />
      {!planner.length ? <Empty title="No confirmed items" body="Confirm a source-backed suggestion to add it to the matter’s planner list." /> : <div className="divide-y divide-[#eee9df]">{planner.map((item: any) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4" data-testid={`planner-item-${item.id}`}><div><div className="flex items-center gap-2"><Badge tone={item.kind === 'event' ? 'gold' : 'green'}>{item.kind}</Badge><Badge tone={item.status === 'done' ? 'green' : 'muted'}>{item.status}</Badge></div><h3 className="mt-2 text-sm font-bold">{item.title}</h3><p className="mt-1 text-xs text-[#71807c]">{item.details}</p><p className="mt-1 text-[10px] text-[#89938e]">{item.matterTitle} · {item.documentName} · Page {item.sourcePage}{item.dueAt ? ` · ${dateLabel(item.dueAt)}` : ''}</p><blockquote className="mt-2 border-l-2 border-[#b99a65] pl-2 text-[10px] italic text-[#71807c]">{item.sourceQuote}</blockquote></div><ActionButton onClick={() => updatePlanner.mutate({ id: item.id, data: { status: item.status === 'done' ? 'open' : 'done' } }, { onSuccess: refresh })} kind="outline" testId={`button-toggle-planner-${item.id}`}>{item.status === 'done' ? 'Reopen' : 'Mark done'}</ActionButton></div>)}</div>}
    </PanelCard>
    {deleteId !== null && <Modal title="Delete this document?" close={() => setDeleteId(null)} testId="dialog-delete-document"><p className="text-sm leading-6 text-[#71807c]">The source file and its associated suggestions will be removed from this firm workspace.</p><div className="mt-6 flex justify-end gap-2"><ActionButton onClick={() => setDeleteId(null)} kind="outline" testId="button-cancel-delete-document">Keep document</ActionButton><ActionButton onClick={() => remove.mutate({ id: deleteId }, { onSuccess: () => { setDeleteId(null); refresh(); }, onError: err => setLocalError(shortError(err)) })} disabled={remove.isPending} kind="danger" testId="button-confirm-delete-document">{remove.isPending ? 'Deleting…' : 'Delete document'}</ActionButton></div></Modal>}
  </div>;
}

function UpdatesPanel({ overview, isLoading, error, retry, matters, clients, refresh }: { overview?: any; isLoading: boolean; error: string; retry: () => void; matters: Matter[]; clients: any[]; refresh: () => void }) {
  const saveSchedule = useSaveClientUpdateSchedule();
  const createDraft = useCreateClientUpdateDraft();
  const updateDraft = useUpdateClientUpdateDraft();
  const sendEmail = useSendReviewedClientUpdateEmail();
  const publishUpdate = usePublishClientUpdate();
  const published = useListPortalUpdates({ query: { queryKey: getListPortalUpdatesQueryKey() } });
  const qc = useQueryClient();
  const [matterId, setMatterId] = useState('');
  const [cadence, setCadence] = useState<'weekly' | 'fortnightly' | 'monthly'>('fortnightly');
  const [editing, setEditing] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [errorText, setErrorText] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailNotice, setEmailNotice] = useState('');
  const schedules = overview?.schedules || [];
  const drafts = overview?.drafts || [];
  const schedulesByMatter = useMemo(() => new Map(schedules.map((s: any) => [s.matterId, s])), [schedules]);
  if (isLoading) return <PanelLoading />;
  if (error) return <PanelError message={error} retry={retry} />;
  const persistSchedule = (id: number, enabled: boolean, cadenceValue: 'weekly' | 'fortnightly' | 'monthly') => saveSchedule.mutate({ data: { matterId: id, enabled, cadence: cadenceValue } }, { onSuccess: refresh, onError: err => setErrorText(shortError(err)) });
  const startDraft = () => { setErrorText(''); if (!matterId) { setErrorText('Choose a matter first.'); return; } createDraft.mutate({ data: { matterId: Number(matterId) } }, { onSuccess: refresh, onError: err => setErrorText(shortError(err)) }); };
  const copyDraft = async (draft: any) => {
    try { await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`); setCopied(draft.id); window.setTimeout(() => setCopied(null), 1800); }
    catch { setErrorText('Clipboard access is unavailable in this browser. Select and copy the draft text instead.'); }
  };
  const sendDraftEmail = (draft: ClientUpdateDraft, provider: 'google'|'microsoft') => {
    const providerName = provider === 'google' ? 'Google' : 'Microsoft';
    if (!window.confirm(`Send “${draft.subject}” to ${draft.clientName} via ${providerName}? This sends an email immediately using the connected account.`)) return;
    setEmailError('');setEmailNotice('');
    sendEmail.mutate({provider,data:{draftId:draft.id}},{onSuccess:()=>setEmailNotice(`${providerName} accepted the email request for “${draft.subject}.”`),onError:error=>setEmailError(`Could not confirm that ${providerName} sent this email. Check the connected account’s Sent folder before retrying. ${shortError(error)}`)});
  };
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Update schedules" value={schedules.filter((s: any) => s.enabled).length} sub="matter cadence settings" icon={CalendarDays} targetId="client-update-schedules" /><Metric label="Drafts for review" value={drafts.filter((d: any) => d.status === 'draft').length} sub="professional review required" icon={FileText} targetId="client-update-drafts" /><Metric label="Recent drafts" value={drafts.length} sub="not sent by the system" icon={Activity} targetId="client-update-drafts" /></div>
    <PanelCard id="client-update-schedules"><SectionTitle number="01" title="Matter update schedules" body="Set when ClientGuard may prepare a client-update draft. It will never send email." />
      {!matters.length ? <Empty title="No matters available" body="Create a matter before setting a client update schedule." /> : <div className="divide-y divide-[#eee9df]">{matters.map(m => { const schedule: any = schedulesByMatter.get(m.id); return <ScheduleRow key={m.id} matter={m} schedule={schedule} onChange={persistSchedule} busy={saveSchedule.isPending} />; })}</div>}
    </PanelCard>
    <PanelCard id="client-update-draft-create"><SectionTitle number="02" title="Create a client update draft" body="Use recent activity on a matter as source material" />
      <div className="grid gap-3 p-5 sm:grid-cols-[1fr_180px_auto] sm:items-end"><Field label="Matter"><select value={matterId} onChange={e => setMatterId(e.target.value)} className={inputClass} data-testid="select-update-matter"><option value="">Choose a matter</option>{matters.map(m => <option key={m.id} value={m.id}>{matterOption(m)}</option>)}</select></Field><Field label="Schedule cadence"><select value={cadence} onChange={e => setCadence(e.target.value as typeof cadence)} className={inputClass} data-testid="select-update-cadence"><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option></select></Field><ActionButton onClick={startDraft} disabled={createDraft.isPending || !matterId} testId="button-generate-client-update">{createDraft.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}Draft update</ActionButton></div>
      {matterId && <div className="px-5 pb-4"><ActionButton onClick={() => persistSchedule(Number(matterId), true, cadence)} disabled={saveSchedule.isPending} kind="outline" testId="button-save-selected-update-schedule"><CalendarDays className="h-3.5 w-3.5" />Save schedule for selected matter</ActionButton></div>}
      {errorText && <div className="px-5 pb-4"><FormError message={errorText} /></div>}
      {clients.length > 0 && <div className="border-t border-[#eee9df] bg-[#f5f2e9] px-5 py-3 text-[10px] text-[#7b8782]" data-testid="text-update-client-context">{clients.length} firm client relationships available · drafts use activity tied to the selected matter.</div>}
    </PanelCard>
    <PanelCard id="client-update-drafts"><SectionTitle number="03" title="Client update drafts" body="Only reviewed drafts may be published to the portal or explicitly sent by email." />
      {emailNotice&&<div role="status" className="border-b border-[#c9d8cc] bg-[#edf3ed] px-5 py-3 text-xs text-[#42664f]" data-testid="status-client-update-email-sent">{emailNotice}</div>}{emailError&&<div role="alert" className="border-b border-[#e6c7c1] bg-[#fff9f6] px-5 py-3 text-xs leading-5 text-[#843f38]" data-testid="status-client-update-email-error">{emailError}</div>}
      {!drafts.length ? <Empty title="No client-update drafts" body="Create a draft from a matter with recent activity. You remain in control of every message." /> : <div className="divide-y divide-[#eee9df]">{drafts.map((draft: ClientUpdateDraft) => <UpdateDraft key={draft.id} draft={draft} editing={editing === draft.id} copied={copied === draft.id} busy={updateDraft.isPending} busyPublish={publishUpdate.isPending} busyEmail={sendEmail.isPending} onEdit={() => setEditing(draft.id)} onCancel={() => setEditing(null)} onCopy={() => copyDraft(draft)} onSave={(subject, body) => updateDraft.mutate({ id: draft.id, data: { subject, body } }, { onSuccess: () => { setEditing(null); refresh(); }, onError: err => setErrorText(shortError(err)) })} onReview={() => updateDraft.mutate({ id: draft.id, data: { status: 'reviewed' } }, { onSuccess: refresh, onError: err => setErrorText(shortError(err)) })} onPublish={() => publishUpdate.mutate({data:{draftId:draft.id}},{onSuccess:()=>{refresh();qc.invalidateQueries({queryKey:getListPortalUpdatesQueryKey()});},onError:err=>setErrorText(shortError(err))})} onSendEmail={provider=>sendDraftEmail(draft,provider)} />)}</div>}
      <div className="border-t border-[#eee9df] bg-[#f5f2e9] px-5 py-3 text-[10px] leading-5 text-[#697873]" data-testid="notice-update-no-send">AI-assisted writing creates drafts only. Copying places text on your clipboard; no email or message is sent.</div>
    </PanelCard>
    <PanelCard id="client-published-updates"><SectionTitle number="04" title="Published to client portal" body="These are the only update records shown to clients." />
      {published.isError?<div className="p-5 text-xs text-[#9a554d]">Published updates could not be loaded. <button onClick={()=>published.refetch()} className="underline">Retry</button></div>:!published.data?.length?<Empty title="Nothing published yet" body="Review a client update draft before publishing it to the portal."/>:<div className="divide-y divide-[#eee9df]">{published.data.map(item=><article key={item.id} className="px-5 py-4" data-testid={`published-client-update-${item.id}`}><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-bold">{item.subject}</h3><span className="mono text-[9px] text-[#89938e]">{dateLabel(item.publishedAt)}</span></div><p className="mt-1 text-[10px] text-[#89938e]">{item.matterTitle}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#667571]">{item.body}</p></article>)}</div>}
    </PanelCard>
  </div>;
}
function RequestsPanel({matters,refresh}:{matters:Matter[];refresh:()=>void}){
  const firmPortalView={view:'firm'} as const;
  const requests=useGetPortalRequests(firmPortalView,{query:{queryKey:getGetPortalRequestsQueryKey(firmPortalView)}});
  const create=useCreatePortalRequest();
  const close=useClosePortalRequest();
  const [matterId,setMatterId]=useState('');
  const [title,setTitle]=useState('');
  const [details,setDetails]=useState('');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!matterId||!title.trim()||!details.trim())return;setError('');setNotice('');create.mutate({data:{matterId:Number(matterId),title:title.trim(),details:details.trim()}},{onSuccess:()=>{refresh();setTitle('');setDetails('');setNotice('Request created. It is now visible to the client in their portal.');},onError:reason=>setError(shortError(reason))});};
  const closeRequest=(request:PortalRequest)=>{if(request.status!=='responded'||!window.confirm(`Close the responded request “${request.title}”?`))return;setError('');close.mutate({id:request.id},{onSuccess:()=>{refresh();setNotice('Responded request closed.');},onError:reason=>setError(shortError(reason))});};
  return <div className="space-y-5">
    <PanelCard><SectionTitle number="01" title="Create a client request" body="Requests are visible to the client assigned to the selected matter."/>
      <form onSubmit={submit} className="grid gap-3 p-5 md:grid-cols-2"><Field label="Matter"><select required value={matterId} onChange={event=>setMatterId(event.target.value)} className={inputClass} data-testid="select-create-portal-request-matter"><option value="">Choose a matter</option>{matters.map(matter=><option key={matter.id} value={matter.id}>{matterOption(matter)}</option>)}</select></Field><Field label="Request title"><input required maxLength={200} value={title} onChange={event=>setTitle(event.target.value)} className={inputClass} placeholder="e.g. Confirm current mailing address" data-testid="input-portal-request-title"/></Field><Field label="Details"><textarea required maxLength={5000} rows={4} value={details} onChange={event=>setDetails(event.target.value)} className={`${inputClass} h-auto py-2`} placeholder="Explain what information or action would help move this matter forward." data-testid="input-portal-request-details"/></Field><div className="flex flex-col justify-end gap-2"><ActionButton type="submit" disabled={!matterId||!title.trim()||!details.trim()||create.isPending} testId="button-create-portal-request">{create.isPending?'Creating request':'Create portal request'}</ActionButton><p className="text-[10px] leading-4 text-[#87918d]">The client can respond in their portal. No email is sent from this action.</p></div></form>
      {(notice||error)&&<div className={`border-t px-5 py-3 text-xs ${error?'border-[#e6c7c1] bg-[#fff9f6] text-[#843f38]':'border-[#c9d8cc] bg-[#edf3ed] text-[#42664f]'}`} role={error?'alert':'status'}>{error||notice}</div>}
    </PanelCard>
    <PanelCard><SectionTitle number="02" title="Client request activity" body="Close a request only after the client has responded."/>
      {requests.isLoading?<PanelLoading/>:requests.isError?<div className="p-5"><PanelError message={shortError(requests.error)} retry={()=>requests.refetch()}/></div>:!requests.data?.length?<Empty title="No portal requests yet" body="Create a matter-specific request above. Responses will appear here."/>:<div className="divide-y divide-[#eee9df]">{requests.data.map(request=><article key={request.id} className="px-5 py-4" data-testid={`firm-portal-request-${request.id}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{request.title}</h3><Badge tone={request.status==='responded'?'green':request.status==='open'?'gold':'muted'}>{request.status}</Badge></div><p className="mt-1 text-[10px] text-[#89938e]">{request.matterTitle} · Created {dateLabel(request.createdAt)}</p></div>{request.status==='responded'&&<ActionButton kind="outline" disabled={close.isPending} onClick={()=>closeRequest(request)} testId={`button-close-portal-request-${request.id}`}>Close request</ActionButton>}</div><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#65756f]">{request.details}</p>{request.responseMessage&&<div className="mt-3 rounded bg-[#e9eee8] p-3"><div className="mono text-[9px] uppercase tracking-wide text-[#547262]">Client response · {request.respondedAt?dateLabel(request.respondedAt):''}</div><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#52655e]">{request.responseMessage}</p></div>}</article>)}</div>}
    </PanelCard>
  </div>;
}
function ScheduleRow({ matter, schedule, onChange, busy }: { matter: Matter; schedule?: any; onChange: (id: number, enabled: boolean, cadence: 'weekly' | 'fortnightly' | 'monthly') => void; busy: boolean }) {
  const [cadence, setCadence] = useState<'weekly' | 'fortnightly' | 'monthly'>(schedule?.cadence || 'fortnightly');
  return <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" data-testid={`update-schedule-${matter.id}`}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{matter.title}</h3><Badge tone={schedule?.enabled ? 'green' : 'muted'}>{schedule?.enabled ? 'Enabled' : 'Off'}</Badge></div><p className="mt-1 text-[10px] text-[#87918d]">{matter.clientName} · {schedule?.nextDraftAt ? `Next draft ${dateLabel(schedule.nextDraftAt)}` : 'No upcoming draft'}</p></div><div className="flex flex-wrap items-center gap-2"><select value={cadence} onChange={e => setCadence(e.target.value as typeof cadence)} className="field h-9 w-32" aria-label={`Cadence for ${matter.title}`} data-testid={`select-schedule-cadence-${matter.id}`}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option></select><ActionButton onClick={() => onChange(matter.id, !schedule?.enabled, cadence)} disabled={busy} kind={schedule?.enabled ? 'outline' : 'primary'} testId={`button-toggle-schedule-${matter.id}`}>{schedule?.enabled ? 'Pause' : 'Enable'}</ActionButton></div></div>;
}
function UpdateDraft({ draft, editing, copied, busy, busyPublish, busyEmail, onEdit, onCancel, onCopy, onSave, onReview, onPublish, onSendEmail }: { draft: ClientUpdateDraft; editing: boolean; copied: boolean; busy: boolean; busyPublish: boolean; busyEmail:boolean; onEdit: () => void; onCancel: () => void; onCopy: () => void; onSave: (subject: string, body: string) => void; onReview: () => void; onPublish: () => void; onSendEmail:(provider:'google'|'microsoft')=>void }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  return <article className="px-5 py-4" data-testid={`client-update-draft-${draft.id}`}><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><Badge tone={draft.status === 'reviewed' ? 'green' : 'gold'} testId={`status-client-update-${draft.id}`}>{draft.status}</Badge><span className="text-[10px] text-[#89938e]">{draft.clientName} · {draft.matterTitle} · {draft.generatedBy === 'schedule' ? 'Scheduled draft' : 'Created by you'}</span></div></div><div className="flex flex-wrap gap-1"><ActionButton onClick={onCopy} kind="quiet" testId={`button-copy-update-${draft.id}`}><Clipboard className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy'}</ActionButton>{draft.status === 'draft' && !editing && <><ActionButton onClick={onEdit} kind="quiet" testId={`button-edit-update-${draft.id}`}>Edit</ActionButton><ActionButton onClick={onReview} disabled={busy} kind="outline" testId={`button-review-update-${draft.id}`}><Check className="h-3.5 w-3.5" />Mark reviewed</ActionButton></>}{draft.status==='reviewed'&&<><ActionButton onClick={onPublish} disabled={busyPublish} kind="outline" testId={`button-publish-update-${draft.id}`}>{busyPublish?'Publishing…':'Publish to portal'}</ActionButton><ActionButton onClick={()=>onSendEmail('google')} disabled={busyEmail} kind="outline" testId={`button-send-update-google-${draft.id}`}>{busyEmail?'Sending…':'Send by Google'}</ActionButton><ActionButton onClick={()=>onSendEmail('microsoft')} disabled={busyEmail} kind="outline" testId={`button-send-update-microsoft-${draft.id}`}>{busyEmail?'Sending…':'Send by Microsoft'}</ActionButton></>}</div></div>
    {editing ? <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); onSave(subject, body); }} data-testid={`form-edit-update-${draft.id}`}><Field label="Subject"><input value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} required className={inputClass} data-testid={`input-update-subject-${draft.id}`} /></Field><Field label="Message body"><textarea value={body} onChange={e => setBody(e.target.value)} rows={7} maxLength={10000} required className={`${inputClass} h-auto py-2`} data-testid={`input-update-body-${draft.id}`} /></Field><div className="flex justify-end gap-2"><ActionButton type="button" onClick={onCancel} kind="quiet" testId={`button-cancel-update-${draft.id}`}>Cancel</ActionButton><ActionButton type="submit" disabled={busy || !subject.trim() || !body.trim()} testId={`button-save-update-${draft.id}`}>{busy ? 'Saving…' : 'Save changes'}</ActionButton></div></form> : <div className="mt-4 rounded bg-[#f5f2e9] p-4"><h3 className="text-sm font-bold" data-testid={`text-update-subject-${draft.id}`}>{draft.subject}</h3><p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[#5f706b]" data-testid={`text-update-body-${draft.id}`}>{draft.body}</p><p className="mt-3 border-t border-[#e5dfd1] pt-2 text-[10px] text-[#8a938d]">Generated {dateLabel(draft.generatedAt)} · Based on {draft.sourceActivityIds.length} recorded activity {draft.sourceActivityIds.length === 1 ? 'item' : 'items'}</p></div>}
  </article>;
}
function Modal({ title, close, children, testId }: { title: string; close: () => void; children: ReactNode; testId: string }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#182d33]/50 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div role="dialog" aria-modal="true" aria-label={title} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-md border border-[#d9d4c8] bg-[#fbfaf5] p-5 shadow-[0_24px_70px_rgba(25,42,44,.25)] sm:p-6" data-testid={testId}><div className="mb-5 flex items-start justify-between"><div><div className="mono text-[9px] uppercase tracking-[.16em] text-[#987747]">Matter workflow</div><h2 className="serif mt-1 text-xl font-bold">{title}</h2></div><button type="button" onClick={close} className="rounded p-1 text-[#78837f] hover:bg-[#eeece4]" aria-label="Close dialog" data-testid="button-close-dialog"><X className="h-4 w-4" /></button></div>{children}</div></div>;
}
function ModalActions({ close, busy, disabled, submitTestId }: { close: () => void; busy: boolean; disabled?: boolean; submitTestId: string }) {
  return <div className="flex justify-end gap-2 border-t border-[#e9e4d9] pt-4"><ActionButton onClick={close} kind="outline" testId="button-cancel-form">Cancel</ActionButton><ActionButton type="submit" disabled={busy || disabled} testId={submitTestId}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{busy ? 'Saving…' : 'Save'}</ActionButton></div>;
}
function FormError({ message }: { message: string }) { return <p className="rounded border border-[#e6c7c1] bg-[#fff8f5] px-3 py-2 text-xs text-[#914a41]" role="alert" data-testid="status-form-error">{message}</p>; }
