import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  getGetWorkspaceMemberAssignmentsQueryKey,
  getListWorkspaceMembersQueryKey,
  getListWorkspaceMembershipConflictsQueryKey,
  useGetWorkspaceMemberAssignments,
  useListWorkspaceMembers,
  useListWorkspaceMembershipConflicts,
  useResolveWorkspaceMembershipConflict,
} from '@workspace/api-client-react';
import type { WorkspaceMembershipConflict, WorkspaceMember } from '@workspace/api-client-react';
import { AlertTriangle, ArrowRight, Check, ChevronDown, CircleHelp, LockKeyhole, RefreshCw, ShieldCheck, Users } from 'lucide-react';

function prettyDate(value: string | null) {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function messageFromError(error: unknown) {
  const candidate = error as { status?: number; data?: { code?: string }; response?: { data?: { code?: string }; status?: number } };
  const status = candidate?.response?.status ?? candidate?.status;
  const code = candidate?.response?.data?.code ?? candidate?.data?.code;
  if (status === 403 || code === 'firm_owner_protected' || code === 'self_removal_protected') {
    return 'This access cannot be removed by this action. The firm owner and the signed-in administrator cannot remove their own membership.';
  }
  if (code === 'unresolved_assignments') {
    return 'Resolve legacy assignment labels in the Team page before removing this teammate.';
  }
  if (code === 'membership_assignments_replacement_required') {
    return 'Choose a current-firm teammate to take over assigned work before removing access.';
  }
  if (code === 'invalid_replacement_member') {
    return 'Choose a different active teammate in this firm to take assigned work.';
  }
  if (status === 404) {
    return 'This membership has changed and can no longer be reviewed here. Refresh the review.';
  }
  return 'The decision could not be recorded. No access or assignment changes were made. You can retry this decision.';
}

function ConflictCard({ conflict, members, currentMemberEmail, onSaved }: {
  conflict: WorkspaceMembershipConflict;
  members: WorkspaceMember[];
  currentMemberEmail?: string;
  onSaved: (membershipId: number, decision: 'retain' | 'remove') => void;
}) {
  const [decision, setDecision] = useState<'retain' | 'remove'>('retain');
  const [reason, setReason] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [decisionFailed, setDecisionFailed] = useState(false);
  const resolve = useResolveWorkspaceMembershipConflict();
  const reasonValid = reason.trim().length >= 3;
  const assignmentsQuery = useGetWorkspaceMemberAssignments(conflict.membershipId, {
    query: {
      enabled: decision === 'remove',
      queryKey: getGetWorkspaceMemberAssignmentsQueryKey(conflict.membershipId),
    },
  });
  const assignments = assignmentsQuery.data;
  const hasAssignments = Boolean(assignments && (
    assignments.clients.length > 0 || assignments.matters.length > 0 || assignments.intakes.length > 0
  ));
  const eligibleMembers = members.filter(member => member.id !== conflict.membershipId);
  const targetIsOwner = conflict.role.toLowerCase() === 'owner';
  const targetIsCurrentAdmin = Boolean(currentMemberEmail && conflict.email.toLowerCase() === currentMemberEmail.toLowerCase());
  const needsReplacement = decision === 'remove' && hasAssignments;
  const replacementValid = !needsReplacement || (replacementId !== '' && eligibleMembers.some(member => String(member.id) === replacementId));
  const canSubmit = reasonValid && replacementValid && !resolve.isPending &&
    !(decision === 'remove' && (!assignmentsQuery.isSuccess || assignmentsQuery.isLoading || targetIsOwner || targetIsCurrentAdmin));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!reasonValid || !replacementValid || resolve.isPending) return;
    setSaved(false);
    setDecisionFailed(false);
    resolve.mutate({
      id: conflict.membershipId,
      data: {
        decision,
        reason: reason.trim(),
        ...(needsReplacement ? { replacementMemberId: Number(replacementId) } : {}),
      },
    }, {
      onSuccess: () => {
        setDecisionFailed(false);
        setSaved(true);
        setSubmitted(false);
          onSaved(conflict.membershipId, decision);
      },
      onError: () => setDecisionFailed(true),
    });
  }

  return <article className="overflow-hidden rounded-md border border-[#ded9cd] bg-[#fbfaf5] shadow-[0_8px_24px_rgba(38,51,53,.035)]" data-testid={`card-membership-conflict-${conflict.membershipId}`}>
    <div className="grid gap-5 border-b border-[#e9e4d9] p-5 md:grid-cols-[1fr_auto] md:items-start md:p-6">
      <div className="flex min-w-0 gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e7ede7] text-sm font-bold text-[#3e6556]" aria-hidden="true">
          {conflict.memberName.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'M'}
        </div>
        <div className="min-w-0">
          <h3 className="serif truncate text-xl font-bold" data-testid={`text-conflict-member-${conflict.membershipId}`}>{conflict.memberName}</h3>
          <p className="mt-1 break-all text-sm text-[#70807e]">{conflict.email}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-sm border border-[#ded9cd] bg-[#f3f0e8] px-2 py-1 font-semibold capitalize text-[#4f6262]">{conflict.role}</span>
            <span className="text-[#85908c]">This firm · {conflict.firmName}</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:min-w-[224px]" aria-label="Duplicate membership counts">
        <div className="rounded-sm bg-[#f0eee6] px-3 py-2.5" data-testid={`count-other-firms-${conflict.membershipId}`}>
          <div className="mono text-[9px] uppercase tracking-[.12em] text-[#8a928a]">Other firms</div>
          <div className="mt-1 text-lg font-semibold">{conflict.otherFirmCount}</div>
        </div>
        <div className="rounded-sm bg-[#f0eee6] px-3 py-2.5" data-testid={`count-other-memberships-${conflict.membershipId}`}>
          <div className="mono text-[9px] uppercase tracking-[.12em] text-[#8a928a]">Other memberships</div>
          <div className="mt-1 text-lg font-semibold">{conflict.otherMembershipCount}</div>
        </div>
      </div>
    </div>

    {conflict.lastDecision && <div className="flex flex-wrap items-start gap-3 border-b border-[#e9e4d9] bg-[#f4f2ea] px-5 py-4 md:px-6" data-testid={`status-last-decision-${conflict.membershipId}`}>
      <div className={`mt-0.5 grid h-7 w-7 place-items-center rounded-full ${conflict.lastDecision === 'retain' ? 'bg-[#e2eee5] text-[#47745d]' : 'bg-[#f7e8e3] text-[#a6574c]'}`}>
        {conflict.lastDecision === 'retain' ? <Check className="h-4 w-4" /> : <LockKeyhole className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
         <p className="text-sm font-semibold">Latest decision: {conflict.lastDecision === 'retain' ? 'Access retained' : 'Access removed'}</p>
         <p className="mt-1 text-xs leading-5 text-[#73817f]">
          {conflict.lastDecisionBy ? `Reviewed by ${conflict.lastDecisionBy}` : 'Reviewer not recorded'}
          {conflict.lastDecisionAt ? ` · ${prettyDate(conflict.lastDecisionAt)}` : ''}
        </p>
        {conflict.lastDecisionReason && <p className="mt-2 border-l-2 border-[#c5b58f] pl-3 text-xs leading-5 text-[#5f706f]">{conflict.lastDecisionReason}</p>}
      </div>
    </div>}

    <form onSubmit={submit} className="p-5 md:p-6" data-testid={`form-conflict-decision-${conflict.membershipId}`}>
      <fieldset className="min-w-0" disabled={resolve.isPending}>
        <legend className="text-sm font-semibold">Review this firm's access</legend>
        <p className="mt-1 text-xs leading-5 text-[#778481]">Your choice applies only to the membership in this firm. Duplicate counts are shown without exposing records held elsewhere.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={`flex cursor-pointer gap-3 rounded-sm border p-3.5 transition ${decision === 'retain' ? 'border-[#8ca597] bg-[#edf2eb]' : 'border-[#e2ded3] bg-[#fffefa] hover:border-[#c5b58f]'}`}>
            <input type="radio" name={`decision-${conflict.membershipId}`} value="retain" checked={decision === 'retain'} onChange={() => { setDecision('retain'); setSubmitted(false); setDecisionFailed(false); }} className="mt-0.5 accent-[#426957]" data-testid={`radio-retain-${conflict.membershipId}`} />
            <span><span className="block text-sm font-semibold">Retain this access</span><span className="mt-1 block text-xs leading-5 text-[#75817d]">Keep this teammate's membership in your firm.</span></span>
          </label>
          <label className={`flex cursor-pointer gap-3 rounded-sm border p-3.5 transition ${decision === 'remove' ? 'border-[#c99487] bg-[#fbf0ec]' : 'border-[#e2ded3] bg-[#fffefa] hover:border-[#c5b58f]'}`}>
            <input type="radio" name={`decision-${conflict.membershipId}`} value="remove" checked={decision === 'remove'} onChange={() => { setDecision('remove'); setSubmitted(false); setSaved(false); setDecisionFailed(false); }} className="mt-0.5 accent-[#a65349]" data-testid={`radio-remove-${conflict.membershipId}`} />
            <span><span className="block text-sm font-semibold">Remove this firm's access</span><span className="mt-1 block text-xs leading-5 text-[#75817d]">Remove access to this firm's workspace.</span></span>
          </label>
        </div>
      </fieldset>

      {decision === 'remove' && <section className="mt-4 rounded-sm border border-[#e4ded0] bg-[#f5f2e9] p-4" aria-label="Assignment handoff" data-testid={`panel-assignments-${conflict.membershipId}`}>
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-[#8d744e]" />
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold">Check firm assignments</h4>
            {assignmentsQuery.isLoading ? <div className="mt-3 space-y-2" aria-label="Loading assignments" data-testid={`loading-assignments-${conflict.membershipId}`}><div className="h-3 w-2/3 animate-pulse rounded bg-[#e3dfd4]" /><div className="h-3 w-1/2 animate-pulse rounded bg-[#e3dfd4]" /></div>
              : assignmentsQuery.isError ? <div className="mt-2 text-sm text-[#8f4d45]" role="alert" data-testid={`error-assignments-${conflict.membershipId}`}>Assignments could not be checked. Retry before requesting removal. <button type="button" onClick={() => assignmentsQuery.refetch()} className="ml-1 font-semibold underline" data-testid={`button-retry-assignments-${conflict.membershipId}`}>Try again</button></div>
                : assignments && hasAssignments ? <>
                  <p className="mt-1 text-xs leading-5 text-[#72807d]">Move these current-firm records to a teammate before removal.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-sm border border-[#e4dfd5] bg-[#fffefa] p-3" data-testid={`assigned-clients-${conflict.membershipId}`}>
                      <p className="mono text-[9px] uppercase tracking-[.12em] text-[#87918b]">Clients · {assignments.clients.length}</p>
                      {assignments.clients.length ? <ul className="mt-2 space-y-1.5 text-xs">{assignments.clients.map(client => <li key={client.id} className="truncate">{client.name}</li>)}</ul> : <p className="mt-2 text-xs text-[#87918b]">No assigned clients</p>}
                    </div>
                    <div className="rounded-sm border border-[#e4dfd5] bg-[#fffefa] p-3" data-testid={`assigned-matters-${conflict.membershipId}`}>
                      <p className="mono text-[9px] uppercase tracking-[.12em] text-[#87918b]">Matters · {assignments.matters.length}</p>
                      {assignments.matters.length ? <ul className="mt-2 space-y-1.5 text-xs">{assignments.matters.map(matter => <li key={matter.id} className="min-w-0"><span className="block truncate font-semibold">{matter.title}</span><span className="block truncate text-[#81908b]">{matter.reference} · {matter.clientName}</span></li>)}</ul> : <p className="mt-2 text-xs text-[#87918b]">No assigned matters</p>}
                    </div>
                    <div className="rounded-sm border border-[#e4dfd5] bg-[#fffefa] p-3" data-testid={`assigned-intakes-${conflict.membershipId}`}>
                      <p className="mono text-[9px] uppercase tracking-[.12em] text-[#87918b]">Pending intakes · {assignments.intakes.length}</p>
                      {assignments.intakes.length ? <ul className="mt-2 space-y-1.5 text-xs">{assignments.intakes.map(intake => <li key={intake.id} className="min-w-0"><span className="block truncate font-semibold">{intake.clientName}</span><span className="block truncate text-[#81908b]">{intake.matterTitle} · {intake.status.replaceAll('_', ' ')}</span></li>)}</ul> : <p className="mt-2 text-xs text-[#87918b]">No pending intakes</p>}
                    </div>
                  </div>
                  <label htmlFor={`replacement-${conflict.membershipId}`} className="mt-4 block text-xs font-semibold">Replacement teammate <span className="text-[#a65349]">Required</span></label>
                  <div className="relative mt-1.5">
                    <select id={`replacement-${conflict.membershipId}`} value={replacementId} onChange={event => setReplacementId(event.target.value)} className="field appearance-none pr-9" aria-describedby={`replacement-help-${conflict.membershipId}`} data-testid={`select-replacement-${conflict.membershipId}`}>
                      <option value="">Choose a current-firm teammate</option>
                      {eligibleMembers.map(member => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[#71807d]" />
                  </div>
                  <p id={`replacement-help-${conflict.membershipId}`} className="mt-1 text-[11px] text-[#7c8884]">Only active teammates in this firm are listed.</p>
                  {eligibleMembers.length === 0 && <p className="mt-2 text-xs text-[#8f4d45]" role="alert">No eligible replacement teammate is available in this firm.</p>}
                </> : assignments && <p className="mt-2 text-xs leading-5 text-[#71807d]" data-testid={`text-no-assignments-${conflict.membershipId}`}>No clients, matters, or pending intakes are assigned to this teammate in your firm.</p>}
          </div>
        </div>
      </section>}

      {decision === 'remove' && (targetIsOwner || targetIsCurrentAdmin) && <div className="mt-4 flex items-start gap-2 rounded-sm border border-[#e8c9c2] bg-[#fff5f1] p-3 text-sm leading-5 text-[#8f443d]" role="alert" data-testid={`error-removal-prohibited-${conflict.membershipId}`}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {targetIsOwner ? 'The firm owner cannot be removed from this firm.' : 'You cannot remove your own membership from this firm.'}
      </div>}
      {decision === 'remove' && assignmentsQuery.isError && <p className="mt-2 text-xs font-medium text-[#9a4941]" role="alert">Confirm assignments before removing access.</p>}

      <label htmlFor={`reason-${conflict.membershipId}`} className="mt-5 block text-sm font-semibold">Decision reason <span className="text-[#a65349]">*</span></label>
      <textarea id={`reason-${conflict.membershipId}`} value={reason} onChange={event => { setReason(event.target.value); setSaved(false); }} rows={3} maxLength={500} placeholder="Record the basis for this access decision" className="mt-2 w-full resize-y rounded-[5px] border border-[#d9d4c8] bg-[#fffefa] px-3 py-2.5 text-sm leading-6 text-[#23353b] outline-none transition placeholder:text-[#9aa19b] focus:border-[#a88b5e] focus:shadow-[0_0_0_3px_rgba(168,139,94,.13)]" aria-describedby={`reason-help-${conflict.membershipId}${submitted && !reasonValid ? ` reason-error-${conflict.membershipId}` : ''}`} data-testid={`input-reason-${conflict.membershipId}`} />
      <div className="mt-1 flex items-start justify-between gap-3">
        <p id={`reason-help-${conflict.membershipId}`} className="text-[11px] leading-5 text-[#7c8884]">At least 3 non-space characters. Kept in your firm's review history.</p>
        <span className="mono shrink-0 text-[10px] text-[#89928c]">{reason.length}/500</span>
      </div>
      {submitted && !reasonValid && <p id={`reason-error-${conflict.membershipId}`} className="mt-2 text-xs font-medium text-[#9a4941]" role="alert" data-testid={`error-reason-${conflict.membershipId}`}>Enter a reason with at least 3 non-space characters.</p>}
      {submitted && needsReplacement && !replacementValid && <p className="mt-2 text-xs font-medium text-[#9a4941]" role="alert" data-testid={`error-replacement-${conflict.membershipId}`}>Choose a current-firm replacement teammate to continue.</p>}
      {(decisionFailed || resolve.isError) && <div className="mt-4 flex items-start gap-2 rounded-sm border border-[#e8c9c2] bg-[#fff5f1] p-3 text-sm leading-5 text-[#8f443d]" role="alert" data-testid={`error-decision-${conflict.membershipId}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{messageFromError(resolve.error)}</div>}
      {saved && <div className="mt-4 flex items-center gap-2 rounded-sm border border-[#d1e0d2] bg-[#edf4ed] p-3 text-sm font-medium text-[#3d6b52]" role="status" data-testid={`status-decision-saved-${conflict.membershipId}`}><Check className="h-4 w-4" />Decision saved to this firm's review history.</div>}
      <div className="mt-5 flex flex-col-reverse gap-3 border-t border-[#ece7dc] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-[11px] leading-5 text-[#7d8985]"><LockKeyhole className="h-3.5 w-3.5 shrink-0 text-[#62806e]" />Only this firm's membership is in scope.</p>
        <button type="submit" disabled={!canSubmit} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${decision === 'remove' ? 'bg-[#a7443e] text-white hover:bg-[#893b36]' : 'bg-[#294651] text-[#f9f6ed] hover:bg-[#1c3943]'}`} data-testid={`button-submit-decision-${conflict.membershipId}`}>
           {resolve.isPending ? 'Saving decision…' : decisionFailed ? decision === 'remove' ? 'Retry removal' : 'Retry decision' : decision === 'remove' ? 'Remove access' : 'Retain access'}
          {!resolve.isPending && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    </form>
  </article>;
}

export default function MembershipConflicts() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const currentMemberEmail = user?.primaryEmailAddress?.emailAddress;
  const conflictsQuery = useListWorkspaceMembershipConflicts({
    query: { queryKey: getListWorkspaceMembershipConflictsQueryKey() },
  });
  const membersQuery = useListWorkspaceMembers({
    query: { queryKey: getListWorkspaceMembersQueryKey() },
  });
  const conflicts = conflictsQuery.data ?? [];
  const members = membersQuery.data ?? [];

  function invalidateViews(membershipId: number, decision: 'retain' | 'remove') {
    setSavedNotice(decision === 'remove'
      ? "Access to this firm's workspace was removed. Firm records remain in place."
      : "Access was retained for this firm and the decision was recorded.");
    void queryClient.invalidateQueries({ queryKey: getListWorkspaceMembershipConflictsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListWorkspaceMembersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetWorkspaceMemberAssignmentsQueryKey(membershipId) });
    void queryClient.invalidateQueries();
  }

  if (conflictsQuery.isLoading || membersQuery.isLoading) {
    return <section className="page-in" data-testid="membership-conflicts-loading" aria-label="Loading membership review">
      <div className="mb-8 h-3 w-36 animate-pulse rounded bg-[#ded9cd]" />
      <div className="h-10 w-80 max-w-full animate-pulse rounded bg-[#e6e2d7]" />
      <div className="mt-3 h-4 w-[30rem] max-w-full animate-pulse rounded bg-[#eae7de]" />
      <div className="mt-8 space-y-4">{[1, 2].map(item => <div key={item} className="h-52 animate-pulse rounded-md border border-[#e0dace] bg-[#fbfaf5]" />)}</div>
    </section>;
  }

  if (conflictsQuery.isError || membersQuery.isError) {
    const failed = conflictsQuery.isError ? conflictsQuery : membersQuery;
    return <section className="rounded-md border border-[#e6c7c1] bg-[#fff9f6] p-6 md:p-8" data-testid="status-conflicts-error">
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-[#9a4941]" /><div><h2 className="serif text-xl font-bold text-[#843f38]">Membership review unavailable</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#7d7470]">The current firm's conflict information could not be loaded. No membership decision has been made.</p><button type="button" onClick={() => { void conflictsQuery.refetch(); void membersQuery.refetch(); }} className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#d9d4c8] bg-[#fffefa] px-4 py-2.5 text-sm font-semibold text-[#40585a] hover:bg-[#f3f0e8]" data-testid="button-retry-conflicts"><RefreshCw className="h-4 w-4" />Try again</button></div></div>
    </section>;
  }

  return <section className="page-in" data-testid="membership-conflicts-page">
    <header className="mb-8 overflow-hidden rounded-md border border-[#dcd7ca] bg-[#eeece3]">
      <div className="grid gap-5 p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
        <div>
          <div className="mono mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[.17em] text-[#92754a]"><span className="h-px w-7 bg-[#b99a65]" />Firm access assurance</div>
          <h1 className="serif text-3xl font-bold tracking-[-.04em] md:text-[38px]" data-testid="text-membership-conflicts-title">Membership review</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6f7e7b]">Review duplicate identity counts, then record what should happen to access in this firm. Other firms' details are never shown.</p>
        </div>
        <div className="flex items-center gap-3 rounded-sm border border-[#d8d5c9] bg-[#f8f6ef] px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[#e1e9e1] text-[#47705b]"><ShieldCheck className="h-4 w-4" /></div>
          <div><div className="mono text-[9px] uppercase tracking-[.12em] text-[#89918b]">Scope</div><div className="mt-0.5 text-xs font-semibold">Current firm only</div></div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ddd8cb] bg-[#e9e7dd] px-6 py-3 text-xs text-[#657572] md:px-8">
        <span className="flex items-center gap-2"><CircleHelp className="h-3.5 w-3.5 text-[#957b52]" />Decisions are recorded only after server confirmation.</span>
        <span className="mono" data-testid="text-conflict-count">{conflicts.length} {conflicts.length === 1 ? 'review' : 'reviews'}</span>
      </div>
    </header>

     {savedNotice && <p className="mb-5 rounded-sm border border-[#d1e0d2] bg-[#edf4ed] px-4 py-3 text-sm font-medium text-[#3d6b52]" role="status" data-testid="status-membership-decision-saved">{savedNotice}</p>}

    {conflicts.length === 0 ? <div className="grid min-h-64 place-items-center rounded-md border border-dashed border-[#d6d1c5] bg-[#fbfaf5] p-8 text-center" data-testid="status-conflicts-empty">
      <div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e8eee8] text-[#4d7463]"><Check className="h-5 w-5" /></div><h2 className="serif mt-4 text-xl font-bold">No membership conflicts to review</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#71807e]">When a duplicate identity needs an access decision for this firm, it will appear here.</p></div>
    </div> : <div className="space-y-5" data-testid="list-membership-conflicts">
      {conflicts.map(conflict => <ConflictCard key={conflict.membershipId} conflict={conflict} members={members} currentMemberEmail={currentMemberEmail} onSaved={invalidateViews} />)}
    </div>}
  </section>;
}
