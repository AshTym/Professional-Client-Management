import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetOperationsReportQueryKey,
  useGetOperationsReport,
  useLogOperationsReportExport,
  useSaveTeamCapacity,
} from '@workspace/api-client-react';
import { AlertTriangle, CalendarClock, Check, ChevronDown, Clock3, Download, Moon, Printer, RefreshCw, Sun, Users } from 'lucide-react';

const panel = 'rounded-md border border-[#e0dace] bg-[#fbfaf5]';
const intervals = [
  { minutes: 5, label: 'Every 5 minutes' },
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 1440, label: 'Every 24 hours' },
] as const;
const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const readableError = (e: unknown) => e instanceof Error ? e.message : 'Request failed. Please retry or ask a firm administrator.';
const formatCurrency = (cents: number, currency: string | null) => {
  if (!currency) return 'No currency configured';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};
const csvCell = (value: string | number | null | undefined) => {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const csvText = (rows: (string | number | null | undefined)[][]) => rows.map(row => row.map(csvCell).join(',')).join('\r\n');
const downloadCsv = (filename: string, content: string) => {
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export default function OperationsReport() {
  const qc = useQueryClient();
  const report = useGetOperationsReport(undefined, {
    query: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false },
  });
  const save = useSaveTeamCapacity();
  const auditExport = useLogOperationsReportExport();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [exporting, setExporting] = useState('');
  const [intervalMenuOpen, setIntervalMenuOpen] = useState(false);
  const [refreshMinutes, setRefreshMinutes] = useState<number | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const intervalMenu = useRef<HTMLDivElement>(null);
  const reportRefetch = useRef(report.refetch);
  reportRefetch.current = report.refetch;
  const data = report.data;

  useEffect(() => {
    if (!intervalMenuOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !intervalMenu.current?.contains(event.target)) setIntervalMenuOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIntervalMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [intervalMenuOpen]);

  useEffect(() => {
    if (!refreshMinutes) return;
    const intervalId = window.setInterval(() => reportRefetch.current(), refreshMinutes * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [refreshMinutes]);

  function submitCapacity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setSuccess('');
    const form = new FormData(e.currentTarget);
    const capacities = (data?.workload || []).map(member => ({
      membershipId: member.membershipId,
      weeklyCapacityMinutes: Number(form.get(`weekly-${member.membershipId}`)),
      activeMatterLimit: Number(form.get(`limit-${member.membershipId}`)),
    }));
    const invalid = capacities.find(x => !Number.isInteger(x.weeklyCapacityMinutes) || x.weeklyCapacityMinutes < 60 || x.weeklyCapacityMinutes > 10080 || !Number.isInteger(x.activeMatterLimit) || x.activeMatterLimit < 1 || x.activeMatterLimit > 1000);
    if (invalid) { setError('Capacity must be 60–10,080 minutes per week and matter limits must be 1–1,000.'); return; }
    save.mutate({ data: { capacities } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetOperationsReportQueryKey() }); setSuccess('Team capacity saved.'); },
      onError: e => setError(readableError(e)),
    });
  }

  function exportCsv(kind: 'pipeline' | 'aging-wip') {
    if (!data) return;
    setError(''); setSuccess('');
    setExporting(kind);
    auditExport.mutate({ data: { format: 'csv', from: data.from, to: data.to } }, {
      onSuccess: result => {
        if (!result.logged) {
          setError('The export audit was not confirmed. No file was downloaded.');
          setExporting('');
          return;
        }
        const rows = kind === 'pipeline'
          ? [
              ['Matter pipeline'],
              ['Status', 'Matter count'],
              ...data.pipeline.map(row => [row.status.replaceAll('_', ' '), row.count]),
            ]
          : [
              ['Aging work in progress'],
              ['Age band', 'Currency', 'Entries', 'Hours', 'Hourly-priced entries', 'Fixed-fee entries', 'Unpriced entries', 'Estimated hourly WIP (cents)'],
              ...data.agingWorkInProgress.map(row => [
                row.bucket,
                row.currency ?? 'No currency configured',
                row.entryCount,
                row.hours,
                row.pricedEntryCount,
                row.fixedFeeEntryCount,
                row.unpricedEntryCount,
                row.estimatedCents,
              ]),
            ];
        downloadCsv(`operations-${kind}-${data.from}-to-${data.to}.csv`, csvText(rows));
        setSuccess(`${kind === 'pipeline' ? 'Pipeline' : 'Aging WIP'} CSV exported. Audit recorded.`);
        setExporting('');
      },
      onError: e => { setError(`Export audit failed; no file was downloaded. ${readableError(e)}`); setExporting(''); },
    });
  }

  function printReport() {
    if (!data) return;
    setError(''); setSuccess('');
    setExporting('pdf');
    auditExport.mutate({ data: { format: 'pdf', from: data.from, to: data.to } }, {
      onSuccess: result => {
        setExporting('');
        if (!result.logged) {
          setError('The print audit was not confirmed. Printing was not opened.');
          return;
        }
        setSuccess('Print audit recorded. Choose “Save as PDF” in the print dialog.');
        window.print();
      },
      onError: e => { setError(`Print audit failed; printing was not opened. ${readableError(e)}`); setExporting(''); },
    });
  }

  if (!data && (report.isLoading || report.isFetching)) return <div className="space-y-4" aria-label="Loading operations report">{[1,2,3].map(i=><div key={i} className="h-40 animate-pulse rounded-md bg-[#e8e4d9]"/>)}</div>;
  if (report.isError || !data) return <div role="alert" className="rounded-md border border-[#e6c7c1] bg-[#fff9f6] p-6 text-sm text-[#843f38]">Operations reporting is unavailable. {readableError(report.error)}<button onClick={()=>report.refetch()} className="ml-2 underline">Retry</button></div>;
  const pipelineTotal = data.pipeline.reduce((n, x) => n + x.count, 0);
  const currencyMax = data.agingWorkInProgress.reduce<Record<string, number>>((maxima, row) => {
    const key = row.currency ?? '__missing_currency__';
    maxima[key] = Math.max(maxima[key] || 0, row.estimatedCents);
    return maxima;
  }, {});

  return <div className={`ops-report ${darkMode ? 'ops-report-dark' : ''}`} style={{ color: darkMode ? '#e7e9df' : '#23353b', backgroundColor: darkMode ? '#14262b' : 'transparent', borderRadius: 6, padding: darkMode ? 16 : 0 }}>
    <style>{`
      .ops-report-dark [class~="bg-[#fbfaf5]"]{background-color:#1b3035!important}
      .ops-report-dark [class~="bg-[#f2f0e9]"]{background-color:#243b40!important}
      .ops-report-dark [class~="bg-[#f7f5ee]"]{background-color:#20363b!important}
      .ops-report-dark [class~="bg-[#e9e5da]"]{background-color:#36494b!important}
      .ops-report-dark [class~="bg-[#e5eee7]"]{background-color:#29473f!important}
      .ops-report-dark [class~="bg-[#fff1db]"]{background-color:#4a402b!important}
      .ops-report-dark [class~="bg-[#f6ece7]"]{background-color:#49332f!important}
      .ops-report-dark [class~="bg-[#fff9f6]"]{background-color:#402f2c!important}
      .ops-report-dark [class~="bg-[#edf3ed]"]{background-color:#293d33!important}
      .ops-report-dark [class~="border-[#e0dace]"],.ops-report-dark [class~="border-[#e9e4d9]"],.ops-report-dark [class~="border-[#eee9df]"],.ops-report-dark [class~="border-[#d9d4c8]"]{border-color:#40565a!important}
      .ops-report-dark [class~="text-[#788581]"],.ops-report-dark [class~="text-[#7d8985]"],.ops-report-dark [class~="text-[#87918d]"],.ops-report-dark [class~="text-[#89918c]"],.ops-report-dark [class~="text-[#72807f]"],.ops-report-dark [class~="text-[#7e8985]"],.ops-report-dark [class~="text-[#86918c]"]{color:#b5c2bd!important}
      .ops-report-dark [class~="text-[#843f38]"]{color:#ffc2b5!important}
      .ops-report-dark [class~="text-[#42664f]"],.ops-report-dark [class~="text-[#47725b]"]{color:#a7d0b2!important}
      .ops-report-dark [class~="text-[#845d24]"]{color:#f0ce8b!important}
      .ops-report-dark [class~="border-[#e6c7c1]"]{border-color:#74514b!important}
      .ops-report-dark [class~="border-[#c9d8cc]"]{border-color:#43644d!important}
      .ops-report-dark .field{background:#1b3035!important;color:#e7e9df!important;border-color:#40565a!important}
      .ops-report-dark .field::placeholder{color:#9aaba5!important}
      @media print{
        .ops-report-controls{display:none!important}
        .ops-report{background:#fff!important;color:#1f2a2b!important;padding:0!important}
        .ops-report input{display:none!important}
        .ops-report .capacity-cell::after{content:attr(data-print-value)}
        .ops-report section,.ops-report article{break-inside:avoid}
      }
    `}</style>
    {report.isLoading || report.isFetching ? <div className="mb-3 text-[10px] text-[#788581]" role="status">Refreshing operations data…</div> : null}
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div><div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#987747]">Admin view / delivery signals</div><h1 className="serif text-3xl font-bold md:text-[38px]">Firm operations</h1><p className="mt-2 text-sm text-[#72807f]">Pipeline, team load, aging work, and deadline pressure. A working view for the firm—not a revenue forecast.</p><p className="mt-2 text-[10px] text-[#89918c]">Reporting period · {formatDate(data.from)} — {formatDate(data.to)}</p></div>
      <div className="ops-report-controls flex flex-wrap items-center gap-2">
        <div className="relative flex" ref={intervalMenu}>
          <button onClick={()=>report.refetch()} disabled={report.isFetching} className="inline-flex items-center gap-2 rounded-l border border-[#d9d4c8] bg-[#fbfaf5] px-3 py-2.5 text-xs font-bold disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${report.isFetching?'animate-spin':''}`} />Refresh</button>
          <button aria-label="Refresh interval options" aria-expanded={intervalMenuOpen} onClick={()=>setIntervalMenuOpen(open=>!open)} className="rounded-r border border-l-0 border-[#d9d4c8] bg-[#fbfaf5] px-2.5 text-[#53635c]"><ChevronDown className="h-3.5 w-3.5"/></button>
          {intervalMenuOpen&&<div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-md border border-[#e0dace] bg-[#fbfaf5] p-1.5 shadow-lg"><div className="px-2.5 py-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#87918d]">Auto-refresh</div><button onClick={()=>{setRefreshMinutes(null);setIntervalMenuOpen(false);}} className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-xs hover:bg-[#f2f0e9]"><span>Off</span>{refreshMinutes===null&&<Check className="h-3.5 w-3.5"/>}</button>{intervals.map(option=><button key={option.minutes} onClick={()=>{setRefreshMinutes(option.minutes);setIntervalMenuOpen(false);}} className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-xs hover:bg-[#f2f0e9]"><span>{option.label}</span>{refreshMinutes===option.minutes&&<Check className="h-3.5 w-3.5"/>}</button>)}</div>}
        </div>
        {refreshMinutes&&<span className="text-[10px] text-[#788581]">Auto · {intervals.find(x=>x.minutes===refreshMinutes)?.label.replace('Every ','')}</span>}
        <button onClick={()=>setDarkMode(on=>!on)} aria-pressed={darkMode} className="inline-flex items-center gap-2 rounded border border-[#d9d4c8] bg-[#fbfaf5] px-3 py-2.5 text-xs font-bold"><span className="sr-only">Toggle report dark mode</span>{darkMode?<Sun className="h-3.5 w-3.5"/>:<Moon className="h-3.5 w-3.5"/>}{darkMode?'Light mode':'Dark mode'}</button>
        <button onClick={printReport} disabled={auditExport.isPending} className="inline-flex items-center gap-2 rounded bg-[#294651] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Printer className="h-3.5 w-3.5"/>{exporting==='pdf'?'Logging print…':'Print / save PDF'}</button>
      </div>
    </header>
    {error && <p role="alert" className="mb-4 rounded border border-[#e6c7c1] bg-[#fff9f6] p-3 text-xs text-[#843f38]">{error}</p>}{success && <p role="status" className="mb-4 rounded border border-[#c9d8cc] bg-[#edf3ed] p-3 text-xs text-[#42664f]">{success}</p>}
    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ['Open matters', data.totals.openMatters, 'Currently active', Users],
      ['On hold', data.totals.onHoldMatters, 'Paused delivery', Clock3],
      ['Overdue deadlines', data.totals.overdueDeadlines, 'Needs review', AlertTriangle],
      ['Due in 7 days', data.totals.dueNext7Days, 'Upcoming pressure', CalendarClock],
    ].map(([label,value,caption,Icon]: any,i)=><article key={label} className={`rounded-md border border-[#e0dace] bg-[#fbfaf5] p-4 ${i===2?'border-t-2 border-t-[#bf7864]':''}`}><div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.12em] text-[#788581]"><span>{label}</span><Icon className="h-4 w-4 text-[#9a7945]"/></div><div className="serif mt-3 text-3xl font-bold">{value}</div><div className="mt-1 text-[10px] text-[#89918c]">{caption}</div></article>)}</section>
    <div className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
      <section className={`${panel} overflow-hidden`}><header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e9e4d9] px-5 py-4"><div><h2 className="serif text-lg font-bold">Matter pipeline</h2><p className="mt-1 text-xs text-[#788581]">{pipelineTotal} matters across all reported statuses</p></div><button className="ops-report-controls inline-flex items-center gap-2 rounded border border-[#d9d4c8] bg-[#fbfaf5] px-3 py-2 text-[10px] font-bold disabled:opacity-50" onClick={()=>exportCsv('pipeline')} disabled={auditExport.isPending}><Download className="h-3.5 w-3.5"/>{exporting==='pipeline'?'Logging export…':'Export CSV'}</button></header><div className="space-y-4 p-5">{data.pipeline.length ? data.pipeline.map(item=><div key={item.status}><div className="mb-1.5 flex justify-between text-xs"><span className="capitalize">{item.status.replaceAll('_',' ')}</span><span className="mono">{item.count}</span></div><div className="h-2 overflow-hidden rounded bg-[#e9e5da]"><div className="h-full rounded bg-[#496a68] transition-[width]" style={{width:`${pipelineTotal ? item.count/pipelineTotal*100 : 0}%`}}/></div></div>):<div className="py-8 text-center text-xs text-[#87918d]">No pipeline records in this period.</div>}</div></section>
      <section className={`${panel} overflow-hidden`}><header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e9e4d9] px-5 py-4"><div><h2 className="serif text-lg font-bold">Aging work in progress</h2><p className="mt-1 text-xs text-[#788581]">Hourly estimates by currency. Fixed-fee and unpriced entries are counted separately.</p></div><button className="ops-report-controls inline-flex items-center gap-2 rounded border border-[#d9d4c8] bg-[#fbfaf5] px-3 py-2 text-[10px] font-bold disabled:opacity-50" onClick={()=>exportCsv('aging-wip')} disabled={auditExport.isPending}><Download className="h-3.5 w-3.5"/>{exporting==='aging-wip'?'Logging export…':'Export CSV'}</button></header><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-[#f2f0e9] text-[9px] uppercase tracking-wide text-[#7d8985]"><tr><th className="px-5 py-3">Age band</th><th className="px-3 py-3">Currency</th><th className="px-3 py-3">Entries / hours</th><th className="px-3 py-3">Estimated hourly WIP</th><th className="px-5 py-3">Hourly-priced</th><th className="px-5 py-3">Fixed-fee</th><th className="px-5 py-3">Unpriced</th></tr></thead><tbody>{data.agingWorkInProgress.map((item,index)=>{const key=item.currency??'__missing_currency__';const rowKey=`${item.bucket}:${item.currency??'none'}:${index}`;return <tr key={rowKey} className="border-t border-[#eee9df]"><td className="px-5 py-3 font-semibold">{item.bucket}</td><td className="px-3 py-3">{item.currency??'No currency configured'}</td><td className="px-3 py-3">{item.entryCount} / {item.hours.toFixed(1)}h</td><td className="px-3 py-3"><div className="font-semibold">{formatCurrency(item.estimatedCents,item.currency)}</div><div className="mt-1 h-1.5 w-28 overflow-hidden rounded bg-[#e9e5da]"><div className="h-full bg-[#a98752]" style={{width:`${currencyMax[key] ? item.estimatedCents/currencyMax[key]*100 : 0}%`}}/></div></td><td className="px-5 py-3">{item.pricedEntryCount}</td><td className="px-5 py-3">{item.fixedFeeEntryCount}</td><td className="px-5 py-3">{item.unpricedEntryCount}</td></tr>})}</tbody></table>{!data.agingWorkInProgress.length&&<div className="p-6 text-center text-xs text-[#87918d]">No aging work in progress.</div>}</div><p className="border-t border-[#e9e4d9] bg-[#f7f5ee] px-5 py-3 text-[10px] leading-5 text-[#89918c]">Estimated values are hourly-priced only and remain separated by currency. Fixed-fee and unpriced work is not included in estimated dollars.</p></section>
    </div>
    <section className={`${panel} mt-5 overflow-hidden`}><header className="border-b border-[#e9e4d9] px-5 py-4"><h2 className="serif text-lg font-bold">Workload & team capacity</h2><p className="mt-1 text-xs text-[#788581]">Active matter counts against each teammate’s working limit. Capacity is configured in minutes per week.</p></header><form onSubmit={submitCapacity}><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-[#f2f0e9] text-[9px] uppercase tracking-wide text-[#7d8985]"><tr><th className="px-5 py-3">Owner</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Active matters</th><th className="px-3 py-3">Logged time</th><th className="px-3 py-3">Weekly minutes</th><th className="px-5 py-3">Matter limit</th></tr></thead><tbody>{data.workload.map(member=><tr key={member.membershipId} className="border-t border-[#eee9df]"><td className="px-5 py-3 font-semibold">{member.name}</td><td className="px-3 py-3 capitalize text-[#788581]">{member.role}</td><td className="px-3 py-3"><div className="flex items-center gap-2"><span>{member.activeMatterCount} / {member.activeMatterLimit}</span><div className="h-1.5 w-20 rounded bg-[#e9e5da]"><div className={`h-full rounded ${member.activeMatterCount>=member.activeMatterLimit?'bg-[#b66354]':'bg-[#527861]'}`} style={{width:`${Math.min(100,member.activeMatterCount/Math.max(1,member.activeMatterLimit)*100)}%`}}/></div></div></td><td className="px-3 py-3">{(member.loggedMinutes/60).toFixed(1)}h</td><td className="capacity-cell px-3 py-3" data-print-value={member.weeklyCapacityMinutes}><input aria-label={`Weekly capacity for ${member.name}`} name={`weekly-${member.membershipId}`} type="number" min="60" max="10080" defaultValue={member.weeklyCapacityMinutes} className="field h-9 max-w-[130px]"/></td><td className="capacity-cell px-5 py-3" data-print-value={member.activeMatterLimit}><input aria-label={`Active matter limit for ${member.name}`} name={`limit-${member.membershipId}`} type="number" min="1" max="1000" defaultValue={member.activeMatterLimit} className="field h-9 max-w-[100px]"/></td></tr>)}</tbody></table>{!data.workload.length&&<div className="p-8 text-center text-xs text-[#87918d]">No assigned team workload is available.</div>}</div><div className="ops-report-controls flex justify-end border-t border-[#e9e4d9] p-4"><button className="rounded-md bg-[#294651] px-4 py-2.5 text-xs font-semibold text-[#f9f6ed] transition hover:bg-[#1c3943] disabled:opacity-50" disabled={save.isPending||!data.workload.length}>{save.isPending?'Saving capacity…':'Save team capacity'}</button></div></form></section>
    <section className={`${panel} mt-5 overflow-hidden`}><header className="border-b border-[#e9e4d9] px-5 py-4"><h2 className="serif text-lg font-bold">Deadline pressure</h2><p className="mt-1 text-xs text-[#788581]">Near-term work requiring owner review.</p></header><div className="divide-y divide-[#eee9df]">{data.upcomingDeadlines.map(item=><a key={item.matterId} href={`/matters/${item.matterId}`} className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-[#f5f2e9]"><span className={`h-2 w-2 rounded-full ${item.riskLevel==='high'?'bg-[#b66354]':item.riskLevel==='medium'?'bg-[#b89451]':'bg-[#668773]'}`}/><div className="min-w-[180px] flex-1"><div className="text-sm font-semibold">{item.matterTitle}</div><div className="mt-1 text-[10px] text-[#87918d]">{item.clientName} · {item.responsible}</div></div><span className="rounded-full bg-[#f6ece7] px-2.5 py-1 text-[10px] font-bold text-[#8d584c]">{formatDate(item.dueAt)}</span><span className="text-[10px] capitalize text-[#87918d]">{item.riskLevel} risk</span></a>)}{!data.upcomingDeadlines.length&&<div className="p-8 text-center text-xs text-[#87918d]">No upcoming deadline pressure.</div>}</div></section>
    <section className={`${panel} mt-5 overflow-hidden`}><header className="border-b border-[#e9e4d9] px-5 py-4"><h2 className="serif text-lg font-bold">Re-engagement follow-ups</h2><p className="mt-1 text-xs text-[#788581]">Renewal and returning-client reminders, surfaced from matter closeout records.</p></header><div className="divide-y divide-[#eee9df]">{data.followups.map(f=><a key={f.id} href={`/matters/${f.matterId}`} className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-[#f5f2e9]"><div className="min-w-[180px] flex-1"><div className="text-sm font-semibold">{f.clientName} · {f.matterTitle}</div><div className="mt-1 text-xs text-[#788581]">{f.reason}</div></div><span className="text-xs text-[#788581]">Due {formatDate(f.dueAt)}</span><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase ${f.status==='complete'?'bg-[#e5eee7] text-[#47725b]':'bg-[#fff1db] text-[#845d24]'}`}>{f.status}</span></a>)}{!data.followups.length&&<div className="p-8 text-center text-xs text-[#87918d]">No follow-ups are currently scheduled.</div>}</div></section>
  </div>;
}
