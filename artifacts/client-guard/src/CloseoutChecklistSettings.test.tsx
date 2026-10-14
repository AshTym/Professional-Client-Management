import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useGetCloseoutChecklistSettings: vi.fn(),
  useUpdateCloseoutChecklistSettings: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  ...mocks,
  getGetCloseoutChecklistSettingsQueryKey: () => ["closeout-checklist-settings"],
}));

import CloseoutChecklistSettings from "./CloseoutChecklistSettings";

const initialSettings = {
  checklists: [{
    matterType: null,
    items: [{ itemKey: "final_billing", title: "Complete final billing review" }],
  }],
  updatedAt: null,
};

function renderSettings(isAdmin = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CloseoutChecklistSettings isAdmin={isAdmin} matterTypes={["advisory"]} />
    </QueryClientProvider>,
  );
}

describe("firm closeout checklist settings", () => {
  beforeEach(() => {
    mocks.useGetCloseoutChecklistSettings.mockReturnValue({
      data: initialSettings,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.mutate.mockImplementation((variables, options) => {
      options.onSuccess({ ...variables.data, updatedAt: "2026-10-14T00:00:00.000Z" });
    });
    mocks.useUpdateCloseoutChecklistSettings.mockReturnValue({
      mutate: mocks.mutate,
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lets an admin add a matter-type override and save it through the API", async () => {
    renderSettings();

    fireEvent.change(screen.getByLabelText("Checklist applies to"), {
      target: { value: "advisory" },
    });
    expect(screen.getByText(/currently uses the all-matters checklist/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Add a matter type checklist"), {
      target: { value: "Commercial lease" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add matter type" }));
    fireEvent.change(screen.getByLabelText("Checklist applies to"), {
      target: { value: "Commercial lease" },
    });
    fireEvent.change(screen.getByLabelText("Closeout step 1"), {
      target: { value: "Confirm lease records are archived" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save closeout checklist" }));

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
    expect(mocks.mutate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        checklists: [
          {
            matterType: null,
            items: [{ itemKey: "final_billing", title: "Complete final billing review" }],
          },
          {
            matterType: "Commercial lease",
            items: [{ itemKey: "final_billing", title: "Confirm lease records are archived" }],
          },
        ],
      },
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "Required closeout checklist saved.",
    );
  });

  it("shows but does not allow staff to edit checklist requirements", () => {
    renderSettings(false);

    expect((screen.getByLabelText("Closeout step 1") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Only firm owners and admins can change required steps.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save closeout checklist" })).toBeNull();
  });
});
