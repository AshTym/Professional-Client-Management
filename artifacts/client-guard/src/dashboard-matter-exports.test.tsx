import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';

const mocks = vi.hoisted(() => ({
  useGetDashboard: vi.fn(),
  useGetWorkspace: vi.fn(),
  useListActivity: vi.fn(),
  useListClients: vi.fn(),
  useCreateClient: vi.fn(),
  useListMatters: vi.fn(),
  useGetMatter: vi.fn(),
  useGetMatterCloseout: vi.fn(),
  useUpdateMatter: vi.fn(),
  useCloseMatter: vi.fn(),
  useLogMatterExportRequest: vi.fn(),
  useGetIntakeOverview: vi.fn(),
  useGetIntakeDrafts: vi.fn(),
  useGetClient: vi.fn(),
  useSaveIntakeChecks: vi.fn(),
  useCreateIntake: vi.fn(),
  useCreateIntakeDraft: vi.fn(),
  useUpdateIntakeDraft: vi.fn(),
  useDeleteIntakeDraft: vi.fn(),
  useSubmitIntakeDraft: vi.fn(),
  useUpdateClient: vi.fn(),
  useDeleteClient: vi.fn(),
  useReviewIntake: vi.fn(),
  useOpenMatterFromIntake: vi.fn(),
  useListWorkspaceAssignmentMembers: vi.fn(),
  downloadMattersPdf: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  ...mocks,
  getGetDashboardQueryKey: () => ['dashboard'],
  getGetClientQueryKey: (id: number) => ['client', id],
  getGetMatterQueryKey: (id: number) => ['matter', id],
  getGetMatterCloseoutQueryKey: (id: number) => ['matter-closeout', id],
  getListActivityQueryKey: () => ['activity'],
  getListClientsQueryKey: () => ['clients'],
  getListWorkspaceAssignmentIssuesQueryKey: () => ['assignment-issues'],
  getGetIntakeOverviewQueryKey: () => ['intake'],
  getGetIntakeDraftsQueryKey: () => ['intake-drafts'],
  getListMattersQueryKey: (params?: any) => ['/api/matters', ...(params ? [params] : [])],
}));

vi.mock('./lib/matters-pdf', () => ({
  downloadMattersPdf: mocks.downloadMattersPdf,
}));
vi.mock('./PortalInvitation', () => ({ default: () => null }));
vi.mock('./MatterCloseout', () => ({ default: () => null }));

import { ClientDetail, ClientsPage, Dashboard, MatterDetail, MattersPage } from './App';
import Intake from './Intake';
import { getListMattersQueryKey } from '@workspace/api-client-react';

const firstMatter = {
  id: 11,
  title: 'Northstar acquisition',
  reference: 'MAT-011',
  clientId: 5,
  clientName: 'Northstar Ltd',
  matterType: 'Acquisition',
  responsible: 'A. Morgan',
  status: 'open',
  riskLevel: 'low',
  dueAt: null,
};
const secondMatter = {
  id: 12,
  title: 'Harbor employment review',
  reference: 'MAT-012',
  clientId: 6,
  clientName: 'Harbor Group',
  matterType: 'Employment',
  responsible: 'J. Lee',
  status: 'on_hold',
  riskLevel: 'medium',
  dueAt: null,
};

function renderAt(path: string, queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})) {
  window.history.replaceState({}, '', path);

  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/clients" component={ClientsPage} />
          <Route path="/clients/:id" component={ClientDetail} />
          <Route path="/matters/:id" component={MatterDetail} />
          <Route path="/intake" component={Intake} />
          <Route path="/matters" component={MattersPage} />
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
}

describe('dashboard shortcuts and matter exports', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.useGetDashboard.mockReturnValue({
      data: {
        clientCount: 1,
        matterCount: 0,
        activeClientCount: 1,
        openMatterCount: 0,
        overdueMatterCount: 0,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useGetWorkspace.mockReturnValue({
      data: { userId: 'user-1', workspace: { id: 1, name: 'Test Firm', practiceType: 'law', createdAt: '2026-01-01T00:00:00.000Z' }, role: 'owner' },
      isLoading: false,
      isError: false,
    });
    mocks.useListActivity.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useListClients.mockReturnValue({ data: [], isLoading: false, isError: false });
    mocks.useCreateClient.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
    mocks.useListMatters.mockReturnValue({
      data: [firstMatter, secondMatter],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useGetMatter.mockReturnValue({
      data: {
        ...firstMatter,
        responsibleMemberId: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useGetMatterCloseout.mockReturnValue({
      data: { canClose: false },
      isLoading: false,
    });
    mocks.useUpdateMatter.mockReturnValue({
      mutate: vi.fn((_variables: any, callbacks: any) => callbacks?.onSuccess?.()),
      isPending: false,
      isError: false,
    });
    mocks.useCloseMatter.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
    mocks.useLogMatterExportRequest.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    });
    mocks.useGetIntakeOverview.mockReturnValue({
      data: { intakes: [], checks: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useGetIntakeDrafts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useGetClient.mockReturnValue({
      data: {
        id: 5, name: 'Northstar Ltd', clientType: 'business', email: 'northstar@example.test',
        phone: '555-0105', industry: 'Technology', status: 'active', owner: 'A. Morgan',
        ownerMemberId: 1, matterCount: 0, lastActivityAt: null, createdAt: '2026-01-01T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useUpdateClient.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
    mocks.useDeleteClient.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useSaveIntakeChecks.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useCreateIntake.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useCreateIntakeDraft.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useUpdateIntakeDraft.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useDeleteIntakeDraft.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useSubmitIntakeDraft.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useReviewIntake.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useOpenMatterFromIntake.mockImplementation((options: any) => ({
      mutate: (variables: any, callbacks: any) => {
        const matter = { id: 99, clientId: 5 };
        options?.mutation?.onSuccess?.(matter, variables, undefined, undefined);
        callbacks?.onSuccess?.(matter, variables, undefined);
      },
      isPending: false,
    }));
    mocks.useListWorkspaceAssignmentMembers.mockReturnValue({
      data: [{ id: 1, name: 'A. Morgan', email: 'morgan@example.test', role: 'professional' }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens the client form from the dashboard client shortcut', () => {
    renderAt('/dashboard');

    fireEvent.click(screen.getByTestId('button-dashboard-create-client'));

    expect(screen.getByRole('dialog', { name: 'Add a client' })).toBeTruthy();
    expect(screen.getByTestId('input-client-name')).toBeTruthy();
  });

  it('opens the intake form from the dashboard matter shortcut', () => {
    renderAt('/dashboard');

    fireEvent.click(screen.getByTestId('button-dashboard-create-matter'));

    expect(screen.getByRole('dialog', { name: 'Start a client intake' })).toBeTruthy();
    expect(screen.getByTestId('button-submit-intake')).toBeTruthy();
  });

  it('opens the intake form from the first-matter dashboard prompt', () => {
    renderAt('/dashboard');

    fireEvent.click(screen.getByTestId('link-create-first-matter'));

    expect(screen.getByRole('dialog', { name: 'Start a client intake' })).toBeTruthy();
    expect(screen.getByTestId('button-submit-intake')).toBeTruthy();
  });

  it('opens a preselected intake directly from the client profile', async () => {
    mocks.useListClients.mockReturnValue({
      data: [{
        id: 5, name: 'Northstar Ltd', clientType: 'business', email: 'northstar@example.test',
        phone: '555-0105', industry: 'Technology', status: 'active', owner: 'A. Morgan',
        ownerMemberId: 1, matterCount: 0, lastActivityAt: null, createdAt: '2026-01-01T00:00:00.000Z',
      }],
      isLoading: false,
      isError: false,
    });
    renderAt('/clients/5');

    const startMatter = screen.getByTestId('link-client-start-matter') as HTMLAnchorElement;
    expect(startMatter.getAttribute('href')).toBe('/intake?create=1&clientId=5');
    fireEvent.click(startMatter);

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Start a client intake' })).toBeTruthy());
    expect((screen.getByTestId('select-intake-client') as HTMLSelectElement).value).toBe('5');
  });

  it('shows only matters currently associated with the client on its profile', () => {
    const matters = [firstMatter, secondMatter];
    mocks.useListMatters.mockImplementation((params?: { clientId?: number }) => ({
      data: matters.filter(matter => matter.clientId === params?.clientId),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    renderAt('/clients/5');

    expect(mocks.useListMatters).toHaveBeenCalledWith(
      { clientId: 5 },
      { query: { enabled: true } },
    );
    expect(screen.getByTestId('client-matters-count').textContent).toBe('1');
    expect(screen.getByTestId('link-client-matter-11').getAttribute('href')).toBe('/matters/11');
    expect(screen.queryByTestId('link-client-matter-12')).toBeNull();
  });

  it('combines client matter title or reference search with a status filter', () => {
    const matters = [
      firstMatter,
      { ...firstMatter, id: 13, title: 'Employment renewal', reference: 'MAT-013', status: 'closed' },
      secondMatter,
    ];
    mocks.useListMatters.mockImplementation((params?: { clientId?: number; search?: string; status?: string }) => ({
      data: matters.filter(matter =>
        matter.clientId === params?.clientId
        && (!params.search || `${matter.title} ${matter.reference}`.toLowerCase().includes(params.search.toLowerCase()))
        && (!params.status || matter.status === params.status),
      ),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    renderAt('/clients/5');
    fireEvent.change(screen.getByTestId('input-search-client-matters'), { target: { value: 'MAT-013' } });
    fireEvent.change(screen.getByTestId('select-client-matter-status'), { target: { value: 'closed' } });

    expect(mocks.useListMatters).toHaveBeenLastCalledWith(
      { clientId: 5, search: 'MAT-013', status: 'closed' },
      { query: { enabled: true } },
    );
    expect(screen.getByTestId('link-client-matter-13')).toBeTruthy();
    expect(screen.queryByTestId('link-client-matter-11')).toBeNull();
    expect(screen.queryByTestId('link-client-matter-12')).toBeNull();

    fireEvent.change(screen.getByTestId('input-search-client-matters'), { target: { value: 'Employment' } });

    expect(mocks.useListMatters).toHaveBeenLastCalledWith(
      { clientId: 5, search: 'Employment', status: 'closed' },
      { query: { enabled: true } },
    );
    expect(screen.getByTestId('link-client-matter-13')).toBeTruthy();
  });

  it('shows a filter-specific empty state and lets staff clear client matter filters', () => {
    mocks.useListMatters.mockImplementation((params?: { clientId?: number; search?: string; status?: string }) => ({
      data: params?.search || params?.status ? [] : [firstMatter],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    renderAt('/clients/5');
    fireEvent.change(screen.getByTestId('input-search-client-matters'), { target: { value: 'not found' } });
    fireEvent.change(screen.getByTestId('select-client-matter-status'), { target: { value: 'closed' } });

    expect(screen.getByTestId('client-matters-no-matches').textContent).toContain('No matters match these filters');
    expect(screen.getByTestId('button-clear-client-matter-filters')).toBeTruthy();

    fireEvent.click(screen.getByTestId('button-clear-client-matter-filters'));

    expect((screen.getByTestId('input-search-client-matters') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('select-client-matter-status') as HTMLSelectElement).value).toBe('');
    expect(screen.getByTestId('link-client-matter-11')).toBeTruthy();
  });

  it('shows a clear empty state when the client has no matters', () => {
    mocks.useListMatters.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderAt('/clients/5');

    expect(screen.getByTestId('client-matters-empty').textContent).toContain('No matters for this client yet');
    expect(screen.getByTestId('link-client-start-first-matter').getAttribute('href')).toBe('/intake?create=1&clientId=5');
  });

  it('preselects the client from a client profile link and lets staff change it', async () => {
    const clientList = [
      {
        id: 5, name: 'Northstar Ltd', clientType: 'business', email: 'northstar@example.test',
        phone: '555-0105', industry: 'Technology', status: 'active', owner: 'A. Morgan',
        ownerMemberId: 1, matterCount: 0, lastActivityAt: null, createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 6, name: 'Harbor Group', clientType: 'business', email: 'harbor@example.test',
        phone: '555-0106', industry: 'Shipping', status: 'active', owner: 'A. Morgan',
        ownerMemberId: 1, matterCount: 0, lastActivityAt: null, createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    mocks.useListClients.mockReturnValue({ data: clientList, isLoading: false, isError: false });

    renderAt('/intake?create=1&clientId=5');

    const clientSelect = screen.getByTestId('select-intake-client') as HTMLSelectElement;
    await waitFor(() => {
      expect(clientSelect.value).toBe('5');
      expect((screen.getByLabelText('Client / entity name') as HTMLInputElement).value).toBe('Northstar Ltd');
    });
    fireEvent.change(clientSelect, { target: { value: '6' } });

    expect(clientSelect.value).toBe('6');
    expect((screen.getByLabelText('Client / entity name') as HTMLInputElement).value).toBe('Harbor Group');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('harbor@example.test');

    fireEvent.change(clientSelect, { target: { value: '' } });
    expect((screen.getByLabelText('Client / entity name') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
  });

  it('does not preselect a client on the regular matter intake route', () => {
    mocks.useListClients.mockReturnValue({
      data: [{
        id: 5, name: 'Northstar Ltd', clientType: 'business', email: 'northstar@example.test',
        phone: '555-0105', industry: 'Technology', status: 'active', owner: 'A. Morgan',
        ownerMemberId: 1, matterCount: 0, lastActivityAt: null, createdAt: '2026-01-01T00:00:00.000Z',
      }],
      isLoading: false,
      isError: false,
    });

    renderAt('/intake?create=1');

    expect((screen.getByTestId('select-intake-client') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Client / entity name') as HTMLInputElement).value).toBe('');
  });

  it('removes the create query when staff close an intake form and keeps it closed after refresh', () => {
    renderAt('/intake?create=1&clientId=5');

    expect(screen.getByRole('dialog', { name: 'Start a client intake' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close intake' }));

    expect(window.location.search).toBe('?clientId=5');
    expect(screen.queryByRole('dialog', { name: 'Start a client intake' })).toBeNull();

    const dismissedPath = `${window.location.pathname}${window.location.search}`;
    cleanup();
    renderAt(dismissedPath);

    expect(screen.queryByRole('dialog', { name: 'Start a client intake' })).toBeNull();
  });

  it('focuses the intake dialog, traps Tab navigation, and closes with Escape', () => {
    renderAt('/intake?create=1&clientId=5');

    const dialog = screen.getByRole('dialog', { name: 'Start a client intake' });
    const clientSelect = screen.getByTestId('select-intake-client');
    const closeButton = screen.getByRole('button', { name: 'Close intake' });
    const submitButton = screen.getByTestId('button-submit-intake');
    const launcher = screen.getByTestId('button-start-intake');

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(clientSelect);

    submitButton.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submitButton);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Start a client intake' })).toBeNull();
    expect(window.location.search).toBe('?clientId=5');
    expect(document.activeElement).toBe(launcher);
  });

  it('returns keyboard focus to the button that opened intake', () => {
    renderAt('/intake');

    const launcher = screen.getByTestId('button-start-intake');
    fireEvent.click(launcher);

    const dialog = screen.getByRole('dialog', { name: 'Start a client intake' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Start a client intake' })).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it('removes the create query when staff cancel intake by clicking outside the dialog', () => {
    renderAt('/intake?create=1&firstMatter=1');

    fireEvent.mouseDown(screen.getByRole('presentation'));

    expect(window.location.search).toBe('?firstMatter=1');
    expect(screen.queryByRole('dialog', { name: 'Start a client intake' })).toBeNull();
  });

  it('asks before discarding changed intake fields and lets staff keep editing or discard', () => {
    renderAt('/intake?create=1');
    fireEvent.change(screen.getByLabelText('Client / entity name'), {
      target: { value: 'Unsaved prospect' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close intake' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved intake changes?' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'Start a client intake' })).toBeTruthy();
    expect((screen.getByLabelText('Client / entity name') as HTMLInputElement).value).toBe('Unsaved prospect');

    fireEvent.click(screen.getByRole('button', { name: 'Close intake' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog', { name: 'Start a client intake' })).toBeNull();
  });

  it('guards backdrop and Escape dismissal when intake changes are unsaved', () => {
    renderAt('/intake?create=1');
    fireEvent.change(screen.getByLabelText('Client / entity name'), {
      target: { value: 'Unsaved prospect' },
    });

    fireEvent.mouseDown(screen.getByRole('presentation'));
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved intake changes?' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Start a client intake' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved intake changes?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog', { name: 'Start a client intake' })).toBeNull();
  });

  it('does not warn when closing an unchanged saved draft', async () => {
    const draft = {
      id: 34,
      data: {
        clientId: null,
        clientName: 'Saved client',
        clientType: 'organization',
        email: 'saved@example.test',
        phone: '555-0134',
        industry: 'Technology',
        matterTitle: 'Saved matter',
        matterType: 'Advisory',
        responsibleMemberId: 1,
        dueAt: '2026-11-14',
        partyNames: ['Related party'],
        answers: { identity: 'Identity captured' },
      },
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    };
    mocks.useGetIntakeDrafts.mockReturnValue({
      data: [draft],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useGetIntakeOverview.mockReturnValue({
      data: {
        intakes: [],
        checks: [{ key: 'identity', label: 'Identity', description: 'Identity check', required: false, category: 'Review' }],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderAt('/intake');
    fireEvent.click(screen.getByTestId('button-resume-intake-draft-34'));
    await waitFor(() => {
      expect((screen.getByLabelText('Client / entity name') as HTMLInputElement).value).toBe('Saved client');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close intake' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Resume client intake draft' })).toBeNull();
  });

  it('warns before leaving the page while intake edits are unsaved', () => {
    renderAt('/intake?create=1');
    fireEvent.change(screen.getByLabelText('Client / entity name'), {
      target: { value: 'Unsaved prospect' },
    });

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('saves an incomplete intake as a draft instead of submitting it for review', () => {
    const saveDraft = vi.fn();
    const submitIntake = vi.fn();
    mocks.useCreateIntakeDraft.mockReturnValue({ mutate: saveDraft, isPending: false });
    mocks.useCreateIntake.mockReturnValue({ mutate: submitIntake, isPending: false });

    renderAt('/intake?create=1');
    fireEvent.change(screen.getByLabelText('Client / entity name'), {
      target: { value: 'Incomplete prospect' },
    });
    fireEvent.click(screen.getByTestId('button-save-intake-draft'));

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft.mock.calls[0][0].data).toMatchObject({
      clientName: 'Incomplete prospect',
      clientType: 'individual',
      matterTitle: '',
      matterType: '',
      responsibleMemberId: null,
    });
    expect(submitIntake).not.toHaveBeenCalled();
  });

  it('resumes a saved intake draft with its collected relationship and review details', async () => {
    const draft = {
      id: 34,
      data: {
        clientId: null,
        clientName: 'Saved client',
        clientType: 'organization',
        email: 'saved@example.test',
        phone: '555-0134',
        industry: 'Technology',
        matterTitle: 'Saved matter',
        matterType: 'Advisory',
        responsibleMemberId: 1,
        dueAt: '2026-11-14',
        partyNames: ['Related party'],
        answers: { identity: 'Identity captured' },
      },
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    };
    const saveDraft = vi.fn();
    mocks.useGetIntakeDrafts.mockReturnValue({
      data: [draft],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useGetIntakeOverview.mockReturnValue({
      data: {
        intakes: [],
        checks: [{ key: 'identity', label: 'Identity', description: 'Identity check', required: false, category: 'Review' }],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useUpdateIntakeDraft.mockReturnValue({ mutate: saveDraft, isPending: false });

    renderAt('/intake');
    fireEvent.click(screen.getByTestId('button-resume-intake-draft-34'));

    await waitFor(() => {
      expect((screen.getByLabelText('Client / entity name') as HTMLInputElement).value).toBe('Saved client');
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('saved@example.test');
      expect((screen.getByLabelText('Matter title') as HTMLInputElement).value).toBe('Saved matter');
      expect((screen.getByLabelText('Related parties, one per line') as HTMLTextAreaElement).value).toBe('Related party');
      expect((screen.getByLabelText('Identity') as HTMLTextAreaElement).value).toBe('Identity captured');
    });
    fireEvent.click(screen.getByTestId('button-save-intake-draft'));

    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 34, data: expect.objectContaining({
      clientName: 'Saved client',
      matterTitle: 'Saved matter',
      responsibleMemberId: 1,
      partyNames: ['Related party'],
      answers: { identity: 'Identity captured' },
    }) }), expect.any(Object));
  });

  it('refreshes client counts and related views after a matter is opened', async () => {
    mocks.useGetIntakeOverview.mockReturnValue({
      data: {
        intakes: [{
          id: 21,
          clientId: null,
          clientName: 'Northstar Ltd',
          clientType: 'business',
          email: 'client@example.test',
          matterTitle: 'Northstar acquisition',
          matterType: 'Acquisition',
          responsible: 'A. Morgan',
          dueAt: null,
          partyNames: [],
          answers: {},
          conflictFindings: [],
          status: 'cleared',
          reviewNote: 'Conflict review complete',
          reviewerClerkUserId: 'reviewer',
          openedMatterId: null,
          createdByClerkUserId: 'assistant',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
        checks: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderAt('/intake', queryClient);

    fireEvent.click(screen.getByTestId('button-open-matter-21'));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client', 5] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['activity'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/matters'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['intake'] });
    });
    expect(screen.getByRole('status').textContent).toContain('Matter opened');
  });

  it('keeps the client list matter total current after several matters open quickly', async () => {
    let openedMatterCount = 0;
    const client = {
      id: 5, name: 'Northstar Ltd', clientType: 'business', email: 'northstar@example.test',
      phone: '555-0105', industry: 'Technology', status: 'active', owner: 'A. Morgan',
      ownerMemberId: 1, matterCount: 0, lastActivityAt: null, createdAt: '2026-01-01T00:00:00.000Z',
    };
    mocks.useListClients.mockImplementation(() => ({
      data: [{ ...client, matterCount: openedMatterCount }],
      isLoading: false,
      isError: false,
    }));
    mocks.useGetIntakeOverview.mockReturnValue({
      data: {
        intakes: [21, 22, 23].map(id => ({
          id,
          clientId: 5,
          clientName: client.name,
          clientType: 'business',
          email: client.email,
          matterTitle: `Northstar matter ${id}`,
          matterType: 'Advisory',
          responsible: 'A. Morgan',
          dueAt: null,
          partyNames: [],
          answers: {},
          conflictFindings: [],
          status: 'cleared',
          reviewNote: 'Conflict review complete',
          reviewerClerkUserId: 'reviewer',
          openedMatterId: null,
          createdByClerkUserId: 'assistant',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        })),
        checks: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useOpenMatterFromIntake.mockImplementation((options: any) => ({
      mutate: (variables: any, callbacks: any) => {
        openedMatterCount += 1;
        const matter = { id: 100 + openedMatterCount, clientId: client.id };
        options?.mutation?.onSuccess?.(matter, variables, undefined, undefined);
        callbacks?.onSuccess?.(matter, variables, undefined);
      },
      isPending: false,
    }));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderAt('/intake', queryClient);

    fireEvent.click(screen.getByTestId('button-open-matter-21'));
    fireEvent.click(screen.getByTestId('button-open-matter-22'));
    fireEvent.click(screen.getByTestId('button-open-matter-23'));

    expect(invalidate.mock.calls.filter(([filters]) => (
      JSON.stringify(filters.queryKey) === JSON.stringify(['clients'])
    ))).toHaveLength(3);
    expect(invalidate.mock.calls.filter(([filters]) => (
      JSON.stringify(filters.queryKey) === JSON.stringify(['client', client.id])
    ))).toHaveLength(3);

    cleanup();
    renderAt('/clients', queryClient);

    await waitFor(() => {
      const row = screen.getByTestId(`row-client-${client.id}`);
      expect(row.textContent).toContain('3matters');
    });
  });

  it('refreshes both client matter totals when a matter is reassigned', async () => {
    mocks.useListClients.mockReturnValue({
      data: [
        { id: 5, name: 'Northstar Ltd' },
        { id: 6, name: 'Harbor Group' },
      ],
      isLoading: false,
      isError: false,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const previousClientMattersKey = getListMattersQueryKey({ clientId: 5 });
    const nextClientMattersKey = getListMattersQueryKey({ clientId: 6 });
    queryClient.setQueryData(previousClientMattersKey, [firstMatter]);
    queryClient.setQueryData(nextClientMattersKey, []);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderAt('/matters/11', queryClient);

    fireEvent.click(screen.getByTestId('button-edit-matter'));
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('button-save-matter-edit'));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client', 5] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client', 6] });
      expect(queryClient.getQueryState(previousClientMattersKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(nextClientMattersKey)?.isInvalidated).toBe(true);
    });
  });

  it('exports only selected matters in the selected PDF and audit request', async () => {
    renderAt('/matters');
    fireEvent.click(screen.getByTestId('checkbox-matter-12'));
    fireEvent.click(screen.getByTestId('button-download-selected-matters'));

    await waitFor(() => {
      expect(mocks.downloadMattersPdf).toHaveBeenCalledWith([secondMatter], 'selected');
    });
    expect(mocks.useLogMatterExportRequest.mock.results[0].value.mutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: 'selected', matterIds: [12] }),
    });
  });

  it('keeps a failed export audit retry after leaving and returning to Matters, then clears it on success', async () => {
    const mutateAsync = vi.fn()
      .mockRejectedValueOnce(new Error('Audit recording failed'))
      .mockResolvedValueOnce({});
    mocks.useLogMatterExportRequest.mockReturnValue({ mutateAsync });

    renderAt('/matters');
    fireEvent.click(screen.getByTestId('checkbox-matter-12'));
    fireEvent.click(screen.getByTestId('button-download-selected-matters'));

    const storageKey = 'clientguard.pendingMatterExportRecord.v1:1';
    await waitFor(() => expect(localStorage.getItem(storageKey)).not.toBeNull());
    const savedRetry = JSON.parse(localStorage.getItem(storageKey)!);
    expect(savedRetry).toEqual({
      scope: 'selected',
      matterIds: [12],
      exportRequestId: expect.any(String),
    });
    expect(JSON.stringify(savedRetry)).not.toContain('Northstar');
    expect(JSON.stringify(savedRetry)).not.toContain('Harbor');

    cleanup();
    renderAt('/dashboard');
    cleanup();
    mocks.useListMatters.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderAt('/matters');

    expect(await screen.findByTestId('panel-pending-matter-export-record')).toBeTruthy();
    expect(screen.getByTestId('button-retry-matter-export-record')).toBeTruthy();
    expect(mocks.downloadMattersPdf).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('button-retry-matter-export-record'));

    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[1][0]).toEqual({
      data: {
        scope: 'selected',
        matterIds: [12],
        exportRequestId: savedRetry.exportRequestId,
      },
    });
    expect(screen.queryByTestId('panel-pending-matter-export-record')).toBeNull();
    expect(mocks.downloadMattersPdf).toHaveBeenCalledTimes(1);
  });

  it('shows a PDF creation error and allows retrying with the same selected matters', async () => {
    mocks.downloadMattersPdf.mockImplementationOnce(() => {
      throw new Error('PDF creation failed');
    });
    renderAt('/matters');
    fireEvent.click(screen.getByTestId('checkbox-matter-12'));

    const exportButton = screen.getByTestId('button-download-selected-matters') as HTMLButtonElement;
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(screen.getByTestId('status-matter-pdf-error').textContent).toContain(
        'The PDF could not be created. Please try again.',
      );
      expect(exportButton.disabled).toBe(false);
    });
    expect(screen.getByTestId('text-selected-matters').textContent).toBe('1 selected');
    expect((screen.getByTestId('checkbox-matter-12') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mocks.downloadMattersPdf).toHaveBeenCalledTimes(2);
      expect(mocks.downloadMattersPdf).toHaveBeenLastCalledWith([secondMatter], 'selected');
    });
    expect(mocks.useLogMatterExportRequest.mock.results[0].value.mutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: 'selected', matterIds: [12] }),
    });
    expect(mocks.useLogMatterExportRequest.mock.results[0].value.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('does not create a PDF or audit event when all-matters export is cancelled', () => {
    renderAt('/matters');
    fireEvent.click(screen.getByTestId('button-download-all-matters'));

    expect(screen.getByRole('alertdialog', { name: 'Download every matter?' })).toBeTruthy();
    expect(screen.getByText(/2 records from across your entire firm/)).toBeTruthy();
    expect(mocks.downloadMattersPdf).not.toHaveBeenCalled();
    expect(mocks.useLogMatterExportRequest.mock.results[0].value.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-cancel-all-matters-export'));

    expect(screen.queryByRole('alertdialog', { name: 'Download every matter?' })).toBeNull();
    expect(mocks.downloadMattersPdf).not.toHaveBeenCalled();
    expect(mocks.useLogMatterExportRequest.mock.results[0].value.mutateAsync).not.toHaveBeenCalled();
  });

  it('exports every matter in the all-matters PDF and audit request after confirmation', async () => {
    renderAt('/matters');
    fireEvent.click(screen.getByTestId('button-download-all-matters'));

    expect(mocks.downloadMattersPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('button-confirm-all-matters-export'));

    await waitFor(() => {
      expect(mocks.downloadMattersPdf).toHaveBeenCalledWith([firstMatter, secondMatter], 'all');
    });
    expect(mocks.useLogMatterExportRequest.mock.results[0].value.mutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: 'all', matterIds: [11, 12] }),
    });
  });
});
