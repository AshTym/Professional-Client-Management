import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useGetIntakeDrafts: vi.fn(),
  useCreateIntake: vi.fn(),
  useCreateIntakeDraft: vi.fn(),
  useUpdateIntakeDraft: vi.fn(),
  useDeleteIntakeDraft: vi.fn(),
  useSubmitIntakeDraft: vi.fn(),
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
  getGetIntakeDraftsQueryKey: () => ['intake-drafts'],
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
    apiMocks.useGetIntakeDrafts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMocks.useCreateIntake.mockReturnValue({ mutate: vi.fn(), isPending: false });
    apiMocks.useCreateIntakeDraft.mockReturnValue({ mutate: vi.fn(), isPending: false });
    apiMocks.useUpdateIntakeDraft.mockReturnValue({ mutate: vi.fn(), isPending: false });
    apiMocks.useDeleteIntakeDraft.mockReturnValue({ mutate: vi.fn(), isPending: false });
    apiMocks.useSubmitIntakeDraft.mockReturnValue({ mutate: vi.fn(), isPending: false });
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
    apiMocks.useListClients.mockReturnValue({
      data: [{
        id: 5,
        name: 'Northstar Ltd',
        clientType: 'business',
        email: 'northstar@example.test',
        phone: '555-0105',
        industry: 'Technology',
        status: 'active',
        owner: 'A. Morgan',
        ownerMemberId: 1,
        matterCount: 0,
        lastActivityAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
      isLoading: false,
      isError: false,
    });

    renderDashboard();

    expect(screen.getByTestId('dashboard-first-matter-onboarding')).toBeTruthy();
    const firstMatterLink = screen.getByTestId('link-create-first-matter');
    expect(firstMatterLink.getAttribute('href')).toBe('/intake?create=1&firstMatter=1');

    fireEvent.click(firstMatterLink);

    expect(await screen.findByRole('dialog', { name: 'Start a client intake' })).toBeTruthy();
    expect(screen.getByTestId('button-submit-intake')).toBeTruthy();
    const clientSelect = screen.getByTestId('select-intake-client') as HTMLSelectElement;
    await waitFor(() => {
      expect(clientSelect.value).toBe('5');
      expect((screen.getByLabelText('Client / entity name') as HTMLInputElement).value).toBe('Northstar Ltd');
    });

    fireEvent.change(clientSelect, { target: { value: '' } });
    expect(clientSelect.value).toBe('');
    expect((screen.getByLabelText('Client / entity name') as HTMLInputElement).value).toBe('');
  });

  it('leaves the client choice blank from the first-matter prompt when a firm has multiple clients', async () => {
    apiMocks.useGetDashboard.mockReturnValue({
      data: {
        clientCount: 2,
        matterCount: 0,
        activeClientCount: 2,
        openMatterCount: 0,
        overdueMatterCount: 0,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    apiMocks.useListClients.mockReturnValue({
      data: [
        { id: 5, name: 'Northstar Ltd', clientType: 'business', email: 'northstar@example.test' },
        { id: 6, name: 'Harbor Group', clientType: 'business', email: 'harbor@example.test' },
      ],
      isLoading: false,
      isError: false,
    });

    renderDashboard();
    fireEvent.click(screen.getByTestId('link-create-first-matter'));

    expect(await screen.findByRole('dialog', { name: 'Start a client intake' })).toBeTruthy();
    const clientSelect = screen.getByTestId('select-intake-client') as HTMLSelectElement;
    await waitFor(() => expect(clientSelect.value).toBe(''));
    expect(clientSelect.options).toHaveLength(3);
    fireEvent.change(clientSelect, { target: { value: '6' } });
    expect(clientSelect.value).toBe('6');
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

  it('renders dashboard metrics and navigation while recent activity is loading', () => {
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
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    renderDashboard();

    expect(screen.getByTestId('metric-clients')).toBeTruthy();
    expect(screen.getByTestId('metric-open-matters')).toBeTruthy();
    expect(screen.getByTestId('button-dashboard-create-client')).toBeTruthy();
    expect(screen.getByTestId('quick-clients')).toBeTruthy();
    expect(screen.getByText('Recent activity')).toBeTruthy();
    expect(screen.getByTestId('dashboard-activity-loading')).toBeTruthy();
    expect(screen.queryByTestId('loading-skeleton')).toBeNull();
  });

  it('keeps the full-page loading state while both dashboard queries are loading', () => {
    apiMocks.useGetDashboard.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    apiMocks.useListActivity.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    renderDashboard();

    expect(screen.getByTestId('loading-skeleton').getAttribute('aria-label')).toBe(
      'Loading firm overview',
    );
    expect(screen.queryByTestId('metric-clients')).toBeNull();
    expect(screen.queryByTestId('dashboard-activity-loading')).toBeNull();
  });

  it('shows a pending activity retry, prevents duplicates, and returns to the activity list', async () => {
    let resolveRefetch!: () => void;
    const pendingRefetch = new Promise<void>((resolve) => {
      resolveRefetch = resolve;
    });
    const refetchActivity = vi.fn(() => pendingRefetch);
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

    const view = renderDashboard();

    expect(screen.getByRole('alert').textContent).toContain('Activity could not be loaded.');
    expect(screen.getByTestId('metric-clients')).toBeTruthy();
    expect(screen.getByTestId('metric-open-matters')).toBeTruthy();
    expect(screen.getByTestId('link-dashboard-activity')).toBeTruthy();
    expect(screen.getByTestId('quick-clients')).toBeTruthy();
    expect(screen.getByTestId('quick-matters')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry activity' }));

    expect(refetchActivity).toHaveBeenCalledTimes(1);
    const retryButton = screen.getByRole('button', { name: 'Reloading activity' }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(true);
    expect(retryButton.textContent).toBe('Reloading…');
    fireEvent.click(retryButton);
    expect(refetchActivity).toHaveBeenCalledTimes(1);

    apiMocks.useListActivity.mockReturnValue({
      data: {
        items: [{
          id: 'activity-1',
          actor: 'Taylor',
          action: 'updated',
          entityType: 'client',
          entityId: 42,
          entityLabel: 'Harbor Co',
          occurredAt: '2026-10-13T10:00:00.000Z',
        }],
      },
      isLoading: false,
      isError: false,
      refetch: refetchActivity,
    });
    await act(async () => {
      resolveRefetch();
      await pendingRefetch;
    });

    expect(view.getByTestId('activity-item-activity-1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reloading activity' })).toBeNull();
  });

  it('recovers from an uncertain setup save and opens the completed workspace', () => {
    const mutate = vi.fn();
    apiMocks.useCreateWorkspace.mockReturnValue({ mutate, isPending: false });
    window.history.replaceState({}, '', '/workspace/setup');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <Switch>
            <Route path="/workspace/setup" component={SetupPage} />
            <Route path="/dashboard" component={Dashboard} />
          </Switch>
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

    const savedContext = {
      userId: 'owner-1',
      email: 'owner@example.test',
      name: 'Test Owner',
      workspace: {
        id: 48,
        name: 'Northline Advisory',
        practiceType: 'law' as const,
        createdAt: new Date('2026-10-14T00:00:00.000Z'),
      },
      role: 'owner' as const,
    };
    act(() => {
      mutate.mock.calls[1][1].onSuccess(savedContext);
    });

    expect(queryClient.getQueryData(['workspace'])).toEqual(savedContext);
    expect(window.location.pathname).toBe('/dashboard');
    expect(screen.getByTestId('dashboard-empty-onboarding')).toBeTruthy();
    expect(screen.getByText('Good morning.')).toBeTruthy();
  });
});
