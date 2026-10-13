import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';

const apiMocks = vi.hoisted(() => ({
  useGetDashboard: vi.fn(),
  useGetWorkspace: vi.fn(),
  useCreateWorkspace: vi.fn(),
  useListActivity: vi.fn(),
  useListClients: vi.fn(),
  useCreateClient: vi.fn(),
  useGetIntakeOverview: vi.fn(),
  useCreateIntake: vi.fn(),
  useSaveIntakeChecks: vi.fn(),
  useListWorkspaceAssignmentMembers: vi.fn(),
  useOpenMatterFromIntake: vi.fn(),
  useReviewIntake: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  ...apiMocks,
  getGetDashboardQueryKey: () => ['dashboard'],
  getGetWorkspaceQueryKey: () => ['workspace'],
  getListActivityQueryKey: () => ['activity'],
  getListClientsQueryKey: () => ['clients'],
  getGetIntakeOverviewQueryKey: () => ['intake'],
}));

import { ClientsPage, Dashboard, SetupPage } from './App';
import Intake from './Intake';

function renderDashboard(initialPath = '/dashboard') {
  window.history.replaceState({}, '', initialPath);
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
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
}

describe('new-firm dashboard onboarding', () => {
  beforeEach(() => {
    apiMocks.useGetDashboard.mockReturnValue({
      data: {
        clientCount: 0,
        matterCount: 0,
        activeClientCount: 0,
        openMatterCount: 0,
        overdueMatterCount: 0,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMocks.useGetWorkspace.mockReturnValue({
      data: { workspace: null },
      isLoading: false,
    });
    apiMocks.useCreateWorkspace.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    apiMocks.useListActivity.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMocks.useListClients.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMocks.useCreateClient.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    apiMocks.useGetIntakeOverview.mockReturnValue({
      data: { intakes: [], checks: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMocks.useCreateIntake.mockReturnValue({ mutate: vi.fn(), isPending: false });
    apiMocks.useSaveIntakeChecks.mockReturnValue({ mutate: vi.fn(), isPending: false });
    apiMocks.useListWorkspaceAssignmentMembers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMocks.useOpenMatterFromIntake.mockReturnValue({ mutate: vi.fn(), isPending: false });
    apiMocks.useReviewIntake.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  afterEach(() => cleanup());

  it('shows the first-client prompt and opens the create-client dialog from its link', () => {
    renderDashboard();

    expect(screen.getByTestId('dashboard-empty-onboarding')).toBeTruthy();
    expect(screen.getByText('Start with your first client.')).toBeTruthy();
    const firstClientLink = screen.getByTestId('link-create-first-client');
    expect(firstClientLink.getAttribute('href')).toBe('/clients?create=1');

    fireEvent.click(firstClientLink);

    expect(screen.getByRole('dialog', { name: 'Add a client' })).toBeTruthy();
    expect(screen.getByTestId('input-client-name')).toBeTruthy();
  });

  it('shows the first-matter prompt for firms with clients and opens the intake form', async () => {
    apiMocks.useGetDashboard.mockReturnValue({
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

    renderDashboard();

    expect(screen.getByTestId('dashboard-first-matter-onboarding')).toBeTruthy();
    const firstMatterLink = screen.getByTestId('link-create-first-matter');
    expect(firstMatterLink.getAttribute('href')).toBe('/intake?create=1');

    fireEvent.click(firstMatterLink);

    expect(await screen.findByRole('dialog', { name: 'Start a client intake' })).toBeTruthy();
    expect(screen.getByTestId('button-submit-intake')).toBeTruthy();
  });

  it('keeps the regular dashboard layout for firms that already have records', () => {
    apiMocks.useGetDashboard.mockReturnValue({
      data: {
        clientCount: 1,
        matterCount: 1,
        activeClientCount: 1,
        openMatterCount: 1,
        overdueMatterCount: 0,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderDashboard();

    expect(screen.getByTestId('metric-clients')).toBeTruthy();
    expect(screen.getByText('Recent activity')).toBeTruthy();
    expect(screen.getByText('Keep work moving.')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-empty-onboarding')).toBeNull();
    expect(screen.queryByTestId('dashboard-first-matter-onboarding')).toBeNull();
  });

  it('shows an activity error and retries without hiding dashboard metrics or navigation', () => {
    const refetchActivity = vi.fn();
    apiMocks.useGetDashboard.mockReturnValue({
      data: {
        clientCount: 3,
        matterCount: 2,
        activeClientCount: 2,
        openMatterCount: 1,
        overdueMatterCount: 0,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMocks.useListActivity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchActivity,
    });

    renderDashboard();

    expect(screen.getByRole('alert').textContent).toContain('Activity could not be loaded.');
    expect(screen.getByTestId('metric-clients')).toBeTruthy();
    expect(screen.getByTestId('metric-open-matters')).toBeTruthy();
    expect(screen.getByTestId('link-dashboard-activity')).toBeTruthy();
    expect(screen.getByTestId('quick-clients')).toBeTruthy();
    expect(screen.getByTestId('quick-matters')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry activity' }));

    expect(refetchActivity).toHaveBeenCalledTimes(1);
  });

  it('keeps firm details and offers a retry when workspace setup fails', () => {
    const mutate = vi.fn();
    apiMocks.useCreateWorkspace.mockReturnValue({ mutate, isPending: false });
    window.history.replaceState({}, '', '/workspace/setup');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <SetupPage />
        </Router>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByTestId('input-workspace-name'), {
      target: { value: 'Northline Advisory' },
    });
    fireEvent.click(screen.getByTestId('button-create-workspace'));

    const firstRequest = mutate.mock.calls[0];
    expect(firstRequest[0]).toEqual({
      data: { name: 'Northline Advisory', practiceType: 'law' },
    });
    act(() => {
      firstRequest[1].onError(new Error('database connection string must stay private'));
    });

    expect(screen.getByRole('alert').textContent).toContain(
      "We couldn't save your firm workspace. Your details are still here.",
    );
    expect((screen.getByTestId('input-workspace-name') as HTMLInputElement).value).toBe(
      'Northline Advisory',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
