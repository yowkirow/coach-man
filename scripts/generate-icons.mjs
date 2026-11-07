// Renders CoachMan's PWA icons (lime pickleball on the night panel) with Playwright and the
// system's Edge/Chrome. Usage: node scripts/generate-icons.mjs  (PW_CHANNEL=chrome to switch)
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const NIGHT = "#0e0e0f";
const LIME = "#daee63";
// Perforations of the BallMark (src/app/components/brand.tsx), in a 32×32 box.
const HOLES = [
  [16, 7.2],
  [9.6, 10.6],
  [22.4, 10.6],
  [16, 16],
  [8.4, 18.4],
  [23.6, 18.4],
  [12, 24.4],
  [20, 24.4],
];

/** Ball scaled around the centre; `cutout` punches the holes through (for monochrome badges). */
const ball = (scale, { bg = NIGHT, fill = LIME, holes = NIGHT, cutout = false } = {}) => {
  const t = (16 - 16 * scale).toFixed(3);
  const dots = (color) =>
    HOLES.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.9" fill="${color}"/>`).join("");
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
    ${bg ? `<rect width="32" height="32" fill="${bg}"/>` : ""}
    <g transform="translate(${t} ${t}) scale(${scale})">
      ${cutout ? `<mask id="m"><rect width="32" height="32" fill="#fff"/>${dots("#000")}</mask>` : ""}
      <circle cx="16" cy="16" r="15" fill="${fill}" ${cutout ? 'mask="url(#m)"' : ""}/>
      ${cutout ? "" : dots(holes)}
    </g>
  </svg>`;
};

const icons = [
  { file: "icon-192.png", size: 192, svg: ball(0.72) },
  { file: "icon-512.png", size: 512, svg: ball(0.72) },
  // Maskable icons keep the mark inside the 80% safe zone.
  { file: "icon-maskable-512.png", size: 512, svg: ball(0.56) },
  { file: "apple-touch-icon-180.png", size: 180, svg: ball(0.68) },
  {
    file: "badge-72.png",
    size: 72,
    svg: ball(0.94, { bg: null, fill: "#fff", cutout: true }),
    transparent: true,
  },
];

await mkdir("public/icons", { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
const page = await browser.newPage();
for (const icon of icons) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent;width:${icon.size}px;height:${icon.size}px">${icon.svg}</body></html>`,
  );
  await page.screenshot({
    path: `public/icons/${icon.file}`,
    omitBackground: Boolean(icon.transparent),
  });
  console.log(`wrote public/icons/${icon.file}`);
}
await browser.close();
