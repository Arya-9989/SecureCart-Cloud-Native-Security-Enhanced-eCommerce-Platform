import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

import { responseTo } from "@/test/network";
import { customer, server } from "@/test/server";
import { renderApp } from "@/test/utils";

/* Waits are tied to MSW responses and loaded modules, never to wall-clock deadlines. */

beforeAll(async () => {
  await import("@/pages/AccountSettingsPage");
}, 60_000);

async function openAccount() {
  const view = renderApp("/account", { user: customer });
  await screen.findByRole("heading", { name: "Account." });
  return view;
}

describe("Account settings", () => {
  it("shows the profile and a confirmed address, and is kept out of search", async () => {
    await openAccount();
    expect(screen.getByLabelText("Full name")).toHaveValue("Maya Patel");
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  it("saves a new name", async () => {
    let sent: unknown = null;
    server.use(
      http.patch("*/api/auth/me/", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...customer, full_name: "Maya P. Shah" });
      }),
      http.get("*/api/auth/me/", () =>
        HttpResponse.json({ ...customer, full_name: "Maya P. Shah" }),
      ),
    );
    const { user } = await openAccount();
    const field = screen.getByLabelText("Full name");
    await user.clear(field);
    await user.type(field, "Maya P. Shah");
    const saved = responseTo("PATCH", "/api/auth/me/");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await saved;
    expect(sent).toEqual({ full_name: "Maya P. Shah" });
  });

  it("changes the password and keeps this tab signed in with the new session", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/api/auth/password/", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ access: "rotated-token", user: customer });
      }),
    );
    const { user } = await openAccount();
    await user.type(screen.getByLabelText("Current password"), "SecureCart!Demo1");
    await user.type(screen.getByLabelText("New password", { exact: true }), "Brand-New-Secret-77!");
    await user.type(screen.getByLabelText("Confirm new password"), "Brand-New-Secret-77!");
    const changed = responseTo("POST", "/api/auth/password/");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await changed;
    expect(body).toEqual({
      current_password: "SecureCart!Demo1",
      new_password: "Brand-New-Secret-77!",
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toHaveValue("");
    });
  });

  it("shows a wrong current password next to the field", async () => {
    server.use(
      http.post("*/api/auth/password/", () =>
        HttpResponse.json(
          {
            error: {
              code: "invalid",
              message: "Invalid input.",
              fields: { current_password: ["Incorrect password."] },
            },
          },
          { status: 400 },
        ),
      ),
    );
    const { user } = await openAccount();
    await user.type(screen.getByLabelText("Current password"), "wrong-password");
    await user.type(screen.getByLabelText("New password", { exact: true }), "Brand-New-Secret-77!");
    await user.type(screen.getByLabelText("Confirm new password"), "Brand-New-Secret-77!");
    const refused = responseTo("POST", "/api/auth/password/");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await refused;
    expect(await screen.findByText("Incorrect password.")).toBeInTheDocument();
  });

  it("signs out everywhere after confirming, then goes to sign-in", async () => {
    server.use(
      http.post("*/api/auth/sessions/revoke/", () => new HttpResponse(null, { status: 204 })),
    );
    const { user, router } = await openAccount();
    await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    const dialog = await screen.findByRole("dialog");
    const revoked = responseTo("POST", "/api/auth/sessions/revoke/");
    await user.click(within(dialog).getByRole("button", { name: "Sign out everywhere" }));
    await revoked;
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
  });

  it("explains why an account with open orders cannot be deleted yet", async () => {
    server.use(
      http.post("*/api/auth/me/delete/", () =>
        HttpResponse.json(
          { error: { code: "open_orders", message: "You have orders that are still open." } },
          { status: 409 },
        ),
      ),
    );
    const { user, router } = await openAccount();
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Confirm with your password"),
      "SecureCart!Demo1",
    );
    const refused = responseTo("POST", "/api/auth/me/delete/");
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    await refused;
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You have orders that are still open.",
    );
    expect(router.state.location.pathname).toBe("/account");
  });

  it("deletes the account with the password and leaves the session", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/api/auth/me/delete/", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user, router } = await openAccount();
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Confirm with your password"),
      "SecureCart!Demo1",
    );
    const deleted = responseTo("POST", "/api/auth/me/delete/");
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    await deleted;
    expect(body).toEqual({ password: "SecureCart!Demo1" });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("requires a session", async () => {
    const { router } = renderApp("/account");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
  });
});
