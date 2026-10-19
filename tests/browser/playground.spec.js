import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("unknown calls retain allowance across windows and can be reconciled", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Reserve allowance", exact: true })
    .click();
  await expect(page.locator("#held")).toHaveText("80");
  await expect(page.locator("#available")).toHaveText("160");
  await page.getByRole("button", { name: "Start call-1", exact: true }).click();
  await page
    .getByRole("button", { name: "Lose response call-1", exact: true })
    .click();
  await page.getByRole("button", { name: "Next window", exact: true }).click();
  await expect(page.locator("#held")).toHaveText("80");
  await expect(page.locator(".state.uncertain")).toHaveText("uncertain");
  await page.getByLabel("Actual units for call-1", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Reconcile call-1", exact: true })
    .click();
  await expect(page.locator("#held")).toHaveText("0");
  await expect(page.locator("#spent")).toHaveText("0");
  await expect(page.locator("#available")).toHaveText("240");
});
test("deadline expiry releases only unstarted calls; replays do not add allowance", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Reserve allowance", exact: true })
    .click();
  await page.getByLabel("Request key", { exact: true }).fill("call-1");
  await page
    .getByRole("button", { name: "Reserve allowance", exact: true })
    .click();
  await expect(page.locator(".call")).toHaveCount(1);
  await expect(page.locator("#message")).toContainText("replay blocked");
  await page.getByRole("button", { name: "+30 seconds", exact: true }).click();
  await expect(page.locator("#held")).toHaveText("0");
  await expect(page.locator(".state.expired")).toHaveText("expired");
});
test("policy constraints block new calls and overages remain visible", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Concurrent call limit").fill("1");
  await page.getByRole("button", { name: "Apply policy & reset" }).click();
  await page
    .getByRole("button", { name: "Reserve allowance", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reserve allowance", exact: true })
    .click();
  await expect(page.locator("#message")).toContainText("denied by concurrency");
  await page.getByRole("button", { name: "Start call-1", exact: true }).click();
  await page.getByLabel("Actual units for call-1").fill("300");
  await page
    .getByRole("button", { name: "Settle call-1", exact: true })
    .click();
  await expect(page.locator("#overage")).toContainText("60 units above");
  await expect(page.locator("#available")).toHaveText("0");
});
test("scenario renders without external requests or JavaScript errors", async ({
  page,
}) => {
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4196/")) external.push(r.url());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load response-loss scenario" })
    .click();
  await expect(page.locator("#held")).toHaveText("80");
  await expect(page.locator("#clock")).toHaveText("01:00");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
for (const width of [1440, 390])
  test(`playground has contained layout and passes automated accessibility checks at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Load response-loss scenario" })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/playground-${width}.png`,
      fullPage: true,
    });
  });
test("downloaded single-file playground works directly from disk", async ({
  page,
}) => {
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  const url = pathToFileURL(resolve("site/quotahold-playground.html")).href;
  await page.goto(url);
  await page
    .getByRole("button", { name: "Load response-loss scenario" })
    .click();
  await expect(page.locator("#held")).toHaveText("80");
  await page.getByLabel("Actual units for report-worker").fill("30");
  await page
    .getByRole("button", { name: "Reconcile report-worker", exact: true })
    .click();
  await expect(page.locator("#held")).toHaveText("0");
  expect(errors).toEqual([]);
  expect(requests.filter((request) => request !== url)).toEqual([]);
});
