import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPracticeSettingsQueryKey, getGetTrustOverviewQueryKey, getListEngagementLettersQueryKey,
  useCreateEngagementLetter, useCreateTrustAccount,
  useCreateTrustEntry, useDecideTrustEntry, useGetPracticeSettings, useGetTrustAccountStatement,
  getGetTrustAccountStatementQueryKey, useGetTrustOverview, useImportTrustStatement,
  useListEngagementLetters, useListMatters, useListWorkspaceIntegrations, useMatchTrustStatementLine,
  useSendEngagementLetter, useSyncEngagementLetter, useUpdatePracticeSettings, useGetWorkspace,
} from '@workspace/api-client-react';
import type { GetTrustAccountStatementParams, TrustStatementLineInput } from '@workspace/api-client-react';
import { AlertTriangle, FileSignature, Landmark, Plus, Printer, RefreshCw, ShieldCheck } from 'lucide-react';

const jurisdictions = ['Australia', 'USA', 'Great Britain'] as const;
const panel = 'rounded-md border border-[#e0dace] bg-[#fbfaf5]';
const button = 'inline-flex items-center justify-center gap-2 rounded-md bg-[#294651] px-3.5 py-2.5 text-xs font-semibold text-[#f9f6ed] transition hover:bg-[#1c3943] disabled:cursor-not-allowed disabled:opacity-50';
const outlined = 'inline-flex items-center justify-center gap-2 rounded-md border border-[#d9d4c8] bg-[#fbfaf5] px-3 py-2 text-xs font-semibold text-[#40575b] transition hover:bg-[#f1eee6] disabled:opacity-50';
const dateLabel = (s?: string | null) => s ? new Date(s).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
const money = (cents: number, currency = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
const errText = (e: unknown) => e instanceof Error ? e.message : 'The request could not be completed. Try again or contact a firm administrator.';
function parseCsvRows(text: string): { rows: string[][]; error?: string } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(v => v.length)) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) return { rows: [], error: 'CSV has an unterminated quoted field.' };
  row.push(cell.trim());
  if (row.some(v => v.length)) rows.push(row);
  return { rows };
}
function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function Notice({ error, success }: { error?: string; success?: string }) {
  return <>{error && <p role="alert" className="rounded border border-[#e6c7c1] bg-[#fff9f6] px-3 py-2.5 text-xs leading-5 text-[#843f38]">{error}</p>}{success && <p role="status" className="rounded border border-[#c9d8cc] bg-[#edf3ed] px-3 py-2.5 text-xs text-[#42664f]">{success}</p>}</>;
}

export default function PracticeOperations() {
  const qc = useQueryClient();
  const settings = useGetPracticeSettings();
  const letters = useListEngagementLetters();
  const trust = useGetTrustOverview();
  const matters = useListMatters();
  const integrations = useListWorkspaceIntegrations();
  const workspace = useGetWorkspace();
  const saveSettings = useUpdatePracticeSettings();
  const createLetter = useCreateEngagementLetter();
  const sendLetter = useSendEngagementLetter();
  const syncLetter = useSyncEngagementLetter();
  const createAccount = useCreateTrustAccount();
  const createEntry = useCreateTrustEntry();
  const decideEntry = useDecideTrustEntry();
  const importStatement = useImportTrustStatement();
  const matchLine = useMatchTrustStatementLine();
  const [jurisdiction, setJurisdiction] = useState<string[]>([]);
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedMatter, setSelectedMatter] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [statementParams, setStatementParams] = useState<GetTrustAccountStatementParams | null>(null);
  const statement = useGetTrustAccountStatement(statementParams || { accountId: 0, matterId: 0, from: '', to: '' }, {
    query: { queryKey: getGetTrustAccountStatementQueryKey(statementParams || { accountId: 0, matterId: 0, from: '', to: '' }), enabled: !!statementParams },
  });
  const docusign = integrations.data?.find(x => x.provider === 'docusign');
  const ownEntry = (creator: string) => {
    if (!workspace.data) return true;
    const identity = [workspace.data.name, workspace.data.email, workspace.data.userId].filter(Boolean).map(x => x!.trim().toLowerCase());
    return identity.some(value => value === creator.trim().toLowerCase());
  };

  useEffect(() => {
    if (!settings.data || settingsReady) return;
    setJurisdiction(settings.data.supportedJurisdictions);
    setRequiresSignature(settings.data.requireEngagementSignature);
    setSettingsReady(true);
  }, [settings.data, settingsReady]);

  function savePractice(e: FormEvent) {
    e.preventDefault(); setError(''); setSuccess('');
    if (!jurisdiction.length) { setError('Select at least one supported jurisdiction.'); return; }
    saveSettings.mutate({ data: { supportedJurisdictions: jurisdiction as ('Australia' | 'USA' | 'Great Britain')[], requireEngagementSignature: requiresSignature } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetPracticeSettingsQueryKey() }); setSuccess('Practice settings saved.'); },
      onError: e => setError(errText(e)),
    });
  }
  function makeLetter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setSuccess('');
    const form = e.currentTarget;
    const f = new FormData(form);
    const id = Number(f.get('matterId'));
    createLetter.mutate({ id, data: { clientEmail: String(f.get('clientEmail')).trim(), scope: String(f.get('scope')).trim() } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListEngagementLettersQueryKey() }); setSuccess('Draft engagement letter created from the matter scope and billing snapshot.'); form.reset(); },
      onError: e => setError(errText(e)),
    });
  }
  function letterAction(id: number, action: 'send' | 'sync') {
    setError(''); setSuccess('');
    const mutation = action === 'send' ? sendLetter : syncLetter;
    mutation.mutate({ id }, {
      onSuccess: result => {
        qc.invalidateQueries({ queryKey: getListEngagementLettersQueryKey() });
        setSuccess(action === 'send' ? 'Sent to DocuSign. Signature status will remain pending until the provider confirms it.' : `Provider status synchronized: ${'status' in result ? result.status : 'updated'}.`);
      },
      onError: e => setError(errText(e)),
    });
  }
  function makeAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setSuccess('');
    const form = e.currentTarget;
    const f = new FormData(form);
    createAccount.mutate({ data: { name: String(f.get('name')), jurisdiction: String(f.get('jurisdiction')) as 'Australia' | 'USA' | 'Great Britain', currency: String(f.get('currency')).toUpperCase(), accountReference: String(f.get('reference')) || null, requireSecondApproval: true } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTrustOverviewQueryKey() }); setSuccess('Trust recordkeeping account created.'); form.reset(); },
      onError: e => setError(errText(e)),
    });
  }
  function addEntry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setSuccess('');
    const form = e.currentTarget;
    const f = new FormData(form);
    const dollars = Number(f.get('amount'));
    if (!Number.isFinite(dollars) || dollars <= 0) { setError('Enter a positive amount.'); return; }
    createEntry.mutate({ data: { accountId: Number(f.get('accountId')), matterId: Number(f.get('matterId')), entryType: String(f.get('entryType')) as 'deposit' | 'disbursement', amountCents: Math.round(dollars * 100), entryDate: String(f.get('entryDate')), description: String(f.get('description')), reference: String(f.get('reference')) || null } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTrustOverviewQueryKey() }); setSuccess('Ledger record proposed. A different authorized teammate must approve it. No money was moved.'); form.reset(); },
      onError: e => setError(errText(e)),
    });
  }
  function decide(id: number, decision: 'approve' | 'reject') {
    const note = window.prompt(decision === 'approve' ? 'Approval note (required)' : 'Reason for rejection (required)');
    if (!note?.trim()) return;
    setError(''); setSuccess('');
    decideEntry.mutate({ id, data: { decision, note: note.trim() } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTrustOverviewQueryKey() }); setSuccess(`Ledger entry ${decision === 'approve' ? 'approved' : 'rejected'}.`); },
      onError: e => setError(errText(e)),
    });
  }
  function importManual(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setSuccess('');
    const form = e.currentTarget;
    const f = new FormData(form);
    const amountRaw = String(f.get('manualAmount'));
    const openingRaw = String(f.get('opening'));
    const closingRaw = String(f.get('closing'));
    const date = String(f.get('lineDate'));
    const start = String(f.get('periodStart'));
    const end = String(f.get('periodEnd'));
    const description = String(f.get('manualDescription')).trim();
    const toCents = (value: string) => Math.round(Number(value) * 100);
    if (!selectedAccount) { setError('Select a trust account before recording a statement.'); return; }
    if (!description || !/^[-]?\d+(\.\d{1,2})?$/.test(amountRaw) || !/^[-]?\d+(\.\d{1,2})?$/.test(openingRaw) || !/^[-]?\d+(\.\d{1,2})?$/.test(closingRaw) || !validIsoDate(date) || !validIsoDate(start) || !validIsoDate(end) || start > end || date < start || date > end) {
      setError('Manual statement not recorded. Check the amount precision, dates, and statement period.'); return;
    }
    if (toCents(openingRaw) + toCents(amountRaw) !== toCents(closingRaw)) {
      setError('Manual statement not recorded. Opening balance plus this line must equal the closing balance.'); return;
    }
    importStatement.mutate({ data: {
      accountId: Number(selectedAccount), sourceType: 'manual', sourceName: String(f.get('sourceName')),
      periodStart: start, periodEnd: end, openingBalanceCents: toCents(openingRaw), closingBalanceCents: toCents(closingRaw),
      lines: [{ lineDate: date, description, reference: String(f.get('manualReference')) || null, amountCents: toCents(amountRaw) }],
    } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTrustOverviewQueryKey() }); setSuccess('Manual bank statement record added for reconciliation.'); form.reset(); },
      onError: e => setError(errText(e)),
    });
  }
  function requestStatement(e: FormEvent) {
    e.preventDefault();
    if (!selectedAccount || !selectedMatter || !period.from || !period.to || period.from > period.to) { setError('Choose an account, matter, and valid statement period.'); return; }
    setError(''); setStatementParams({ accountId: Number(selectedAccount), matterId: Number(selectedMatter), ...period });
  }
  function downloadStatement() {
    if (!statement.data) return;
    const data = statement.data;
    const escape = (v: string) => v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
    const rows = data.entries.map(e => `<tr><td>${escape(dateLabel(e.entryDate))}</td><td>${escape(e.description)}</td><td>${escape(e.reference || '')}</td><td>${e.entryType}</td><td>${money(e.amountCents, data.currency)}</td><td>${money(e.balanceCents, data.currency)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><title>Trust ledger statement · ${escape(data.matterTitle)}</title><style>body{font:14px Georgia,serif;color:#23353b;margin:36px}h1{font-size:24px}small{color:#657575}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{border-bottom:1px solid #d9d4c8;padding:9px;text-align:left}th{font:11px Arial,sans-serif;text-transform:uppercase}td:nth-child(n+5){text-align:right}.totals{margin:24px 0;padding:16px;background:#f2f0e9}</style></head><body><small>CLIENTGUARD · PRIVATE MATTER STATEMENT</small><h1>${escape(data.matterTitle)}</h1><p>${escape(data.clientName)} · ${escape(data.accountName)} · ${escape(data.jurisdiction)}</p><p>Period ${escape(dateLabel(data.from))} — ${escape(dateLabel(data.to))}</p><div class="totals">Opening balance: <strong>${money(data.openingBalanceCents, data.currency)}</strong> &nbsp; Closing balance: <strong>${money(data.closingBalanceCents, data.currency)}</strong></div><table><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th>Type</th><th>Amount</th><th>Running balance</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No approved entries in this period.</td></tr>'}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { setError('The statement print window was blocked. Allow pop-ups for ClientGuard and retry.'); return; }
    printWindow.opener = null;
    printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
  }
  async function parseCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setError(''); setSuccess('');
    const text = await file.text();
    const csv = parseCsvRows(text.replace(/^\uFEFF/, ''));
    if (csv.error) { setError(`CSV not imported. ${csv.error}`); e.target.value = ''; return; }
    const rows = csv.rows;
    const header = rows.shift()?.map(x => x.toLowerCase());
    const dateIndex = header?.findIndex(x => ['date', 'line_date'].includes(x)) ?? -1;
    const descIndex = header?.findIndex(x => ['description', 'memo'].includes(x)) ?? -1;
    const amountIndex = header?.findIndex(x => ['amount', 'amount_cents'].includes(x)) ?? -1;
    const referenceIndex = header?.findIndex(x => ['reference', 'ref'].includes(x)) ?? -1;
    const rowErrors: string[] = [];
    const parsed: TrustStatementLineInput[] = [];
    if (dateIndex < 0 || descIndex < 0 || amountIndex < 0) rowErrors.push('CSV needs date, description, and amount columns (reference is optional).');
    rows.forEach((row, index) => {
      const lineNo = index + 2; const date = row[dateIndex] || ''; const desc = row[descIndex] || ''; const amountRaw = row[amountIndex] || '';
      if (header && row.length !== header.length) rowErrors.push(`Row ${lineNo}: expected ${header.length} columns but found ${row.length}.`);
      const cents = header?.[amountIndex] === 'amount_cents' ? Number(amountRaw) : Math.round(Number(amountRaw) * 100);
      if (!validIsoDate(date)) rowErrors.push(`Row ${lineNo}: invalid date; use YYYY-MM-DD.`);
      if (!desc) rowErrors.push(`Row ${lineNo}: description is required.`);
      const validAmount = header?.[amountIndex] === 'amount_cents' ? /^-?\d+$/.test(amountRaw) : /^-?\d+(\.\d{1,2})?$/.test(amountRaw);
      if (!amountRaw || !validAmount || !Number.isSafeInteger(cents)) rowErrors.push(`Row ${lineNo}: amount is invalid; use a number with at most two decimal places.`);
      if (desc && Number.isSafeInteger(cents) && validIsoDate(date)) parsed.push({ lineDate: date, description: desc, reference: referenceIndex >= 0 ? row[referenceIndex] || null : null, amountCents: cents });
    });
    if (rowErrors.length) { setError(`CSV not imported. ${rowErrors.join(' ')}`); e.target.value = ''; return; }
    if (!selectedAccount) { setError('Select a trust account before importing a statement.'); return; }
    const opening = window.prompt('Statement opening balance in major currency units (for example 1200.00)');
    const closing = window.prompt('Statement closing balance in major currency units');
    const start = window.prompt('Statement period start (YYYY-MM-DD)');
    const end = window.prompt('Statement period end (YYYY-MM-DD)');
    if (opening === null || closing === null || !start || !end) return;
    const toCents = (v: string) => Math.round(Number(v) * 100);
    if (!/^-?\d+(\.\d{1,2})?$/.test(opening) || !/^-?\d+(\.\d{1,2})?$/.test(closing) || !Number.isSafeInteger(toCents(opening)) || !Number.isSafeInteger(toCents(closing)) || !validIsoDate(start) || !validIsoDate(end) || start > end || parsed.some(line => line.lineDate < start || line.lineDate > end)) { setError('Statement totals or period are invalid; CSV was not committed.'); return; }
    const calculatedClosing = toCents(opening) + parsed.reduce((sum, line) => sum + line.amountCents, 0);
    if (calculatedClosing !== toCents(closing)) { setError(`CSV not committed. Opening balance plus imported lines is ${money(calculatedClosing, trust.data?.accounts.find(a => String(a.id) === selectedAccount)?.currency || 'USD')}, which does not match the provided closing balance.`); return; }
    importStatement.mutate({ data: { accountId: Number(selectedAccount), sourceType: 'csv', sourceName: file.name, periodStart: start, periodEnd: end, openingBalanceCents: toCents(opening), closingBalanceCents: toCents(closing), lines: parsed } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTrustOverviewQueryKey() }); setSuccess(`${parsed.length} bank statement lines imported for strict reconciliation.`); e.target.value = ''; },
      onError: error => setError(errText(error)),
    });
  }

  if (settings.isLoading || letters.isLoading || trust.isLoading) return <div className="space-y-4" aria-label="Loading practice operations">{[1,2,3].map(i => <div key={i} className="h-36 animate-pulse rounded-md bg-[#e8e4d9]" />)}</div>;
  if (settings.isError || letters.isError || trust.isError) return <div role="alert" className="rounded-md border border-[#e6c7c1] bg-[#fff9f6] p-5 text-sm text-[#843f38]">Practice records could not be loaded. <button onClick={() => { settings.refetch(); letters.refetch(); trust.refetch(); }} className="ml-2 underline">Try again</button></div>;

  return <div data-testid="page-practice-operations">
    <header className="mb-7"><div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#987747]">Firm policy / client money custody</div><h1 className="serif text-3xl font-bold md:text-[38px]">Practice operations</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#72807f]">Set the rules of engagement, issue letters for provider-confirmed signature, and keep a precise record of client money.</p></header>
    <div className="mb-5"><Notice error={error} success={success} /></div>
    <section className={`${panel} mb-5 overflow-hidden`}><div className="flex items-start gap-3 border-b border-[#e9e4d9] px-5 py-4"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#527861]" /><div><h2 className="serif text-lg font-bold">Practice configuration</h2><p className="mt-1 text-xs text-[#788581]">Apply signature and jurisdiction policy before new matters are opened.</p></div></div>
      <form onSubmit={savePractice} className="grid gap-5 p-5 md:grid-cols-[1fr_320px]"><fieldset><legend className="mb-3 text-xs font-bold uppercase tracking-wide text-[#687773]">Supported jurisdictions</legend><div className="flex flex-wrap gap-2">{jurisdictions.map(j => <label key={j} className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2.5 text-sm transition ${jurisdiction.includes(j)?'border-[#829c8b] bg-[#edf3ed]':'border-[#ded9cd] bg-[#f8f6ef] hover:bg-[#f0ece2]'}`}><input type="checkbox" checked={jurisdiction.includes(j)} onChange={e => setJurisdiction(old => e.target.checked ? [...old, j] : old.filter(v => v !== j))} className="accent-[#294651]" />{j}</label>)}</div></fieldset>
      <div className="flex flex-col justify-between gap-4"><label className="flex items-start gap-3 rounded bg-[#f1eee6] p-3 text-xs leading-5"><input type="checkbox" checked={requiresSignature} onChange={e => setRequiresSignature(e.target.checked)} className="mt-1 accent-[#294651]" /><span><strong className="block text-[#344b50]">Require signed engagement before opening</strong><span className="text-[#74807d]">A letter must be confirmed signed by the provider.</span></span></label><button className={button} disabled={saveSettings.isPending}>{saveSettings.isPending ? 'Saving policy…' : 'Save practice policy'}</button></div>
      {saveSettings.isError && <p role="alert" className="text-xs text-[#843f38]">{errText(saveSettings.error)}</p>}
    </form></section>

    <section className={`${panel} mb-5 overflow-hidden`}><div className="flex items-start justify-between gap-4 border-b border-[#e9e4d9] px-5 py-4"><div className="flex gap-3"><FileSignature className="mt-0.5 h-5 w-5 text-[#9a7945]" /><div><h2 className="serif text-lg font-bold">Engagement letters</h2><p className="mt-1 text-xs text-[#788581]">Draft scope and billing terms from a matter record; signature state follows provider confirmation.</p></div></div><span className={`h-fit rounded-full px-2.5 py-1 text-[9px] font-bold uppercase ${docusign?.connected && docusign.ready ? 'bg-[#e5eee7] text-[#47725b]' : 'bg-[#fff1db] text-[#845d24]'}`}>{docusign?.connected ? (docusign.ready ? 'DocuSign connected' : 'Setup required') : 'Sandbox'}</span></div>
      {(!docusign?.connected || !docusign.ready) && <div className="mx-5 mt-4 rounded border border-[#ead9b8] bg-[#fff8eb] px-3 py-2.5 text-xs leading-5 text-[#755a2d]">DocuSign is in sandbox until this firm connects and configures its own OAuth app. Sending is disabled until the provider is ready. <a href="/settings/integrations" className="font-bold underline">Review integration settings</a></div>}
      <form onSubmit={makeLetter} className="grid gap-3 p-5 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end"><label className="text-xs font-semibold text-[#53625f]">Matter<select required name="matterId" className="field mt-1.5"><option value="">Choose matter</option>{(matters.data || []).filter(m => m.status !== 'closed').map(m => <option key={m.id} value={m.id}>{m.title} · {m.clientName}</option>)}</select></label><label className="text-xs font-semibold text-[#53625f]">Client email<input required name="clientEmail" type="email" className="field mt-1.5" placeholder="client@example.com" /></label><label className="text-xs font-semibold text-[#53625f]">Scope summary<textarea required minLength={10} maxLength={12000} name="scope" className="field mt-1.5 h-10 min-h-10 py-2" placeholder="Describe the work covered by this engagement" /></label><button className={button} disabled={createLetter.isPending}><Plus className="h-4 w-4" />{createLetter.isPending ? 'Drafting…' : 'Draft letter'}</button></form>
      <div className="overflow-x-auto border-t border-[#e9e4d9]"><table className="w-full min-w-[800px] text-left text-xs"><thead className="bg-[#f2f0e9] text-[9px] uppercase tracking-[.12em] text-[#7d8985]"><tr><th className="px-5 py-3">Matter / client</th><th className="px-3 py-3">Revision</th><th className="px-3 py-3">Scope & billing snapshot</th><th className="px-3 py-3">Status / dates</th><th className="px-5 py-3">Action</th></tr></thead><tbody>{(letters.data || []).map(letter => <tr key={letter.id} className="border-t border-[#eee9df] align-top"><td className="px-5 py-3"><strong>{letter.matterTitle}</strong><div className="mt-1 text-[#87918d]">{letter.clientName} · {letter.clientEmail}</div></td><td className="px-3 py-3">r{letter.revision}</td><td className="max-w-[280px] px-3 py-3"><div className="line-clamp-2">{letter.scope}</div><div className="mt-1 text-[#87918d]">{letter.billingTerms}</div>{letter.signedDocumentId && <div className="mt-1 text-[#47725b]">Signed PDF attached to matter</div>}</td><td className="px-3 py-3"><span className="rounded-full bg-[#eaece7] px-2 py-1 font-bold capitalize text-[#53635c]">{letter.status}</span><div className="mt-2 text-[#87918d]">Sent {dateLabel(letter.sentAt)}</div><div className="mt-1 text-[#87918d]">Signed {dateLabel(letter.signedAt)}</div></td><td className="px-5 py-3"><div className="flex gap-2">{letter.status === 'draft' && <button className={outlined} disabled={!docusign?.ready || !docusign.connected || sendLetter.isPending} onClick={() => letterAction(letter.id, 'send')}>Send</button>}{letter.status === 'sent' && <button className={outlined} disabled={!docusign?.ready || syncLetter.isPending} onClick={() => letterAction(letter.id, 'sync')}><RefreshCw className="h-3 w-3" />Sync status</button>}</div></td></tr>)}</tbody></table>{!letters.data?.length && <div className="p-8 text-center text-sm text-[#788581]">No engagement letters recorded for this firm.</div>}</div>
      <p className="border-t border-[#e9e4d9] px-5 py-3 text-[10px] leading-5 text-[#89918c]">A sent envelope is not a signed engagement. ClientGuard records a signed state only after DocuSign confirms it; linked signed PDFs remain private to the matter.</p>
    </section>

    <section className={`${panel} mb-5 overflow-hidden`}><div className="flex gap-3 border-b border-[#e9e4d9] px-5 py-4"><Landmark className="mt-0.5 h-5 w-5 text-[#527861]" /><div><h2 className="serif text-lg font-bold">Trust & client-money records</h2><p className="mt-1 text-xs text-[#788581]">Ledger entries are records only. ClientGuard does not move money.</p></div></div>
      {trust.data?.alerts?.map(alert => <div key={alert.id} className="mx-5 mt-4 flex gap-2 rounded border border-[#ead9b8] bg-[#fff8eb] p-3 text-xs text-[#755a2d]"><AlertTriangle className="h-4 w-4 shrink-0" /><div><strong>{alert.title}</strong><div className="mt-1">{alert.detail}</div></div></div>)}
      <div className="grid gap-5 p-5 xl:grid-cols-[.82fr_1.18fr]">
        <div className="space-y-4"><form onSubmit={makeAccount} className="rounded border border-[#e7e2d7] p-4"><h3 className="text-sm font-bold">Configure a trust account</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Account name<input name="name" required className="field mt-1" /></label><label className="text-xs font-semibold">Jurisdiction<select name="jurisdiction" className="field mt-1">{(trust.data?.supportedJurisdictions || jurisdictions).map(j => <option key={j}>{j}</option>)}</select></label><label className="text-xs font-semibold">Currency<input name="currency" required minLength={3} maxLength={3} defaultValue="USD" className="field mt-1 uppercase" /></label><label className="text-xs font-semibold">Reference<input name="reference" className="field mt-1" placeholder="Optional account ref" /></label></div><p className="my-2 text-[10px] text-[#87918d]">Two-person approval is enabled for new records.</p><button className={button} disabled={createAccount.isPending}>{createAccount.isPending ? 'Saving…' : 'Add account'}</button></form>
          <form onSubmit={addEntry} className="rounded border border-[#e7e2d7] p-4"><h3 className="text-sm font-bold">Propose ledger entry</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Trust account<select name="accountId" required className="field mt-1">{(trust.data?.accounts || []).map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></label><label className="text-xs font-semibold">Matter<select name="matterId" required className="field mt-1"><option value="">Choose matter</option>{(matters.data || []).map(m => <option key={m.id} value={m.id}>{m.title} · {m.clientName}</option>)}</select></label><label className="text-xs font-semibold">Record type<select name="entryType" className="field mt-1"><option value="deposit">Deposit</option><option value="disbursement">Disbursement</option></select></label><label className="text-xs font-semibold">Amount<input name="amount" required type="number" min="0.01" step="0.01" className="field mt-1" /></label><label className="text-xs font-semibold">Date<input name="entryDate" required type="date" defaultValue={new Date().toISOString().slice(0,10)} className="field mt-1" /></label><label className="text-xs font-semibold">Reference<input name="reference" className="field mt-1" /></label><label className="text-xs font-semibold sm:col-span-2">Description<input name="description" required maxLength={1000} className="field mt-1" /></label></div><button className={`${button} mt-3`} disabled={createEntry.isPending}><Plus className="h-3.5 w-3.5" />Propose entry</button></form></div>
        <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">{(trust.data?.accounts || []).map(a => <div key={a.id} className="rounded border border-[#e7e2d7] bg-[#f7f5ee] p-4"><div className="flex justify-between gap-3"><div><div className="text-sm font-bold">{a.name}</div><div className="mt-1 text-[10px] text-[#7e8985]">{a.jurisdiction} · {a.currency} · {a.active ? 'Active' : 'Inactive'}</div></div><Landmark className="h-4 w-4 text-[#9a7945]" /></div><div className="mono mt-4 text-xl">{money(a.balanceCents, a.currency)}</div><div className="mt-1 text-[10px] text-[#87918d]">Recorded balance · approval required</div></div>)}</div>
          <div className="overflow-hidden rounded border border-[#e7e2d7]"><div className="flex items-center justify-between bg-[#f2f0e9] px-4 py-3"><h3 className="text-sm font-bold">Ledger records</h3><span className="text-[10px] text-[#87918d]">Amount · entry date</span></div><div className="divide-y divide-[#eee9df]">{(trust.data?.entries || []).slice(0,12).map(entry => <div key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-xs"><div className="min-w-[145px] flex-1"><strong>{entry.matterTitle}</strong><div className="mt-1 text-[#87918d]">{entry.description} · {dateLabel(entry.entryDate)}</div><div className="mt-1 text-[10px] text-[#89918c]">Proposed by {entry.createdBy}{entry.approvedBy ? ` · decided by ${entry.approvedBy}` : ''}</div></div><span className="font-bold">{entry.entryType === 'disbursement' ? '−' : '+'}{money(entry.amountCents, entry.currency)}</span><span className="rounded-full bg-[#ecebe5] px-2 py-1 text-[9px] font-bold uppercase">{entry.status.replace('_', ' ')}</span>{entry.status === 'pending_approval' && <div className="flex items-center gap-1">{ownEntry(entry.createdBy) ? <span className="text-[9px] text-[#9a6940]">Awaiting a different approver</span> : <button className={outlined} onClick={() => decide(entry.id, 'approve')} disabled={decideEntry.isPending} title="The proposer cannot approve their own record">Approve</button>}<button className={outlined} onClick={() => decide(entry.id, 'reject')} disabled={decideEntry.isPending}>Reject</button></div>}</div>)}{!trust.data?.entries?.length && <div className="p-6 text-center text-xs text-[#87918d]">Ledger activity appears here after a proposal is recorded.</div>}</div></div>
          <div className="rounded border border-[#e7e2d7] p-4">
            <h3 className="text-sm font-bold">Bank statement import & reconciliation</h3>
            <p className="mt-1 text-[10px] leading-5 text-[#87918d]">Upload CSV with date, description, amount or amount_cents, and optional reference. Every row and statement balance is validated before import. Matching is strict; exceptions remain visible.</p>
            <form onSubmit={importManual} className="mt-3 grid gap-2 rounded bg-[#f7f5ee] p-3 sm:grid-cols-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#687773] sm:col-span-2">Record a statement line manually</div>
              <label className="text-[10px] font-semibold">Statement label<input name="sourceName" required className="field mt-1 h-9" placeholder="Bank statement" /></label>
              <label className="text-[10px] font-semibold">Transaction date<input name="lineDate" required type="date" className="field mt-1 h-9" /></label>
              <label className="text-[10px] font-semibold">Description<input name="manualDescription" required className="field mt-1 h-9" /></label>
              <label className="text-[10px] font-semibold">Reference<input name="manualReference" className="field mt-1 h-9" /></label>
              <label className="text-[10px] font-semibold">Line amount<input name="manualAmount" required type="number" step="0.01" className="field mt-1 h-9" /></label>
              <label className="text-[10px] font-semibold">Period opening<input name="opening" required type="number" step="0.01" className="field mt-1 h-9" /></label>
              <label className="text-[10px] font-semibold">Period closing<input name="closing" required type="number" step="0.01" className="field mt-1 h-9" /></label>
              <label className="text-[10px] font-semibold">Period start<input name="periodStart" required type="date" className="field mt-1 h-9" /></label>
              <label className="text-[10px] font-semibold">Period end<input name="periodEnd" required type="date" className="field mt-1 h-9" /></label>
              <button className="rounded bg-[#294651] px-3 py-2 text-[10px] font-bold text-white transition hover:bg-[#1c3943] disabled:opacity-50 sm:col-span-2 sm:justify-self-start" disabled={importStatement.isPending}>{importStatement.isPending?'Recording…':'Record manual line'}</button>
            </form>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded border border-[#d9d4c8] bg-[#fbfaf5] px-3 py-2 text-xs font-semibold hover:bg-[#f1eee6]">Import CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={parseCsv} disabled={importStatement.isPending} /></label>
            <div className="mt-3 space-y-2">
              {(trust.data?.statements || []).map(s => <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eee9df] pt-2 text-xs">
                <span><strong>{s.sourceName}</strong><span className="ml-2 text-[#87918d]">{dateLabel(s.periodStart)}—{dateLabel(s.periodEnd)} · {s.matchedLines}/{s.lineCount} matched</span></span>
                <span className={s.unmatchedLineCount ? 'text-[#9a6940]' : 'text-[#47725b]'}>{s.unmatchedLineCount ? `${s.unmatchedLineCount} exceptions` : 'Reconciled'}</span>
                {s.lines?.filter(l => l.status === 'unmatched').map(line => <label key={line.id} className="flex basis-full items-center gap-2 text-[10px] text-[#788581]">
                  {line.lineDate} · {line.description} · {line.amountCents}
                  <select className="field max-w-[220px]" defaultValue="" onChange={e => {
                    if (e.target.value) matchLine.mutate({
                      statementId: s.id, lineId: line.id, data: { matchedEntryId: Number(e.target.value) },
                    }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetTrustOverviewQueryKey() }), onError: er => setError(errText(er)) });
                  }}>
                    <option value="">Strict match to approved entry…</option>
                    {(trust.data?.entries || []).filter(en => en.status === 'approved' && en.amountCents === Math.abs(line.amountCents) && en.entryDate === line.lineDate && (line.reference ? en.reference === line.reference : en.description === line.description)).map(en => <option key={en.id} value={en.id}>{en.matterTitle} · {en.description} · {money(en.amountCents, en.currency)}</option>)}
                  </select>
                </label>)}
              </div>)}
            </div>
          </div>
        </div>
      </div>
    </section>
    <section className={`${panel} overflow-hidden print:break-inside-avoid`}><div className="border-b border-[#e9e4d9] px-5 py-4"><h2 className="serif text-lg font-bold">Matter ledger statement</h2><p className="mt-1 text-xs text-[#788581]">Firm-scoped statement of approved entries, with opening and closing balances. Fetching records an audit event.</p></div>
      <form onSubmit={requestStatement} className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_150px_150px_auto] lg:items-end"><label className="text-xs font-semibold">Account<select value={selectedAccount} onChange={e=>setSelectedAccount(e.target.value)} className="field mt-1"><option value="">Choose account</option>{(trust.data?.accounts || []).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label className="text-xs font-semibold">Matter<select value={selectedMatter} onChange={e=>setSelectedMatter(e.target.value)} className="field mt-1"><option value="">Choose matter</option>{(matters.data || []).map(m=><option key={m.id} value={m.id}>{m.title} · {m.clientName}</option>)}</select></label><label className="text-xs font-semibold">From<input required type="date" value={period.from} onChange={e=>setPeriod({ ...period, from: e.target.value })} className="field mt-1" /></label><label className="text-xs font-semibold">To<input required type="date" value={period.to} onChange={e=>setPeriod({ ...period, to: e.target.value })} className="field mt-1" /></label><button className={button} disabled={statement.isFetching}><RefreshCw className="h-3.5 w-3.5" />Fetch statement</button></form>
      {statement.isError && <p role="alert" className="mx-5 mb-4 text-xs text-[#843f38]">{errText(statement.error)}</p>}
      {statement.data && <div className="border-t border-[#e9e4d9] p-5" data-testid="trust-statement-view"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mono text-[9px] uppercase tracking-[.14em] text-[#92754a]">Private matter statement</div><h3 className="serif mt-1 text-xl font-bold">{statement.data.matterTitle}</h3><p className="mt-1 text-xs text-[#788581]">{statement.data.clientName} · {statement.data.accountName} · {statement.data.from} to {statement.data.to}</p></div><button onClick={downloadStatement} className={outlined}><Printer className="h-3.5 w-3.5" />Print / save as PDF</button></div><div className="my-4 grid gap-3 sm:grid-cols-2"><div className="rounded bg-[#f2f0e9] p-3 text-xs">Period opening <strong className="mono ml-2">{money(statement.data.openingBalanceCents, statement.data.currency)}</strong></div><div className="rounded bg-[#edf3ed] p-3 text-xs">Period closing <strong className="mono ml-2">{money(statement.data.closingBalanceCents, statement.data.currency)}</strong></div></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-[9px] uppercase tracking-wide text-[#87918d]"><tr><th className="py-2">Date</th><th>Description</th><th>Reference</th><th>Type</th><th>Amount</th><th>Balance</th></tr></thead><tbody>{statement.data.entries.map(e=><tr key={e.id} className="border-t border-[#eee9df]"><td className="py-2">{dateLabel(e.entryDate)}</td><td>{e.description}</td><td>{e.reference || '—'}</td><td className="capitalize">{e.entryType}</td><td>{money(e.amountCents, statement.data!.currency)}</td><td>{money(e.balanceCents, statement.data!.currency)}</td></tr>)}</tbody></table>{!statement.data.entries.length && <p className="py-4 text-center text-xs text-[#87918d]">No approved entries in this period.</p>}</div></div>}
    </section>
  </div>;
}
