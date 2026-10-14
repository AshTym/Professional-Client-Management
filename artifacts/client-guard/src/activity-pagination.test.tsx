import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';

const apiMocks = vi.hoisted(() => ({
  useListActivity: vi.fn(),
  useListActivityActors: vi.fn(),
  getListActivityQueryKey: vi.fn((params) => ['/api/activity', params]),
  useListWorkspaceAssignmentMembers: vi.fn(),
  useListClients: vi.fn(),
  useListMatters: vi.fn(),
  exportActivity: vi.fn(),
  eventTotal: 41,
  filteredEventTotal: 43,
}));
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

vi.mock('@workspace/api-client-react', () => ({
  ...apiMocks,
}));

import { ActivityPage } from './App';

function event(
  id: number,
  overrides: {
    actor?: string;
    entityType?: string;
    entityId?: number;
    entityLabel?: string;
  } = {},
) {
  return {
    id,
    actor: 'A. Morgan',
    action: 'updated',
    entityType: 'workspace',
    entityId: 1,
    entityLabel: `Record ${id}`,
    occurredAt: '2026-10-13T10:00:00.000Z',
    ...overrides,
  };
}

function renderActivityPage() {
  window.history.replaceState({}, '', '/activity');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <Router>
        <ActivityPage />
      </Router>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, rerenderActivity: () => view.rerender(tree()) };
}

describe('activity pagination', () => {
  beforeEach(() => {
    apiMocks.exportActivity.mockReset().mockResolvedValue('');
    apiMocks.eventTotal = 41;
    apiMocks.filteredEventTotal = 43;
    apiMocks.useListActivity.mockImplementation(
      ({ limit, offset, snapshotId, actorName, entityType, entityId }) => {
        const isFilteredRecord =
          actorName === 'Former Teammate' && entityType === 'client' && entityId === 10;
        const matchingEventTotal = isFilteredRecord
          ? apiMocks.filteredEventTotal
          : apiMocks.eventTotal;
        const currentSnapshot = snapshotId ?? matchingEventTotal;
        const newestEventId = Math.min(matchingEventTotal, currentSnapshot);
        return {
          data: {
            items: Array.from(
              { length: Math.min(limit, Math.max(0, newestEventId - offset)) },
              (_, index) =>
                event(
                  newestEventId - offset - index,
                  isFilteredRecord
                    ? {
                        actor: 'Former Teammate',
                        entityType: 'client',
                        entityId: 10,
                        entityLabel: 'Northline Client',
                      }
                    : {},
                ),
            ),
            snapshotId: currentSnapshot,
            latestSnapshotId: matchingEventTotal,
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      },
    );
    apiMocks.useListWorkspaceAssignmentMembers.mockReturnValue({
      data: [{ id: 5, name: 'A. Morgan' }],
      isLoading: false,
      isError: false,
    });
    apiMocks.useListActivityActors.mockReturnValue({
      data: [{ name: 'A. Morgan' }, { name: 'Former Teammate' }],
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

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('exports the complete history with the active filters', async () => {
    const csv = '"id","actor","action"\r\n"1","A. Morgan","updated"\r\n';
    apiMocks.exportActivity.mockResolvedValue(csv);
    const createObjectURL = vi.fn(() => 'blob:activity-export');
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    renderActivityPage();
    fireEvent.change(screen.getByTestId('select-activity-actor'), {
      target: { value: 'A. Morgan' },
    });
    fireEvent.change(screen.getByTestId('select-activity-record'), {
      target: { value: 'client:10' },
    });
    fireEvent.change(screen.getByTestId('input-activity-start-date'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByTestId('input-activity-end-date'), {
      target: { value: '2026-10-14' },
    });
    fireEvent.click(screen.getByTestId('button-export-activity'));

    await waitFor(() => expect(apiMocks.exportActivity).toHaveBeenCalledWith({
      snapshotId: 41,
      actorName: 'A. Morgan',
      entityType: 'client',
      entityId: 10,
      startDate: '2026-10-01',
      endDate: '2026-10-14',
    }));
    await screen.findByText('Activity history downloaded.');
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:activity-export');
  });

  it('shows a retry message when the activity export fails', async () => {
    apiMocks.exportActivity.mockRejectedValue(new Error('request failed'));
    renderActivityPage();
    fireEvent.click(screen.getByTestId('button-export-activity'));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Activity history could not be exported. Please try again.',
    );
  });

  it('requests the next offset, returns to the prior page, and shows the end of history', () => {
    renderActivityPage();

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 0, snapshotId: 41 }),
      expect.any(Object),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 1–40');
    expect(screen.getByTestId('button-activity-previous').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('button-activity-next').hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByTestId('button-activity-next'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 40, snapshotId: 41 }),
      expect.any(Object),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 41–41');
    expect(screen.getByTestId('text-activity-page-status').textContent).toBe(
      'End of activity history · Page 2',
    );
    expect(screen.getByTestId('button-activity-previous').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('button-activity-next').hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByTestId('button-activity-previous'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 0, snapshotId: 41 }),
      expect.any(Object),
    );
  });

  it('keeps the displayed snapshot stable and offers refresh when newer activity arrives', () => {
    const { rerenderActivity } = renderActivityPage();

    expect(screen.queryByTestId('status-new-activity')).toBeNull();
    expect(screen.getByText('Record 41')).toBeTruthy();

    apiMocks.eventTotal = 43;
    rerenderActivity();

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 0, snapshotId: 41 }),
      expect.objectContaining({ query: expect.objectContaining({ refetchInterval: 30_000 }) }),
    );
    expect(screen.getByTestId('status-new-activity')).toBeTruthy();
    expect(screen.getByText('Record 41')).toBeTruthy();
    expect(screen.queryByText('Record 43')).toBeNull();

    fireEvent.click(screen.getByTestId('button-load-new-activity'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 0, snapshotId: 43 }),
      expect.any(Object),
    );
    expect(screen.queryByTestId('status-new-activity')).toBeNull();
    expect(screen.getByText('Record 43')).toBeTruthy();
  });

  it.each([20, 40, 80])(
    'shows the end of history without an extra page when exactly %i events fill a page',
    (pageSize) => {
      apiMocks.eventTotal = pageSize;
      renderActivityPage();

      if (pageSize !== 40) {
        fireEvent.change(screen.getByTestId('select-activity-limit'), {
          target: { value: String(pageSize) },
        });
      }

      expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: pageSize + 1, offset: 0, snapshotId: pageSize }),
        expect.any(Object),
      );
      expect(screen.getByTestId('text-activity-count').textContent).toBe(
        `Events 1–${pageSize}`,
      );
      expect(screen.getByTestId('text-activity-page-status').textContent).toBe(
        'End of activity history · Page 1',
      );
      expect(screen.getByTestId('button-activity-next').hasAttribute('disabled')).toBe(true);

      fireEvent.click(screen.getByTestId('button-activity-next'));

      expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: pageSize + 1, offset: 0, snapshotId: pageSize }),
        expect.any(Object),
      );
      expect(screen.getByTestId('text-activity-count').textContent).toBe(
        `Events 1–${pageSize}`,
      );
    },
  );

  it('resets to the first page when the page size changes', () => {
    renderActivityPage();
    fireEvent.click(screen.getByTestId('button-activity-next'));

    fireEvent.change(screen.getByTestId('select-activity-limit'), {
      target: { value: '20' },
    });

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 21, offset: 0, snapshotId: 41 }),
      expect.any(Object),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 1–20');
  });

  it('filters by current or former actor name and record and resets pagination', () => {
    renderActivityPage();
    expect(screen.getByRole('option', { name: 'Former Teammate' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-activity-next'));
    fireEvent.change(screen.getByTestId('select-activity-actor'), {
      target: { value: 'Former Teammate' },
    });

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 41,
        offset: 0,
        snapshotId: 41,
        actorName: 'Former Teammate',
      }),
      expect.any(Object),
    );

    fireEvent.change(screen.getByTestId('select-activity-record'), {
      target: { value: 'client:10' },
    });

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 41,
        offset: 0,
        snapshotId: 43,
        actorName: 'Former Teammate',
        entityType: 'client',
        entityId: 10,
      }),
      expect.any(Object),
    );
  });

  it('keeps teammate and record filters on forward and backward pages with filtered ranges', () => {
    renderActivityPage();
    fireEvent.change(screen.getByTestId('select-activity-actor'), {
      target: { value: 'Former Teammate' },
    });
    fireEvent.change(screen.getByTestId('select-activity-record'), {
      target: { value: 'client:10' },
    });

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 41,
        offset: 0,
        snapshotId: 43,
        actorName: 'Former Teammate',
        entityType: 'client',
        entityId: 10,
      }),
      expect.any(Object),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 1–40');
    expect(screen.getByTestId('text-activity-page-status').textContent).toBe('Page 1');
    expect(screen.getByTestId('activity-item-43').textContent).toContain(
      'Former Teammate updated Northline Client',
    );

    fireEvent.click(screen.getByTestId('button-activity-next'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 41,
        offset: 40,
        snapshotId: 43,
        actorName: 'Former Teammate',
        entityType: 'client',
        entityId: 10,
      }),
      expect.any(Object),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 41–43');
    expect(screen.getByTestId('text-activity-page-status').textContent).toBe(
      'End of activity history · Page 2',
    );
    expect(screen.getByTestId('activity-item-3').textContent).toContain(
      'Former Teammate updated Northline Client',
    );

    fireEvent.click(screen.getByTestId('button-activity-previous'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 41,
        offset: 0,
        snapshotId: 43,
        actorName: 'Former Teammate',
        entityType: 'client',
        entityId: 10,
      }),
      expect.any(Object),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 1–40');
    expect(screen.getByTestId('text-activity-page-status').textContent).toBe('Page 1');
  });

  it('keeps later pages on the starting snapshot and refreshes to include newer events', () => {
    renderActivityPage();
    expect(screen.getByTestId('activity-item-41')).toBeTruthy();
    expect(screen.queryByTestId('activity-item-42')).toBeNull();

    apiMocks.eventTotal = 43;
    fireEvent.click(screen.getByTestId('button-activity-next'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 41, offset: 40, snapshotId: 41 }),
      expect.any(Object),
    );
    expect(screen.getByTestId('activity-item-1')).toBeTruthy();
    expect(screen.queryByTestId('activity-item-42')).toBeNull();

    fireEvent.click(screen.getByTestId('button-refresh-activity'));
    expect(screen.getByTestId('activity-item-43')).toBeTruthy();
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 1–40');
  });

  it('recovers from a later page after filtered history shrinks without changing page size or filters', () => {
    const { rerenderActivity } = renderActivityPage();
    fireEvent.change(screen.getByTestId('select-activity-limit'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByTestId('select-activity-actor'), {
      target: { value: 'Former Teammate' },
    });
    fireEvent.change(screen.getByTestId('select-activity-record'), {
      target: { value: 'client:10' },
    });
    fireEvent.click(screen.getByTestId('button-activity-next'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 21,
        offset: 20,
        snapshotId: 43,
        actorName: 'Former Teammate',
        entityType: 'client',
        entityId: 10,
      }),
      expect.any(Object),
    );

    apiMocks.filteredEventTotal = 15;
    rerenderActivity();

    expect(screen.getByTestId('activity-page-out-of-range')).toBeTruthy();
    expect(screen.getByTestId('select-activity-limit')).toHaveProperty('value', '20');
    expect(screen.getByTestId('select-activity-actor')).toHaveProperty(
      'value',
      'Former Teammate',
    );
    expect(screen.getByTestId('select-activity-record')).toHaveProperty('value', 'client:10');

    fireEvent.click(screen.getByTestId('button-activity-recover-page'));

    expect(apiMocks.useListActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 21,
        offset: 0,
        snapshotId: 43,
        actorName: 'Former Teammate',
        entityType: 'client',
        entityId: 10,
      }),
      expect.any(Object),
    );
    expect(screen.getByTestId('text-activity-count').textContent).toBe('Events 1–15');
  });

  it('distinguishes an empty filtered result from an empty audit trail', () => {
    apiMocks.useListActivity.mockReturnValue({
      data: { items: [], snapshotId: 41 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderActivityPage();

    expect(screen.getByText('No recorded events')).toBeTruthy();

    fireEvent.change(screen.getByTestId('select-activity-actor'), {
      target: { value: 'A. Morgan' },
    });

    expect(screen.getByText('No matching activity')).toBeTruthy();
  });
});
