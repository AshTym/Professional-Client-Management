import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useCreateIntake, useCreateIntakeDraft, useDeleteIntakeDraft, useGetIntakeDrafts, useGetIntakeOverview, useListClients, useListWorkspaceAssignmentMembers, useOpenMatterFromIntake, useReviewIntake, useSaveIntakeChecks, useSubmitIntakeDraft, useUpdateIntakeDraft, getGetClientQueryKey, getGetDashboardQueryKey, getGetIntakeDraftsQueryKey, getGetIntakeOverviewQueryKey, getListActivityQueryKey, getListClientsQueryKey, getListMattersQueryKey, getListClientMattersQueryKey } from '@workspace/api-client-react';
import type { Client, IntakeCase, IntakeDraft, IntakeDraftData, IntakeInput, IntakeRule } from '@workspace/api-client-react';
import { AlertTriangle, Check, ClipboardCheck, Plus, ShieldCheck } from 'lucide-react';

const inputClass = 'field';
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set';
const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
function prefillClientFields(form: HTMLFormElement, client: Client) {
  const set = (name: string, value: string | null) => {
    const field = form.elements.namedItem(name) as HTMLInputElement | null;
    if (field) field.value = value || '';
  };
  set('clientName', client.name);
  set('email', client.email);
  set('phone', client.phone);
  set('industry', client.industry);
  const type = form.elements.namedItem('clientType') as HTMLSelectElement | null;
  if (type) type.value = client.clientType === 'business' ? 'organization' : 'individual';
}
function clearClientFields(form: HTMLFormElement) {
  for (const name of ['clientName', 'email', 'phone', 'industry']) {
    const field = form.elements.namedItem(name) as HTMLInputElement | null;
    if (field) field.value = '';
  }
  const type = form.elements.namedItem('clientType') as HTMLSelectElement | null;
  if (type) type.value = 'individual';
}
const starterChecks: IntakeRule[] = [
  { key: 'identity', label: 'Identity and entity verification', description: 'Confirm legal name and identity or formation details.', required: true, category: 'Identity' },
  { key: 'beneficial_owners', label: 'Beneficial ownership', description: 'Record relevant ownership and control information.', required: true, category: 'Financial services' },
  { key: 'source_of_funds', label: 'Source of funds', description: 'Capture source-of-funds information where applicable.', required: false, category: 'Financial services' },
  { key: 'adverse_media', label: 'Adverse media review', description: 'Document the outcome of appropriate screening.', required: false, category: 'Risk review' },
  { key: 'engagement_scope', label: 'Engagement scope', description: 'Clarify objectives, scope, and expected outcomes.', required: true, category: 'Engagement' },
];
const intakeStatusOptions: Array<{ value: IntakeCase['status']; label: string }> = [
  { value: 'review_required', label: 'Review required' },
  { value: 'cleared', label: 'Cleared' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'converted', label: 'Converted' },
];

export default function Intake() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const overview = useGetIntakeOverview({ query: { queryKey: getGetIntakeOverviewQueryKey() } });
  const draftsQuery = useGetIntakeDrafts({ query: { queryKey: getGetIntakeDraftsQueryKey() } });
  const clients = useListClients(undefined, { query: { queryKey: getListClientsQueryKey() } });
  const assignmentMembers = useListWorkspaceAssignmentMembers();
  const saveChecks = useSaveIntakeChecks();
  const create = useCreateIntake();
  const createDraft = useCreateIntakeDraft();
  const updateDraft = useUpdateIntakeDraft();
  const deleteDraft = useDeleteIntakeDraft();
  const submitDraft = useSubmitIntakeDraft();
  const review = useReviewIntake();
  const openMatter = useOpenMatterFromIntake({
    mutation: {
      onSuccess: (matter) => {
        void Promise.all([
          qc.invalidateQueries({ queryKey: getListClientsQueryKey() }),
          qc.invalidateQueries({ queryKey: getListClientMattersQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetClientQueryKey(matter.clientId) }),
          qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
          qc.invalidateQueries({ queryKey: getListActivityQueryKey() }),
        ]);
      },
    },
  });
  const [editingChecks, setEditingChecks] = useState(false);
  const [checks, setChecks] = useState<IntakeRule[]>([]);
  const searchParams = new URLSearchParams(window.location.search);
  const initialClientId = (() => {
    const raw = searchParams.get('clientId');
    const id = Number(raw);
    return raw && Number.isSafeInteger(id) && id > 0 ? id : null;
  })();
  const isFirstMatterShortcut = searchParams.get('firstMatter') === '1';
  const [selectedClientId, setSelectedClientId] = useState<number | null>(initialClientId);
  const [formOpen, setFormOpen] = useState(searchParams.get('create') === '1');
  const intakeFormRef = useRef<HTMLFormElement>(null);
  const intakeDialogRef = useRef<HTMLElement>(null);
  const discardDialogRef = useRef<HTMLElement>(null);
  const startIntakeButtonRef = useRef<HTMLButtonElement>(null);
  const formLauncherRef = useRef<HTMLElement | null>(null);
  const discardTriggerRef = useRef<HTMLElement | null>(null);
  const formWasOpenRef = useRef(false);
  const discardWasOpenRef = useRef(false);
  const formBaselineRef = useRef<string | null>(null);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const prefilledClientIdRef = useRef<number | null>(null);
  const firstMatterClientPrefillAttemptedRef = useRef(false);
  const [selected, setSelected] = useState<IntakeCase | null>(null);
  const [activeDraft, setActiveDraft] = useState<IntakeDraft | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const records = overview.data?.intakes || [];
  const [statusFilter, setStatusFilter] = useState<IntakeCase['status'] | 'all'>('all');
  const statusCounts = records.reduce<Record<IntakeCase['status'], number>>((counts, record) => {
    counts[record.status] += 1;
    return counts;
  }, { review_required: 0, cleared: 0, rejected: 0, converted: 0 });
  const filteredRecords = statusFilter === 'all' ? records : records.filter(record => record.status === statusFilter);
  const drafts = draftsQuery.data || [];
  const rules = overview.data?.checks || starterChecks;
  const refresh = () => qc.invalidateQueries({ queryKey: getGetIntakeOverviewQueryKey() });
  const refreshDrafts = () => qc.invalidateQueries({ queryKey: getGetIntakeDraftsQueryKey() });

  useEffect(() => {
    if (formOpen) {
      if (!formWasOpenRef.current) {
        formWasOpenRef.current = true;
        const initialFocus = intakeDialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]');
        (initialFocus || intakeDialogRef.current)?.focus();
      }
      return;
    }
    if (formWasOpenRef.current) {
      formWasOpenRef.current = false;
      const launcher = formLauncherRef.current;
      const focusTarget = launcher?.isConnected ? launcher : startIntakeButtonRef.current;
      focusTarget?.focus();
      formLauncherRef.current = null;
    }
  }, [formOpen]);

  useEffect(() => {
    if (discardConfirmationOpen) {
      discardWasOpenRef.current = true;
      discardDialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    } else if (discardWasOpenRef.current && formOpen) {
      discardWasOpenRef.current = false;
      discardTriggerRef.current?.focus();
      discardTriggerRef.current = null;
    }
  }, [discardConfirmationOpen, formOpen]);

  useEffect(() => {
    if (!isFirstMatterShortcut || initialClientId !== null || firstMatterClientPrefillAttemptedRef.current || !clients.data) return;
    firstMatterClientPrefillAttemptedRef.current = true;
    if (clients.data.length === 1) setSelectedClientId(clients.data[0].id);
  }, [clients.data, initialClientId, isFirstMatterShortcut]);

  useEffect(() => {
    if (!formOpen || activeDraft || selectedClientId === null || !clients.data) return;
    const client = clients.data.find(item => item.id === selectedClientId);
    if (!client) {
      setSelectedClientId(null);
      return;
    }
    if (intakeFormRef.current && prefilledClientIdRef.current !== client.id) {
      prefillClientFields(intakeFormRef.current, client);
      prefilledClientIdRef.current = client.id;
    }
  }, [activeDraft, clients.data, formOpen, selectedClientId]);

  useEffect(() => {
    const form = intakeFormRef.current;
    if (!formOpen || !activeDraft || !form) return;
    const data = activeDraft.data;
    const setValue = (name: string, value: string) => {
      const field = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
      if (field) field.value = value;
    };
    setSelectedClientId(data.clientId);
    setValue('clientName', data.clientName);
    setValue('email', data.email || '');
    setValue('phone', data.phone || '');
    setValue('industry', data.industry || '');
    setValue('matterTitle', data.matterTitle);
    setValue('matterType', data.matterType);
    setValue('dueAt', data.dueAt || '');
    setValue('partyNames', data.partyNames.join('\n'));
    const clientType = form.elements.namedItem('clientType') as HTMLSelectElement | null;
    if (clientType) clientType.value = data.clientType;
    const responsible = form.elements.namedItem('responsibleMemberId') as HTMLSelectElement | null;
    if (responsible) responsible.value = data.responsibleMemberId === null ? '' : String(data.responsibleMemberId);
    for (const rule of rules) setValue(`answer-${rule.key}`, data.answers[rule.key] || '');
  }, [activeDraft, assignmentMembers.data, formOpen, rules]);

  useEffect(() => {
    if (!formOpen) {
      formBaselineRef.current = null;
      return;
    }
    if (formBaselineRef.current !== null) return;
    if (!activeDraft && selectedClientId !== null && clients.isLoading) return;
    if (!activeDraft && selectedClientId !== null
      && clients.data?.some(client => client.id === selectedClientId)
      && prefilledClientIdRef.current !== selectedClientId) return;
    if (!activeDraft && isFirstMatterShortcut && clients.data?.length === 1
      && selectedClientId === null) return;
    const form = intakeFormRef.current;
    if (!form) return;
    const initialData = activeDraft?.data ?? readDraftData(form);
    formBaselineRef.current = JSON.stringify({
      ...initialData,
      answers: Object.fromEntries(rules.map(rule => [rule.key, initialData.answers[rule.key] || ''])),
    });
  }, [activeDraft, clients.data, clients.isLoading, formOpen, isFirstMatterShortcut, rules, selectedClientId]);

  function hasUnsavedChanges() {
    const form = intakeFormRef.current;
    return !!form && formBaselineRef.current !== null
      && JSON.stringify(readDraftData(form)) !== formBaselineRef.current;
  }

  function closeForm() {
    setDiscardConfirmationOpen(false);
    setFormOpen(false);
    const params = new URLSearchParams(window.location.search);
    params.delete('create');
    const query = params.toString();
    setLocation(`/intake${query ? `?${query}` : ''}`, { replace: true });
    setSelectedClientId(initialClientId);
    setActiveDraft(null);
    prefilledClientIdRef.current = null;
  }

  function requestCloseForm() {
    if (hasUnsavedChanges()) {
      discardTriggerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setDiscardConfirmationOpen(true);
      return;
    }
    closeForm();
  }

  useEffect(() => {
    if (!formOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (discardConfirmationOpen) {
          setDiscardConfirmationOpen(false);
        } else {
          requestCloseForm();
        }
        return;
      }
      if (event.key !== 'Tab') return;

      const activeDialog = discardConfirmationOpen ? discardDialogRef.current : intakeDialogRef.current;
      if (!activeDialog) return;
      const focusable = Array.from(activeDialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element => !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (!activeDialog.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [discardConfirmationOpen, formOpen]);

  function readDraftData(form: HTMLFormElement): IntakeDraftData {
    const values = new FormData(form);
    const clientId = Number(values.get('clientId'));
    const responsibleMemberId = Number(values.get('responsibleMemberId'));
    const dueAt = String(values.get('dueAt') || '');
    const parties = String(values.get('partyNames') || '').split(/\n|,/).map(s => s.trim()).filter(Boolean);
    const answers = Object.fromEntries(rules.map(rule => [rule.key, String(values.get(`answer-${rule.key}`) || '')]));
    return {
      clientId: Number.isSafeInteger(clientId) && clientId > 0 ? clientId : null,
      clientName: String(values.get('clientName') || ''),
      clientType: String(values.get('clientType') || 'individual') as IntakeDraftData['clientType'],
      email: String(values.get('email') || '') || null,
      phone: String(values.get('phone') || '') || null,
      industry: String(values.get('industry') || '') || null,
      matterTitle: String(values.get('matterTitle') || ''),
      matterType: String(values.get('matterType') || ''),
      responsibleMemberId: Number.isSafeInteger(responsibleMemberId) && responsibleMemberId > 0 ? responsibleMemberId : null,
      dueAt: dueAt || null,
      partyNames: parties,
      answers,
    };
  }

  function saveCurrentDraft() {
    const form = intakeFormRef.current;
    if (!form) return;
    setError('');
    const data = readDraftData(form);
    const saved = () => {
      void refreshDrafts();
      closeForm();
      setNotice('Intake draft saved. Firm teammates can resume it later.');
    };
    const failed = (e: unknown) => setError(message(e));
    if (activeDraft) {
      updateDraft.mutate({ id: activeDraft.id, data }, { onSuccess: saved, onError: failed });
    } else {
      createDraft.mutate({ data }, { onSuccess: saved, onError: failed });
    }
  }

  function discardDraft(draft: IntakeDraft) {
    if (!window.confirm('Discard this saved intake draft? This cannot be undone.')) return;
    deleteDraft.mutate({ id: draft.id }, {
      onSuccess: () => {
        void refreshDrafts();
        if (activeDraft?.id === draft.id) closeForm();
        setNotice('Intake draft discarded.');
      },
      onError: e => setError(message(e)),
    });
  }

  function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    const parties = String(form.get('partyNames') || '').split(/\n|,/).map(s => s.trim()).filter(Boolean);
    const answers = Object.fromEntries(rules.map(rule => [rule.key, String(form.get(`answer-${rule.key}`) || '')]));
    const clientId = String(form.get('clientId') || '');
    const responsibleMemberId = Number(form.get('responsibleMemberId'));
    const responsibleMember = assignmentMembers.data?.find(member => member.id === responsibleMemberId);
    if (!responsibleMember) { setError('Select an active teammate for this matter.'); return; }
    const input: IntakeInput = {
      clientId: clientId ? Number(clientId) : null,
      clientName: String(form.get('clientName')).trim(),
      clientType: String(form.get('clientType')) as IntakeInput['clientType'],
      email: String(form.get('email') || '') || null,
      phone: String(form.get('phone') || '') || null,
      industry: String(form.get('industry') || '') || null,
      matterTitle: String(form.get('matterTitle')).trim(),
      matterType: String(form.get('matterType')).trim(),
      responsibleMemberId,
      responsible: responsibleMember.name || responsibleMember.email,
      dueAt: String(form.get('dueAt') || '') || null,
      partyNames: parties,
      answers,
    };
    const submitted = () => {
      void refresh();
      void refreshDrafts();
      void qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
      void qc.invalidateQueries({ queryKey: getListMattersQueryKey() });
      closeForm();
      setNotice('Intake submitted for professional review.');
    };
    if (activeDraft) {
      submitDraft.mutate({ id: activeDraft.id, data: input }, { onSuccess: submitted, onError: e => setError(message(e)) });
    } else {
      create.mutate({ data: input }, { onSuccess: submitted, onError: e => setError(message(e)) });
    }
  }

  function decision(record: IntakeCase, action: 'cleared' | 'rejected') {
    const note = window.prompt(action === 'cleared' ? 'Add a professional review note' : 'Explain why this intake is rejected');
    if (!note?.trim()) return;
    review.mutate({ id: record.id, data: { decision: action, note: note.trim(), conflictsResolved: action === 'cleared' ? window.confirm('Have all potential conflict findings been resolved?') : false } }, {
      onSuccess: () => { refresh(); setSelected(null); setNotice(action === 'cleared' ? 'Intake cleared for matter opening.' : 'Intake rejected.'); },
      onError: e => setError(message(e)),
    });
  }

  if (overview.isLoading) return <div className="space-y-4" aria-label="Loading intake"><div className="h-28 animate-pulse rounded bg-[#e8e4d9]" /><div className="h-64 animate-pulse rounded bg-[#eeeae0]" /></div>;
  if (overview.isError) return <div className="rounded-md border border-[#e6c7c1] bg-[#fff9f6] p-6"><p className="font-semibold text-[#843f38]">Intake records unavailable</p><button className="mt-3 underline" onClick={() => overview.refetch()}>Try again</button></div>;

  return <div data-testid="page-intake">
    <header className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#987747]">Relationship acceptance / professional review</div><h1 className="serif text-3xl font-bold md:text-[38px]">Client intake</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#72807f]">Collect the context needed to evaluate a relationship, surface potential conflicts, and keep matter opening behind a human decision.</p></div><button ref={startIntakeButtonRef} onClick={() => { formLauncherRef.current = startIntakeButtonRef.current; setError(''); setActiveDraft(null); setSelectedClientId(initialClientId); setFormOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-md bg-[#294651] px-4 py-3 text-sm font-semibold text-[#fbf8ee] hover:bg-[#1c3943]" data-testid="button-start-intake"><Plus className="h-4 w-4" />Start intake</button></header>
    {notice && <div role="status" className="mb-5 rounded border border-[#c9d8cc] bg-[#edf3ed] px-4 py-3 text-sm text-[#42664f]">{notice}</div>}
    {error && <div role="alert" className="mb-5 rounded border border-[#e6c7c1] bg-[#fff9f6] px-4 py-3 text-sm text-[#843f38]">{error}</div>}
    <section className="mb-7 overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5]">
      <div className="flex flex-col justify-between gap-3 border-b border-[#e9e4d9] px-5 py-4 sm:flex-row sm:items-center"><div><h2 className="serif text-lg font-bold">Onboarding checks</h2><p className="mt-1 text-xs text-[#87918d]">Configure the firm's law and financial-service intake prompts.</p></div><button onClick={() => { setChecks([...rules]); setEditingChecks(!editingChecks); }} className="rounded border border-[#d9d4c8] px-3 py-2 text-xs font-bold" data-testid="button-edit-intake-checks">{editingChecks ? 'Cancel editing' : 'Configure checks'}</button></div>
      {!editingChecks ? <div className="divide-y divide-[#eee9df]">{rules.map(rule => <div key={rule.key} className="flex gap-3 px-5 py-3"><span className="mt-0.5 text-[#54816a]"><ShieldCheck className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{rule.label}{rule.required && <span className="rounded-full bg-[#f3eddd] px-2 py-0.5 text-[9px] uppercase tracking-wide text-[#8d713e]">Required</span>}</div><p className="mt-1 text-xs text-[#788581]">{rule.description}</p></div><span className="hidden text-[10px] text-[#929993] sm:block">{rule.category}</span></div>)}</div> : <div className="space-y-3 p-5">{checks.map((rule, index) => <div key={rule.key} className="grid gap-2 rounded border border-[#e9e4d9] p-3 sm:grid-cols-[1fr_1.2fr_1fr_auto]"><input aria-label="Check label" className={inputClass} value={rule.label} onChange={e => setChecks(checks.map((x,i)=>i===index?{...x,label:e.target.value}:x))} /><input aria-label="Check description" className={inputClass} value={rule.description} onChange={e => setChecks(checks.map((x,i)=>i===index?{...x,description:e.target.value}:x))} /><input aria-label="Check category" className={inputClass} value={rule.category} onChange={e => setChecks(checks.map((x,i)=>i===index?{...x,category:e.target.value}:x))} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rule.required} onChange={e => setChecks(checks.map((x,i)=>i===index?{...x,required:e.target.checked}:x))} />Required</label></div>)}<div className="flex flex-wrap justify-between gap-2"><button onClick={() => setChecks([...checks,{key:`check_${Date.now()}`,label:'New onboarding check',description:'',required:false,category:'General'}])} className="text-xs font-semibold text-[#405c60]">Add a check</button><button disabled={saveChecks.isPending} onClick={() => saveChecks.mutate({data:{checks}}, {onSuccess:()=>{refresh();setEditingChecks(false);setNotice('Intake checks saved.');},onError:e=>setError(message(e))})} className="rounded bg-[#294651] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saveChecks.isPending?'Saving…':'Save checks'}</button></div></div>}
    </section>
    <section className="mb-7 overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5]" data-testid="section-intake-drafts"><div className="flex items-center justify-between border-b border-[#e9e4d9] px-5 py-4"><div><h2 className="serif text-lg font-bold">Saved drafts</h2><p className="mt-1 text-xs text-[#87918d]">Incomplete intakes stay here until someone submits or discards them.</p></div><span className="mono rounded bg-[#f0ece2] px-2.5 py-1 text-[10px]">{drafts.length} saved</span></div>{draftsQuery.isError ? <div className="p-5 text-sm text-[#843f38]">Saved drafts could not be loaded. <button className="underline" onClick={() => draftsQuery.refetch()}>Try again</button></div> : draftsQuery.isLoading ? <div className="p-5 text-sm text-[#788581]">Loading saved drafts…</div> : !drafts.length ? <div className="p-5 text-sm text-[#788581]">No saved drafts. You can save an intake at any point and return to it later.</div> : <div className="divide-y divide-[#eee9df]">{drafts.map(draft => <article key={draft.id} className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center" data-testid={`intake-draft-${draft.id}`}><div className="min-w-0"><h3 className="text-sm font-bold">{draft.data.clientName.trim() || 'Untitled client intake'}</h3><p className="mt-1 text-xs text-[#7c8984]">{draft.data.matterTitle.trim() || 'Matter details not set'}{draft.data.matterType.trim() ? ` · ${draft.data.matterType}` : ''}</p><p className="mono mt-2 text-[10px] text-[#929993]">Last saved {date(draft.updatedAt)}</p></div><div className="flex shrink-0 gap-2"><button onClick={event => { formLauncherRef.current = event.currentTarget; setError(''); setActiveDraft(draft); setSelectedClientId(draft.data.clientId); setFormOpen(true); }} className="rounded bg-[#294651] px-3 py-2 text-xs font-bold text-white" data-testid={`button-resume-intake-draft-${draft.id}`}>Resume</button><button disabled={deleteDraft.isPending} onClick={() => discardDraft(draft)} className="rounded border border-[#e5c8c2] px-3 py-2 text-xs font-bold text-[#98483f] disabled:opacity-50" data-testid={`button-discard-intake-draft-${draft.id}`}>Discard</button></div></article>)}</div>}</section>
    <section className="overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5]" data-testid="section-intake-queue">
      <div className="flex flex-col justify-between gap-3 border-b border-[#e9e4d9] px-5 py-4 sm:flex-row sm:items-center">
        <div><h2 className="serif text-lg font-bold">Intake queue</h2><p className="mt-1 text-xs text-[#87918d]">Conflicts are indicators for review, not determinations.</p></div>
        <span className="mono rounded bg-[#f0ece2] px-2.5 py-1 text-[10px]">{statusCounts.review_required} awaiting</span>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-[#e9e4d9] px-5 py-3" role="group" aria-label="Filter intake records by status">
        <button type="button" onClick={() => setStatusFilter('all')} aria-pressed={statusFilter === 'all'} data-testid="button-filter-intake-all" className={`rounded border px-3 py-2 text-xs font-semibold ${statusFilter === 'all' ? 'border-[#294651] bg-[#294651] text-white' : 'border-[#d9d4c8] hover:bg-[#f0ece2]'}`}>
          All statuses <span className="mono ml-1">{records.length}</span>
        </button>
        {intakeStatusOptions.map(({ value, label }) => (
          <button key={value} type="button" onClick={() => setStatusFilter(value)} aria-pressed={statusFilter === value} data-testid={`button-filter-intake-${value}`} className={`rounded border px-3 py-2 text-xs font-semibold ${statusFilter === value ? 'border-[#294651] bg-[#294651] text-white' : 'border-[#d9d4c8] hover:bg-[#f0ece2]'}`}>
            {label} <span className="mono ml-1">{statusCounts[value]}</span>
          </button>
        ))}
      </div>
      {!filteredRecords.length ? (
        <div className="p-8 text-center">
          <ClipboardCheck className="mx-auto h-7 w-7 text-[#799183]" />
          <p className="serif mt-3 text-lg font-bold">{records.length ? 'No records with this status' : 'No intake records'}</p>
          <p className="mt-1 text-sm text-[#788581]">{records.length ? 'Choose another status or show the full queue.' : 'New relationships and matters begin with a documented review.'}</p>
          {records.length > 0 && statusFilter !== 'all' && <button type="button" onClick={() => setStatusFilter('all')} className="mt-3 rounded border border-[#d9d4c8] px-3 py-2 text-xs font-bold hover:bg-[#f0ece2]" data-testid="button-clear-intake-filter">Show all intake records</button>}
        </div>
      ) : (
        <div className="divide-y divide-[#eee9df]">{filteredRecords.map(record => <article key={record.id} className="px-5 py-4" data-testid={`intake-case-${record.id}`}>
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{record.clientName}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${record.status === 'cleared' ? 'bg-[#e5eee7] text-[#47725b]' : record.status === 'rejected' ? 'bg-[#f7e6e1] text-[#9d5045]' : 'bg-[#f3eddd] text-[#8d713e]'}`}>{record.status.replaceAll('_', ' ')}</span></div>
              <p className="mt-1 text-xs text-[#7c8984]">{record.matterTitle} · {record.matterType} · {record.responsible}</p>
              <p className="mono mt-2 text-[10px] text-[#929993]">Submitted {date(record.createdAt)} · {record.clientType}{record.email ? ` · ${record.email}` : ''}</p>
            </div>
            <button onClick={() => setSelected(record)} className="rounded border border-[#d9d4c8] px-3 py-2 text-xs font-bold hover:bg-[#f0ece2]" data-testid={`button-review-intake-${record.id}`}>Review record</button>
          </div>
          {record.conflictFindings.length > 0 && <div className="mt-4 rounded border border-[#e8d6b0] bg-[#faf4e6] p-3"><div className="flex items-center gap-2 text-xs font-bold text-[#775b2d]"><AlertTriangle className="h-3.5 w-3.5" />Potential conflict matches · review required</div><div className="mt-2 flex flex-wrap gap-2">{record.conflictFindings.map((f, i) => <span key={`${f.recordType}-${f.recordId}-${i}`} className="rounded border border-[#e6d8ba] bg-[#fffaf0] px-2 py-1 text-[10px] text-[#6f6047]">{f.name} ↔ {f.recordLabel} ({f.recordType})</span>)}</div></div>}
          {record.status === 'cleared' && <div className="mt-3 flex justify-end"><button disabled={openMatter.isPending} onClick={() => openMatter.mutate({ id: record.id }, { onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: getListMattersQueryKey() }); qc.invalidateQueries({ queryKey: getListClientMattersQueryKey() }); setNotice('Matter opened from the cleared intake.'); }, onError: e => setError(message(e)) })} className="inline-flex items-center gap-2 rounded bg-[#294651] px-3 py-2 text-xs font-bold text-white disabled:opacity-50" data-testid={`button-open-matter-${record.id}`}><Check className="h-3.5 w-3.5" />{record.openedMatterId ? 'Matter opened' : 'Open matter'}</button></div>}
        </article>)}</div>
      )}
    </section>
      {formOpen && <div className="fixed inset-0 z-40 grid place-items-center bg-[#1b3035]/45 p-3" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)requestCloseForm();}}><section ref={intakeDialogRef} role="dialog" aria-modal="true" aria-labelledby="intake-dialog-title" tabIndex={-1} className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#dcd6c9] bg-[#fbfaf5] p-5 shadow-2xl md:p-7"><div className="mb-5 flex items-start justify-between"><div><div className="mono text-[10px] uppercase tracking-[.16em] text-[#987747]">01 / Relationship details</div><h2 id="intake-dialog-title" className="serif mt-2 text-2xl font-bold">{activeDraft ? 'Resume client intake draft' : 'Start a client intake'}</h2><p className="mt-1 text-sm text-[#788581]">Submitting does not open a matter. A professional must review the findings first.</p></div><button onClick={requestCloseForm} aria-label="Close intake" className="rounded px-2 py-1 text-xl">×</button></div><form ref={intakeFormRef} onSubmit={submitIntake} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold sm:col-span-2">Existing client relationship, if applicable<select data-dialog-initial-focus name="clientId" className={`${inputClass} mt-1.5`} data-testid="select-intake-client" value={selectedClientId ?? ''} onChange={event=>{const id=Number(event.currentTarget.value);const client=clients.data?.find(item=>item.id===id);setSelectedClientId(client?.id??null);if(client&&event.currentTarget.form){prefillClientFields(event.currentTarget.form,client);prefilledClientIdRef.current=client.id;}else{prefilledClientIdRef.current=null;if(event.currentTarget.form)clearClientFields(event.currentTarget.form);}}}><option value="">New client prospect</option>{activeDraft?.data.clientId && !clients.data?.some(client=>client.id===activeDraft.data.clientId) && <option value={activeDraft.data.clientId}>Previously selected client (unavailable)</option>}{(clients.data||[]).map(client=><option key={client.id} value={client.id}>{client.name} · {client.email||client.clientType}</option>)}</select><span className="mt-1 block text-[10px] font-normal text-[#87918d]">Select an existing relationship to prefill its record. New prospects will be checked against existing records during review.</span></label><label className="text-xs font-semibold">Client / entity name<input required name="clientName" className={`${inputClass} mt-1.5`} maxLength={200} /></label><label className="text-xs font-semibold">Client type<select name="clientType" className={`${inputClass} mt-1.5`}><option value="individual">Individual</option><option value="organization">Organization</option></select></label><label className="text-xs font-semibold">Email<input name="email" type="email" className={`${inputClass} mt-1.5`} /></label><label className="text-xs font-semibold">Phone<input name="phone" className={`${inputClass} mt-1.5`} /></label><label className="text-xs font-semibold sm:col-span-2">Industry / practice area<input name="industry" className={`${inputClass} mt-1.5`} maxLength={160} /></label></div>
       <div className="border-t border-[#e9e4d9] pt-4"><h3 className="serif text-lg font-bold">Proposed matter</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Matter title<input required name="matterTitle" className={`${inputClass} mt-1.5`} maxLength={240} /></label><label className="text-xs font-semibold">Matter type<input required name="matterType" className={`${inputClass} mt-1.5`} maxLength={160} placeholder="Advisory, transaction, estate…" /></label><label className="text-xs font-semibold">Responsible teammate<select required name="responsibleMemberId" className={`${inputClass} mt-1.5`} defaultValue="" data-testid="select-intake-responsible" disabled={assignmentMembers.isLoading || assignmentMembers.isError}><option value="">Select a teammate</option>{activeDraft?.data.responsibleMemberId && !assignmentMembers.data?.some(member=>member.id===activeDraft.data.responsibleMemberId) && <option value={activeDraft.data.responsibleMemberId}>Previously selected teammate (unavailable)</option>}{(assignmentMembers.data || []).map(member=><option key={member.id} value={member.id}>{member.name || member.email} · {member.role}</option>)}</select>{assignmentMembers.isError&&<span className="mt-1 block font-normal text-[#9b4941]">Teammates could not be loaded. <button type="button" className="underline" onClick={()=>assignmentMembers.refetch()}>Try again</button></span>}</label><label className="text-xs font-semibold">Target due date<input name="dueAt" type="date" className={`${inputClass} mt-1.5`} /></label><label className="text-xs font-semibold sm:col-span-2">Related parties, one per line<textarea name="partyNames" className={`${inputClass} mt-1.5 h-20 py-2`} placeholder="Names to include in conflict screening" /></label></div></div>
      <div className="border-t border-[#e9e4d9] pt-4"><h3 className="serif text-lg font-bold">Onboarding checks</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{rules.map(rule=><label key={rule.key} className="text-xs font-semibold">{rule.label}{rule.required&&<span className="ml-1 text-[#987747]">Required</span>}<textarea name={`answer-${rule.key}`} required={rule.required} className={`${inputClass} mt-1.5 h-16 py-2`} placeholder={rule.description} /></label>)}</div></div>
        {error&&<p role="alert" className="text-xs text-[#9b4941]">{error}</p>}<div className="flex flex-wrap justify-end gap-2 border-t border-[#e9e4d9] pt-4"><button type="button" onClick={requestCloseForm} className="rounded border border-[#d9d4c8] px-4 py-2.5 text-xs font-bold">Close</button>{activeDraft&&<button type="button" disabled={deleteDraft.isPending} onClick={()=>discardDraft(activeDraft)} className="rounded border border-[#e5c8c2] px-4 py-2.5 text-xs font-bold text-[#98483f] disabled:opacity-50">Discard draft</button>}<button type="button" disabled={createDraft.isPending||updateDraft.isPending||deleteDraft.isPending} onClick={saveCurrentDraft} className="rounded border border-[#294651] px-4 py-2.5 text-xs font-bold text-[#294651] disabled:opacity-50" data-testid="button-save-intake-draft">{createDraft.isPending||updateDraft.isPending?'Saving…':activeDraft?'Save changes':'Save draft'}</button><button disabled={create.isPending||submitDraft.isPending} className="rounded bg-[#294651] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50" data-testid="button-submit-intake">{create.isPending||submitDraft.isPending?'Submitting…':'Submit for review'}</button></div>
    </form></section></div>}
      {discardConfirmationOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-[#1b3035]/55 p-4" role="presentation"><section ref={discardDialogRef} role="alertdialog" aria-modal="true" aria-labelledby="discard-intake-title" aria-describedby="discard-intake-description" tabIndex={-1} className="w-full max-w-md rounded-lg border border-[#dcd6c9] bg-[#fbfaf5] p-6 shadow-2xl"><h2 id="discard-intake-title" className="serif text-xl font-bold">Discard unsaved intake changes?</h2><p id="discard-intake-description" className="mt-2 text-sm leading-6 text-[#697873]">Your latest edits have not been saved. Keep editing or discard these changes and close the intake.</p><div className="mt-6 flex justify-end gap-2"><button data-dialog-initial-focus type="button" onClick={() => setDiscardConfirmationOpen(false)} className="rounded border border-[#d9d4c8] px-4 py-2.5 text-xs font-bold">Keep editing</button><button type="button" onClick={closeForm} className="rounded bg-[#98483f] px-4 py-2.5 text-xs font-bold text-white">Discard changes</button></div></section></div>}
    {selected&&<div className="fixed inset-0 z-40 grid place-items-center bg-[#1b3035]/45 p-3"><section role="dialog" aria-modal="true" className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#dcd6c9] bg-[#fbfaf5] p-6 shadow-2xl"><div className="flex justify-between"><div><div className="mono text-[10px] uppercase tracking-wide text-[#987747]">Professional review · #{selected.id}</div><h2 className="serif mt-2 text-2xl font-bold">{selected.clientName}</h2></div><button onClick={()=>setSelected(null)} aria-label="Close review">Close</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{[['Proposed matter',selected.matterTitle],['Type',selected.matterType],['Responsible',selected.responsible],['Due date',date(selected.dueAt)],['Email',selected.email||'Not provided'],['Phone',selected.phone||'Not provided']].map(([label,value])=><div key={label} className="rounded bg-[#f2efe6] p-3"><div className="text-[10px] uppercase tracking-wide text-[#8a938c]">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div>)}</div><div className="mt-4"><h3 className="text-xs font-bold uppercase tracking-wide text-[#75817e]">Intake responses</h3>{Object.entries(selected.answers).map(([key,value])=><div key={key} className="border-b border-[#e9e4d9] py-3"><div className="text-xs font-semibold">{rules.find(r=>r.key===key)?.label||key}</div><p className="mt-1 whitespace-pre-wrap text-sm text-[#637370]">{value||'No response'}</p></div>)}</div>{selected.conflictFindings.length>0&&<div className="mt-4 rounded border border-[#e8d6b0] bg-[#faf4e6] p-4"><h3 className="text-xs font-bold text-[#775b2d]">Potential matches to resolve</h3>{selected.conflictFindings.map((f,i)=><p key={i} className="mt-2 text-sm">{f.name} — {f.recordLabel} ({f.recordType})</p>)}</div>}<div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={()=>decision(selected,'rejected')} disabled={review.isPending||selected.status!=='review_required'} className="rounded border border-[#e5c8c2] px-4 py-2.5 text-xs font-bold text-[#98483f] disabled:opacity-50">Reject</button><button onClick={()=>decision(selected,'cleared')} disabled={review.isPending||selected.status!=='review_required'} className="rounded bg-[#294651] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Check className="mr-1 inline h-3.5 w-3.5" />Clear for opening</button></div></section></div>}
  </div>;
}
