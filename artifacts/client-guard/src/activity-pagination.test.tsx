import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';

const apiMocks = vi.hoisted(() => ({
  useListActivity: vi.fn(),
  useListWorkspaceAssignmentMembers: vi.fn(),
  useListClients: vi.fn(),
  useListMatters: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  ...apiMocks,
}));

import { ActivityPage } from './App';

function event(id: number) {
  return {
    id,
    actor: 'A. Morgan',
    action: 'updated',
    entityType: 'workspace',
    entityId: 1,
    entityLabel: `Record ${id}`,
    occurredAt: '2026-10-13T10:00:00.000Z',
  };
}

function renderActivityPage() {
  window.history.replaceState({}, '', '/activity');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <ActivityPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe('activity pagination', () => {
  beforeEach(() => {
    apiMocks.useListActivity.mockImplementation(({ limit, offset }) => ({
      data: Array.from({ length: offset === 0 ? limit : 1 }, (_, index) =>
        event(offset + index + 1),
      ),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));
    apiMocks.useListWorkspaceAssignmentMembers.mockReturnValue({
      data: [{ id: 5, name: 'A. Morgan' }],
      isLoading: false,
      isError: false,
    });
    apiMocks.useListClients.mockReturnValue({
      data: [{ id: 10, name: 'Northline Client' }],
      isLoading: false,
      isError: false,
    });
    apiMocks.useListMatters.mockReturnValue({
      data: [{ id: 20, title: 'Advisory Review', clientName: 'Northline Client' }],
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => cleanup());

  it('requests the next offset, returns to the prior page, and shows the end of history', () => {
    renderActivityPage();

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 0 }),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 1–40');
    expect(screen.getByTestId('button-activity-previous').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('button-activity-next').hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByTestId('button-activity-next'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 40 }),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 41–41');
    expect(screen.getByTestId('text-activity-page-status').textContent).toBe(
      'End of activity history · Page 2',
    );
    expect(screen.getByTestId('button-activity-previous').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('button-activity-next').hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByTestId('button-activity-previous'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 0 }),
    );
  });

  it('resets to the first page when the page size changes', () => {
    renderActivityPage();
    fireEvent.click(screen.getByTestId('button-activity-next'));

    fireEvent.change(screen.getByTestId('select-activity-limit'), {
      target: { value: '20' },
    });

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 21, offset: 0 }),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 1–20');
  });

  it('filters by teammate and record and resets pagination when the filter changes', () => {
    renderActivityPage();
    fireEvent.click(screen.getByTestId('button-activity-next'));
    fireEvent.change(screen.getByTestId('select-activity-actor'), {
      target: { value: '5' },
    });

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 0, actorMemberId: 5 }),
    );

    fireEvent.change(screen.getByTestId('select-activity-record'), {
      target: { value: 'client:10' },
    });

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 41,
        offset: 0,
        actorMemberId: 5,
        entityType: 'client',
        entityId: 10,
      }),
    );
  });

  it('distinguishes an empty filtered result from an empty audit trail', () => {
    apiMocks.useListActivity.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderActivityPage();

    expect(screen.getByText('No recorded events')).toBeTruthy();

    fireEvent.change(screen.getByTestId('select-activity-actor'), {
      target: { value: '5' },
    });

    expect(screen.getByText('No matching activity')).toBeTruthy();
  });
});
