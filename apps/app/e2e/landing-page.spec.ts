import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

async function loadAllImages(page: Page) {
  // The login page loads lazily; wait for it before collecting its images.
  await expect(page.locator("#landing-main img")).toHaveCount(7);
  // Images are lazy; visit each so every themed variant is requested.
  for (const image of await page.locator("#landing-main img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
}

for (const width of [320, 393, 700, 701, 900, 901, 1440, 1920]) {
  test(`landing page reflows without overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width <= 700 ? 852 : 1000 });
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "It takes a village.", level: 1 }),
    ).toBeVisible();
    const navigation = page.getByRole("navigation", {
      name: "Main navigation",
    });
    if (width <= 700) {
      // Phones keep one header row; every section is a short scroll away.
      await expect(navigation).toBeHidden();
      expect(
        (await page.locator(".lp-header-shell").boundingBox())!.height,
      ).toBeLessThanOrEqual(72);
    } else {
      await expect(navigation).toBeVisible();
      await expect(navigation.getByRole("link")).toHaveCount(5);
      for (const link of await navigation.getByRole("link").all()) {
        const box = (await link.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        if (width <= 900) expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(
      await page.locator("#landing-title").evaluate((element) => {
        const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
        return (
          element.getBoundingClientRect().height <= lineHeight + 1 &&
          element.scrollWidth <= element.clientWidth
        );
      }),
    ).toBe(true);
    const shots = (await page.locator(".lp-product-shots").boundingBox())!;
    expect(shots.x).toBeGreaterThanOrEqual(0);
    expect(shots.x + shots.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const pair of [".lp-card-pair", ".lp-demo-pair", ".lp-guide-pair"]) {
      const [first, second] = await page
        .locator(`${pair} > *`)
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().toJSON()),
        );
      if (width <= 900 && pair !== ".lp-guide-pair") {
        expect(second.x).toBe(first.x);
        expect(second.y).toBeGreaterThanOrEqual(first.y + first.height + 19);
      } else if (width > 700) {
        expect(second.y).toBe(first.y);
        expect(second.x).toBeGreaterThan(first.x + first.width);
      }
    }
  });
}

for (const width of [393, 1440]) {
  test(`landing text stays readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expect(page.locator("#landing-title")).toBeVisible();
    const small = await page.evaluate(() => {
      const runs: string[] = [];
      const walker = document.createTreeWalker(
        document.querySelector(".landing-page")!,
        NodeFilter.SHOW_TEXT,
      );
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent!.trim();
        const element = walker.currentNode.parentElement!;
        // The wordmark's "TNBC" lockup and mock browser chrome are decorative.
        if (
          !text ||
          element.closest('.lp-diana-wordmark > span, [aria-hidden="true"]')
        )
          continue;
        if (!element.getClientRects().length) continue;
        const size = parseFloat(getComputedStyle(element).fontSize);
        if (size < 13) runs.push(`${size}px ${text}`);
      }
      return runs;
    });
    expect(small).toEqual([]);
  });
}

test("landing page loads without requesting reader or clinical data", async ({
  page,
}) => {
  const readerRequests: string[] = [];
  await page.route("**/api/wiki/**", async (route) => {
    // Page-view telemetry is a write-only beacon, not reader data.
    if (!route.request().url().endsWith("/api/wiki/telemetry"))
      readerRequests.push(route.request().url());
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.goto("/login");
  await loadAllImages(page);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(page.locator("footer")).toBeInViewport();
  expect(readerRequests).toEqual([]);
});

test("landing navigation reaches every section and the sign-in page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  for (const [link, heading] of [
    ["Our story", "#story-title"],
    ["Features", "#inside-title"],
    ["Privacy", "#privacy-title"],
    ["Oncobase", "#platform-title"],
  ]) {
    await navigation.getByRole("link", { name: link, exact: true }).click();
    await expect(page.locator(heading)).toBeInViewport();
  }
  await expect(
    navigation.getByRole("link", { name: "Education", exact: true }),
  ).toHaveAttribute("href", "/education");
  // The password form lives on its own page.
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByLabel("Password", { exact: true })).toBeInViewport();
  // Signed-out visitors see the landing page at "/" on the deployed server.
  await expect(
    page.getByRole("link", { name: "About the knowledge base" }),
  ).toHaveAttribute("href", "/");
  await page.goto("/login");
  await page
    .getByRole("link", { name: "Sign in to the knowledge base", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

for (const width of [393, 1440]) {
  test(`header stays visible and follows the platform color at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 393 ? 852 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    const header = page.locator(".lp-header-shell");
    await expect(header).toHaveAttribute("data-tone", "diana");
    const dianaColor = await header.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );

    await page.evaluate(() => {
      const platform = document.querySelector("#platform")!;
      const header = document.querySelector(".lp-header-shell")!;
      window.scrollTo(
        0,
        platform.getBoundingClientRect().top +
          scrollY -
          header.getBoundingClientRect().height +
          2,
      );
    });
    await expect(header).toHaveAttribute("data-tone", "oncobase");
    expect(Math.abs((await header.boundingBox())!.y)).toBeLessThan(1);
    expect(
      await header.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe(dianaColor);

    if (width === 393) {
      await page.evaluate(() => (location.hash = "#story"));
    } else {
      await page.getByRole("link", { name: "Our story", exact: true }).click();
    }
    await expect
      .poll(async () => (await page.locator("#story-title").boundingBox())!.y)
      .toBeGreaterThanOrEqual((await header.boundingBox())!.height + 20);
    await expect(header).toHaveAttribute("data-tone", "diana");

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).toHaveAttribute("data-tone", "diana");
    expect(Math.abs((await header.boundingBox())!.y)).toBeLessThan(1);
  });
}

test("phones reach educational content, the footer, and sign-in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/login");
  await expect(
    page.getByRole("link", { name: "Browse educational content" }).first(),
  ).toHaveAttribute("href", "/education");
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(page.locator("footer")).toBeInViewport();
  await expect(page.locator(".lp-header-shell")).toHaveAttribute(
    "data-tone",
    "diana",
  );
  await expect(
    page.getByRole("link", { name: "Terms & conditions" }),
  ).toHaveAttribute("href", "/terms-and-conditions");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByLabel("Password", { exact: true })).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Enter Diana’s knowledge base" }),
  ).toBeInViewport();
  await expect(
    page.getByText("A private space for Diana’s village.", { exact: true }),
  ).toBeVisible();
});

test("sign-in reports connection and server failures and allows a retry", async ({
  page,
}) => {
  let attempt = 0;
  await page.route("**/api/login", async (route) => {
    attempt++;
    if (attempt === 1) await route.abort("failed");
    else await route.fulfill({ status: 503, body: "{}" });
  });
  await page.goto("/sign-in");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page
    .getByRole("button", { name: "Enter Diana’s knowledge base", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Unable to connect. Please try again.",
  );
  await expect(
    page.getByRole("button", {
      name: "Enter Diana’s knowledge base",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Enter Diana’s knowledge base", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Sign in is temporarily unavailable. Please try again.",
  );
});

test("private links ask for the password and continue to the page", async ({
  page,
}) => {
  await page.route("**/api/login", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/wiki/care/index", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>Current care</title>",
    }),
  );
  await page.goto("/login");
  const contents = page.locator(".lp-contents");
  await expect(
    contents.getByRole("link", { name: "Educational content" }),
  ).toHaveAttribute("href", "/education");
  const currentCare = contents.getByRole("link", { name: /^Current care/ });
  await expect(currentCare).toHaveAccessibleName(
    "Current care Sign in required",
  );
  await expect(currentCare).toHaveAttribute(
    "href",
    "/sign-in?redirect=%2Fwiki%2Fcare%2Findex",
  );
  for (const link of await page
    .locator(".landing-page a[href^='http']")
    .all()) {
    // Only source repositories and the MRI image credit leave the site.
    expect(["github.com", "doi.org", "creativecommons.org"]).toContain(
      new URL((await link.getAttribute("href"))!).hostname,
    );
  }
  await currentCare.click();
  await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fwiki%2Fcare%2Findex$/);
  await expect(
    page.getByText(
      "Enter the shared password to continue to the page you opened.",
    ),
  ).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/wiki\/care\/index$/);
});

test("the server's landing response renders the landing page at the root", async ({
  page,
}) => {
  // The deployed gate marks a signed-out "/" response; the dev server serves
  // HTML without the gate, so add the marker it would send.
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(
        "</head>",
        '<meta name="wiki-reader-access" content="landing" /></head>',
      );
      await route.fulfill({ response, body: html });
    },
  );
  const sessionRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/wiki/session")
      sessionRequests.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "It takes a village." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "Diana TNBC home" }).first(),
  ).toHaveAttribute("href", "/");
  // The visitor is signed out, so the reader session is never requested.
  expect(sessionRequests).toEqual([]);
});

test("a private page's redirect opens the sign-in page directly", async ({
  page,
}) => {
  // A bare visit and the bare domain's own redirect show the landing page.
  for (const path of ["/login", "/login?redirect=%2F"]) {
    await page.goto(path);
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("sign-in-page")).toHaveCount(0);
  }
  await page.goto("/login?redirect=%2Fwiki%2Fcare%2Findex");
  await expect(page.getByTestId("sign-in-page")).toBeVisible();
  await expect(page).toHaveTitle("Sign in — Diana TNBC Knowledge Base");
});

for (const width of [320, 393, 900, 901, 1440]) {
  test(`sign-in page reflows without overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width <= 700 ? 852 : 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/sign-in");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Open Diana’s knowledge base.",
      }),
    ).toBeVisible();
    const cartoon = page.locator(".si-cartoon img");
    await expect(cartoon).toHaveAttribute(
      "src",
      /sign-in-cartoon-light\.webp$/,
    );
    await expect
      .poll(() =>
        cartoon.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const art = (await page.locator(".si-art").boundingBox())!;
    const form = (await page.locator(".auth-card").boundingBox())!;
    if (width <= 900) expect(form.y).toBeGreaterThanOrEqual(art.y + art.height);
    else expect(form.x).toBeGreaterThanOrEqual(art.x + art.width);
    // The password and its button fit on the first screen.
    await expect(
      page.getByRole("button", { name: "Enter Diana’s knowledge base" }),
    ).toBeInViewport();
    for (const control of [
      page.getByLabel("Password", { exact: true }),
      page.getByRole("button", { name: "Dark theme" }),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("dark sign-in page uses Diana's palette and the dark cartoon", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/sign-in");
  await expect(page.locator(".auth-card")).toHaveCSS(
    "background-color",
    "rgb(48, 36, 48)",
  );
  await expect(page.locator(".si-cartoon img")).toHaveAttribute(
    "src",
    /sign-in-cartoon-dark\.webp$/,
  );
});

test("PII example changes inline details while preserving surrounding context", async ({
  page,
}) => {
  await page.goto("/login");
  const demo = page.locator(".lp-redaction-demo");
  const toggle = demo.getByRole("switch", {
    name: "Redact example personal information",
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(
    demo.getByText("[redacted email]", { exact: true }),
  ).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    demo.getByText("alex@example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    demo.getByText(
      "For the next call: review the report and make a list of questions for the care team.",
    ),
  ).toBeVisible();
  await toggle.click();
  await expect(
    demo.getByText("[redacted email]", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Interactive examples with fictional people and details."),
  ).toBeVisible();
});

test("role preview shows different page visibility with thumb-friendly controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/login");
  const picker = page.getByRole("group", {
    name: "Preview an example user role",
  });
  for (const button of await picker.getByRole("button").all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await picker
    .getByRole("button", { name: "Friends & family", exact: true })
    .click();
  await expect(
    picker.getByRole("button", { name: "Friends & family", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const pages = page.getByRole("list", {
    name: "Page visibility for Friends & family",
  });
  await expect(
    pages.getByRole("listitem").filter({ hasText: "Clinical records" }),
  ).toContainText("Hidden");
  await expect(
    pages.getByRole("listitem").filter({ hasText: "Educational content" }),
  ).toContainText("Viewable");
  await picker.getByRole("button", { name: "Care team", exact: true }).click();
  await expect(
    page
      .getByRole("list", { name: "Page visibility for Care team" })
      .getByRole("listitem")
      .filter({ hasText: "Clinical records" }),
  ).toContainText("Viewable");
});

test("showcase images load in the visitor's theme and follow the theme toggle", async ({
  page,
}) => {
  const failedAssets: string[] = [];
  page.on("response", (response) => {
    // A reload revalidates cached images with 304 Not Modified.
    if (response.url().includes("/landing/") && response.status() >= 400)
      failedAssets.push(response.url());
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await loadAllImages(page);
  const themed = page.locator(
    "#landing-main img[src*='-light.'], #landing-main img[src*='-dark.']",
  );
  await expect(themed).toHaveCount(5);
  expect(
    await themed.evaluateAll((images) =>
      images.every((image) => image.getAttribute("src")!.includes("-light.")),
    ),
  ).toBe(true);

  const toggle = page.getByRole("button", { name: "Dark theme" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Dark theme" }),
  ).toHaveAttribute("aria-pressed", "true");
  await loadAllImages(page);
  expect(
    await themed.evaluateAll((images) =>
      images.every((image) => image.getAttribute("src")!.includes("-dark.")),
    ),
  ).toBe(true);
  // Choosing the system's own theme goes back to following the system.
  await page.getByRole("button", { name: "Dark theme" }).click();
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
  expect(failedAssets).toEqual([]);
});

for (const width of [393, 1440]) {
  test(`dark landing keeps Diana purple and Oncobase green at ${width}px`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/login");
    await expect(page.locator("#landing-title")).toBeVisible();
    await expect(page.locator(".lp-contents")).toHaveCSS(
      "background-color",
      "rgb(48, 36, 48)",
    );
    await expect(page.locator(".lp-header-shell .lp-button")).toHaveCSS(
      "color",
      "rgb(36, 28, 35)",
    );
    await expect(
      page.locator('.lp-role-picker button[aria-pressed="true"]'),
    ).toHaveCSS("background-color", "rgb(68, 48, 68)");
    await expect(page.locator(".lp-platform")).toHaveCSS(
      "background-color",
      "rgb(27, 42, 33)",
    );
    await expect(page.locator("#platform-title")).toHaveCSS(
      "color",
      "rgb(226, 234, 220)",
    );
    await page.locator("#platform").evaluate((element) => {
      const header = document.querySelector(".lp-header-shell")!;
      window.scrollTo(
        0,
        element.getBoundingClientRect().top +
          scrollY -
          header.getBoundingClientRect().height +
          2,
      );
    });
    await expect(page.locator(".lp-header-shell")).toHaveAttribute(
      "data-tone",
      "oncobase",
    );
    await expect(page.locator(".lp-header-shell .lp-button")).toHaveCSS(
      "color",
      "rgb(22, 35, 28)",
    );
    await page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(page.locator(".lp-header-shell")).toHaveAttribute(
      "data-tone",
      "diana",
    );
    await expect(page.locator(".lp-footer-platform .lp-brand-mark")).toHaveCSS(
      "background-color",
      "rgb(42, 62, 45)",
    );
  });
}
