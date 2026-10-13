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
  useLogMatterExportRequest: vi.fn(),
  useGetIntakeOverview: vi.fn(),
  useSaveIntakeChecks: vi.fn(),
  useCreateIntake: vi.fn(),
  useReviewIntake: vi.fn(),
  useOpenMatterFromIntake: vi.fn(),
  downloadMattersPdf: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  ...mocks,
  getGetDashboardQueryKey: () => ['dashboard'],
  getListActivityQueryKey: () => ['activity'],
  getListClientsQueryKey: () => ['clients'],
  getGetIntakeOverviewQueryKey: () => ['intake'],
  getListMattersQueryKey: () => ['matters'],
}));

vi.mock('./lib/matters-pdf', () => ({
  downloadMattersPdf: mocks.downloadMattersPdf,
}));

import { ClientsPage, Dashboard, MattersPage } from './App';
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

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/clients" component={ClientsPage} />
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
    mocks.useLogMatterExportRequest.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    });
    mocks.useGetIntakeOverview.mockReturnValue({
      data: { intakes: [], checks: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useSaveIntakeChecks.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useCreateIntake.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useReviewIntake.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useOpenMatterFromIntake.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  afterEach(() => cleanup());

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

  it('exports only selected matters in the selected PDF and audit request', async () => {
    renderAt('/matters');
    fireEvent.click(screen.getByTestId('checkbox-matter-12'));
    fireEvent.click(screen.getByTestId('button-download-selected-matters'));

    await waitFor(() => {
      expect(mocks.downloadMattersPdf).toHaveBeenCalledWith([secondMatter], 'selected');
    });
    expect(mocks.useLogMatterExportRequest.mock.results[0].value.mutateAsync).toHaveBeenCalledWith({
      data: { scope: 'selected', matterIds: [12] },
    });
  });

  it('exports every matter in the all-matters PDF and audit request', async () => {
    renderAt('/matters');
    fireEvent.click(screen.getByTestId('button-download-all-matters'));

    await waitFor(() => {
      expect(mocks.downloadMattersPdf).toHaveBeenCalledWith([firstMatter, secondMatter], 'all');
    });
    expect(mocks.useLogMatterExportRequest.mock.results[0].value.mutateAsync).toHaveBeenCalledWith({
      data: { scope: 'all', matterIds: [11, 12] },
    });
  });
});
