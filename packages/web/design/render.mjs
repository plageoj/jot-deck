// Render ogp.html to public/ogp.png (1200x630) with the app package's Playwright.
// From the repo root:
//   node packages/web/design/render.mjs
// After changing the image, bump the `?v=` query on og:image / twitter:image in
// src/pages/index.astro so social caches refetch it.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../app/package.json"));
const { chromium } = require("@playwright/test");

const html = path.join(here, "ogp.html");
const out = path.join(here, "../public/ogp.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(html).href);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
