import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListClientsQueryKey, getListPortalAccessQueryKey, useInvitePortalClient, useListPortalAccess, useRevokePortalAccess } from '@workspace/api-client-react';
import { Link2, Mail, ShieldCheck, UserRoundPlus } from 'lucide-react';

export default function PortalInvitation({clientId,clientName,email}:{clientId:number;clientName:string;email:string|null}) {
  const qc=useQueryClient();
  const access=useListPortalAccess({query:{queryKey:getListPortalAccessQueryKey()}});
  const invite=useInvitePortalClient();
  const revoke=useRevokePortalAccess();
  const [address,setAddress]=useState(email||'');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const grants=(access.data||[]).filter(item=>item.clientId===clientId);
  function send(){if(!address.trim()){setError('Enter the client email address.');return;}setError('');setNotice('');invite.mutate({data:{clientId,email:address.trim()}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListPortalAccessQueryKey()});qc.invalidateQueries({queryKey:getListClientsQueryKey()});setNotice(`Portal invitation sent to ${address.trim()}.`);},onError:e=>setError(e instanceof Error?e.message:'Invitation could not be sent.')});}
  return <section className="overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5]" data-testid={`portal-access-client-${clientId}`}><div className="flex items-center gap-3 border-b border-[#e9e4d9] px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded bg-[#e8eee8] text-[#4d7463]"><ShieldCheck className="h-4 w-4"/></span><div><h2 className="serif text-lg font-bold">Client portal access</h2><p className="mt-1 text-xs text-[#87918d]">Invite this client into their assigned-record portal.</p></div></div>
    <div className="space-y-4 p-5"><div className="flex flex-col gap-2 sm:flex-row"><label className="relative flex-1"><span className="sr-only">Client portal email</span><Mail className="absolute left-3 top-3 h-4 w-4 text-[#89918d]"/><input type="email" required value={address} onChange={e=>setAddress(e.target.value)} placeholder="client@example.com" className="field pl-10" data-testid="input-portal-invite-email"/></label><button onClick={send} disabled={invite.isPending||access.isLoading} className="inline-flex items-center justify-center gap-2 rounded bg-[#294651] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50" data-testid="button-invite-client-portal"><UserRoundPlus className="h-3.5 w-3.5"/>{invite.isPending?'Sending…':'Invite to portal'}</button></div>
      <p className="text-[10px] leading-4 text-[#89938e]">Portal users see only assigned matters, expressly shared documents, published updates, and portal messages.</p>
      {access.isError&&<p className="text-xs text-[#9a554d]">Current portal grants could not be loaded. <button onClick={()=>access.refetch()} className="underline">Retry</button></p>}
      {notice&&<p role="status" className="rounded border border-[#c9d8cc] bg-[#edf3ed] px-3 py-2 text-xs text-[#42664f]">{notice}</p>}{error&&<p role="alert" className="text-xs text-[#9a554d]">{error}</p>}
      {grants.length>0&&<div className="space-y-2 border-t border-[#e9e4d9] pt-3">{grants.map(grant=><div key={grant.id} className="flex flex-col justify-between gap-2 rounded bg-[#f4f1e9] px-3 py-3 sm:flex-row sm:items-center" data-testid={`portal-grant-${grant.id}`}><div className="min-w-0"><div className="text-xs font-semibold">{grant.email} <span className={`ml-1 rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ${grant.status==='active'?'bg-[#e5eee7] text-[#47725b]':grant.status==='invited'?'bg-[#f3eddd] text-[#8d713e]':'bg-[#ecebe5] text-[#687371]'}`}>{grant.status}</span></div><p className="mt-1 text-[9px] text-[#89938e]">Created {new Date(grant.createdAt).toLocaleDateString()}</p></div>{grant.status!=='revoked'&&<button onClick={()=>{if(window.confirm(`Revoke portal access for ${grant.email}?`))revoke.mutate({id:grant.id},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListPortalAccessQueryKey()});setNotice(`Portal access revoked for ${grant.email}.`);},onError:e=>setError(e instanceof Error?e.message:'Portal access could not be revoked.')});}} disabled={revoke.isPending} className="text-[10px] font-bold text-[#98483f] underline" data-testid={`button-revoke-portal-${grant.id}`}>Revoke access</button>}</div>)}</div>}
      {!grants.length&&access.isSuccess&&<p className="flex items-center gap-2 text-[11px] text-[#8a938e]"><Link2 className="h-3.5 w-3.5"/>No portal grant for {clientName} yet.</p>}
    </div>
  </section>;
}
