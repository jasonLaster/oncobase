import { expect, test } from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
} from "./fixtures";

test("renders ordinary currency ranges literally while preserving intentional math", async ({
  page,
}) => {
  await installWikiApiMocks(page, {
    pageOverrides: {
      "about/About": {
        content: [
          "# About This Wiki",
          "",
          "### What It Costs You",
          "",
          "- **A Claude subscription** (~$20–$200/month depending on plan).",
          "",
          "Intentional math remains rendered: $x^2$.",
        ].join("\n"),
      },
    },
  });

  await gotoWiki(page, "/about/About");

  const article = documentArticle(page);
  await expect(article).toContainText(
    "A Claude subscription (~$20–$200/month depending on plan).",
  );
  await expect(article.locator(".katex")).toHaveCount(1);
  await expect(article.locator(".katex")).not.toContainText("200/month");
});
