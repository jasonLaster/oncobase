import { expect, test, type Locator } from "@playwright/test";

async function imageLayout(image: Locator) {
  return image.evaluate(async element => {
    const image = element as HTMLImageElement;
    await image.decode();
    const box = image.getBoundingClientRect();
    const caption = image.parentElement?.nextElementSibling?.getBoundingClientRect();
    return {
      width: box.width, height: box.height, x: box.x,
      captionGap: caption ? caption.top - box.bottom : 0,
      display: getComputedStyle(image).display,
    };
  });
}

test("the embedded learning lab follows the chosen app theme on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  // Browser media emulation forces every frame's scheme independently. Let the
  // iframe inherit the real parent color-scheme instead, as it does in the app.
  await page.emulateMedia({ colorScheme: null });
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem("theme", "light");
  });
  await page.goto("/education/tools/in-vivo-car-t-learning-lab/");
  const frame = page.frameLocator("iframe[data-education-lab]");
  const body = frame.locator("body");
  await expect(body).toBeVisible();
  const light = await body.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect.poll(() => body.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(light);
  expect(await body.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [393, 1440]) {
  test(`cartoons and diagram panels keep their layout across themes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => {
      if (window === window.top && !localStorage.getItem("theme")) localStorage.setItem("theme", "light");
    });
    const theme = page.getByRole("button", { name: "Dark theme", exact: true });
    await page.goto("/education/guides/start-here/01-read-the-labels/");
    const images = page.locator("article img[data-theater-image]:visible");
    const light = await imageLayout(images.first());
    const visibleCount = await images.count();
    expect(light.display).toBe("block");
    await expect(images.first()).toHaveAttribute("src", /-light\./);
    await theme.click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(images.first()).toHaveAttribute("src", /-dark\./);
    expect(await images.count()).toBe(visibleCount);
    const dark = await imageLayout(images.first());
    expect(dark.display).toBe("block");
    for (const key of ["width", "height", "x", "captionGap"] as const) {
      expect(Math.abs(light[key] - dark[key]), key).toBeLessThan(1);
    }
    const highlight = await page.locator("article .mermaid-diagram .node").first().evaluate(element => {
      const rect = getComputedStyle(element.querySelector("rect")!);
      const text = getComputedStyle(element.querySelector("text")!);
      const expected = getComputedStyle(document.documentElement);
      return { fill: rect.fill, stroke: rect.stroke, text: text.fill,
        accent: expected.getPropertyValue("--accent-light").trim(),
        brand: expected.getPropertyValue("--brand").trim(), foreground: expected.color };
    });
    // Resolve the theme tokens to browser color strings before comparing them.
    const colors = await page.evaluate(values => values.map(value => {
      const element = document.createElement("span"); element.style.color = value;
      document.body.append(element); const color = getComputedStyle(element).color; element.remove(); return color;
    }), [highlight.accent, highlight.brand]);
    expect(highlight.fill).toBe(colors[0]);
    expect(highlight.stroke).toBe(colors[1]);
    expect(highlight.text).toBe(highlight.foreground);
    await images.first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const controls = await dialog.locator(".wiki-image-theater__button").evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { height: box.height, font: getComputedStyle(element).fontFamily, right: box.right };
    }));
    for (const control of controls) {
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.right).toBeLessThanOrEqual(width);
      expect(control.font).toContain("sans-serif");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    await page.goto("/education/designing-a-vaccine/index/");
    const diagram = page.locator("article .mermaid-diagram").first();
    await expect(diagram.locator("svg")).toHaveCount(1);
    let darkSize: { width: number; height: number } | undefined;
    for (const dark of [true, false]) {
      if (!dark) await theme.click();
      await expect(page.locator("html")).toHaveAttribute("style", `color-scheme: ${dark ? "dark" : "light"};`);
      const appearance = await diagram.evaluate(element => {
        const svg = element.querySelector("svg")!;
        const root = getComputedStyle(document.documentElement);
        const box = element.getBoundingClientRect();
        const text = svg.querySelector("text")!;
        return {
          background: getComputedStyle(element).backgroundColor,
          pageBackground: root.backgroundColor,
          textColor: getComputedStyle(text).fill, foreground: root.color,
          svgBackground: getComputedStyle(svg).backgroundColor,
          accent: getComputedStyle(svg).getPropertyValue("--accent").trim(),
          brand: root.getPropertyValue("--brand").trim(),
          clipped: element.scrollWidth > element.clientWidth,
          width: box.width, height: box.height,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(appearance.background).toBe(appearance.pageBackground);
      expect(appearance.textColor).toBe(appearance.foreground);
      expect(appearance.svgBackground).toBe("rgba(0, 0, 0, 0)");
      expect(appearance.accent).toBe(appearance.brand);
      expect(appearance.clipped).toBe(false);
      expect(appearance.pageOverflow).toBe(false);
      if (dark) darkSize = appearance;
      else {
        expect(appearance.width).toBe(darkSize!.width);
        expect(appearance.height).toBe(darkSize!.height);
      }
    }
  });
}
