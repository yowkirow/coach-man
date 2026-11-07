// Captures the academy release's surfaces for design review, at desktop (1440) and phone (390), as
// four people: an owner, a coach, a parent, and someone signed out. It first sets up a believable
// academy through the test-auth bypass (sample data, a listed public page with a logo, programs and
// tiers, coaches, consent forms, announcements, a linked parent, enrollment requests, and payment
// proofs), then walks the pages and their sheets. Every name is synthetic.
//
// Needs the app running (npm run build, then vite preview) and the E2E bypass vars in .dev.vars.
// Usage: node scripts/academy-screenshots.mjs [outDir]   (default .impeccable/review/academy)
// Env: E2E_BASE_URL, E2E_BYPASS_SECRET, PW_CHANNEL (default msedge),
//      SHOT_GROUPS="staff,coach,portal,wizard,public,empty" (default: all),
//      SHOT_VIEWPORTS="desktop,mobile", SHOT_SHEETS=0 (skip the review contact sheets)
//
// Besides one PNG per surface and viewport, it writes review sheets to <outDir>/sheets: phone pages
// cut into 844px slices, three side by side, and tall desktop pages cut into 900px slices.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const outDir = process.argv[2] ?? ".impeccable/review/academy";
const groups = new Set(
  (process.env.SHOT_GROUPS ?? "staff,coach,portal,wizard,public,empty").split(","),
);
const wanted = (process.env.SHOT_VIEWPORTS ?? "desktop,mobile").split(",");

async function bypassSecret() {
  if (process.env.E2E_BYPASS_SECRET) return process.env.E2E_BYPASS_SECRET;
  const vars = await readFile(".dev.vars", "utf8").catch(() => "");
  const match = vars.match(/^E2E_BYPASS_SECRET\s*=\s*"?([^"\r\n]+)"?/m);
  if (!match) throw new Error("Set E2E_BYPASS_SECRET (or add it to .dev.vars).");
  return match[1];
}
const secret = await bypassSecret();

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });

// --- API helpers -----------------------------------------------------------------------------------

/**
 * `request.fetch` that rides out the local preview server dropping a request under load: that
 * answer is a 5xx page without the Worker's JSON (the Worker's own errors are JSON), so it's sent
 * again.
 */
async function fetchRetry(ctx, url, options) {
  let res = await ctx.request.fetch(url, options);
  for (let i = 0; i < 3 && res.status() >= 500; i++) {
    if ((res.headers()["content-type"] ?? "").includes("application/json")) break;
    await new Promise((r) => setTimeout(r, 1500));
    res = await ctx.request.fetch(url, options);
  }
  return res;
}

async function call(ctx, method, path, data, { bypass = false, raw = false } = {}) {
  const headers = bypass ? { "x-e2e-bypass": secret } : {};
  const res = await fetchRetry(ctx, `${base}${path}`, { method, data, headers });
  const text = await res.text();
  if (raw) return { status: res.status(), json: text ? JSON.parse(text) : undefined };
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}
const get = (ctx, path) => call(ctx, "GET", path);
const post = (ctx, path, data = {}, opts) => call(ctx, "POST", path, data, opts);
const patch = (ctx, path, data) => call(ctx, "PATCH", path, data);

async function signIn(ctx, email, name, persona = "none") {
  await post(ctx, "/api/test/sign-in", { email, name, persona }, { bypass: true });
}

async function newContext(vp, extra = {}) {
  return browser.newContext({
    ...VIEWPORTS[vp],
    colorScheme: "light",
    serviceWorkers: "block",
    ...extra,
  });
}

/** A PNG drawn by the browser (the academy's logo, a receipt): transparent where nothing is. */
async function drawPng(html, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(`<body style="margin:0;background:transparent">${html}</body>`);
  const png = await page.screenshot({ omitBackground: true });
  await ctx.close();
  return png;
}

// --- The academy -----------------------------------------------------------------------------------

const run = Date.now().toString(36);
const emails = {
  owner: `review-owner-${run}@coachman.test`,
  coach: `review-coach-${run}@coachman.test`,
  parent: `review-parent-${run}@coachman.test`,
  bare: `review-new-${run}@coachman.test`,
  fresh: `review-fresh-${run}@coachman.test`,
};
const NAMES = { owner: "Robin Castillo", coach: "Lea Navarro", parent: "Grace Park" };
const PAY_INSTRUCTIONS =
  "GCash 0917 555 0142 (Riverside Pickleball). BPI 1234-5678-90. Send the screenshot here once you've paid.";

function bornYearsAgo(age) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - age);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

async function setUp() {
  const own = await newContext("desktop");
  await signIn(own, emails.owner, NAMES.owner, "coach");
  await post(own, "/api/test/seed?tz=Asia%2FManila&currency=PHP", {}, { bypass: true });
  const me = await get(own, "/api/v1/me");
  const ownerId = me.user.id;
  await patch(own, "/api/v1/workspace", { paymentMethods: ["Cash", "GCash", "Bank transfer"] });

  const slug = `riverside-${run}`;
  await patch(own, "/api/v1/academy", {
    name: "Riverside Pickleball Academy",
    slug,
    tagline: "Coached pickleball for juniors and adults, four evenings a week.",
    about:
      "Small groups, the same coaches every week, and a plan for every player. We train at Riverside Park Courts and the Northside Rec Center.\n\nNew to the game? Start with a trial session and we'll find your level together.",
    contactPhone: "0917 555 0142",
    contactEmail: "hello@riverside-pickleball.example",
    address: "Riverside Park Courts, Riverside Park",
    mapUrl: "https://maps.example.com/riverside-park-courts",
    socials: { facebook: "https://facebook.com/riverside.pickleball.example" },
    paymentInstructions: PAY_INSTRUCTIONS,
    policies:
      "Sessions run rain or shine on covered courts. Tell us 24 hours ahead if you can't make it.",
    enrollmentOpen: true,
    listed: true,
  });
  const logo = await drawPng(
    `<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <circle cx="64" cy="64" r="60" fill="#1f5f4a"/>
      <circle cx="64" cy="64" r="48" fill="none" stroke="#f3e9d2" stroke-width="3"/>
      <text x="64" y="76" font-family="Georgia, serif" font-size="38" font-weight="700" fill="#f3e9d2" text-anchor="middle">RP</text>
    </svg>`,
    128,
    128,
  );
  const logoRes = await fetchRetry(own, `${base}/api/v1/academy/logo`, {
    method: "PUT",
    data: logo,
    headers: { "Content-Type": "image/png" },
  });
  if (!logoRes.ok()) throw new Error(`Logo upload failed: ${await logoRes.text()}`);

  await patch(own, `/api/v1/coaches/${ownerId}`, {
    title: "Head coach",
    bio: "Robin has coached juniors and adults for eight years and runs the evening program.",
    certifications: ["Level 2 coaching certificate"],
    duprRating: 4.6,
    specialties: ["Juniors", "Third-shot drops"],
    languages: ["English", "Filipino"],
    yearsCoaching: 8,
    isPublic: true,
  });
  const coach = await post(
    own,
    "/api/test/member",
    { email: emails.coach, name: NAMES.coach, role: "coach" },
    { bypass: true },
  );
  await patch(own, `/api/v1/coaches/${coach.userId}`, {
    title: "Coach",
    bio: "Lea works with beginners and the juniors' weekend group.",
    specialties: ["Beginners", "Footwork"],
    languages: ["English", "Filipino"],
    yearsCoaching: 3,
    isPublic: true,
  });

  const groupsList = await get(own, "/api/v1/groups");
  const evening = groupsList.find((g) => g.name === "Evening program");
  await patch(own, `/api/v1/groups/${evening.id}`, { assistantCoachIds: [coach.userId] });

  const waiver = await post(own, "/api/v1/consent-documents", {
    kind: "waiver",
    title: "Waiver and release",
    body: "Pickleball is a sport with risks.\n\nI understand them and will follow the coaches' instructions.",
    required: true,
    appliesTo: "all",
    active: true,
  });
  const parental = await post(own, "/api/v1/consent-documents", {
    kind: "parental",
    title: "Parental consent",
    body: "I am the student's parent or guardian and agree to their training.",
    required: true,
    appliesTo: "minors",
    active: true,
  });

  const staffInvite = await post(own, "/api/v1/team/invites", {
    email: "jamie.cruz@example.com",
    role: "coach",
  });

  const clients = await get(own, "/api/v1/clients");
  const jun = clients.find((c) => c.firstName === "Jun");
  const zoe = clients.find((c) => c.firstName === "Zoe");
  await patch(own, `/api/v1/clients/${jun.id}`, {
    medicalNotes: "Mild asthma. His inhaler is in the front pocket of his bag.",
    emergencyName: "Grace Park",
    emergencyPhone: "+1 555 0190",
  });
  await post(own, `/api/v1/clients/${jun.id}/pickups`, {
    name: "Martin Park",
    relationship: "Uncle",
    phone: "+1 555 0177",
  });
  await post(own, "/api/v1/notes", {
    clientId: jun.id,
    body: "Great footwork today. Keep the paddle up between shots and you'll be first to the kitchen line.",
    visibility: "shared",
  });
  await post(own, "/api/v1/notes", {
    clientId: jun.id,
    kind: "handoff",
    body: "Lea takes Jun on Saturdays from next week. He's working on his backhand dink.",
  });
  const skills = await get(own, "/api/v1/skills");
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await post(own, `/api/v1/clients/${jun.id}/assessments`, {
    assessedOn: weekAgo,
    overallLevel: "2.5",
    notes: "Steady serve and return. Next: soft game at the kitchen line.",
    scores: skills.map((s, i) => ({ skillId: s.id, score: 2 + (i % 3 === 0 ? 1 : 0) })),
    sharedWithFamily: true,
  });
  await post(
    own,
    "/api/test/family",
    { clientId: jun.id, email: emails.parent, name: NAMES.parent, relation: "guardian" },
    { bypass: true },
  );
  const familyInvite = await post(own, `/api/v1/clients/${zoe.id}/family/invites`, {
    relation: "guardian",
  });

  // The parent renews Jun into Monthly for this month (approved, so there's something to pay),
  // pays by GCash twice by mistake (a duplicate to review), and asks for a trial for a new child.
  const par = await newContext("desktop");
  await signIn(par, emails.parent, NAMES.parent);
  const academy = await get(par, `/api/public/academies/${slug}`);
  const tier = (name) => academy.packages.find((p) => p.name === name);
  const thisMonth = academy.today.slice(0, 7);
  const program = academy.programs[0];
  const sign = (docs) =>
    docs.map((d) => ({ documentId: d.id, version: d.version, signerName: NAMES.parent }));
  const answers = {
    phone: "+1 555 0190",
    emergencyName: "Grace Park",
    emergencyPhone: "+1 555 0190",
    selfRating: 2.5,
    shirtSize: "Kids M",
    pickups: [],
  };
  const junRequest = await post(par, "/api/portal/enrollments", {
    slug,
    packageId: tier("Monthly").id,
    who: { kind: "child", clientId: jun.id },
    startMonth: thisMonth,
    answers,
    signatures: sign([waiver, parental]),
  });
  await post(own, `/api/v1/enrollments/${junRequest.request.id}/approve`, {});
  const receipt = await drawPng(
    `<div style="width:300px;height:420px;background:#fff;font-family:Arial,sans-serif;color:#1d2b4f;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
      <div style="width:56px;height:56px;border-radius:50%;background:#2f6fde;color:#fff;display:grid;place-items:center;font-size:30px">✓</div>
      <div style="font-size:15px">Sent via e-wallet</div>
      <div style="font-size:30px;font-weight:700">PHP 6,000.00</div>
      <div style="font-size:13px;color:#56607a">To Riverside Pickleball</div>
      <div style="font-size:13px;color:#56607a">Ref. No. 7012 3456 7890</div>
    </div>`,
    300,
    420,
  );
  const proof = (data) =>
    fetchRetry(par, `${base}/api/portal/students/${jun.id}/payment-proofs`, {
      method: "POST",
      multipart: {
        data: JSON.stringify(data),
        proof: { name: "receipt.png", mimeType: "image/png", buffer: receipt },
      },
    });
  for (const extra of [{ enrollmentId: junRequest.request.id, note: "Paid from my GCash." }, {}]) {
    const res = await proof({
      amountMinor: 600000,
      method: "GCash",
      reference: "7012 3456 7890",
      paidOn: academy.today,
      ...extra,
    });
    if (!res.ok()) throw new Error(`Proof failed: ${await res.text()}`);
  }
  const sessions = await get(par, `/api/public/academies/${slug}/programs/${program.id}/sessions`);
  const miaRequest = await post(par, "/api/portal/enrollments", {
    slug,
    packageId: tier("Trial").id,
    who: { kind: "new_child", firstName: "Mia", lastName: "Park", birthDate: bornYearsAgo(9) },
    lessonId: sessions[0].id,
    answers: { ...answers, shirtSize: undefined, selfRating: 1.5 },
    signatures: sign([waiver, parental]),
  });
  await par.close();

  for (const a of [
    {
      title: "Courts 1 and 2 are being resurfaced",
      body: "From Tuesday the evening program moves to Courts 3 and 4 for two weeks. Same times, same coaches.\n\nParking is by the north gate while the work is on.",
      audience: "all",
      pinned: true,
      publish: "now",
    },
    {
      title: "Evening program: bring water",
      body: "It's still hot at 7pm. Bring a full bottle; the fountain by Court 4 is out.",
      audience: "program",
      audienceId: evening.id,
      publish: "now",
    },
    {
      title: "Holiday schedule",
      body: "No sessions on the public holiday. Make-up sessions are on the Saturday after.",
      audience: "all",
      publish: "schedule",
      publishAt: Date.now() + 3 * 86_400_000,
    },
    {
      title: "Junior tournament sign-ups",
      body: "Sign-ups for the junior round-robin open next month.",
      audience: "all",
      publish: "draft",
    },
  ])
    await post(own, "/api/v1/announcements", a);

  const todayDto = await get(own, "/api/v1/today");
  const campSession = todayDto.lessons.find((l) => l.kind === "event") ?? todayDto.lessons[0];
  await own.close();
  return {
    slug,
    today,
    jun: jun.id,
    campSession: campSession.id,
    junRequest: junRequest.request.id,
    miaRequest: miaRequest.request.id,
    monthly: tier("Monthly").id,
    staffToken: staffInvite.link.split("/join/")[1],
    familyToken: familyInvite.link.split("/join/")[1],
  };
}

// --- Capturing -------------------------------------------------------------------------------------

const shots = [];

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

async function visit(page, path) {
  let res = await page.goto(`${base}${path}`);
  for (let i = 0; i < 2 && res && res.status() >= 500; i++) res = await page.goto(`${base}${path}`);
  await settle(page);
}

/** The whole page (phones), or the first screen plus the whole page when it's taller (desktop). */
async function shoot(page, name, vp) {
  const file = `${outDir}/${name}-${vp}.png`;
  if (vp === "mobile") {
    await page.screenshot({ path: file, fullPage: true });
  } else {
    await page.screenshot({ path: file });
    const tall = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 40,
    );
    if (tall) {
      const full = `${outDir}/${name}-${vp}-full.png`;
      await page.screenshot({ path: full, fullPage: true });
      shots.push({ file: full, vp, kind: "full", name });
    }
  }
  shots.push({ file, vp, kind: vp === "mobile" ? "full" : "fold", name });
  console.log(`wrote ${file}`);
}

/** The open sheet (dialog) alone, plus its scrolled-down states when its body scrolls. */
async function shootDialog(page, name, vp) {
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor();
  await page.waitForTimeout(400);
  const file = `${outDir}/${name}-${vp}.png`;
  await dialog.screenshot({ path: file });
  shots.push({ file, vp, kind: "element", name });
  console.log(`wrote ${file}`);
  const body = dialog.locator(".overflow-y-auto").first();
  if (!(await body.count())) return;
  for (let i = 2; i <= 4; i++) {
    const more = await body.evaluate((el) => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) return false;
      el.scrollTop += el.clientHeight - 48;
      return true;
    });
    if (!more) break;
    await page.waitForTimeout(250);
    const next = `${outDir}/${name}-${vp}-${i}.png`;
    await dialog.screenshot({ path: next });
    shots.push({ file: next, vp, kind: "element", name: `${name} ${i}` });
    console.log(`wrote ${next}`);
  }
}

async function shootSection(page, selector, name, vp) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const file = `${outDir}/${name}-${vp}.png`;
  await el.screenshot({ path: file });
  shots.push({ file, vp, kind: "element", name });
  console.log(`wrote ${file}`);
}

async function tryStep(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.warn(`skipped ${label}: ${String(err).split("\n")[0]}`);
  }
}

async function staff(vp, s) {
  const ctx = await newContext(vp);
  await signIn(ctx, emails.owner, NAMES.owner);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  const pages = [
    ["today", "/"],
    ["team", "/team"],
    ["packages-public", "/packages?tab=public"],
    ["client-overview", `/clients/${s.jun}`],
    ["client-progress", `/clients/${s.jun}?tab=progress`],
    ["session-roster", `/sessions/${s.campSession}`],
    ["enrollments", "/enrollments"],
    ["request-new-student", `/enrollments/${s.miaRequest}`],
    ["request-approved", `/enrollments/${s.junRequest}`],
    ["renewals", "/enrollments?view=renewals"],
    ["money", "/money"],
    ["announcements", "/announcements"],
    ["announcements-drafts", "/announcements?tab=draft"],
  ];
  for (const [name, path] of pages) {
    await tryStep(name, async () => {
      await visit(page, path);
      await shoot(page, name, vp);
    });
  }
  await tryStep("team-invite", async () => {
    await visit(page, "/team?invite=1");
    await page.getByLabel("Their Google email").fill("alex.rivera@example.com");
    await page.getByRole("button", { name: "Create invite link" }).click();
    await page.getByRole("heading", { name: "Invite link ready" }).waitFor();
    await shootDialog(page, "team-invite-link", vp);
  });
  await tryStep("settings", async () => {
    await visit(page, "/settings");
    await shootSection(page, "#academy-profile", "settings-academy-profile", vp);
    await shootSection(page, "#coach-profile", "settings-coach-profile", vp);
    await shootSection(page, "#consents", "settings-consents", vp);
  });
  await tryStep("tier-editor", async () => {
    await visit(page, "/packages?tab=public");
    await page.getByRole("button", { name: "Edit Monthly plus" }).click();
    await shootDialog(page, "tier-editor", vp);
  });
  await tryStep("note-sheet", async () => {
    await visit(page, `/clients/${s.jun}`);
    await page.getByRole("button", { name: "Add a note" }).click();
    await shootDialog(page, "note-sheet", vp);
  });
  await tryStep("assessment-sheet", async () => {
    await visit(page, `/clients/${s.jun}`);
    await page.getByRole("button", { name: "New assessment" }).click();
    await shootDialog(page, "assessment-sheet", vp);
  });
  await tryStep("roster-medical", async () => {
    await visit(page, `/sessions/${s.campSession}`);
    await page
      .getByRole("button", { name: /Medical/ })
      .first()
      .click();
    await shootDialog(page, "roster-medical-sheet", vp);
  });
  await tryStep("approve-sheet", async () => {
    await visit(page, `/enrollments/${s.miaRequest}`);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await shootDialog(page, "approve-sheet", vp);
  });
  await tryStep("proof-viewer", async () => {
    await visit(page, "/money");
    await page
      .getByRole("button", { name: /^View / })
      .first()
      .click();
    await shootDialog(page, "proof-viewer", vp);
  });
  await tryStep("announcement-composer", async () => {
    await visit(page, "/announcements?new=1");
    await shootDialog(page, "announcement-composer", vp);
  });
  await ctx.close();
}

async function coachRole(vp, s) {
  const ctx = await newContext(vp);
  await signIn(ctx, emails.coach, NAMES.coach);
  const page = await ctx.newPage();
  for (const [name, path] of [
    ["coach-today", "/"],
    ["coach-clients", "/clients"],
    ["coach-schedule", "/schedule"],
    ["coach-client", `/clients/${s.jun}`],
  ]) {
    await tryStep(name, async () => {
      await visit(page, path);
      await shoot(page, name, vp);
    });
  }
  await ctx.close();
}

async function portal(vp, s) {
  const ctx = await newContext(vp);
  await signIn(ctx, emails.parent, NAMES.parent);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  for (const [name, path] of [
    ["portal-home", "/my"],
    ["portal-progress", `/my/${s.jun}/progress`],
    ["portal-schedule", `/my/${s.jun}/schedule`],
    ["portal-coaches", `/my/${s.jun}/coaches`],
    ["portal-payments", `/my/${s.jun}/payments`],
    ["portal-pay", `/my/${s.jun}/pay?request=${s.junRequest}`],
    ["portal-profile", `/my/${s.jun}/profile`],
    ["portal-consents", `/my/${s.jun}/consents`],
    ["portal-announcements", "/my/announcements"],
    ["portal-notifications", "/my/notifications"],
    ["portal-settings", "/my/settings"],
    ["portal-more", "/my/more"],
    ["portal-enroll", "/my/enroll"],
  ]) {
    await tryStep(name, async () => {
      await visit(page, path);
      await shoot(page, name, vp);
    });
  }
  await tryStep("portal-profile-edit", async () => {
    await visit(page, `/my/${s.jun}/profile`);
    await page.getByRole("button", { name: /^Edit/ }).first().click();
    await shootDialog(page, "portal-profile-edit", vp);
  });
  await tryStep("portal-pay-error", async () => {
    await visit(page, `/my/${s.jun}/pay?request=${s.junRequest}`);
    await page.getByRole("button", { name: /^Send/ }).last().click();
    await page.waitForTimeout(500);
    await shoot(page, "portal-pay-error", vp);
  });
  await ctx.close();
  if (vp === "mobile") {
    const ios = await newContext(vp, { userAgent: IPHONE_UA });
    await signIn(ios, emails.parent, NAMES.parent);
    const p = await ios.newPage();
    await tryStep("portal-notifications-ios", async () => {
      await visit(p, "/my/notifications");
      await shoot(p, "portal-notifications-ios", vp);
    });
    await ios.close();
  }
}

async function wizard(vp, s) {
  const anon = await newContext(vp);
  const a = await anon.newPage();
  const url = `/a/${s.slug}/enroll?package=${s.monthly}`;
  await tryStep("wizard-signin", async () => {
    await visit(a, url);
    await shoot(a, "wizard-signin", vp);
    await a.getByRole("button", { name: "Create a passkey account" }).click();
    await a.waitForTimeout(400);
    await shoot(a, "wizard-passkey", vp);
  });
  await anon.close();

  const ctx = await newContext(vp);
  await signIn(ctx, emails.parent, NAMES.parent);
  const w = await ctx.newPage();
  w.setDefaultTimeout(20_000);
  const next = async (heading, name) => {
    await w.getByRole("button", { name: "Continue" }).click();
    await w.getByRole("heading", { level: 1, name: heading }).waitFor();
    await settle(w);
    await shoot(w, name, vp);
  };
  const toggle = (locator) => locator.locator("xpath=ancestor::label[1]").click();
  await tryStep("wizard", async () => {
    await visit(w, url);
    await shoot(w, "wizard-who", vp);
    await w.getByRole("button", { name: "Continue" }).click();
    await w.waitForTimeout(300);
    await shoot(w, "wizard-who-error", vp);
    await toggle(w.getByRole("radio", { name: /^(My child|Add another child)/ }));
    await w.getByLabel("Child's first name").fill(vp === "desktop" ? "Leo" : "Ava");
    await w.getByLabel("Child's last name").fill("Park");
    await w.getByLabel("Child's birth date").fill(bornYearsAgo(11));
    await shoot(w, "wizard-who-filled", vp);
    await next(/^About .*'s game$/, "wizard-level");
    await toggle(w.getByRole("radio", { name: /^2\.5/ }));
    await w.getByRole("button", { name: /Training shirt size/ }).click();
    await w.getByRole("option", { name: /^Kids M/ }).click();
    await next("Contact and safety", "wizard-contact");
    await w.getByLabel("Your mobile number").fill("+1 555 0190");
    await w.getByLabel("Emergency contact", { exact: true }).fill("Grace Park");
    await w.getByLabel("Emergency contact's phone").fill("+1 555 0190");
    await next("Which month?", "wizard-when");
    await toggle(w.getByRole("radio", { name: /^This month/ }));
    await next("Consent forms", "wizard-consents");
    await toggle(w.getByRole("checkbox", { name: /Waiver and release/ }));
    await toggle(w.getByRole("checkbox", { name: /Parental consent/ }));
    await next("Check and send", "wizard-review");
    await w.getByRole("button", { name: "Send request" }).click();
    await w.getByRole("heading", { name: "Request sent" }).waitFor();
    await settle(w);
    await shoot(w, "wizard-done", vp);
  });
  await ctx.close();
}

async function publicPages(vp, s) {
  const ctx = await newContext(vp);
  const page = await ctx.newPage();
  for (const [name, path] of [
    ["public-academy", `/a/${s.slug}`],
    ["public-rates", `/a/${s.slug}/rates`],
    ["about", "/about"],
    ["privacy", "/privacy"],
    ["terms", "/terms"],
    ["join-staff", `/join/${s.staffToken}`],
    ["join-family", `/join/${s.familyToken}`],
    ["sign-in", "/sign-in"],
  ]) {
    await tryStep(name, async () => {
      await visit(page, path);
      await shoot(page, name, vp);
    });
  }
  if (vp === "mobile") {
    // The first screen as a phone shows it, then partway down (the contact bar's turn).
    await tryStep("public-academy-screens", async () => {
      await visit(page, `/a/${s.slug}`);
      const first = `${outDir}/public-academy-first-screen-mobile.png`;
      await page.screenshot({ path: first });
      shots.push({ file: first, vp, kind: "element", name: "public-academy first screen" });
      await page.evaluate(() => window.scrollTo(0, 1400));
      await page.waitForTimeout(700);
      const scrolled = `${outDir}/public-academy-scrolled-mobile.png`;
      await page.screenshot({ path: scrolled });
      shots.push({ file: scrolled, vp, kind: "element", name: "public-academy scrolled" });
      console.log(`wrote ${first}, ${scrolled}`);
    });
  }
  if (vp === "desktop") {
    await tryStep("rates-print", async () => {
      await page.setViewportSize({ width: 794, height: 1123 });
      await visit(page, `/a/${s.slug}/rates`);
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(300);
      const file = `${outDir}/public-rates-print.png`;
      await page.screenshot({ path: file, fullPage: true });
      shots.push({ file, vp: "print", kind: "print", name: "public-rates-print" });
      console.log(`wrote ${file}`);
    });
  }
  await ctx.close();
  const bare = await newContext(vp);
  await signIn(bare, emails.bare, "Alex Rivera");
  const b = await bare.newPage();
  await tryStep("welcome", async () => {
    await visit(b, "/welcome");
    await shoot(b, "welcome", vp);
  });
  await bare.close();
}

async function emptyStates(vp) {
  const ctx = await newContext(vp);
  await signIn(ctx, `${vp}-${emails.fresh}`, "Jo Mendoza", "coach");
  await post(ctx, "/api/v1/workspace/onboard", {
    name: "Mendoza Pickleball",
    currency: "PHP",
    timezone: "Asia/Manila",
    locale: "en-PH",
    withSampleData: false,
  }).catch(() => undefined);
  const page = await ctx.newPage();
  for (const [name, path] of [
    ["empty-enrollments", "/enrollments"],
    ["empty-money", "/money"],
    ["empty-announcements", "/announcements"],
    ["empty-team", "/team"],
    ["empty-packages-public", "/packages?tab=public"],
  ]) {
    await tryStep(name, async () => {
      await visit(page, path);
      await shoot(page, name, vp);
    });
  }
  await tryStep("empty-settings-consents", async () => {
    await visit(page, "/settings");
    await shootSection(page, "#consents", "empty-settings-consents", vp);
  });
  await ctx.close();
}

// --- Review sheets ---------------------------------------------------------------------------------

function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Lays slices of the captures out on one page and saves it (no image library needed). */
async function renderSheet(file, columns, colWidth, colHeight) {
  const html = columns
    .map(
      (c) => `<figure style="margin:0;display:flex;flex-direction:column;gap:6px">
        <figcaption style="font:600 13px system-ui;color:#333">${c.caption}</figcaption>
        <div style="width:${colWidth}px;height:${c.height}px;overflow:hidden;background:#fff;outline:1px solid #bbb">
          <img src="data:image/png;base64,${c.data}" style="display:block;width:${c.width}px;margin-top:-${c.offset}px">
        </div></figure>`,
    )
    .join("");
  const ctx = await browser.newContext({
    viewport: { width: colWidth * columns.length + 24 * (columns.length + 1), height: colHeight },
  });
  const page = await ctx.newPage();
  await page.setContent(
    `<body style="margin:0;padding:12px 24px;background:#d4d4d8;display:flex;gap:24px;align-items:flex-start">${html}</body>`,
  );
  await page.waitForTimeout(100);
  await page.screenshot({ path: file, fullPage: true });
  await ctx.close();
}

async function buildSheets() {
  const dir = `${outDir}/sheets`;
  await mkdir(dir, { recursive: true });
  // Phones: every page and sheet in 844px slices, three to a sheet, in capture order.
  const slices = [];
  for (const s of shots.filter((x) => x.vp === "mobile")) {
    const buf = await readFile(s.file);
    const { width, height } = pngSize(buf);
    const cssW = width / 2;
    const cssH = height / 2;
    const n = Math.max(1, Math.ceil(cssH / 844));
    const data = buf.toString("base64");
    for (let i = 0; i < n; i++) {
      const offset = i * 844;
      slices.push({
        caption: `${s.name}${n > 1 ? ` ${i + 1}/${n}` : ""}`,
        data,
        width: cssW,
        offset,
        height: Math.min(844, cssH - offset),
      });
    }
  }
  for (let i = 0; i < slices.length; i += 3) {
    const file = `${dir}/mobile-${String(i / 3 + 1).padStart(2, "0")}.png`;
    await renderSheet(file, slices.slice(i, i + 3), 390, 900);
    console.log(`wrote ${file}`);
  }
  // Desktop: the rest of a tall page, 900px at a time (the first screen is its own capture).
  for (const s of shots.filter((x) => x.vp === "desktop" && x.kind === "full")) {
    const buf = await readFile(s.file);
    const { width, height } = pngSize(buf);
    const data = buf.toString("base64");
    for (let i = 1; i * 900 < height; i++) {
      const file = `${dir}/${s.name}-desktop-s${i + 1}.png`;
      await renderSheet(
        file,
        [
          {
            caption: `${s.name} ${i + 1}`,
            data,
            width,
            offset: i * 900,
            height: Math.min(900, height - i * 900),
          },
        ],
        width,
        960,
      );
      console.log(`wrote ${file}`);
    }
  }
}

// --- Run -------------------------------------------------------------------------------------------

const state = await setUp();
await writeFile(`${outDir}/state.json`, JSON.stringify({ ...state, emails }, null, 2));
console.log(`academy ready: /a/${state.slug}`);
const steps = [
  ["staff", staff],
  ["coach", coachRole],
  ["portal", portal],
  ["public", publicPages],
  ["empty", emptyStates],
  ["wizard", wizard],
];
for (const [group, fn] of steps) {
  if (!groups.has(group)) continue;
  for (const vp of Object.keys(VIEWPORTS).filter((v) => wanted.includes(v))) await fn(vp, state);
}
if (process.env.SHOT_SHEETS !== "0") await buildSheets();
await browser.close();
