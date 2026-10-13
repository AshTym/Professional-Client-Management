import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useListWorkspaceMembershipConflicts: vi.fn(),
  useListWorkspaceMembers: vi.fn(),
  useGetWorkspaceMemberAssignments: vi.fn(),
  useResolveWorkspaceMembershipConflict: vi.fn(),
  resolveMutate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  ...mocks,
  getListWorkspaceMembershipConflictsQueryKey: () => ["/api/workspace/membership-conflicts"],
  getListWorkspaceMembersQueryKey: () => ["/api/workspace/members"],
  getGetWorkspaceMemberAssignmentsQueryKey: (id: number) => [
    `/api/workspace/members/${id}/assignments`,
  ],
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "admin@example.test" } },
  }),
}));

import MembershipConflicts from "./MembershipConflicts";

const conflict = {
  membershipId: 42,
  memberName: "Shared Person",
  email: "shared@example.test",
  role: "advisor",
  firmName: "Current Firm",
  otherFirmCount: 1,
  otherMembershipCount: 1,
  lastDecision: null,
  lastDecisionBy: null,
  lastDecisionAt: null,
  lastDecisionReason: null,
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MembershipConflicts />
    </QueryClientProvider>,
  );
}

describe("firm membership conflict review", () => {
  beforeEach(() => {
    mocks.useListWorkspaceMembershipConflicts.mockReturnValue({
      data: [conflict],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useListWorkspaceMembers.mockReturnValue({
      data: [
        {
          id: 1,
          name: "Firm Owner",
          email: "owner@example.test",
          role: "owner",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: 17,
          name: "Replacement Teammate",
          email: "replacement@example.test",
          role: "professional",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useGetWorkspaceMemberAssignments.mockReturnValue({
      data: {
        clients: [{ id: 4, name: "Current Firm Client" }],
        intakes: [
          {
            id: 12,
            clientName: "Current Firm Intake Client",
            matterTitle: "Current Firm Pending Intake",
            status: "review_required",
          },
        ],
        matters: [
          {
            id: 9,
            title: "Current Firm Matter",
            reference: "MAT-9",
            clientName: "Current Firm Client",
          },
        ],
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    mocks.resolveMutate.mockImplementation((_variables, callbacks) => {
      (callbacks as { onSuccess?: () => void } | undefined)?.onSuccess?.();
    });
    mocks.useResolveWorkspaceMembershipConflict.mockReturnValue({
      mutate: mocks.resolveMutate,
      isPending: false,
      isError: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("removes only this firm's access after recording a reason and assignment replacement", async () => {
    renderPanel();

    expect(screen.getByTestId("card-membership-conflict-42").textContent).toContain(
      "Current Firm",
    );
    expect(screen.getByText("Other firms")).toBeTruthy();
    expect(screen.getByText("Other memberships")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Confidential Other Firm");

    fireEvent.click(screen.getByTestId("radio-remove-42"));
    expect(screen.getByText("Current Firm Matter")).toBeTruthy();
    expect(screen.getByTestId("assigned-intakes-42").textContent).toContain(
      "Current Firm Pending Intake",
    );
    fireEvent.change(screen.getByTestId("select-replacement-42"), {
      target: { value: "17" },
    });
    fireEvent.change(screen.getByTestId("input-reason-42"), {
      target: { value: "Reviewed this firm's access need" },
    });
    fireEvent.click(screen.getByTestId("button-submit-decision-42"));

    await waitFor(() => {
      expect(mocks.resolveMutate).toHaveBeenCalledWith(
        {
          id: 42,
          data: {
            decision: "remove",
            reason: "Reviewed this firm's access need",
            replacementMemberId: 17,
          },
        },
        expect.any(Object),
      );
      expect(screen.getByTestId("status-membership-decision-saved")).toBeTruthy();
    });
  });
});
