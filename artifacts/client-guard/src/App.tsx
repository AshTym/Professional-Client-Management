import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser, UserProfile } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Route, Switch, Router as WouterRouter, Link, Redirect, useLocation, useRoute } from 'wouter';
import {
  useHealthCheck, useGetWorkspace, useCreateWorkspace, useGetDashboard, useListActivity,
  useListWorkspaceInvitations, useCreateWorkspaceInvitation, useResendWorkspaceInvitation,
  useWithdrawWorkspaceInvitation, useAcceptWorkspaceInvitation, useListWorkspaceMembers,
  useUpdateWorkspaceMember, useRemoveWorkspaceMember, useTransferWorkspaceOwnership,
  useListOwnershipNoticeFailures, useRetryOwnershipNotice,
  useGetWorkspaceMemberAssignments,
  useListWorkspaceAssignmentMembers, useListWorkspaceAssignmentIssues,
  useGetMatterCloseout, getGetMatterCloseoutQueryKey,
  useListClients, useCreateClient, useGetClient, useUpdateClient, useDeleteClient,
  useListMatters, useGetMatter, useUpdateMatter, useCloseMatter, useLogMatterExportRequest,
  getHealthCheckQueryKey, getGetWorkspaceQueryKey, getGetDashboardQueryKey, getListActivityQueryKey,
  getListWorkspaceInvitationsQueryKey, getListWorkspaceMembersQueryKey,
  getListOwnershipNoticeFailuresQueryKey,
  getListWorkspaceAssignmentIssuesQueryKey,
  getListClientsQueryKey, getGetClientQueryKey, getListMattersQueryKey, getGetMatterQueryKey,
} from '@workspace/api-client-react';
import type { Client, ClientInput, Matter, WorkspaceInput, WorkspaceInvitationInput, WorkspaceMemberUpdate } from '@workspace/api-client-react';
import {
  Activity as ActivityIcon, ArrowDownRight, ArrowLeft, ArrowRight, BriefcaseBusiness, Check, ClipboardList as ClipboardListIcon,
  ChevronDown, CircleHelp, Clock3, FileText, Fingerprint, LockKeyhole, LogOut, Menu,
  Plus, Search, ShieldCheck, Users, X, Building2, Settings2, AlertTriangle, RefreshCw, Download,
  Mail, UserPlus, Landmark,
} from 'lucide-react';
import Workflows from './Workflows';
import Intake from './Intake';
import Governance from './Governance';
import Integrations from './Integrations';
import Portal from './Portal';
import PortalInvitation from './PortalInvitation';
import MembershipConflicts from './MembershipConflicts';
import PracticeOperations from './PracticeOperations';
import OperationsReport from './OperationsReport';
import MatterCloseout from './MatterCloseout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
const appearance = {
  theme: shadcn, cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: '#294552', colorForeground: '#23353b', colorMutedForeground: '#68777a', colorDanger: '#aa4842', colorBackground: '#fbfaf5', colorInput: '#fffefa', colorInputForeground: '#23353b', colorNeutral: '#d9d7cf', fontFamily: 'DM Sans', borderRadius: '10px' },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#23353b] font-bold', headerSubtitle: 'text-[#68777a]', socialButtonsBlockButtonText: 'text-[#23353b]',
    formFieldLabel: 'text-[#31464c]', footerActionLink: 'text-[#294552] font-semibold', footerActionText: 'text-[#68777a]',
    dividerText: 'text-[#68777a]', identityPreviewEditButton: 'text-[#294552]', formFieldSuccessText: 'text-[#347258]',
    alertText: 'text-[#8e3c37]', logoBox: 'rounded-lg', logoImage: 'max-h-10', socialButtonsBlockButton: 'border-[#d9d7cf] bg-[#fffefa]',
    formButtonPrimary: 'bg-[#294552] hover:bg-[#1d3741]', formFieldInput: 'border-[#d9d7cf] bg-[#fffefa] text-[#23353b]',
    footerAction: 'text-[#68777a]', dividerLine: 'bg-[#e3e0d7]', alert: 'bg-[#fbefed]', otpCodeFieldInput: 'border-[#d9d7cf]',
    formFieldRow: 'text-[#31464c]', main: 'text-[#23353b]',
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const id = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== id) qc.clear();
    previous.current = id;
  }), [addListener, qc]);
  return null;
}
function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Your firm workspace is ready when you are.' } }, signUp: { start: { title: 'Create your secure account', subtitle: 'A considered workspace for the work that matters.' } } }}
    routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <ClerkQueryClientCacheInvalidator />
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={() => <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>} />
      <Route path="/sign-up/*?" component={() => <AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>} />
      <Route path="/invite" component={InviteAcceptance} />
      <Route path="/portal" component={ClientPortalRoute} />
      <Route path="/dashboard" component={() => <Protected><Dashboard /></Protected>} />
      <Route path="/clients" component={() => <Protected><ClientsPage /></Protected>} />
      <Route path="/clients/:id" component={() => <Protected><ClientDetail /></Protected>} />
      <Route path="/matters" component={() => <Protected><MattersPage /></Protected>} />
      <Route path="/matters/:id" component={() => <Protected><MatterDetail /></Protected>} />
      <Route path="/practice-operations" component={() => <Protected><PracticeOperations /></Protected>} />
      <Route path="/reports/operations" component={() => <Protected><OperationsReport /></Protected>} />
      <Route path="/workflows" component={() => <Protected><Workflows /></Protected>} />
      <Route path="/intake" component={() => <Protected><Intake /></Protected>} />
      <Route path="/governance" component={() => <Protected><Governance /></Protected>} />
      <Route path="/settings/integrations" component={() => <Protected><Integrations /></Protected>} />
      <Route path="/activity" component={() => <Protected><ActivityPage /></Protected>} />
      <Route path="/team" component={() => <Protected><TeamPage /></Protected>} />
      <Route path="/workspace/setup" component={() => <Protected><SetupPage /></Protected>} />
      <Route path="/settings/security" component={() => <Protected><SecurityPage /></Protected>} />
      <Route component={NotFound} />
    </Switch>
  </ClerkProvider>;
}
function ClientPortalRoute() {
  return <><Show when="signed-in"><Portal /></Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>;
}
function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY.');
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><ClerkRoutes /></WouterRouter></QueryClientProvider>;
}
export default App;

function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><Landing /></Show></>;
}
function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="grain min-h-[100dvh] bg-[#f3f0e7] flex flex-col items-center justify-center p-5">
    <Link href="/" className="mb-7 flex items-center gap-3" data-testid="link-auth-home"><Logo /><span className="serif text-2xl font-bold">ClientGuard</span></Link>
    {children}
    <p className="mt-7 text-xs text-[#788383]">Private by design. Built for professional trust.</p>
  </main>;
}
function Logo({ small = false }: { small?: boolean }) {
  return <img src={`${basePath}/logo.svg`} alt="ClientGuard" className={small ? 'h-8 w-8' : 'h-10 w-10'} data-testid="img-brand-mark" />;
}
function Landing() {
  return <main className="grain min-h-[100dvh] bg-[#f6f3eb] text-[#23353b]">
    <header className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-6 lg:px-10">
      <Link href="/" className="flex items-center gap-3" data-testid="link-brand"><Logo /><span className="serif text-xl font-extrabold">ClientGuard</span></Link>
      <div className="flex items-center gap-5"><Link href="/sign-in" className="text-sm font-semibold hover:text-[#a77937]" data-testid="link-sign-in">Sign in</Link><Link href="/sign-up" className="rounded-md bg-[#284651] px-5 py-3 text-sm font-semibold text-[#fbf8ee] transition hover:bg-[#1e3942]" data-testid="link-get-started">Get started <ArrowRight className="ml-2 inline h-4 w-4" /></Link></div>
    </header>
    <section className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 pb-20 pt-12 md:grid-cols-[1.1fr_.9fr] md:pb-32 md:pt-20 lg:px-10">
      <div className="page-in"><div className="mb-7 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.18em] text-[#8b7049]"><span className="h-px w-8 bg-[#b89663]" />THE WORKSPACE FOR TRUST</div>
        <h1 className="serif max-w-[680px] text-[clamp(3.3rem,7.2vw,6.4rem)] font-semibold leading-[.99]">Good work begins with <span className="text-[#987747]">good custody.</span></h1>
        <p className="mt-8 max-w-lg text-lg leading-8 text-[#607175]">ClientGuard gives law firms and financial teams one composed place to manage relationships, matters, and access—with the details always in view.</p>
        <div className="mt-9 flex flex-wrap gap-3"><Link href="/sign-up" className="rounded-md bg-[#284651] px-6 py-4 text-sm font-bold text-[#fbf8ee] shadow-lg shadow-[#203c4520] transition hover:-translate-y-0.5" data-testid="link-create-workspace">Create your workspace <ArrowRight className="ml-5 inline h-4 w-4" /></Link><Link href="/sign-in" className="rounded-md border border-[#d5d0c3] bg-[#fbf9f2] px-6 py-4 text-sm font-semibold" data-testid="link-existing-account">Already a member</Link></div>
        <div className="mt-12 flex items-center gap-4 text-xs text-[#6d7a7a]"><ShieldCheck className="h-5 w-5 text-[#54836e]" /><span>Firm-scoped by default</span><span className="h-1 w-1 rounded-full bg-[#b9ad96]" /><span>Clear access assurance</span></div>
      </div>
      <div className="relative page-in [animation-delay:100ms]">
        <div className="absolute -right-5 -top-8 h-40 w-40 rounded-full border border-[#d7c9aa]/70" /><div className="absolute -bottom-8 -left-7 h-32 w-32 rounded-full border border-[#b7c8c2]/70" />
        <div className="relative overflow-hidden rounded-[3px] border border-[#d8d3c6] bg-[#fbfaf5] p-6 shadow-[0_28px_70px_rgba(37,54,54,.14)]">
          <div className="flex items-center justify-between border-b border-[#e5e0d4] pb-5"><div><div className="mono text-[10px] uppercase tracking-[.16em] text-[#92968c]">Firm overview</div><div className="serif mt-1 text-xl font-bold">Northline Advisory</div></div><span className="rounded-full bg-[#e8efe9] px-3 py-1 text-[10px] font-bold text-[#43735e]">ACCESS VERIFIED</span></div>
          <div className="grid grid-cols-3 gap-2 py-6">{[['Clients','128'],['Open matters','36'],['Needs attention','04']].map(([label,value])=><div key={label} className="border-l border-[#c9b58f] pl-3"><div className="mono text-[9px] uppercase tracking-wide text-[#92968c]">{label}</div><div className="serif mt-2 text-3xl font-bold">{value}</div></div>)}</div>
          <div className="rounded-sm bg-[#f3f0e8] p-4"><div className="mb-3 flex items-center justify-between text-xs font-semibold"><span>Recent client activity</span><span className="mono text-[9px] text-[#92968c]">TODAY</span></div>{[['ML','Matter status updated','10:42 AM'],['SK','Client record created','09:18 AM'],['AR','Access review completed','08:53 AM']].map(([initials,label,time])=><div key={label} className="flex items-center gap-3 border-t border-[#e1dccf] py-3 first:border-0"><div className="grid h-7 w-7 place-items-center rounded-full bg-[#dfe7e1] text-[9px] font-bold text-[#31594c]">{initials}</div><div className="flex-1 text-[11px] font-medium">{label}</div><span className="mono text-[9px] text-[#898f8a]">{time}</span></div>)}</div>
          <div className="mt-4 flex items-center gap-2 text-[10px] text-[#657374]"><LockKeyhole className="h-3.5 w-3.5 text-[#4f806a]" /> Private workspace · Firm access only</div>
        </div>
      </div>
    </section>
    <section className="border-y border-[#ded9cd] bg-[#eeece3]"><div className="mx-auto grid max-w-[1240px] gap-9 px-6 py-12 md:grid-cols-3 lg:px-10">
      <Feature index="01" title="A clear chain of custody" body="Know what changed, when it changed, and who made the change. Your audit trail is part of the everyday workflow." />
      <Feature index="02" title="Matters stay in focus" body="See active work, responsible owners, due dates, and risk signals without hunting across disconnected records." />
      <Feature index="03" title="Access is intentional" body="Sign in with Google or email and password. Firm roles keep each workspace's records and actions scoped to its members." />
    </div></section>
    <section className="mx-auto flex max-w-[1240px] flex-col items-start justify-between gap-8 px-6 py-16 md:flex-row md:items-center md:py-24 lg:px-10"><div><div className="mono text-[10px] uppercase tracking-[.18em] text-[#92754a]">A composed way to work</div><h2 className="serif mt-3 max-w-2xl text-4xl font-semibold leading-tight md:text-5xl">More confidence in every client relationship.</h2></div><Link href="/sign-up" className="shrink-0 rounded-md bg-[#284651] px-6 py-4 text-sm font-bold text-[#fbf8ee]" data-testid="link-start-now">Set up your firm <ArrowRight className="ml-4 inline h-4 w-4" /></Link></section>
    <footer className="border-t border-[#ded9cd] px-6 py-6 text-center text-xs text-[#77817d]">ClientGuard <span className="mx-2">·</span> A protected workspace for professional services</footer>
  </main>;
}
function Feature({ index, title, body }: { index: string; title: string; body: string }) { return <article className="border-t-2 border-[#b99a65] pt-5"><div className="mono text-[10px] text-[#987747]">{index} / PRINCIPLE</div><h3 className="serif mt-4 text-xl font-bold">{title}</h3><p className="mt-3 max-w-sm text-sm leading-6 text-[#687779]">{body}</p></article>; }

function Protected({ children }: { children: ReactNode }) {
  return <><Show when="signed-in"><WorkspaceGate>{children}</WorkspaceGate></Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}
function WorkspaceGate({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const { data: ctx, isLoading, isError, refetch } = useGetWorkspace();
  if (isLoading) return <Shell><Skeleton title="Preparing your workspace" /></Shell>;
  if (isError || !ctx) return <Shell><ErrorState title="Workspace unavailable" retry={() => refetch()} /></Shell>;
  if (path === '/settings/security') return <Shell context={ctx}>{children}</Shell>;
  if (!ctx.workspace && path !== '/workspace/setup') return <Redirect to="/workspace/setup" />;
  if (path === '/team' && !['owner', 'admin'].includes(ctx.role || '')) return <Redirect to="/dashboard" />;
  if (path === '/workspace/setup') return <Shell context={ctx}>{children}</Shell>;
  return <Shell context={ctx}>{children}</Shell>;
}
function Shell({ children, context }: { children: ReactNode; context?: any }) {
  const [path] = useLocation();
  const { signOut } = useClerk();
  const service = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 60_000 } });
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = [{ href: '/dashboard', label: 'Overview', icon: BriefcaseBusiness }, { href: '/clients', label: 'Clients', icon: Users }, { href: '/matters', label: 'Matters', icon: FileText }, { href: '/intake', label: 'Intake', icon: ClipboardListIcon }, { href: '/portal', label: 'Client portal', icon: LockKeyhole }, { href: '/workflows', label: 'Workflows', icon: RefreshCw }, { href: '/governance', label: 'Governance', icon: ShieldCheck }, { href: '/practice-operations', label: 'Practice operations', icon: Landmark }, ...(['owner','admin'].includes(context?.role) ? [{ href: '/reports/operations', label: 'Operations report', icon: ActivityIcon }] : []), { href: '/activity', label: 'Activity', icon: ActivityIcon }, { href: '/settings/integrations', label: 'Integrations', icon: Settings2 }, ...(['owner','admin'].includes(context?.role) ? [{ href: '/team', label: 'Team', icon: Users }] : [])];
  const heading = path.split('/')[1] || 'dashboard';
  return <div className="min-h-[100dvh] bg-[#f6f3eb] text-[#23353b] md:flex">
    <aside className="hidden w-[250px] shrink-0 flex-col bg-[#253f49] text-[#eff0e9] md:flex">
      <Link href="/dashboard" className="flex items-center gap-3 px-6 py-6" data-testid="link-sidebar-brand"><Logo small /><span className="serif text-lg font-extrabold">ClientGuard</span></Link>
      <div className="mx-4 mb-5 rounded-md border border-[#ffffff1a] bg-[#ffffff0b] px-3 py-3"><div className="mono text-[9px] uppercase tracking-[.16em] text-[#aab7b5]">Workspace</div><div className="mt-1 truncate text-sm font-semibold">{context?.workspace?.name || 'Firm setup'}</div><div className="mt-1 text-[10px] capitalize text-[#abbab7]">{context?.workspace?.practiceType || 'Not configured'} · {context?.role || 'member'}</div></div>
      <nav className="flex-1 px-3">{nav.map(({ href,label,icon:Icon })=><Link key={href} href={href} className={`mb-1 flex items-center gap-3 rounded-md px-3 py-3 text-[13px] font-medium transition ${path===href?'bg-[#f0e5cc] text-[#253f49]':'text-[#c7d1ce] hover:bg-[#ffffff12] hover:text-white'}`} data-testid={`nav-${label.toLowerCase()}`}><Icon className="h-4 w-4" />{label}{path===href&&<span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#a67e44]" />}</Link>)}</nav>
      <div className="border-t border-[#ffffff1a] p-3"><Link href="/settings/security" className={`flex items-center gap-3 rounded-md px-3 py-3 text-[13px] ${path==='/settings/security'?'bg-[#f0e5cc] text-[#253f49]':'text-[#c7d1ce] hover:bg-[#ffffff12]'}`} data-testid="nav-security"><ShieldCheck className="h-4 w-4" />Account & sign-in</Link><button onClick={()=>signOut({redirectUrl:basePath||'/'})} className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-[13px] text-[#c7d1ce] hover:bg-[#ffffff12]" data-testid="button-sign-out"><LogOut className="h-4 w-4" />Sign out</button></div>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[#dfdbd0] bg-[#f8f6ef]/95 px-5 backdrop-blur md:px-9">
        <div className="flex items-center gap-3"><button className="md:hidden" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Toggle navigation" data-testid="button-mobile-menu"><Menu className="h-5 w-5" /></button><div className="text-[11px] font-semibold uppercase tracking-[.13em] text-[#87908c]">Workspace <span className="mx-2 text-[#c1b8a4]">/</span><span className="text-[#344b50]">{heading.replace('-', ' ')}</span></div></div>
        <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full bg-[#e9eee8] px-2.5 py-1 text-[9px] font-bold text-[#557661] sm:flex" data-testid="status-service-health"><span className={`h-1.5 w-1.5 rounded-full ${service.isError?'bg-[#b9564b]':'bg-[#588268]'}`} />{service.isError?'SERVICE CHECK':'SECURE WORKSPACE'}</div><div className="hidden text-right sm:block"><div className="text-xs font-semibold">{context?.name || 'Your account'}</div><div className="text-[10px] text-[#828b87]">{context?.email || 'Verified workspace member'}</div></div><div className="grid h-8 w-8 place-items-center rounded-full bg-[#dfe7e1] text-[11px] font-bold text-[#385e51]">{(context?.name||'CG').split(' ').map((x:string)=>x[0]).slice(0,2).join('')}</div><button onClick={()=>setMenuOpen(!menuOpen)} className="md:hidden" data-testid="button-mobile-menu-toggle"><ChevronDown className="h-4 w-4" /></button></div>
      </header>
      {menuOpen&&<div className="absolute z-30 w-full border-b border-[#ddd8cc] bg-[#f8f6ef] p-3 shadow-lg md:hidden">{nav.map(n=><Link key={n.href} href={n.href} onClick={()=>setMenuOpen(false)} className="block rounded px-3 py-3 text-sm" data-testid={`mobile-${n.label.toLowerCase()}`}>{n.label}</Link>)}<Link href="/settings/security" onClick={()=>setMenuOpen(false)} className="block rounded px-3 py-3 text-sm" data-testid="mobile-security">Account & sign-in</Link><button className="px-3 py-3 text-sm" onClick={()=>signOut({redirectUrl:basePath||'/'})} data-testid="mobile-signout">Sign out</button></div>}
      <main className="page-in mx-auto max-w-[1440px] px-5 py-8 md:px-9 md:py-10">{children}</main>
    </div>
  </div>;
}
function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: ReactNode; action?: ReactNode }) { return <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div>{eyebrow&&<div className="mono mb-2 text-[10px] uppercase tracking-[.17em] text-[#987747]">{eyebrow}</div>}<h1 className="serif text-3xl font-bold md:text-[38px]" data-testid="text-page-title">{title}</h1>{subtitle&&<p className="mt-2 text-sm text-[#72807f]">{subtitle}</p>}</div>{action}</div>; }
function Button({ children, onClick, variant='primary', disabled=false, testId='button-action', type='button' }: { children: ReactNode; onClick?:()=>void; variant?:'primary'|'outline'|'quiet'|'danger'; disabled?: boolean; testId?:string; type?:'button'|'submit' }) {
 const style={primary:'bg-[#294651] text-[#f9f6ed] hover:bg-[#1c3943]',outline:'border border-[#d9d4c8] bg-[#fbfaf5] text-[#334a50] hover:bg-[#f0ece2]',quiet:'text-[#526568] hover:bg-[#eeece4]',danger:'bg-[#a7443e] text-white hover:bg-[#893b36]'}[variant];
 return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${style}`} data-testid={testId}>{children}</button>;
}
function Skeleton({ title='Loading records' }: { title?:string }) { return <div aria-label={title} data-testid="loading-skeleton"><div className="h-8 w-56 animate-pulse rounded bg-[#e6e2d7]" /><div className="mt-7 grid gap-4 md:grid-cols-3"><div className="h-28 animate-pulse rounded-md bg-[#eae7de]" /><div className="h-28 animate-pulse rounded-md bg-[#eae7de]" /><div className="h-28 animate-pulse rounded-md bg-[#eae7de]" /></div><div className="mt-5 h-56 animate-pulse rounded-md bg-[#eae7de]" /></div>; }
function ErrorState({ title, retry }: { title:string; retry:()=>void }) { return <div className="rounded-md border border-[#e6c7c1] bg-[#fff9f6] p-8" data-testid="status-error"><div className="flex items-center gap-2 font-semibold text-[#843f38]"><AlertTriangle className="h-4 w-4" />{title}</div><p className="mt-2 text-sm text-[#7d7470]">We could not load this information. Your firm data has not been changed.</p><Button onClick={retry} variant="outline" testId="button-retry"><RefreshCw className="h-4 w-4" />Try again</Button></div>; }
function EmptyState({ title, detail, action }: { title:string; detail:string; action?:ReactNode }) { return <div className="grid min-h-64 place-items-center rounded-md border border-dashed border-[#d6d1c5] bg-[#fbfaf5] p-8 text-center" data-testid="status-empty"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e8eee8] text-[#4d7463]"><FileText className="h-5 w-5" /></div><h3 className="serif mt-4 text-xl font-bold">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#71807e]">{detail}</p>{action&&<div className="mt-5">{action}</div>}</div></div>; }
export function Dashboard() {
 const summary = useGetDashboard(); const activity = useListActivity({limit:6}); const [,setLocation]=useLocation();
 if(summary.isLoading||activity.isLoading) return <Skeleton title="Loading firm overview" />;
 if(summary.isError) return <ErrorState title="Overview unavailable" retry={()=>summary.refetch()} />;
 const data=summary.data!;
 const isEmpty=data.clientCount===0&&data.matterCount===0;
  const needsFirstMatter=data.clientCount>0&&data.matterCount===0;
  return <><PageHeader eyebrow="Your firm at a glance" title="Good morning." subtitle="Here is what needs your attention across the workspace." action={<div className="flex flex-wrap items-center gap-2"><Button onClick={()=>setLocation('/clients?create=1')} testId="button-dashboard-create-client"><Plus className="h-4 w-4" />Create client</Button><Button variant="outline" onClick={()=>setLocation('/intake?create=1')} testId="button-dashboard-create-matter"><Plus className="h-4 w-4" />Start intake</Button><Link href="/activity" className="px-2 py-2 text-sm font-semibold text-[#405c60]" data-testid="link-full-activity">View audit trail <ArrowRight className="ml-1 inline h-4 w-4" /></Link></div>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Clients',data.clientCount,'Total relationships',Users,'/clients'],['Active clients',data.activeClientCount,'Currently engaged',Fingerprint,'/clients?status=active'],['Open matters',data.openMatterCount,'In progress',BriefcaseBusiness,'/matters?status=open'],['Overdue matters',data.overdueMatterCount,'Review required',Clock3,'/matters?due=overdue']].map(([name,value,caption,Icon,href]:any,i)=><Link href={href} key={name} aria-label={`${name}: ${value}. View records.`} className={`group rounded-md border border-[#e0dace] bg-[#fbfaf5] p-5 transition hover:border-[#b99a65] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#294651] ${i===3?'border-t-2 border-t-[#c46d5f]':''}`} data-testid={`metric-${String(name).toLowerCase().replace(' ','-')}`}><div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[.12em] text-[#75817e]"><span>{name}</span><Icon className="h-4 w-4 text-[#9a825a]" /></div><div className="serif mt-4 text-4xl font-semibold">{value}</div><div className="mt-2 text-xs text-[#85908c]">{caption}</div><div className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-[#405c60] opacity-80 group-hover:opacity-100">View records <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></div></Link>)}</div>
      {needsFirstMatter&&<section className="mt-7 rounded-md border border-[#e0dace] bg-[#fbfaf5] p-6 md:p-8" data-testid="dashboard-first-matter-onboarding"><div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center"><div><div className="mono text-[10px] uppercase tracking-[.16em] text-[#987747]">Next step</div><h2 className="serif mt-2 text-2xl font-bold">Begin the next matter with review.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#71807e]">Start a documented intake, review potential conflicts, and open the matter only after professional clearance.</p></div><Link href="/intake?create=1" className="inline-flex items-center justify-center gap-2 rounded-md bg-[#294651] px-4 py-3 text-[13px] font-semibold text-[#f9f6ed] transition hover:bg-[#1c3943]" data-testid="link-create-first-matter">Start client intake <ArrowRight className="h-4 w-4" /></Link></div></section>}
      {isEmpty?<section className="mt-7 rounded-md border border-[#e0dace] bg-[#fbfaf5] p-6 md:p-8" data-testid="dashboard-empty-onboarding"><div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center"><div><div className="mono text-[10px] uppercase tracking-[.16em] text-[#987747]">Getting started</div><h2 className="serif mt-2 text-2xl font-bold">Start with your first client.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#71807e]">Add a client relationship to your firm. Once it’s in place, you can create and track matters for that client.</p></div><Link href="/clients?create=1" className="inline-flex items-center justify-center gap-2 rounded-md bg-[#294651] px-4 py-3 text-[13px] font-semibold text-[#f9f6ed] transition hover:bg-[#1c3943]" data-testid="link-create-first-client">Add your first client <ArrowRight className="h-4 w-4" /></Link></div></section>:<div className="mt-7 grid gap-5 xl:grid-cols-[1.45fr_.8fr]"><section className="rounded-md border border-[#e0dace] bg-[#fbfaf5]"><div className="flex items-center justify-between border-b border-[#e9e4d9] px-5 py-4"><div><h2 className="serif text-lg font-bold">Recent activity</h2><p className="mt-1 text-xs text-[#87918d]">A living record of firm changes</p></div><Link href="/activity" className="inline-flex items-center gap-1 text-xs font-semibold text-[#405c60] hover:text-[#987747]" data-testid="link-dashboard-activity">View all <ArrowRight className="h-3.5 w-3.5" /></Link></div>{activity.isError?<div className="p-5 text-sm text-[#9a554d]" role="alert" data-testid="status-dashboard-activity-error">Activity could not be loaded. <button type="button" onClick={()=>activity.refetch()} aria-label="Retry activity" data-testid="button-retry-activity" className="underline">Retry</button></div>:<ActivityList items={(activity.data||[]).slice(0,6)} />}</section>
    <section className="rounded-md bg-[#294651] p-6 text-[#f3f1e9]"><div className="mono text-[9px] uppercase tracking-[.18em] text-[#c5b389]">Quick access</div><h2 className="serif mt-3 text-2xl font-semibold">Keep work moving.</h2><p className="mt-2 text-sm leading-6 text-[#c6d0cc]">Jump into the records that shape your day.</p><div className="mt-6 space-y-2"><QuickLink href="/clients" label="Browse client relationships" /><QuickLink href="/matters" label="Review active matters" /><QuickLink href="/settings/security" label="Account security" /></div></section>
    </div>}
 </>;
}
function QuickLink({href,label}:{href:string;label:string}) {return <Link href={href} className="flex items-center justify-between border-b border-[#ffffff22] py-3 text-[13px] font-medium text-[#e5e9e2] hover:text-[#e6c992]" data-testid={`quick-${href.slice(1).replace('/','-')}`}>{label}<ArrowRight className="h-4 w-4" /></Link>}
function ActivityList({items}:{items:any[]}) {
 if(!items.length)return <div className="p-6"><EmptyState title="No activity yet" detail="When your firm updates a client or matter, the events will appear here." /></div>;
 return <div className="divide-y divide-[#eee9df]">{items.map((e:any)=>{
  const href=e.entityType==='client'?`/clients/${e.entityId}`:e.entityType==='matter'?`/matters/${e.entityId}`:undefined;
  const content=<><div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e8eee8] text-[#4d7463]"><ActivityIcon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="text-sm"><span className="font-semibold">{e.actor}</span> {e.action} <span className="font-semibold">{e.entityLabel}</span></div><div className="mt-1 text-[11px] text-[#87918d]">{e.entityType} <span className="mx-1">·</span>{timeAgo(e.occurredAt)}</div></div><div className="mono shrink-0 pt-1 text-[9px] text-[#89918b]">{formatTime(e.occurredAt)}</div>{href&&<ArrowRight className="mt-2 h-3.5 w-3.5 shrink-0 text-[#9a825a] opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />}</>;
  const className="group flex gap-3 px-5 py-4 transition hover:bg-[#f5f2e9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#294651]";
  return href?<Link key={e.id} href={href} className={className} aria-label={`Open ${e.entityType}: ${e.entityLabel}`} data-testid={`activity-item-${e.id}`}>{content}</Link>:<div key={e.id} className={className} data-testid={`activity-item-${e.id}`}>{content}</div>;
 })}</div>;
}
function timeAgo(date:string){if(!date)return 'Recently';const mins=Math.floor((Date.now()-new Date(date).getTime())/60000);if(mins<60)return `${Math.max(mins,1)} min ago`;if(mins<1440)return `${Math.floor(mins/60)} hr ago`;return `${Math.floor(mins/1440)} days ago`;}
function formatTime(date:string){return date?new Date(date).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'—';}
function StatusPill({value}:{value:string}) { const label=value.replace('_',' ');const style=value==='active'||value==='open'?'bg-[#e5eee7] text-[#47725b]':value==='prospect'||value==='on_hold'?'bg-[#f3eddd] text-[#8d713e]':value==='high'?'bg-[#f7e6e1] text-[#9d5045]':'bg-[#ecebe5] text-[#687371]';return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${style}`} data-testid={`status-${value}`}>{label}</span>}

export function ClientsPage() {
 const [search,setSearch]=useState(''); const [status,setStatus]=useState(()=>{const initial=new URLSearchParams(window.location.search).get('status')||'';return ['active','prospect','archived'].includes(initial)?initial:'';}); const [modal,setModal]=useState(()=>new URLSearchParams(window.location.search).get('create')==='1');
 const [,setLocation]=useLocation();
 const result=useListClients({search:search||undefined,status:(status||undefined) as any});
 const qc=useQueryClient();const create=useCreateClient();
 function closeModal(){setModal(false);if(new URLSearchParams(window.location.search).has('create'))setLocation('/clients',{replace:true});}
  function updateStatusFilter(value:string){setStatus(value);const params=new URLSearchParams(window.location.search);if(value)params.set('status',value);else params.delete('status');const query=params.toString();setLocation(`/clients${query?`?${query}`:''}`,{replace:true});}
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const input:ClientInput={name:String(f.get('name')),clientType:String(f.get('clientType')) as any,email:String(f.get('email'))||null,phone:String(f.get('phone'))||null,industry:String(f.get('industry'))||null,status:String(f.get('status')) as any};create.mutate({data:input},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListClientsQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardQueryKey()});qc.invalidateQueries({queryKey:getListActivityQueryKey()});closeModal()}});}
 return <><PageHeader eyebrow="Relationships" title="Clients" subtitle="A clear view of every relationship in your firm." action={<Button onClick={()=>setModal(true)} testId="button-new-client"><Plus className="h-4 w-4" />Add client</Button>} />
    <div className="mb-5 flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-[#89918d]" /><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search client name, email, industry…" className="h-10 w-full rounded-md border border-[#d9d4c8] bg-[#fbfaf5] pl-10 pr-3 text-sm outline-none focus:border-[#a88b5e]" data-testid="input-search-clients" /></label><select value={status} onChange={e=>updateStatusFilter(e.target.value)} aria-label="Filter clients by status" className="h-10 rounded-md border border-[#d9d4c8] bg-[#fbfaf5] px-3 text-sm capitalize" data-testid="select-client-status"><option value="">All statuses</option><option value="active">Active</option><option value="prospect">Prospect</option><option value="archived">Archived</option></select></div>
   {result.isLoading?<Skeleton title="Loading clients" />:result.isError?<ErrorState title="Client list unavailable" retry={()=>result.refetch()} />:!result.data?.length?<EmptyState title={search||status?'No matching clients':'Your client list starts here'} detail={search||status?'Try adjusting the search or status filter.':'Create your first client record to give your firm a clear home for each relationship.'} action={<Button onClick={()=>setModal(true)} testId="button-empty-add-client"><Plus className="h-4 w-4" />Add a client</Button>} />:
   <div className="overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5]"><div className="hidden grid-cols-[minmax(200px,1.5fr)_1fr_120px_95px_125px] gap-4 border-b border-[#e8e3d8] bg-[#f1eee6] px-5 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[#798480] md:grid"><span>Client</span><span>Contact</span><span>Status</span><span>Matters</span><span>Last activity</span></div>{result.data.map(c=><Link href={`/clients/${c.id}`} key={c.id} className="grid gap-3 border-b border-[#eee9df] px-5 py-4 transition hover:bg-[#f5f2e9] last:border-0 md:grid-cols-[minmax(200px,1.5fr)_1fr_120px_95px_125px] md:items-center md:gap-4" data-testid={`row-client-${c.id}`}><div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e7ece6] text-xs font-bold text-[#446b59]">{c.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</div><div className="min-w-0"><div className="truncate text-sm font-semibold">{c.name}</div><div className="mt-1 text-[11px] capitalize text-[#87918d]">{c.clientType}{c.industry?` · ${c.industry}`:''}</div></div></div><div className="min-w-0 text-xs text-[#687779]">{c.email||'No email on file'}<div className="mt-1">{c.phone||''}</div></div><div><StatusPill value={c.status} /></div><div className="text-xs"><span className="mono font-medium">{c.matterCount}</span><span className="ml-1 text-[#84908b]">matters</span></div><div className="text-xs text-[#788581]">{c.lastActivityAt?formatTime(c.lastActivityAt):'No activity'}</div></Link>)}</div>}
    {modal&&<Modal title="Add a client" close={closeModal}><form onSubmit={submit} className="space-y-4"><Field label="Client name"><input name="name" required maxLength={160} className="field" placeholder="Name or organization" data-testid="input-client-name" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Client type"><select name="clientType" className="field"><option value="individual">Individual</option><option value="business">Business</option></select></Field><Field label="Status"><select name="status" className="field"><option value="active">Active</option><option value="prospect">Prospect</option></select></Field></div><Field label="Email"><input name="email" type="email" className="field" data-testid="input-client-email" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Phone"><input name="phone" className="field" data-testid="input-client-phone" /></Field><Field label="Industry"><input name="industry" className="field" data-testid="input-client-industry" /></Field></div>{create.isError&&<p className="text-sm text-[#9b4941]" data-testid="status-create-error">Could not create this client. Please try again.</p>}<div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={closeModal} testId="button-cancel-client">Cancel</Button><Button type="submit" disabled={create.isPending} testId="button-save-client">{create.isPending?'Saving…':'Create client'}</Button></div></form></Modal>}
 </>;
}
function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}) {return <div className="fixed inset-0 z-50 grid place-items-center bg-[#17282db3] p-4" role="dialog" aria-modal="true" aria-label={title} data-testid="dialog-form"><div className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-md border border-[#ddd7ca] bg-[#fbfaf5] p-6 shadow-2xl"><div className="mb-6 flex items-center justify-between"><h2 className="serif text-2xl font-bold">{title}</h2><button onClick={close} className="rounded p-1 text-[#71807e] hover:bg-[#efede5]" aria-label="Close" data-testid="button-close-dialog"><X className="h-5 w-5" /></button></div>{children}</div></div>}
function Field({label,children}:{label:string;children:ReactNode}) {return <label className="block text-xs font-semibold text-[#506064]">{label}<div className="mt-1.5">{children}</div></label>}
export function ClientDetail() {
 const params=useRoute('/clients/:id')[1];const id=Number(params?.id);const result=useGetClient(id,{query:{queryKey:getGetClientQueryKey(id)}});
 const update=useUpdateClient();const remove=useDeleteClient();const qc=useQueryClient();const [,setLocation]=useLocation();const [editing,setEditing]=useState(false);const assignmentMembers=useListWorkspaceAssignmentMembers();
 if(result.isLoading)return <Skeleton title="Loading client record" />;if(result.isError||!result.data)return <ErrorState title="Client record unavailable" retry={()=>result.refetch()} />;
 const c=result.data;
 const portalInvitation=<PortalInvitation clientId={c.id} clientName={c.name} email={c.email} />;
 function save(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);update.mutate({id,data:{name:String(f.get('name')),clientType:String(f.get('clientType')) as any,email:String(f.get('email'))||null,phone:String(f.get('phone'))||null,industry:String(f.get('industry'))||null,status:String(f.get('status')) as any,ownerMemberId:Number(f.get('ownerMemberId'))}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetClientQueryKey(id)});qc.invalidateQueries({queryKey:getListClientsQueryKey()});qc.invalidateQueries({queryKey:getListActivityQueryKey()});qc.invalidateQueries({queryKey:getListWorkspaceAssignmentIssuesQueryKey()});setEditing(false)}});}
 function archive(){if(window.confirm(`Archive ${c.name}?`))remove.mutate({id},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListClientsQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardQueryKey()});qc.invalidateQueries({queryKey:getListActivityQueryKey()});setLocation('/clients')}});}
  return <><Link href="/clients" className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-[#6f7e7b]" data-testid="link-back-clients"><ArrowLeft className="h-4 w-4" />All clients</Link><PageHeader eyebrow={`Client record · ${c.clientType}`} title={c.name} subtitle={`Added ${formatTime(c.createdAt)} · Relationship owner ${c.owner}`} action={<div className="flex flex-wrap gap-2"><Link href={`/intake?create=1&clientId=${c.id}`} className="inline-flex items-center justify-center gap-2 rounded-md bg-[#294651] px-4 py-2 text-xs font-semibold text-[#fbf8ee] transition hover:bg-[#1c3943]" data-testid="link-client-start-matter"><Plus className="h-3.5 w-3.5" />Start matter intake</Link><Button variant="outline" onClick={()=>setEditing(!editing)} testId="button-edit-client">Edit record</Button><Button variant="danger" onClick={archive} disabled={remove.isPending} testId="button-archive-client">Archive client</Button></div>} /><div className="mb-5">{portalInvitation}</div>
 <div className="grid gap-5 lg:grid-cols-[1fr_320px]"><div className="rounded-md border border-[#e0dace] bg-[#fbfaf5] p-6"><div className="flex items-start justify-between border-b border-[#eae5da] pb-5"><div><div className="mono text-[10px] uppercase tracking-[.15em] text-[#8e9690]">Relationship status</div><div className="mt-3"><StatusPill value={c.status} /></div></div><div className="grid h-12 w-12 place-items-center rounded-full bg-[#e7ece6] text-sm font-bold text-[#446b59]">{c.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</div></div>
 {editing?<form onSubmit={save} className="mt-5 space-y-4"><Field label="Name"><input name="name" defaultValue={c.name} required className="field" data-testid="input-edit-client-name" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Type"><select name="clientType" defaultValue={c.clientType} className="field"><option value="individual">Individual</option><option value="business">Business</option></select></Field><Field label="Status"><select name="status" defaultValue={c.status} className="field"><option value="prospect">Prospect</option><option value="active">Active</option><option value="archived">Archived</option></select></Field></div><Field label="Relationship owner"><select name="ownerMemberId" defaultValue={c.ownerMemberId ?? ''} required className="field" data-testid="select-client-owner">{(assignmentMembers.data ?? []).map(member=><option key={member.id} value={member.id}>{member.name || member.email} · {member.role}</option>)}</select></Field><Field label="Email"><input name="email" defaultValue={c.email||''} className="field" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Phone"><input name="phone" defaultValue={c.phone||''} className="field" /></Field><Field label="Industry"><input name="industry" defaultValue={c.industry||''} className="field" /></Field></div><div className="flex gap-2"><Button type="submit" disabled={update.isPending || assignmentMembers.isLoading} testId="button-save-client-edit">{update.isPending?'Saving…':'Save changes'}</Button><Button variant="outline" onClick={()=>setEditing(false)} testId="button-cancel-client-edit">Cancel</Button></div>{update.isError&&<p className="text-xs text-red-700">Update failed. Please retry.</p>}</form>:<div className="grid gap-x-8 gap-y-6 pt-6 sm:grid-cols-2">{[['Email',c.email||'Not provided'],['Phone',c.phone||'Not provided'],['Industry',c.industry||'Not specified'],['Client type',c.clientType]].map(([label,value])=><div key={label}><div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#89918c]">{label}</div><div className="mt-2 text-sm font-medium capitalize" data-testid={`client-detail-${label.toLowerCase().replace(' ','-')}`}>{value}</div></div>)}</div>}</div>
  <aside className="space-y-4"><div className="rounded-md border border-[#e0dace] bg-[#fbfaf5] p-5"><div className="mono text-[10px] uppercase tracking-[.14em] text-[#8a928d]">Relationship at a glance</div><Link href={`/matters?clientId=${c.id}`} className="mt-5 flex items-center justify-between border-b border-[#ede8dd] pb-4 text-[#405c60] hover:text-[#987747]" data-testid="link-client-matters"><span className="text-xs text-[#7a8783]">Matters</span><span className="inline-flex items-center gap-1 mono text-sm font-medium">{c.matterCount}<ArrowRight className="h-3 w-3" /></span></Link><div className="mt-4 flex justify-between"><span className="text-xs text-[#7a8783]">Last activity</span><span className="text-xs font-semibold">{c.lastActivityAt?formatTime(c.lastActivityAt):'—'}</span></div></div><div className="rounded-md bg-[#e8eee8] p-5"><ShieldCheck className="h-5 w-5 text-[#4b7662]" /><h3 className="serif mt-3 font-bold">Firm-scoped record</h3><p className="mt-1 text-xs leading-5 text-[#657772]">This client information is accessible only within your authorized workspace.</p></div></aside></div></>;
}

export function MattersPage() {
  const qc=useQueryClient();
 const [search,setSearch]=useState('');
 const [status,setStatus]=useState(()=>{const initial=new URLSearchParams(window.location.search).get('status')||'';return ['open','on_hold','closed'].includes(initial)?initial:'';});
 const [dueFilter,setDueFilter]=useState<'overdue'|''>(()=>new URLSearchParams(window.location.search).get('due')==='overdue'?'overdue':'');
 const [clientId,setClientId]=useState<number|null>(()=>{const raw=new URLSearchParams(window.location.search).get('clientId');const parsed=Number(raw);return raw&&Number.isSafeInteger(parsed)&&parsed>0?parsed:null;});
 const [selectedIds,setSelectedIds]=useState<Set<number>>(()=>new Set());
 const [pendingAllMattersExport,setPendingAllMattersExport]=useState<Matter[]|null>(null);
  const [pendingExportRecord,setPendingExportRecord]=useState<{scope:'selected'|'all';matterIds:number[];exportRequestId:string}|null>(null);
 const [pdfError,setPdfError]=useState('');
 const [isExportingPdf,setIsExportingPdf]=useState(false);
  const [isRetryingExportRecord,setIsRetryingExportRecord]=useState(false);
 const list=useListMatters();
 const logExport=useLogMatterExportRequest();
 const clients=useListClients();
 const [,setLocation]=useLocation();
 useEffect(()=>{if(new URLSearchParams(window.location.search).get('create')==='1')setLocation('/intake?create=1',{replace:true});},[setLocation]);
  function updateQueryFilter(key:string,value:string){const params=new URLSearchParams(window.location.search);if(value)params.set(key,value);else params.delete(key);const query=params.toString();setLocation(`/matters${query?`?${query}`:''}`,{replace:true});}
 const filteredMatters=useMemo(()=>{
  const query=search.trim().toLowerCase();
  return (list.data||[]).filter(m=>
   (!status||m.status===status)&&
    (clientId===null||m.clientId===clientId)&&
    (dueFilter!=='overdue'||(m.status==='open'&&m.dueAt!==null&&new Date(m.dueAt).getTime()<Date.now()))&&
   (!query||m.title.toLowerCase().includes(query)||m.reference.toLowerCase().includes(query)||m.clientName.toLowerCase().includes(query))
  );
  },[list.data,search,status,dueFilter,clientId]);
 const selectedMatters=filteredMatters.filter(m=>selectedIds.has(m.id));
 const allVisibleSelected=filteredMatters.length>0&&filteredMatters.every(m=>selectedIds.has(m.id));
 function toggleVisibleSelection(){
  setSelectedIds(current=>{
   const next=new Set(current);
   if(allVisibleSelected)filteredMatters.forEach(m=>next.delete(m.id));
   else filteredMatters.forEach(m=>next.add(m.id));
   return next;
  });
 }
 async function downloadPdf(records: Matter[], scope:'selected'|'all'){
  if(!records.length)return;
  setPdfError('');
   setPendingExportRecord(null);
  setIsExportingPdf(true);
  try{
   const {downloadMattersPdf}=await import('./lib/matters-pdf');
   downloadMattersPdf(records,scope);
    const exportRequest={scope,matterIds:records.map(record=>record.id),exportRequestId:crypto.randomUUID()};
    try{
       await logExport.mutateAsync({data:exportRequest});
    }catch{
       setPendingExportRecord(exportRequest);
       setPdfError('The PDF was downloaded, but its audit-trail entry could not be recorded. Retry recording it without downloading the PDF again.');
      return;
    }
    void Promise.all([
      qc.invalidateQueries({queryKey:getListActivityQueryKey()}),
      qc.invalidateQueries({queryKey:getGetDashboardQueryKey()}),
    ]);
  }catch{
   setPdfError('The PDF could not be created. Please try again.');
  }finally{
   setIsExportingPdf(false);
  }
 }
  async function retryExportRecord(){
   if(!pendingExportRecord)return;
   setIsRetryingExportRecord(true);
   try{
    await logExport.mutateAsync({data:pendingExportRecord});
    setPendingExportRecord(null);
    setPdfError('');
    void Promise.all([
     qc.invalidateQueries({queryKey:getListActivityQueryKey()}),
     qc.invalidateQueries({queryKey:getGetDashboardQueryKey()}),
    ]);
   }catch{
    setPdfError('The export entry could not be recorded yet. You can retry without downloading the PDF again.');
   }finally{
    setIsRetryingExportRecord(false);
   }
  }
 return <>
  <PageHeader eyebrow="Active work" title="Matters" subtitle="Keep each engagement, owner, and next date in view." action={<Button onClick={()=>setLocation('/intake?create=1')} testId="button-new-matter"><Plus className="h-4 w-4" />Start matter intake</Button>} />
  <div className="mb-5 flex flex-col gap-3 sm:flex-row">
   <label className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-[#89918d]" /><input value={search} onChange={e=>{setSearch(e.target.value);setSelectedIds(new Set());}} placeholder="Search matter, reference, client…" className="h-10 w-full rounded-md border border-[#d9d4c8] bg-[#fbfaf5] pl-10 pr-3 text-sm outline-none focus:border-[#a88b5e]" data-testid="input-search-matters" /></label>
    <select value={status} onChange={e=>{setStatus(e.target.value);updateQueryFilter('status',e.target.value);setSelectedIds(new Set());}} aria-label="Filter matters by status" className="h-10 rounded-md border border-[#d9d4c8] bg-[#fbfaf5] px-3 text-sm capitalize" data-testid="select-matter-status"><option value="">All statuses</option><option value="open">Open</option><option value="on_hold">On hold</option><option value="closed">Closed</option></select>
    <select value={dueFilter} onChange={e=>{const value=e.target.value as ''|'overdue';setDueFilter(value);updateQueryFilter('due',value);setSelectedIds(new Set());}} aria-label="Filter matters by due date" className="h-10 rounded-md border border-[#d9d4c8] bg-[#fbfaf5] px-3 text-sm" data-testid="select-matter-due-filter"><option value="">All due dates</option><option value="overdue">Overdue only</option></select>
  </div>
   {(clientId!==null||dueFilter==='overdue')&&<div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#e0dace] bg-[#f5f2e9] px-4 py-3 text-xs text-[#687779]">{clientId!==null&&<span data-testid="text-matter-client-filter">Client: {clients.data?.find(c=>c.id===clientId)?.name||`Client #${clientId}`}</span>}{dueFilter==='overdue'&&<span data-testid="text-matter-overdue-filter">Overdue matters</span>}{clientId!==null&&<button type="button" onClick={()=>{setClientId(null);setSelectedIds(new Set());updateQueryFilter('clientId','');}} className="ml-auto font-semibold text-[#405c60] underline underline-offset-2" data-testid="button-clear-client-filter">Clear client filter</button>}</div>}
  {list.isLoading?<Skeleton title="Loading matters" />:list.isError?<ErrorState title="Matter list unavailable" retry={()=>list.refetch()} />:<>
   {!!list.data?.length&&<div className="mb-4 rounded-md border border-[#e0dace] bg-[#fbfaf5] p-3">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
     <div className="flex flex-wrap items-center gap-4 text-xs text-[#647573]">
      <label className="inline-flex cursor-pointer items-center gap-2 font-semibold"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection} aria-label="Select all visible matters" data-testid="checkbox-select-visible-matters" className="h-4 w-4 accent-[#294651]" />Select visible</label>
      <span data-testid="text-selected-matters">{selectedIds.size} selected</span>
      {selectedIds.size>0&&<button type="button" onClick={()=>setSelectedIds(new Set())} className="font-semibold text-[#405c60] underline underline-offset-2" data-testid="button-clear-matter-selection">Clear selection</button>}
     </div>
     <div className="flex flex-wrap gap-2">
       <Button variant="outline" onClick={()=>downloadPdf(selectedMatters,'selected')} disabled={!selectedMatters.length||isExportingPdf||isRetryingExportRecord} testId="button-download-selected-matters"><Download className="h-4 w-4" />{isExportingPdf?'Preparing PDF…':`Download selected PDF (${selectedMatters.length})`}</Button>
       <Button onClick={()=>setPendingAllMattersExport([...(list.data||[])])} disabled={!list.data?.length||isExportingPdf||isRetryingExportRecord} testId="button-download-all-matters"><Download className="h-4 w-4" />{isExportingPdf?'Preparing PDF…':`Download all matters PDF (${list.data.length})`}</Button>
     </div>
    </div>
     {pdfError&&<div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#9b4941]" data-testid="status-matter-pdf-error"><p>{pdfError}</p>{pendingExportRecord&&<Button variant="outline" onClick={retryExportRecord} disabled={isRetryingExportRecord} testId="button-retry-matter-export-record">{isRetryingExportRecord?'Recording export…':'Retry recording export'}</Button>}</div>}
   </div>}
    {!filteredMatters.length?<EmptyState title={search||status||dueFilter||clientId!==null?'No matching matters':'No matters on file'} detail={search||status||dueFilter||clientId!==null?'Try adjusting the search or filters.':'Start a client intake, complete the conflict review, then open the matter.'} action={<Button onClick={()=>setLocation('/intake?create=1')} testId="button-empty-add-matter"><Plus className="h-4 w-4" />Start intake</Button>} />:
    <div className="overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5]">
     <div className="hidden grid-cols-[28px_minmax(220px,1.5fr)_1fr_110px_105px_115px] gap-4 border-b border-[#e8e3d8] bg-[#f1eee6] px-5 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[#798480] md:grid"><span></span><span>Matter</span><span>Responsible</span><span>Status</span><span>Risk</span><span>Due date</span></div>
     {filteredMatters.map(m=><div key={m.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 gap-y-2 border-b border-[#eee9df] px-5 py-4 transition hover:bg-[#f5f2e9] last:border-0 md:grid-cols-[28px_minmax(220px,1.5fr)_1fr_110px_105px_115px] md:items-center md:gap-4" data-testid={`row-matter-${m.id}`}>
      <div className="flex items-center"><input type="checkbox" checked={selectedIds.has(m.id)} onChange={e=>setSelectedIds(current=>{const next=new Set(current);if(e.target.checked)next.add(m.id);else next.delete(m.id);return next;})} aria-label={`Select ${m.title}`} data-testid={`checkbox-matter-${m.id}`} className="h-4 w-4 accent-[#294651]" /></div>
      <Link href={`/matters/${m.id}`} className="contents" data-testid={`link-matter-${m.id}`}><div className="min-w-0"><div className="truncate text-sm font-semibold">{m.title}</div><div className="mt-1 text-[11px] text-[#7e8985]">{m.clientName}<span className="mx-2">·</span><span className="mono">{m.reference}</span></div></div><div className="col-start-2 text-xs md:col-start-auto">{m.responsible}</div><div className="col-start-2 md:col-start-auto"><StatusPill value={m.status} /></div><div className="col-start-2 md:col-start-auto"><StatusPill value={m.riskLevel} /></div><div className="col-start-2 text-xs text-[#72807d] md:col-start-auto">{m.dueAt?formatTime(m.dueAt):'No due date'}</div></Link>
     </div>)}
    </div>}
   </>}
   <AlertDialog
    open={pendingAllMattersExport!==null}
    onOpenChange={open=>{if(!open)setPendingAllMattersExport(null);}}
   >
    <AlertDialogContent>
     <AlertDialogHeader>
      <AlertDialogTitle>Download every matter?</AlertDialogTitle>
      <AlertDialogDescription>
       This will create a PDF containing {pendingAllMattersExport?.length||0} {pendingAllMattersExport?.length===1?'record':'records'} from across your entire firm, including matters hidden by current filters and selection. The export will be recorded in firm activity.
      </AlertDialogDescription>
     </AlertDialogHeader>
     <AlertDialogFooter>
      <AlertDialogCancel data-testid="button-cancel-all-matters-export">Cancel</AlertDialogCancel>
      <AlertDialogAction
       data-testid="button-confirm-all-matters-export"
       onClick={()=>{
        if(!pendingAllMattersExport)return;
        const records=pendingAllMattersExport;
        setPendingAllMattersExport(null);
        void downloadPdf(records,'all');
       }}
      >Download all matters</AlertDialogAction>
     </AlertDialogFooter>
    </AlertDialogContent>
   </AlertDialog>
  </>;
}
function MatterDetail() {
  const params = useRoute('/matters/:id')[1];
  const id = Number(params?.id);
  const result = useGetMatter(id, { query: { queryKey: getGetMatterQueryKey(id) } });
  const closeout = useGetMatterCloseout(id, { query: { queryKey: getGetMatterCloseoutQueryKey(id) } });
  const update = useUpdateMatter();
  const close = useCloseMatter();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [editing, setEditing] = useState(false);
  const clients = useListClients();
  const assignmentMembers = useListWorkspaceAssignmentMembers();
  if (result.isLoading) return <Skeleton title="Loading matter record" />;
  if (result.isError || !result.data) return <ErrorState title="Matter record unavailable" retry={() => result.refetch()} />;
  const m = result.data;

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const responsibleMemberId = Number(f.get('responsibleMemberId'));
    const member = assignmentMembers.data?.find(candidate => candidate.id === responsibleMemberId);
    if (!member) return;
    update.mutate({
      id,
      data: {
        clientId: Number(f.get('clientId')),
        title: String(f.get('title')),
        matterType: String(f.get('matterType')),
        responsible: member.name || member.email,
        responsibleMemberId,
        riskLevel: String(f.get('riskLevel')) as any,
        status: String(f.get('status')) as any,
        dueAt: String(f.get('dueAt')) || null,
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetMatterQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListMattersQueryKey() });
        qc.invalidateQueries({ queryKey: getListActivityQueryKey() });
        qc.invalidateQueries({ queryKey: getListWorkspaceAssignmentIssuesQueryKey() });
        setEditing(false);
      },
    });
  }
  function closeThis() {
    if (!closeout.data?.canClose) return;
    if (window.confirm(`Close the matter “${m.title}”?`)) close.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMattersQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        qc.invalidateQueries({ queryKey: getListActivityQueryKey() });
        setLocation('/matters');
      },
    });
  }

  return <>
    <Link href="/matters" className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-[#6f7e7b]" data-testid="link-back-matters"><ArrowLeft className="h-4 w-4" />All matters</Link>
     <PageHeader eyebrow={`Matter · ${m.reference}`} title={m.title} subtitle={<><Link href={`/clients/${m.clientId}`} className="inline-flex items-center gap-1 font-semibold text-[#405c60] hover:text-[#987747]" data-testid="link-matter-client">{m.clientName}<ArrowRight className="h-3.5 w-3.5" /></Link> · {m.matterType}</>} action={<div className="flex gap-2"><Button variant="outline" onClick={() => setEditing(!editing)} testId="button-edit-matter">Edit matter</Button>{m.status !== 'closed' && <Button variant="danger" onClick={closeThis} disabled={close.isPending || closeout.isLoading || !closeout.data?.canClose} testId="button-close-matter">{close.isPending ? 'Closing…' : closeout.data?.canClose ? 'Close matter' : 'Complete closeout first'}</Button>}</div>} />
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="rounded-md border border-[#e0dace] bg-[#fbfaf5] p-6">
        {editing ? <form onSubmit={save} className="space-y-4">
          <Field label="Matter title"><input name="title" defaultValue={m.title} required className="field" data-testid="input-edit-matter-title" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client"><select name="clientId" defaultValue={m.clientId} className="field">{(clients.data || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Matter type"><input name="matterType" defaultValue={m.matterType} className="field" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Responsible teammate">
              <select name="responsibleMemberId" defaultValue={m.responsibleMemberId ?? ''} required className="field" data-testid="select-matter-responsible">
                <option value="">Select an active teammate</option>
                {(assignmentMembers.data || []).map(member => <option key={member.id} value={member.id}>{member.name || member.email} · {member.role}</option>)}
              </select>
            </Field>
            <Field label="Due date"><input name="dueAt" type="date" defaultValue={m.dueAt?.slice(0, 10) || ''} className="field" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status"><select name="status" defaultValue={m.status} className="field"><option value="open">Open</option><option value="on_hold">On hold</option><option value="closed">Closed</option></select></Field>
            <Field label="Risk level"><select name="riskLevel" defaultValue={m.riskLevel} className="field"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
          </div>
          <div className="flex gap-2"><Button type="submit" disabled={update.isPending || assignmentMembers.isLoading} testId="button-save-matter-edit">{update.isPending ? 'Saving…' : 'Save changes'}</Button><Button variant="outline" onClick={() => setEditing(false)} testId="button-cancel-matter-edit">Cancel</Button></div>
          {update.isError && <p className="text-xs text-red-700">Update failed. Please retry.</p>}
        </form> : <>
          <div className="flex flex-wrap items-center gap-2 border-b border-[#eae5da] pb-5"><StatusPill value={m.status} /><StatusPill value={m.riskLevel} /></div>
          <div className="grid gap-7 pt-6 sm:grid-cols-2">{[['Client', m.clientName], ['Responsible professional', m.responsible], ['Matter type', m.matterType], ['Due date', m.dueAt ? formatTime(m.dueAt) : 'Not set'], ['Opened', formatTime(m.createdAt)], ['Last updated', formatTime(m.updatedAt)]].map(([label, value]) => <div key={label}><div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#89918c]">{label}</div><div className="mt-2 text-sm font-medium" data-testid={`matter-detail-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</div></div>)}</div>
        </>}
      </section>
      <aside className="rounded-md bg-[#294651] p-6 text-[#f3f1e9]"><div className="mono text-[9px] uppercase tracking-[.16em] text-[#c5b389]">Matter reference</div><div className="mono mt-3 text-xl">{m.reference}</div><div className="my-5 h-px bg-[#ffffff26]" /><div className="flex justify-between text-xs text-[#c8d2ce]"><span>Risk classification</span><span className="capitalize text-[#f0d79f]">{m.riskLevel}</span></div><p className="mt-5 text-xs leading-5 text-[#b9c8c3]">Matter status and ownership are maintained as part of the firm's shared audit trail.</p></aside>
    </div>
     {close.isError && <p role="alert" className="mt-3 rounded border border-[#e6c7c1] bg-[#fff9f6] p-3 text-xs text-[#843f38]">{close.error instanceof Error ? close.error.message : 'Matter could not be closed. Review the closeout checklist and try again.'}</p>}
      <MatterCloseout matterId={id} />
  </>;
}

export function ActivityPage() {
 const [limit,setLimit]=useState(40);const [page,setPage]=useState(0);const [actorMemberId,setActorMemberId]=useState('');const [recordFilter,setRecordFilter]=useState('');
 const members=useListWorkspaceAssignmentMembers();const clients=useListClients();const matters=useListMatters();
 const [entityType,entityIdValue]=recordFilter ? recordFilter.split(':') : [];
 const result=useListActivity({limit:limit+1,offset:page*limit,actorMemberId:actorMemberId?Number(actorMemberId):undefined,entityType:entityType as 'client'|'matter'|undefined,entityId:entityIdValue?Number(entityIdValue):undefined});
 const items=result.data?.slice(0,limit)??[];const hasNextPage=(result.data?.length??0)>limit;
 const firstEvent=page*limit+1;const lastEvent=firstEvent+items.length-1;
 const hasFilters=Boolean(actorMemberId||recordFilter);
 function clearFilters(){setActorMemberId('');setRecordFilter('');setPage(0);}
 return <><PageHeader eyebrow="Audit trail" title="Activity" subtitle="A chronological record of changes across your workspace." action={<select value={limit} onChange={e=>{setLimit(Number(e.target.value));setPage(0);}} className="h-10 rounded-md border border-[#d9d4c8] bg-[#fbfaf5] px-3 text-sm" data-testid="select-activity-limit"><option value="20">20 per page</option><option value="40">40 per page</option><option value="80">80 per page</option></select>} />
 <section className="mb-5 rounded-md border border-[#e0dace] bg-[#fbfaf5] p-4" aria-label="Filter activity">
  <div className="grid gap-4 sm:grid-cols-2">
   <label className="block text-xs font-semibold text-[#53625f]">Teammate
    <select value={actorMemberId} onChange={e=>{setActorMemberId(e.target.value);setPage(0);}} disabled={members.isLoading} className="field mt-2" data-testid="select-activity-actor"><option value="">All teammates</option>{members.data?.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select>
   </label>
   <label className="block text-xs font-semibold text-[#53625f]">Client or matter
    <select value={recordFilter} onChange={e=>{setRecordFilter(e.target.value);setPage(0);}} disabled={clients.isLoading||matters.isLoading} className="field mt-2" data-testid="select-activity-record"><option value="">All records</option>{(clients.data?.length??0)>0&&<optgroup label="Clients">{clients.data?.map(client=><option key={`client-${client.id}`} value={`client:${client.id}`}>{client.name}</option>)}</optgroup>}{(matters.data?.length??0)>0&&<optgroup label="Matters">{matters.data?.map(matter=><option key={`matter-${matter.id}`} value={`matter:${matter.id}`}>{matter.title} · {matter.clientName}</option>)}</optgroup>}</select>
   </label>
  </div>
  <div className="mt-3 flex flex-wrap items-center gap-3"><span className="text-[11px] text-[#87918d]">Filters apply to this firm’s activity and its pages.</span>{hasFilters&&<button type="button" onClick={clearFilters} className="text-xs font-semibold text-[#405c60] underline underline-offset-2" data-testid="button-clear-activity-filters">Clear filters</button>}</div>
  {(members.isError||clients.isError||matters.isError)&&<p className="mt-2 text-xs text-[#9a554d]" role="status">Some filter options could not be loaded. You can still view activity.</p>}
 </section>
 {result.isLoading?<Skeleton title="Loading audit events" />:result.isError?<ErrorState title="Audit trail unavailable" retry={()=>result.refetch()} />:!items.length?<EmptyState title={hasFilters?"No matching activity":"No recorded events"} detail={hasFilters?"Try a different teammate or record, or clear the filters to see all activity.":"As your firm works with client and matter records, this timeline will keep an auditable account of changes."} />:<div className="overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5]"><div className="flex items-center justify-between border-b border-[#e9e4d9] bg-[#f1eee6] px-5 py-4"><div className="mono text-[10px] uppercase tracking-[.14em] text-[#798480]">{hasFilters?"Matching events":"Workspace events"}</div><span className="text-xs text-[#798480]" data-testid="text-activity-count">Events {firstEvent}–{lastEvent}</span></div><ActivityList items={items} /><div className="flex flex-col gap-3 border-t border-[#e9e4d9] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-[#798480]" data-testid="text-activity-page-status">{hasNextPage?`Page ${page+1}`:`End of activity history · Page ${page+1}`}</span><div className="flex gap-2"><button type="button" onClick={()=>setPage(current=>Math.max(0,current-1))} disabled={page===0} className="inline-flex items-center gap-1 rounded-md border border-[#d9d4c8] px-3 py-2 text-xs font-semibold text-[#405c60] transition hover:bg-[#f1eee6] disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-activity-previous"><ArrowLeft className="h-3.5 w-3.5" />Previous</button><button type="button" onClick={()=>setPage(current=>current+1)} disabled={!hasNextPage} className="inline-flex items-center gap-1 rounded-md border border-[#d9d4c8] px-3 py-2 text-xs font-semibold text-[#405c60] transition hover:bg-[#f1eee6] disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-activity-next">Next<ArrowRight className="h-3.5 w-3.5" /></button></div></div></div>}</>;
}
export function SetupPage() {
 const {data:ctx,isLoading}=useGetWorkspace();const create=useCreateWorkspace();const qc=useQueryClient();const [,setLocation]=useLocation();const [error,setError]=useState('');
 if(isLoading)return <Skeleton title="Loading firm setup" />;
 if(ctx?.workspace)return <><PageHeader eyebrow="Workspace" title="Firm setup" subtitle="Your workspace is already established." /><div className="rounded-md border border-[#dce6dc] bg-[#f8fbf6] p-6" data-testid="status-setup-complete"><Check className="inline h-5 w-5 text-[#4e7c61]" /> Firm setup is complete. Your information is ready.</div></>;
   function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setError('');const f=new FormData(e.currentTarget);const input:WorkspaceInput={name:String(f.get('name')),practiceType:String(f.get('practiceType')) as any};create.mutate({data:input},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetWorkspaceQueryKey()});setLocation('/dashboard')},onError:()=>setError("We couldn't save your firm workspace. Your details are still here. Please try again.")});}
   return <div className="mx-auto max-w-2xl"><div className="mb-8"><div className="mono text-[10px] uppercase tracking-[.16em] text-[#987747]">First, your firm</div><h1 className="serif mt-2 text-4xl font-bold">Give your workspace a name.</h1><p className="mt-3 max-w-lg text-sm leading-6 text-[#71807e]">This is the private home for your firm's client relationships, matters, and access controls.</p></div><form onSubmit={submit} className="space-y-5 rounded-md border border-[#e0dace] bg-[#fbfaf5] p-6 md:p-8"><Field label="Firm or team name"><input name="name" required minLength={2} maxLength={120} placeholder="e.g. Northline Advisory" className="field" data-testid="input-workspace-name" /></Field><Field label="Practice type"><select name="practiceType" className="field" data-testid="select-practice-type"><option value="law">Law firm</option><option value="financial">Financial services</option><option value="both">Both</option></select></Field><div className="rounded-md bg-[#f1eee6] p-4 text-xs leading-5 text-[#677673]"><LockKeyhole className="mr-2 inline h-4 w-4 text-[#92754a]" />Client records are available to members of this firm's workspace.</div>{error&&<p role="alert" className="text-sm text-[#9b4941]" data-testid="status-workspace-error">{error}</p>}<Button type="submit" disabled={create.isPending} testId="button-create-workspace">{create.isPending?'Creating workspace…':error?'Try again':'Create firm workspace'}<ArrowRight className="h-4 w-4" /></Button></form></div>;
}
function SecurityPage() {
 const {user,isLoaded}=useUser();
  return <><PageHeader eyebrow="Account controls" title="Account & sign-in" subtitle="Manage the sign-in methods you use to access ClientGuard." />
  {!isLoaded?<Skeleton title="Loading account settings" />:<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"><section className="rounded-md border border-[#e0dace] bg-[#fbfaf5] p-2 sm:p-5" data-testid="panel-security-profile"><div className="mb-4 px-3 pt-3"><div className="mono text-[10px] uppercase tracking-[.15em] text-[#987747]">Your account</div><div className="mt-2 text-sm text-[#71807e]">Update your profile and manage your email/password sign-in.</div></div><UserProfile routing="hash" />
  </section><aside className="space-y-4"><div className="rounded-md bg-[#294651] p-5 text-[#f4f2e9]"><ShieldCheck className="h-5 w-5 text-[#e4c58e]" /><h3 className="serif mt-3 text-lg font-bold">Sign in your way</h3><p className="mt-2 text-xs leading-5 text-[#c3cfca]">Use email and password, or Google when it is enabled for this environment.</p></div><div className="rounded-md border border-[#e0dace] bg-[#fbfaf5] p-5"><div className="mono text-[9px] uppercase tracking-[.15em] text-[#8b948f]">Signed-in identity</div><div className="mt-3 text-sm font-semibold" data-testid="text-security-user">{user?.fullName||user?.primaryEmailAddress?.emailAddress||'Account'}</div><div className="mt-1 break-all text-xs text-[#7e8985]">{user?.primaryEmailAddress?.emailAddress}</div><div className="mt-4 flex items-center gap-2 text-xs text-[#52735e]"><Check className="h-4 w-4" /> Signed in</div></div></aside></div>}
 </>;
}
function TeamPage() {
  const invitations = useListWorkspaceInvitations();
  const createInvitation = useCreateWorkspaceInvitation();
  const resendInvitation = useResendWorkspaceInvitation();
  const withdrawInvitation = useWithdrawWorkspaceInvitation();
  const members = useListWorkspaceMembers();
  const updateMember = useUpdateWorkspaceMember();
  const removeMember = useRemoveWorkspaceMember();
  const transferOwnership = useTransferWorkspaceOwnership();
  const ownershipNoticeFailures = useListOwnershipNoticeFailures({
    query: { staleTime: 0 },
  });
  const retryOwnershipNotice = useRetryOwnershipNotice();
  const assignmentIssues = useListWorkspaceAssignmentIssues({ query: { staleTime: 0 } });
  const workspace = useGetWorkspace();
  const qc = useQueryClient();
  const [invitationActionMessage, setInvitationActionMessage] = useState('');
  const [invitationActionWarning, setInvitationActionWarning] = useState(false);
  const [memberActionMessage, setMemberActionMessage] = useState('');
  const [ownershipNoticeMessage, setOwnershipNoticeMessage] = useState('');
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);
  const [replacementMemberId, setReplacementMemberId] = useState<number | null>(null);
  const assignments = useGetWorkspaceMemberAssignments(removingMemberId ?? 0, {
    query: { enabled: removingMemberId !== null, staleTime: 0 },
  });
  const removingMember = members.data?.find((member) => member.id === removingMemberId);

  async function refreshAccessViews() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListWorkspaceMembersQueryKey() }),
      qc.invalidateQueries({ queryKey: getListOwnershipNoticeFailuresQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }),
      qc.invalidateQueries({ queryKey: getListActivityQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
      qc.invalidateQueries({ queryKey: getListClientsQueryKey() }),
      qc.invalidateQueries({ queryKey: getListMattersQueryKey() }),
      qc.invalidateQueries({ queryKey: getListWorkspaceAssignmentIssuesQueryKey() }),
      qc.invalidateQueries({
        predicate: query => {
          const key = query.queryKey[0];
          return typeof key === 'string' &&
            (key.startsWith('/api/clients/') || key.startsWith('/api/matters/'));
        },
      }),
    ]);
  }

  function saveMemberRole(e: FormEvent<HTMLFormElement>, memberId: number, memberName: string, currentRole: string) {
    e.preventDefault();
    const role = String(new FormData(e.currentTarget).get('role')) as WorkspaceMemberUpdate['role'];
    if (role === currentRole) return;
    setMemberActionMessage('');
    updateMember.mutate({ id: memberId, data: { role } }, {
      onSuccess: async () => {
        await refreshAccessViews();
        setMemberActionMessage(`${memberName}’s role was updated.`);
      },
      onError: async () => {
        await qc.invalidateQueries({ queryKey: getListWorkspaceMembersQueryKey() });
      },
    });
  }

  function removeTeammate(memberId: number) {
    setMemberActionMessage('');
    setReplacementMemberId(null);
    removeMember.reset();
    setRemovingMemberId(memberId);
  }

  function confirmRemoveTeammate() {
    if (!removingMember) return;
    const memberName = removingMember.name || removingMember.email || 'This teammate';
    removeMember.mutate({
      id: removingMember.id,
      data: replacementMemberId === null ? {} : { replacementMemberId },
    }, {
      onSuccess: async () => {
        await refreshAccessViews();
        setMemberActionMessage(`${memberName} no longer has access to this firm.`);
        setRemovingMemberId(null);
      },
      onError: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: getListWorkspaceMembersQueryKey() }),
          assignments.refetch(),
        ]);
      },
    });
  }

  function transferFirmOwnership(memberId: number, memberName: string) {
    if (!window.confirm(`Transfer firm ownership to ${memberName}? You will become an admin, and ${memberName} will become the owner.`)) return;
    setMemberActionMessage('');
    transferOwnership.reset();
    transferOwnership.mutate({ id: memberId }, {
      onSuccess: async () => {
        await refreshAccessViews();
        setMemberActionMessage(`Firm ownership was transferred to ${memberName}. You are now an admin.`);
      },
      onError: async () => {
        await qc.invalidateQueries({ queryKey: getListWorkspaceMembersQueryKey() });
      },
    });
  }

  function retryFailedOwnershipNotice(
    transferId: string,
    recipientRole: 'former_owner' | 'new_owner',
    recipientName: string,
  ) {
    setOwnershipNoticeMessage('');
    retryOwnershipNotice.reset();
    retryOwnershipNotice.mutate({ transferId, recipientRole }, {
      onSuccess: async () => {
        await qc.invalidateQueries({
          queryKey: getListOwnershipNoticeFailuresQueryKey(),
        });
        setOwnershipNoticeMessage(`The ownership notice to ${recipientName} was sent.`);
      },
      onError: async () => {
        await qc.invalidateQueries({
          queryKey: getListOwnershipNoticeFailuresQueryKey(),
        });
        setOwnershipNoticeMessage(`The ownership notice to ${recipientName} could not be sent. You can try again.`);
      },
    });
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const data: WorkspaceInvitationInput = {
      email: String(form.get('email')).trim(),
      role: String(form.get('role')) as WorkspaceInvitationInput['role'],
    };
    createInvitation.reset();
    createInvitation.mutate({ data }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListWorkspaceInvitationsQueryKey() });
        formElement.reset();
      },
    });
  }

  return <>
    <PageHeader eyebrow="Firm access" title="Your team" subtitle="Invite colleagues to this firm's shared workspace and set their starting role." />
    {assignmentIssues.isError ? <div className="mb-6 rounded border border-[#ead3ce] bg-[#fbefed] p-4 text-sm text-[#9b4941]" role="alert">Legacy assignments could not be checked. <button className="underline" onClick={() => assignmentIssues.refetch()}>Try again</button></div> : assignmentIssues.data && (assignmentIssues.data.clients.length > 0 || assignmentIssues.data.matters.length > 0) && <section className="mb-6 rounded-md border border-[#e5d4b1] bg-[#fbf5e8] p-5" data-testid="panel-unresolved-assignments">
      <h2 className="serif text-lg font-bold text-[#725a31]">Legacy assignments need review</h2>
      <p className="mt-1 text-xs leading-5 text-[#766b55]">These saved labels did not uniquely identify a current teammate. Open each record and select the right teammate before removing anyone whose work may be affected.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {assignmentIssues.data.clients.map(item => <Link key={`client-${item.id}`} href={`/clients/${item.id}`} className="rounded border border-[#e6d8ba] bg-[#fffaf0] p-3 text-xs hover:bg-white" data-testid={`unresolved-client-${item.id}`}><span className="font-semibold">{item.name}</span><span className="mt-1 block text-[#806b44]">Saved owner label: {item.label}</span></Link>)}
        {assignmentIssues.data.matters.map(item => <Link key={`matter-${item.id}`} href={`/matters/${item.id}`} className="rounded border border-[#e6d8ba] bg-[#fffaf0] p-3 text-xs hover:bg-white" data-testid={`unresolved-matter-${item.id}`}><span className="font-semibold">{item.reference} · {item.title}</span><span className="mt-1 block text-[#806b44]">Client: {item.clientName} · Saved teammate label: {item.label}</span></Link>)}
      </div>
    </section>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section className="rounded-md border border-[#e0dace] bg-[#fbfaf5] p-5 sm:p-6">
        <div className="flex items-center gap-3 border-b border-[#e9e4d9] pb-4">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[#e8eee8] text-[#4d7463]"><UserPlus className="h-5 w-5" /></div>
          <div><h2 className="serif text-xl font-bold">Invite a teammate</h2><p className="mt-1 text-xs text-[#788480]">They’ll receive a secure sign-in link by email.</p></div>
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="Work email"><input name="email" type="email" required maxLength={320} className="field" placeholder="colleague@firm.com" data-testid="input-invitation-email" /></Field>
          <Field label="Starting role">
            <select name="role" defaultValue="professional" className="field" data-testid="select-invitation-role">
              <option value="admin">Admin — manage invitations and firm access</option>
              <option value="advisor">Advisor — work with firm records</option>
              <option value="professional">Professional — work with firm records</option>
              <option value="assistant">Assistant — view firm records</option>
            </select>
          </Field>
          {createInvitation.isSuccess && <div className="rounded-md border border-[#cbdccd] bg-[#f2f8f1] p-3 text-sm text-[#446b55]" role="status" data-testid="status-invitation-sent">Invitation email sent to {createInvitation.data.email}.</div>}
          {createInvitation.isError && <p className="text-sm text-[#9b4941]" role="alert" data-testid="status-invitation-error">We couldn’t send that invitation. Check the address or try again.</p>}
          <Button type="submit" disabled={createInvitation.isPending} testId="button-send-invitation"><Mail className="h-4 w-4" />{createInvitation.isPending ? 'Sending…' : 'Send invitation'}</Button>
        </form>
      </section>
      <section className="rounded-md border border-[#e0dace] bg-[#fbfaf5]">
        <div className="flex items-center justify-between border-b border-[#e9e4d9] px-5 py-4">
          <div><h2 className="serif text-xl font-bold">Invitations</h2><p className="mt-1 text-xs text-[#87918d]">Invitations expire after seven days. Expired invitations can be renewed.</p></div>
          <Users className="h-5 w-5 text-[#987747]" />
        </div>
        {invitationActionMessage && <p className={`px-5 pt-4 text-sm ${invitationActionWarning ? 'text-[#8a5c24]' : 'text-[#446b55]'}`} role={invitationActionWarning ? 'alert' : 'status'} data-testid="status-invitation-action">{invitationActionMessage}</p>}
        {(resendInvitation.isError || withdrawInvitation.isError) && <p className="px-5 pt-4 text-sm text-[#9b4941]" role="alert" data-testid="status-invitation-action-error">That invitation could not be updated. It may have changed; refresh the list and try again.</p>}
        {invitations.isLoading ? <div className="p-5"><Skeleton title="Loading invitations" /></div> :
          invitations.isError ? <div className="p-5 text-sm text-[#9b4941]">Invitations could not be loaded. <button onClick={() => invitations.refetch()} className="underline" data-testid="button-retry-invitations">Try again</button></div> :
          !invitations.data?.length ? <div className="p-6"><EmptyState title="No invitations" detail="When you invite a colleague, their email and role will appear here until they join." /></div> :
          <div className="divide-y divide-[#eee9df]">{invitations.data.map(invite => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" data-testid={`invitation-row-${invite.id}`}>
            <div className="min-w-0"><div className="break-all text-sm font-semibold">{invite.email}</div><div className="mt-1 text-xs capitalize text-[#7e8985]">{invite.role} · sent {formatTime(invite.createdAt)}</div>{invite.revoked ? <span className="mt-2 inline-block rounded-full bg-[#ecebe5] px-3 py-1 text-[10px] font-semibold text-[#687371]">Withdrawn</span> : <span className={`mt-2 inline-block rounded-full px-3 py-1 text-[10px] font-semibold ${invite.expired ? 'bg-[#f8e9e5] text-[#9b4941]' : 'bg-[#f2eee3] text-[#806b44]'}`}>{invite.expired ? 'Expired' : 'Expires'} {formatTime(invite.expiresAt)}</span>}{invite.providerRevocationFailed && <p className="mt-3 max-w-xl rounded border border-[#e5d4b1] bg-[#fbf5e8] p-3 text-xs leading-5 text-[#765a2b]" role="alert" data-testid={`invitation-revocation-warning-${invite.id}`}>The ClientGuard link is disabled, but Clerk may still have an active invitation for this address. Check Clerk and revoke any old invitation.</p>}</div>
            {!invite.revoked && <div className="flex items-center gap-2">
              <Button variant="outline" disabled={resendInvitation.isPending || withdrawInvitation.isPending} testId={`button-resend-invitation-${invite.id}`} onClick={() => {
                setInvitationActionMessage('');
                setInvitationActionWarning(false);
                resendInvitation.reset();
                withdrawInvitation.reset();
                resendInvitation.mutate({ id: invite.id }, {
                  onSuccess: async (updatedInvitation) => {
                    await qc.invalidateQueries({ queryKey: getListWorkspaceInvitationsQueryKey() });
                    setInvitationActionWarning(updatedInvitation.providerRevocationFailed);
                    setInvitationActionMessage(updatedInvitation.providerRevocationFailed
                      ? `A fresh invitation was sent to ${invite.email}. Its previous ClientGuard link no longer works, but Clerk could not confirm revocation. Review Clerk invitations for this address.`
                      : `A fresh invitation was sent to ${invite.email}. Its previous link no longer works.`);
                  },
                });
              }}><RefreshCw className="h-4 w-4" />{resendInvitation.isPending ? (invite.expired ? 'Renewing…' : 'Resending…') : (invite.expired ? 'Renew' : 'Resend')}</Button>
              {!invite.expired && <Button variant="outline" disabled={resendInvitation.isPending || withdrawInvitation.isPending} testId={`button-withdraw-invitation-${invite.id}`} onClick={() => {
                setInvitationActionMessage('');
                setInvitationActionWarning(false);
                resendInvitation.reset();
                withdrawInvitation.reset();
                withdrawInvitation.mutate({ id: invite.id }, {
                  onSuccess: async (withdrawnInvitation) => {
                    await qc.invalidateQueries({ queryKey: getListWorkspaceInvitationsQueryKey() });
                    setInvitationActionWarning(withdrawnInvitation.providerRevocationFailed);
                    setInvitationActionMessage(withdrawnInvitation.providerRevocationFailed
                      ? `The invitation to ${invite.email} was withdrawn and its ClientGuard link is disabled, but Clerk could not confirm revocation. Review Clerk invitations for this address.`
                      : `The invitation to ${invite.email} was withdrawn.`);
                  },
                });
              }}><X className="h-4 w-4" />{withdrawInvitation.isPending ? 'Withdrawing…' : 'Withdraw'}</Button>}
            </div>}
          </div>)}</div>}
      </section>
    </div>
      {(workspace.data?.role === 'owner' || workspace.data?.role === 'admin') && <MembershipConflicts />}
    {(ownershipNoticeFailures.isLoading || ownershipNoticeFailures.isError ||
      (ownershipNoticeFailures.data?.length ?? 0) > 0 || ownershipNoticeMessage) && <section className="mt-6 overflow-hidden rounded-md border border-[#e5d4b1] bg-[#fbf5e8]" aria-labelledby="ownership-notice-heading" data-testid="panel-ownership-notice-failures">
      <div className="border-b border-[#eadcbe] px-5 py-4">
        <h2 id="ownership-notice-heading" className="serif text-xl font-bold text-[#725a31]">Ownership notices</h2>
        <p className="mt-1 text-xs text-[#766b55]">Ownership changes are complete even when an email could not be delivered.</p>
      </div>
      {ownershipNoticeMessage && <p className="px-5 pt-4 text-sm text-[#446b55]" role="status" data-testid="status-ownership-notice-action">{ownershipNoticeMessage}</p>}
      {ownershipNoticeFailures.isLoading ? <div className="p-5 text-sm text-[#766b55]">Checking ownership notices…</div> :
        ownershipNoticeFailures.isError ? <div className="p-5 text-sm text-[#9b4941]" role="alert">Ownership notices could not be loaded. <button onClick={() => ownershipNoticeFailures.refetch()} className="underline" data-testid="button-retry-ownership-notices">Try again</button></div> :
        !ownershipNoticeFailures.data?.length ? <div className="p-5 text-sm text-[#536d5c]">No ownership notices are waiting to be sent.</div> :
        <div className="divide-y divide-[#eadcbe]">{ownershipNoticeFailures.data.map(notice => {
          const recipientLabel = notice.recipientRole === 'former_owner' ? 'outgoing owner' : 'incoming owner';
          return <div key={`${notice.transferId}-${notice.recipientRole}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`ownership-notice-failure-${notice.transferId}-${notice.recipientRole}`}>
            <div className="text-sm text-[#53625f]">
              <span className="font-semibold">{notice.recipientName}</span> ({recipientLabel}) wasn’t emailed after ownership transferred to <span className="font-semibold">{notice.otherOwnerName}</span>.
            </div>
            {(workspace.data?.role === 'owner' || workspace.data?.role === 'admin') && <Button variant="outline" disabled={retryOwnershipNotice.isPending} testId={`button-retry-ownership-notice-${notice.transferId}-${notice.recipientRole}`} onClick={() => retryFailedOwnershipNotice(notice.transferId, notice.recipientRole, notice.recipientName)}>
              <RefreshCw className="h-4 w-4" />{retryOwnershipNotice.isPending ? 'Sending…' : 'Retry notice'}
            </Button>}
          </div>;
        })}</div>}
    </section>}
    <section className="mt-6 overflow-hidden rounded-md border border-[#e0dace] bg-[#fbfaf5]" data-testid="panel-workspace-members">
      <div className="flex items-center justify-between border-b border-[#e9e4d9] px-5 py-4">
        <div><h2 className="serif text-xl font-bold">Current members</h2><p className="mt-1 text-xs text-[#87918d]">Review who can access this firm and update teammate roles.</p></div>
        <Users className="h-5 w-5 text-[#987747]" />
      </div>
      {memberActionMessage && <p className="px-5 pt-4 text-sm text-[#446b55]" role="status" data-testid="status-member-action">{memberActionMessage}</p>}
      {(updateMember.isError || removeMember.isError || transferOwnership.isError) && <p className="px-5 pt-4 text-sm text-[#9b4941]" role="alert" data-testid="status-member-action-error">That access change could not be completed. The member list has been refreshed; please try again.</p>}
      {members.isLoading ? <div className="p-5"><Skeleton title="Loading firm members" /></div> :
        members.isError ? <div className="p-5 text-sm text-[#9b4941]">Firm members could not be loaded. <button onClick={() => members.refetch()} className="underline" data-testid="button-retry-members">Try again</button></div> :
        !members.data?.length ? <div className="p-6"><EmptyState title="No current members" detail="Firm members will appear here after they accept an invitation." /></div> :
        <div className="divide-y divide-[#eee9df]">{members.data.map(member => {
          const memberName = member.name || member.email || 'Unnamed teammate';
          const isProtectedOwner = member.role === 'owner';
          return <div key={member.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`member-row-${member.id}`}>
            <div className="min-w-0">
              <div className="break-words text-sm font-semibold">{memberName}</div>
              <div className="mt-1 break-all text-xs text-[#7e8985]">{member.email || 'No email address'}</div>
              <div className="mt-1 text-[10px] text-[#87918d]">Joined {formatTime(member.createdAt)}</div>
            </div>
            {isProtectedOwner ?
              <span className="inline-flex w-fit rounded-full bg-[#f2eee3] px-3 py-1.5 text-xs font-semibold capitalize text-[#806b44]" data-testid={`member-role-${member.id}`}>Firm owner</span> :
              <div className="flex flex-wrap items-center gap-2">
                <form className="flex items-center gap-2" onSubmit={e => saveMemberRole(e, member.id, memberName, member.role)}>
                  <Field label="Role">
                    <select name="role" defaultValue={member.role} className="field min-w-40" data-testid={`select-member-role-${member.id}`}>
                      <option value="admin">Admin</option>
                      <option value="advisor">Advisor</option>
                      <option value="professional">Professional</option>
                      <option value="assistant">Assistant</option>
                    </select>
                  </Field>
                  <Button type="submit" variant="outline" disabled={updateMember.isPending || removeMember.isPending || transferOwnership.isPending} testId={`button-save-member-role-${member.id}`}>
                    {updateMember.isPending ? 'Saving…' : 'Save role'}
                  </Button>
                </form>
                {workspace.data?.role === 'owner' && <Button variant="outline" disabled={updateMember.isPending || removeMember.isPending || transferOwnership.isPending} testId={`button-transfer-ownership-${member.id}`} onClick={() => transferFirmOwnership(member.id, memberName)}>
                  {transferOwnership.isPending ? 'Transferring…' : 'Make firm owner'}
                </Button>}
                <Button variant="outline" disabled={updateMember.isPending || removeMember.isPending || transferOwnership.isPending} testId={`button-remove-member-${member.id}`} onClick={() => removeTeammate(member.id)}>
                  Remove access
                </Button>
              </div>}
          </div>;
        })}</div>}
    </section>
    {removingMember && <Modal title={`Remove ${removingMember.name || removingMember.email}?`} close={() => {
      if (!removeMember.isPending) setRemovingMemberId(null);
    }}>
      <div className="space-y-5">
        <p className="text-sm leading-6 text-[#657572]">Review the client and matter work assigned to this teammate. Any listed assignments must be moved to an active colleague before access is removed.</p>
        {assignments.isLoading ? <Skeleton title="Checking assigned work" /> :
          assignments.isError ? <div className="rounded-md border border-[#ead3ce] bg-[#fbefed] p-4 text-sm text-[#9b4941]" role="alert">
            Assigned work could not be loaded. <button onClick={() => assignments.refetch()} className="font-semibold underline" data-testid="button-retry-member-assignments">Try again</button>
          </div> : <>
            {!!((assignments.data?.unresolvedClients.length ?? 0) + (assignments.data?.unresolvedMatters.length ?? 0)) && <div className="rounded border border-[#e5d4b1] bg-[#fbf5e8] p-3 text-xs text-[#725a31]" role="alert" data-testid="member-unresolved-assignments">
              Some legacy labels could belong to this teammate but are ambiguous. Resolve these records before removing access:
              <div className="mt-2 flex flex-wrap gap-3">
                {assignments.data?.unresolvedClients.map(item => <Link key={`client-${item.id}`} href={`/clients/${item.id}`} className="font-semibold underline">{item.name} · “{item.label}”</Link>)}
                {assignments.data?.unresolvedMatters.map(item => <Link key={`matter-${item.id}`} href={`/matters/${item.id}`} className="font-semibold underline">{item.reference} · “{item.label}”</Link>)}
              </div>
            </div>}
            <div className="rounded-md border border-[#e4dfd4] bg-[#f8f6ef] p-4" data-testid="member-assignment-summary">
              <div className="text-xs font-semibold text-[#40565a]">Clients ({assignments.data?.clients.length ?? 0})</div>
              {assignments.data?.clients.length ? <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[#657572]">
                {assignments.data.clients.map(client => <li key={client.id}>{client.name}</li>)}
              </ul> : <p className="mt-2 text-xs text-[#87918d]">No clients assigned.</p>}
              <div className="mt-4 border-t border-[#e4dfd4] pt-3 text-xs font-semibold text-[#40565a]">Matters ({assignments.data?.matters.length ?? 0})</div>
              {assignments.data?.matters.length ? <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[#657572]">
                {assignments.data.matters.map(matter => <li key={matter.id}>{matter.reference} · {matter.title} <span className="text-xs text-[#87918d]">({matter.clientName})</span></li>)}
              </ul> : <p className="mt-2 text-xs text-[#87918d]">No matters assigned.</p>}
            </div>
            {!!((assignments.data?.clients.length ?? 0) + (assignments.data?.matters.length ?? 0)) && <Field label="Reassign this work to">
              <select
                value={replacementMemberId ?? ''}
                onChange={event => setReplacementMemberId(event.target.value ? Number(event.target.value) : null)}
                className="field"
                data-testid="select-assignment-replacement"
                required
              >
                <option value="">Select an active teammate</option>
                {(members.data ?? []).filter(member => member.id !== removingMember.id).map(member => (
                  <option key={member.id} value={member.id}>{member.name || member.email} · {member.role}</option>
                ))}
              </select>
            </Field>}
          </>}
        {removeMember.isError && <p className="text-sm text-[#9b4941]" role="alert" data-testid="status-remove-member-error">
          Removal could not be completed. Assigned work or active membership may have changed; review the list and try again.
        </p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#e9e4d9] pt-4">
          <Button variant="outline" disabled={removeMember.isPending} onClick={() => setRemovingMemberId(null)} testId="button-cancel-remove-member">Cancel</Button>
          <Button
            variant="danger"
            disabled={assignments.isLoading || assignments.isError || removeMember.isPending || !!((assignments.data?.unresolvedClients.length ?? 0) + (assignments.data?.unresolvedMatters.length ?? 0)) || (
              !!((assignments.data?.clients.length ?? 0) + (assignments.data?.matters.length ?? 0)) &&
              (replacementMemberId === null || !(members.data ?? []).some(member => member.id === replacementMemberId && member.id !== removingMember.id))
            )}
            onClick={confirmRemoveTeammate}
            testId="button-confirm-remove-member"
          >{removeMember.isPending ? 'Reassigning and removing…' : 'Reassign and remove access'}</Button>
        </div>
      </div>
    </Modal>}
  </>;
}
function InviteAcceptance() {
  const { isLoaded, isSignedIn } = useUser();
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const returnUrl = `${basePath}/invite?token=${encodeURIComponent(token)}`;
  if (!token) return <AuthFrame><div className="rounded-md border border-[#e0dace] bg-[#fbfaf5] p-7 text-center"><h1 className="serif text-2xl font-bold">Invitation link unavailable</h1><p className="mt-3 text-sm text-[#71807e]">The invitation link is missing or incomplete. Ask your firm admin to send another one.</p></div></AuthFrame>;
  if (!isLoaded) return <AuthFrame><Skeleton title="Checking your sign-in" /></AuthFrame>;
  if (isSignedIn) return <AcceptInvitation token={token} />;

  return <AuthFrame>
    <div className="w-full max-w-lg rounded-md border border-[#e0dace] bg-[#fbfaf5] p-6 sm:p-8">
      <div className="mb-6 text-center"><div className="mono text-[10px] uppercase tracking-[.16em] text-[#987747]">Firm invitation</div><h1 className="serif mt-2 text-3xl font-bold">Sign in to continue</h1><p className="mt-2 text-sm leading-6 text-[#71807e]">Use the account with the invited email address, then accept the invitation to join the firm workspace.</p></div>
      <SignIn routing="hash" signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={returnUrl} signUpForceRedirectUrl={returnUrl} />
    </div>
  </AuthFrame>;
}
function AcceptInvitation({ token }: { token: string }) {
  const accept = useAcceptWorkspaceInvitation();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  function acceptInvitation() {
    accept.mutate({ data: { token } }, {
      onSuccess: () => {
        qc.clear();
        setLocation('/dashboard');
      },
    });
  }

  return <main className="grain grid min-h-[100dvh] place-items-center bg-[#f3f0e7] p-5 text-[#23353b]">
    <section className="w-full max-w-lg rounded-md border border-[#e0dace] bg-[#fbfaf5] p-7 text-center shadow-xl sm:p-9" data-testid="panel-accept-invitation">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e8eee8] text-[#4d7463]"><Users className="h-5 w-5" /></div>
      <div className="mono mt-5 text-[10px] uppercase tracking-[.16em] text-[#987747]">Firm invitation</div>
      <h1 className="serif mt-2 text-3xl font-bold">Join your firm workspace</h1>
      <p className="mt-3 text-sm leading-6 text-[#71807e]">Accepting will add this signed-in account to the workspace that invited its verified email address.</p>
      {accept.isError && <p className="mt-4 text-sm text-[#9b4941]" role="alert" data-testid="status-accept-invitation-error">This invitation could not be accepted. Check that you’re signed in with the invited email address, or ask your firm admin for help.</p>}
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row"><Button onClick={acceptInvitation} disabled={accept.isPending} testId="button-accept-invitation">{accept.isPending ? 'Joining…' : 'Accept invitation'}<ArrowRight className="h-4 w-4" /></Button><Link href="/" className="rounded-md border border-[#d9d4c8] px-4 py-2.5 text-[13px] font-semibold text-[#526568]">Not now</Link></div>
    </section>
  </main>;
}
function NotFound() {return <div className="grid min-h-[100dvh] place-items-center bg-[#f6f3eb] p-6 text-center"><div><div className="mono text-xs uppercase tracking-[.15em] text-[#987747]">404 · Not found</div><h1 className="serif mt-3 text-4xl font-bold">This page is outside the file.</h1><p className="mt-3 text-sm text-[#71807e]">The address may have changed or may not exist.</p><Link href="/" className="mt-6 inline-flex items-center gap-2 rounded bg-[#294651] px-5 py-3 text-sm font-semibold text-[#f6f3eb]" data-testid="link-not-found-home">Return home <ArrowRight className="h-4 w-4" /></Link></div></div>}

