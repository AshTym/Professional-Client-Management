import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { ContactPage, PricingPage } from "./PublicPages";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPublicPage(page: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Router>{page}</Router>
    </QueryClientProvider>,
  );
}

function fillContactForm() {
  fireEvent.change(screen.getByTestId("input-contact-name"), {
    target: { value: "Morgan Lee" },
  });
  fireEvent.change(screen.getByTestId("input-contact-email"), {
    target: { value: "morgan@example.test" },
  });
  fireEvent.change(screen.getByTestId("input-contact-organization"), {
    target: { value: "Northline Advisory" },
  });
  fireEvent.change(screen.getByTestId("input-contact-message"), {
    target: { value: "Please send information about ClientGuard." },
  });
}

describe("public pages", () => {
  it("explains the requested pricing without implying app restrictions", () => {
    renderPublicPage(<PricingPage />);

    expect(screen.getByTestId("page-pricing")).toBeTruthy();
    expect(screen.getAllByText(/one client/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/one matter/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/AU\$15/i)).toBeTruthy();
    expect(screen.getByTestId("notice-pricing-informational").textContent).toMatch(
      /informational only/i,
    );
    expect(screen.getByTestId("link-public-contact").getAttribute("href")).toBe(
      "/contact",
    );
  });

  it("posts a valid inquiry and shows success only after a 204 response", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPublicPage(<ContactPage />);

    fillContactForm();
    fireEvent.click(screen.getByTestId("button-contact-submit"));

    await waitFor(() =>
      expect(screen.queryByTestId("status-contact-success")).not.toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/contact");
    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      name: "Morgan Lee",
      email: "morgan@example.test",
      organization: "Northline Advisory",
      message: "Please send information about ClientGuard.",
    });
  });

  it("shows a delivery error when the contact API rejects the inquiry", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: "Email delivery failed." }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPublicPage(<ContactPage />);

    fillContactForm();
    fireEvent.click(screen.getByTestId("button-contact-submit"));

    await waitFor(() =>
      expect(screen.queryByTestId("status-contact-error")).not.toBeNull(),
    );
    expect(screen.queryByTestId("status-contact-success")).toBeNull();
  });
});
