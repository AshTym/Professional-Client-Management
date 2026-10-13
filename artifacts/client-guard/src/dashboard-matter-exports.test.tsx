import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';

const mocks = vi.hoisted(() => ({
  useGetDashboard: vi.fn(),
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
  useGetClient: vi.fn(),
  useSaveIntakeChecks: vi.fn(),
  useCreateIntake: vi.fn(),
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
  getListMattersQueryKey: () => ['matters'],
}));

vi.mock('./lib/matters-pdf', () => ({
  downloadMattersPdf: mocks.downloadMattersPdf,
}));
vi.mock('./PortalInvitation', () => ({ default: () => null }));
vi.mock('./MatterCloseout', () => ({ default: () => null }));

import { ClientDetail, ClientsPage, Dashboard, MatterDetail, MattersPage } from './App';
import Intake from './Intake';

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
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['matters'] });
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
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderAt('/matters/11', queryClient);

    fireEvent.click(screen.getByTestId('button-edit-matter'));
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('button-save-matter-edit'));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['clients'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client', 5] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client', 6] });
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
