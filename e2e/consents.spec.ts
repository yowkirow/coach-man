import type {
  ClientConsentsDto,
  ConsentDocumentDto,
  PortalConsentsDto,
} from "../src/shared/api-types";
import {
  auditLog,
  bornYearsAgo,
  expect,
  linkFamily,
  onboard,
  portalCall,
  portalGet,
  submitSheet,
  test,
  testEmail,
  toggle,
  visit,
  watchErrors,
} from "./support";

// Consents (WS4a): versioned waivers and consents, starter templates, paper signatures recorded by
// staff, and signing in the family portal: a parent or guardian for a minor, adults for
// themselves, never a teen's own login.

const WAIVER = "Activity waiver and release";

test.describe("consents", () => {
  test("an owner starts from a template; a changed text asks for a new signature", async ({
    page,
    coach,
  }) => {
    const { api } = coach;
    await onboard(api);
    const errors = watchErrors(page);
    const kai = await api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Reyes",
      birthDate: bornYearsAgo(30),
    });

    // Settings → Consent forms: a starter waiver, added as a draft with the academy's name in it.
    await visit(page, "/settings");
    const section = page.getByRole("region", { name: "Consent forms" });
    await section.getByRole("button", { name: "Start from a template" }).click();
    const templates = page.getByRole("dialog", { name: "Start from a template" });
    await expect(templates).toContainText("A starting point, not legal advice");
    await expect(templates).toContainText("Data privacy consent");
    await templates.getByRole("button", { name: `Add ${WAIVER}` }).click();
    const editor = page.getByRole("dialog", { name: "Edit consent form" });
    await expect(editor).toContainText("A starting point, not legal advice");
    const text = editor.getByLabel("Text", { exact: true });
    await expect(text).toHaveValue(/E2E Coaching/);
    const active = editor.getByRole("switch", { name: /^Active/ });
    await expect(active).not.toBeChecked();
    await toggle(active);
    await expect(active).toBeChecked();
    await submitSheet(editor, editor.getByRole("button", { name: "Save", exact: true }));
    await expect(section.getByRole("listitem").filter({ hasText: WAIVER })).toContainText("Active");

    // Kai hasn't signed: he's on the "Missing consents" list.
    await visit(page, "/clients?filter=consents");
    await expect(page.getByText("Kai Reyes").first()).toBeVisible();

    // A form signed on paper, recorded from his profile.
    await visit(page, `/clients/${kai.id}`);
    const card = page.getByRole("region", { name: "Consents" });
    const row = card.getByRole("listitem").filter({ hasText: WAIVER });
    await expect(row).toContainText("Missing");
    await row.getByRole("button", { name: `Record paper signature for ${WAIVER}` }).click();
    const paper = page.getByRole("dialog", { name: "Record a paper signature" });
    await paper.getByLabel("Name on the signed form").fill("Kai Reyes");
    await submitSheet(paper, paper.getByRole("button", { name: "Record signature" }));
    await expect(row).toContainText("Signed");
    await expect(row).toContainText("Signed on paper by Kai Reyes, recorded by Robin Coach");

    await visit(page, "/clients?filter=consents");
    await expect(page.getByText("Kai Reyes")).toHaveCount(0);

    // Changing the text after a signature starts version 2.
    await visit(page, "/settings");
    await section.getByRole("button", { name: `Edit ${WAIVER}` }).click();
    await expect(editor).toBeVisible();
    await text.fill(`${await text.inputValue()}\n\nPlayers bring their own water.`);
    await expect(editor).toContainText("Saving starts version 2");
    await submitSheet(editor, editor.getByRole("button", { name: "Save as version 2" }));
    // Signed documents are kept: no delete.
    await expect(section.getByRole("button", { name: `Delete ${WAIVER}` })).toHaveCount(0);

    const docs = await api.get<ConsentDocumentDto[]>("/consent-documents");
    expect(docs[0]).toMatchObject({
      title: WAIVER,
      version: 2,
      active: true,
      signedCurrent: 0,
      signedTotal: 1,
    });
    const standing = await api.get<ClientConsentsDto>(`/clients/${kai.id}/consents`);
    expect(standing.missing).toBe(1);
    expect(standing.documents[0]).toMatchObject({
      status: "needs_resign",
      signature: { documentVersion: 1, relation: "staff", signerName: "Kai Reyes" },
    });

    await visit(page, `/clients/${kai.id}`);
    await expect(row).toContainText("Needs re-signing");
    await expect(row).toContainText("version 2 needs a new signature");
    await visit(page, "/clients?filter=consents");
    await expect(page.getByText("Kai Reyes").first()).toBeVisible();

    const log = await auditLog(coach.request);
    expect(log.some((e) => e.entity === "consent_signature" && e.action === "record")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("a parent signs for a minor in the portal; the minor's own login can't", async ({
    coach,
    personas,
  }, info) => {
    const { api } = coach;
    await onboard(api);
    const waiver = await api.post<ConsentDocumentDto>("/consent-documents", {
      kind: "waiver",
      title: WAIVER,
      body: "Training carries a risk of injury.\n\nFollow the coaches' instructions.",
    });
    const parental = await api.post<ConsentDocumentDto>("/consent-documents", {
      kind: "parental",
      title: "Parental consent",
      body: "I allow my child to train with the academy.",
      appliesTo: "minors",
    });
    const mia = await api.post<{ id: string }>("/clients", {
      firstName: "Mia",
      lastName: "Santos",
      birthDate: bornYearsAgo(15),
      isJunior: true,
    });
    const parentEmail = testEmail("consent-parent", info);
    const teenEmail = testEmail("consent-teen", info);
    for (const [email, name, relation] of [
      [parentEmail, "Pat Santos", "guardian"],
      [teenEmail, "Mia Santos", "self"],
    ] as const) {
      const linked = await linkFamily(coach.request, { clientId: mia.id, email, name, relation });
      expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    }

    // Mia's own login sees the forms but can't sign them.
    const teen = await personas.open({ email: teenEmail, name: "Mia Santos", persona: "none" });
    const teenView = await portalGet<PortalConsentsDto>(
      teen.context.request,
      `/students/${mia.id}/consents`,
    );
    expect(teenView.signer).toMatchObject({ ok: false, code: "needs_guardian" });
    expect(teenView.documents.map((d) => d.title)).toEqual([WAIVER, "Parental consent"]);
    const refused = await portalCall(
      teen.context.request,
      "POST",
      `/students/${mia.id}/consents/${waiver.id}/sign`,
      { signerName: "Mia Santos", version: 1 },
    );
    expect(refused.status).toBe(403);
    await visit(teen.page, `/my/${mia.id}/consents`);
    await expect(teen.page.getByRole("note")).toContainText(
      "A parent or guardian signs these for students under 18",
    );
    await expect(teen.page.getByRole("button", { name: /Read and sign/ })).toHaveCount(0);
    await teen.page.getByRole("button", { name: `Read ${WAIVER}` }).click();
    const teenSheet = teen.page.getByRole("dialog", { name: WAIVER });
    await expect(teenSheet).toContainText("Follow the coaches' instructions.");
    await expect(teenSheet.getByLabel("Type your full name to sign")).toHaveCount(0);

    // The parent reads the form, then signs by typing their name.
    const parent = await personas.open({ email: parentEmail, name: "Pat Santos", persona: "none" });
    const errors = watchErrors(parent.page);
    await visit(parent.page, "/my");
    await parent.page.getByRole("link", { name: /2 consent forms to sign/ }).click();
    await expect(parent.page).toHaveURL(new RegExp(`/my/${mia.id}/consents`));
    await expect(parent.page.getByRole("heading", { name: "2 forms to sign" })).toBeVisible();
    await parent.page.getByRole("button", { name: `Read and sign ${WAIVER}` }).click();
    const sheet = parent.page.getByRole("dialog", { name: WAIVER });
    await expect(sheet).toContainText("Training carries a risk of injury.");
    await sheet.getByLabel("Type your full name to sign").fill("Pat Santos");
    await submitSheet(sheet, sheet.getByRole("button", { name: "Sign" }));
    const signedRow = parent.page.getByRole("listitem").filter({ hasText: WAIVER });
    await expect(signedRow).toContainText("Signed");
    await expect(signedRow).toContainText("Signed by Pat Santos (a parent or guardian)");
    await expect(parent.page.getByRole("heading", { name: "1 form to sign" })).toBeVisible();
    expect(errors).toEqual([]);

    const standing = await api.get<ClientConsentsDto>(`/clients/${mia.id}/consents`);
    expect(standing.minor).toBe(true);
    expect(
      standing.documents.map((d) => [d.document.id, d.status, d.signature?.relation ?? null]),
    ).toEqual([
      [waiver.id, "signed", "guardian"],
      [parental.id, "missing", null],
    ]);
    const log = await auditLog(coach.request);
    expect(log.some((e) => e.entity === "consent_signature" && e.action === "sign")).toBe(true);
  });

  test("an adult signs for themselves", async ({ coach, personas }, info) => {
    const { api } = coach;
    await onboard(api);
    await api.post<ConsentDocumentDto>("/consent-documents", {
      kind: "waiver",
      title: WAIVER,
      body: "Training carries a risk of injury.",
    });
    // For students under 18 only: it doesn't apply to an adult.
    await api.post<ConsentDocumentDto>("/consent-documents", {
      kind: "parental",
      title: "Parental consent",
      body: "I allow my child to train with the academy.",
      appliesTo: "minors",
    });
    const ana = await api.post<{ id: string }>("/clients", {
      firstName: "Ana",
      lastName: "Cruz",
      birthDate: bornYearsAgo(30),
    });
    const email = testEmail("consent-adult", info);
    const linked = await linkFamily(coach.request, {
      clientId: ana.id,
      email,
      name: "Ana Cruz",
      relation: "self",
    });
    expect(linked.status).toBe(201);
    const adult = await personas.open({ email, name: "Ana Cruz", persona: "none" });
    const errors = watchErrors(adult.page);
    await visit(adult.page, `/my/${ana.id}/consents`);
    await expect(adult.page.getByRole("heading", { name: "1 form to sign" })).toBeVisible();
    await expect(adult.page.getByText("Parental consent")).toHaveCount(0);
    await adult.page.getByRole("button", { name: `Read and sign ${WAIVER}` }).click();
    const sheet = adult.page.getByRole("dialog", { name: WAIVER });
    await expect(sheet.getByLabel("Type your full name to sign")).toHaveValue("Ana Cruz");
    await submitSheet(sheet, sheet.getByRole("button", { name: "Sign" }));
    await expect(adult.page.getByRole("listitem").filter({ hasText: WAIVER })).toContainText(
      "Signed by Ana Cruz (the student)",
    );
    expect(errors).toEqual([]);

    const standing = await api.get<ClientConsentsDto>(`/clients/${ana.id}/consents`);
    expect(standing).toMatchObject({ minor: false, missing: 0 });
    expect(standing.documents.map((d) => [d.status, d.signature?.relation])).toEqual([
      ["signed", "self"],
    ]);
  });
});
