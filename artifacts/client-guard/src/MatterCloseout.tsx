import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMatterCloseoutQueryKey, useCreateMatterFollowup, useGetMatterCloseout,
  useInitializeMatterCloseout, useUpdateCloseoutItem, useUpdateMatterFollowup,
} from '@workspace/api-client-react';
import { AlertTriangle, CalendarClock, Check, LockKeyhole } from 'lucide-react';

const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'The request could not be completed.';
export default function MatterCloseout({ matterId }: { matterId: number }) {
  const qc = useQueryClient();
  const closeout = useGetMatterCloseout(matterId, { query: { queryKey: getGetMatterCloseoutQueryKey(matterId) } });
  const initialize = useInitializeMatterCloseout();
  const updateItem = useUpdateCloseoutItem();
  const createFollowup = useCreateMatterFollowup();
  const updateFollowup = useUpdateMatterFollowup();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  function refresh() { qc.invalidateQueries({ queryKey: getGetMatterCloseoutQueryKey(matterId) }); }
  function init() {
    setError(''); setSuccess('');
    initialize.mutate({ id: matterId }, { onSuccess: () => { refresh(); setSuccess('Closeout checklist is ready.'); }, onError: e => setError(errorMessage(e)) });
  }
  function complete(itemId: number, status: 'open' | 'complete') {
    setError(''); setSuccess('');
    updateItem.mutate({ id: itemId, data: { status } }, { onSuccess: () => { refresh(); setSuccess(status === 'complete' ? 'Checklist item completed.' : 'Checklist item reopened.'); }, onError: e => setError(errorMessage(e)) });
  }
  function addFollowup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setSuccess('');
    const form = e.currentTarget;
    const f = new FormData(form);
    createFollowup.mutate({ id: matterId, data: { dueAt: String(f.get('dueAt')), reason: String(f.get('reason')).trim() } }, { onSuccess: () => { refresh(); setSuccess('Re-engagement follow-up scheduled.'); form.reset(); }, onError: e => setError(errorMessage(e)) });
  }
  function followupStatus(id: number, status: 'open' | 'complete') {
    setError(''); setSuccess('');
    updateFollowup.mutate({ id, data: { status } }, { onSuccess: () => { refresh(); setSuccess(`Follow-up marked ${status}.`); }, onError: e => setError(errorMessage(e)) });
  }
  return <section className="mt-5 overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5]" data-testid="panel-matter-closeout">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e9e4d9] px-5 py-4"><div><div className="mono text-[9px] uppercase tracking-[.14em] text-[#92754a]">Matter completion & return engagement</div><h2 className="serif mt-1 text-xl font-bold">Closeout & follow-up</h2><p className="mt-1 text-xs text-[#788581]">Complete closeout review before this matter can close. Legal holds remain visible until resolved.</p></div>{closeout.data && <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase ${closeout.data.canClose?'bg-[#e5eee7] text-[#47725b]':'bg-[#fff1db] text-[#845d24]'}`}>{closeout.data.canClose?'Ready to close':'Closeout required'}</span>}</header>
    {(error || success) && <div className="px-5 pt-4">{error && <p role="alert" className="rounded border border-[#e6c7c1] bg-[#fff9f6] p-3 text-xs text-[#843f38]">{error}</p>}{success && <p role="status" className="rounded border border-[#c9d8cc] bg-[#edf3ed] p-3 text-xs text-[#42664f]">{success}</p>}</div>}
    {closeout.isLoading ? <div className="space-y-3 p-5">{[1,2,3].map(i=><div key={i} className="h-10 animate-pulse rounded bg-[#e8e4d9]"/>)}</div> : closeout.isError || !closeout.data ? <div className="p-5"><p role="alert" className="mb-3 text-xs text-[#843f38]">Closeout details are unavailable. {closeout.error ? errorMessage(closeout.error) : ''}</p><button onClick={init} disabled={initialize.isPending} className="rounded border border-[#d9d4c8] px-3 py-2 text-xs font-semibold">{initialize.isPending?'Preparing…':'Initialize closeout checklist'}</button><button onClick={()=>closeout.refetch()} className="ml-3 text-xs font-semibold underline">Retry</button></div> : <>
      {closeout.data.legalHold && <div className="mx-5 mt-4 flex items-start gap-2 rounded border border-[#e6c7c1] bg-[#fff5f2] p-3 text-xs leading-5 text-[#843f38]"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0"/><span><strong>Legal hold active.</strong> Retention disposition must not proceed while this hold remains in force. Review the firm Governance register.</span></div>}
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_.9fr]">
        <div><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#6c7975]">Required closeout review</h3><div className="divide-y divide-[#eee9df] rounded border border-[#e7e2d7]">{closeout.data.items.map(item=><div key={item.id} className="flex items-center gap-3 p-3"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${item.status==='complete'?'bg-[#e5eee7] text-[#47725b]':'bg-[#f2f0e9] text-[#9a7945]'}`}>{item.status==='complete'?<Check className="h-4 w-4"/>:<span className="mono text-[10px]">—</span>}</span><div className="min-w-0 flex-1"><div className="text-sm font-semibold">{item.title}</div><div className="mt-1 text-[10px] text-[#89918c]">{item.completedBy ? `Completed by ${item.completedBy} · ${item.completedAt ? new Date(item.completedAt).toLocaleDateString() : ''}` : 'Awaiting review'}</div></div><button onClick={()=>complete(item.id,item.status==='complete'?'open':'complete')} disabled={updateItem.isPending} className="rounded border border-[#d9d4c8] px-3 py-2 text-[10px] font-bold text-[#40575b] transition hover:bg-[#f1eee6] disabled:opacity-50">{item.status==='complete'?'Reopen':'Mark complete'}</button></div>)}</div>
          <div className="mt-3 grid gap-2 rounded bg-[#f2f0e9] p-3 text-xs sm:grid-cols-2"><div><span className="text-[#788581]">Retention period</span><div className="mt-1 font-semibold">{closeout.data.retentionDays} days</div></div><div><span className="text-[#788581]">Target disposition</span><div className="mt-1 font-semibold">{closeout.data.targetRetentionDate ? new Date(closeout.data.targetRetentionDate).toLocaleDateString() : 'Not scheduled'}</div></div></div>
        </div>
        <div><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#6c7975]">Re-engagement reminders</h3><form onSubmit={addFollowup} className="grid gap-3 rounded border border-[#e7e2d7] p-3"><label className="text-xs font-semibold">Due date<input type="date" required name="dueAt" className="field mt-1"/></label><label className="text-xs font-semibold">Reason<input required maxLength={1000} name="reason" className="field mt-1" placeholder="Renewal review, annual check-in…" /></label><button className="justify-self-start rounded bg-[#294651] px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-[#1c3943] disabled:opacity-50" disabled={createFollowup.isPending}><CalendarClock className="mr-1 inline h-3.5 w-3.5"/>{createFollowup.isPending?'Scheduling…':'Schedule follow-up'}</button></form>
          <div className="mt-3 divide-y divide-[#eee9df] rounded border border-[#e7e2d7]">{closeout.data.followups.map(f=><div key={f.id} className="flex items-start gap-3 p-3"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[#9a7945]"/><div className="min-w-0 flex-1"><div className="text-xs font-semibold">{f.reason}</div><div className="mt-1 text-[10px] text-[#89918c]">Due {new Date(f.dueAt).toLocaleDateString()} · {f.clientName}</div></div><button onClick={()=>followupStatus(f.id,f.status==='complete'?'open':'complete')} className="rounded border border-[#d9d4c8] px-2 py-1.5 text-[9px] font-bold" disabled={updateFollowup.isPending}>{f.status==='complete'?'Reopen':'Complete'}</button></div>)}{!closeout.data.followups.length && <div className="p-4 text-center text-xs text-[#87918d]">No future reminders scheduled.</div>}</div>
          {closeout.data.legalHold && <p className="mt-3 flex gap-2 text-[10px] leading-5 text-[#8d584c]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0"/>Legal hold is active; keep the matter and its evidence available.</p>}
        </div>
      </div>
    </>}
  </section>;
}
