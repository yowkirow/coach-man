import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import type {
  ConsentDocumentDto,
  EnrollmentSubmittedDto,
  PublicAcademyDto,
  PublicPackageDto,
  PublicProgramDto,
  PublicSessionDto,
} from "../src/shared/api-types";
import {
  type Api,
  type Coach,
  expect,
  listAcademy,
  portalCall,
  type RawResponse,
  shiftMonth,
  toggle,
} from "./support";

// Helpers for the enrollment specs (WS4b): an academy page that takes enrollment requests,
// requests sent straight to the portal API, and the wizard's steps driven like a person would.

export interface EnrollAcademy {
  slug: string;
  academy: PublicAcademyDto;
  program: PublicProgramDto;
  /** 1 session, asks a self-rating: a trial that books one session of the program. */
  trial: PublicPackageDto;
  /** Month-end, uniform included, asks a self-rating. */
  monthly: PublicPackageDto;
  monthlyPlus: PublicPackageDto;
  thisMonth: string;
  nextMonth: string;
}

/** The public academy page as anyone sees it. */
export async function publicAcademy(
  request: APIRequestContext,
  slug: string,
): Promise<PublicAcademyDto> {
  const res = await request.get(`/api/public/academies/${slug}`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as PublicAcademyDto;
}

/**
 * Lists a seeded academy (its Evening program and the Trial, Monthly, and Monthly plus tiers)
 * with enrollment open.
 */
export async function openEnrollment(
  coach: Coach,
  info: TestInfo,
  profile: Record<string, unknown> = {},
): Promise<EnrollAcademy> {
  const slug = await listAcademy(coach.api, info, { enrollmentOpen: true, ...profile });
  const academy = await publicAcademy(coach.request, slug);
  const tier = (name: string) => {
    const found = academy.packages.find((p) => p.name === name);
    if (!found) throw new Error(`No "${name}" tier on the academy page`);
    return found;
  };
  const program = academy.programs[0];
  if (!program) throw new Error("No public program on the academy page");
  const thisMonth = academy.today.slice(0, 7);
  return {
    slug,
    academy,
    program,
    trial: tier("Trial"),
    monthly: tier("Monthly"),
    monthlyPlus: tier("Monthly plus"),
    thisMonth,
    nextMonth: shiftMonth(thisMonth, 1),
  };
}

/** Required consent forms: one for everyone, one for under-18s. */
export async function addConsents(api: Api) {
  const waiver = await api.post<ConsentDocumentDto>("/consent-documents", {
    kind: "waiver",
    title: "Waiver and release",
    body: "Pickleball is a sport with risks.\n\nI understand them and will follow the coaches' instructions.",
    required: true,
    appliesTo: "all",
    active: true,
  });
  const parental = await api.post<ConsentDocumentDto>("/consent-documents", {
    kind: "parental",
    title: "Parental consent",
    body: "I am the student's parent or guardian and agree to their training.",
    required: true,
    appliesTo: "minors",
    active: true,
  });
  return { waiver, parental };
}

/** Upcoming sessions of a public program, as the wizard lists them. */
export async function publicSessions(
  request: APIRequestContext,
  slug: string,
  programId: string,
): Promise<PublicSessionDto[]> {
  const res = await request.get(`/api/public/academies/${slug}/programs/${programId}/sessions`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as PublicSessionDto[];
}

/** What the wizard's details steps send, filled in. */
export function answersFor(overrides: Record<string, unknown> = {}) {
  return {
    phone: "0917 555 0100",
    emergencyName: "Pat Santos",
    emergencyPhone: "0917 555 0101",
    selfRating: 2.5,
    shirtSize: "Kids M",
    medicalNotes: "Mild asthma",
    pickups: [],
    ...overrides,
  };
}

/** POST /api/portal/enrollments as whoever `request` is signed in as. */
export function sendRequest(request: APIRequestContext, body: Record<string, unknown>) {
  return portalCall(request, "POST", "/enrollments", body);
}

/** Sends a request and expects it made (201). */
export async function sendOk(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<EnrollmentSubmittedDto> {
  const res = await sendRequest(request, body);
  expect(res.status, res.text).toBe(201);
  return res.json as EnrollmentSubmittedDto;
}

/** A new child's request for a month-end tier (next month unless given). */
export function newChildBody(
  setup: EnrollAcademy,
  input: {
    firstName: string;
    lastName?: string;
    birthDate: string;
    tier?: PublicPackageDto;
    startMonth?: string;
    lessonId?: string;
    answers?: Record<string, unknown>;
    signatures?: { documentId: string; version: number; signerName: string }[];
  },
) {
  const tier = input.tier ?? setup.monthly;
  return {
    slug: setup.slug,
    packageId: tier.id,
    who: {
      kind: "new_child",
      firstName: input.firstName,
      lastName: input.lastName ?? "Santos",
      birthDate: input.birthDate,
    },
    ...(tier.validityMode === "month_end"
      ? { startMonth: input.startMonth ?? setup.nextMonth }
      : input.lessonId
        ? { lessonId: input.lessonId }
        : {}),
    answers: answersFor(input.answers),
    signatures: input.signatures ?? [],
  };
}

/** The refusal code of an API answer (`{ error: { code } }`). */
export function codeOf(res: RawResponse): string | undefined {
  return (res.json as { error?: { code?: string } } | undefined)?.error?.code;
}

// --- Driving the wizard --------------------------------------------------------------------------

export async function continueTo(page: Page, heading: string | RegExp) {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

/** "Who's training": a new child with a name and birth date. */
export async function chooseNewChild(
  page: Page,
  child: { firstName: string; lastName: string; birthDate: string },
) {
  await toggle(page.getByRole("radio", { name: /^(My child|Add another child)/ }));
  await page.getByLabel("Child's first name").fill(child.firstName);
  await page.getByLabel("Child's last name").fill(child.lastName);
  await page.getByLabel("Child's birth date").fill(child.birthDate);
}

/** "About <name>'s game": a level (or "Not sure") and, when asked, a shirt size. */
export async function pickLevel(page: Page, level: string, size?: string) {
  await toggle(page.getByRole("radio", { name: new RegExp(`^${level.replace(".", "\\.")}`) }));
  if (size) {
    await page.getByRole("button", { name: /Training shirt size/ }).click();
    await page.getByRole("option", { name: new RegExp(`^${size}`) }).click();
  }
}

/** "Contact and safety": phone and emergency contact (pickups are added by the caller). */
export async function fillContact(page: Page, who = "Pat Santos") {
  await page.getByLabel("Your mobile number").fill("0917 555 0100");
  await page.getByLabel("Emergency contact", { exact: true }).fill(who);
  await page.getByLabel("Emergency contact's phone").fill("0917 555 0101");
}
