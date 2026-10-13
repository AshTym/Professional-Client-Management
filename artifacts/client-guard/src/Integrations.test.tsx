import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuthorizeWorkspaceIntegration: vi.fn(),
  useGetBillingOverview: vi.fn(),
  useGetDocumentOverview: vi.fn(),
  useListWorkspaceIntegrations: vi.fn(),
  useSyncApprovedPlannerItem: vi.fn(),
  useSyncReviewedBill: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  ...mocks,
  getGetBillingOverviewQueryKey: () => ["billing"],
  getGetDocumentOverviewQueryKey: () => ["documents"],
  getListWorkspaceIntegrationsQueryKey: () => ["integrations"],
}));

import Integrations from "./Integrations";

function renderIntegrations() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Integrations />
    </QueryClientProvider>,
  );
}

describe("provider integration setup state", () => {
  beforeEach(() => {
    mocks.useListWorkspaceIntegrations.mockReturnValue({
      data: [
        { provider: "google", connected: true, ready: false, accountLabel: "Google account", lastSyncAt: null },
        { provider: "microsoft", connected: false, ready: false, accountLabel: "Microsoft 365", lastSyncAt: null },
        { provider: "xero", connected: false, ready: false, accountLabel: "Xero", lastSyncAt: null },
        { provider: "quickbooks", connected: false, ready: false, accountLabel: "QuickBooks Online", lastSyncAt: null },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useGetDocumentOverview.mockReturnValue({ data: { plannerItems: [] } });
    mocks.useGetBillingOverview.mockReturnValue({ data: { drafts: [] } });
    mocks.useAuthorizeWorkspaceIntegration.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mocks.useSyncApprovedPlannerItem.mockReturnValue({ mutate: vi.fn() });
    mocks.useSyncReviewedBill.mockReturnValue({ mutate: vi.fn() });
  });

  afterEach(() => cleanup());

  it("explains incomplete setup and disables connection and sync actions", () => {
    renderIntegrations();

    for (const provider of ["google", "microsoft", "xero", "quickbooks"]) {
      expect(screen.getByTestId(`integration-${provider}-setup`).textContent).toContain(
        "A ClientGuard administrator must add this provider’s OAuth app credentials and the token-encryption key to Replit Secrets",
      );
      expect((screen.getByTestId(`button-connect-${provider}`) as HTMLButtonElement).disabled).toBe(true);
    }

    expect(screen.getByText("Connected").textContent).toBe("Connected");
    expect(screen.getByText("Sync is unavailable until provider setup is complete.").textContent).toBe(
      "Sync is unavailable until provider setup is complete.",
    );
  });
});
