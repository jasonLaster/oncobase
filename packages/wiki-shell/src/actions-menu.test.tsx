import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiActionsMenu, WikiAuthDialog, WikiSidebarSignInPrompt } from "./actions-menu.tsx";

// The menu trigger and sign-in prompt are in the reader's server-rendered first
// frame; UI SDK now owns their ARIA, so check it reaches the HTML.
describe("server render", () => {
  test("a custom menu trigger keeps its props and gets the menu's ARIA, with the menu closed", () => {
    const html = renderToStaticMarkup(
      <WikiActionsMenu trigger={<button aria-label="Workspace menu" data-test-id="sidebar-workspace-trigger" type="button">D</button>} />,
    );
    expect(html).toContain('data-test-id="sidebar-workspace-trigger"');
    expect(html).toContain('aria-label="Workspace menu"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menu"');
  });

  test("the default trigger is named Actions", () => {
    const html = renderToStaticMarkup(<WikiActionsMenu />);
    expect(html).toContain('aria-label="Actions"');
    expect(html).toContain('data-test-id="header-actions-menu"');
  });

  test("the sidebar prompt renders its button with the dialog closed", () => {
    const html = renderToStaticMarkup(<WikiSidebarSignInPrompt />);
    expect(html).toMatch(/<button type="button" data-test-id="sidebar-sign-in">/);
    expect(html).not.toContain('role="dialog"');
  });

  test("an open auth dialog is named for its mode", () => {
    const signIn = renderToStaticMarkup(<WikiAuthDialog initialMode="signin" open />);
    expect(signIn).toContain('role="dialog"');
    expect(signIn).toContain('data-test-id="wiki-auth-dialog"');
    expect(signIn).toMatch(/<h2[^>]*data-slot="dialog-title"[^>]*>Sign in<\/h2>/);
    const labelled = (html: string, label: string, id: string) => {
      const labelId = html.match(new RegExp(`<label[^>]*id="([^"]+)"[^>]*>${label}</label>`))?.[1];
      expect(labelId).toBeDefined();
      expect(html).toMatch(new RegExp(`<input[^>]*id="${id}"[^>]*aria-labelledby="${labelId}"`));
    };
    labelled(signIn, "Email", "auth-email");
    labelled(signIn, "Password", "auth-password");
    expect(signIn).toContain('aria-label="Show password"');
    expect(signIn).not.toContain('id="auth-name"');
    const signUp = renderToStaticMarkup(<WikiAuthDialog initialMode="signup" open />);
    expect(signUp).toMatch(/data-slot="dialog-title"[^>]*>Sign up</);
    labelled(signUp, "Name", "auth-name");
  });
});
