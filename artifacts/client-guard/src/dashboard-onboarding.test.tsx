import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';

const apiMocks = vi.hoisted(() => ({
  useGetDashboard: vi.fn(),
  useListActivity: vi.fn(),
  useListClients: vi.fn(),
  useCreateClient: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  ...apiMocks,
  getGetDashboardQueryKey: () => ['dashboard'],
  getListActivityQueryKey: () => ['activity'],
  getListClientsQueryKey: () => ['clients'],
}));

import { ClientsPage, Dashboard } from './App';

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
  });
});
