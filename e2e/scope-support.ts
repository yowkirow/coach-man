import type { TestInfo } from "@playwright/test";
import type {
  FamilyAccessDto,
  MeDto,
  PortalStudentDto,
  PortalTeenInviteCreatedDto,
  TodayDto,
} from "../src/shared/api-types";
import { answersFor, sendOk } from "./enroll-support";
import { sendProofOk } from "./proof-support";
import {
  addMember,
  bornYearsAgo,
  type Coach,
  expect,
  linkFamily,
  listAcademy,
  onboard,
  type PersonaSession,
  type Personas,
  pngImage,
  portalCall,
  shiftMonth,
  testEmail,
  uploadPng,
  uuid,
} from "./support";

// Shared by the scope specs (portal-scope, files): one academy with two families and everything a
// family can own (a photo, a pickup person with a photo, a payment proof with a screenshot, an
// enrollment request, a signed consent, a teen's login link), staff of every role, a second
// academy with its own family, and someone linked to nobody.

export interface StudentFiles {
  id: string;
  photoKey: string;
  pickupId: string;
  pickupPhotoKey: string;
  proofId: string;
  proofKey: string;
}

export interface FamilyWorld {
  tag: string;
  workspaceId: string;
  slug: string;
  today: string;
  tierId: string;
  consent: { id: string; version: number };
  logoKey: string;
  qrKey: string;
  coachPhotoKey: string;
  /** Mia, 15: the student everyone tries to reach. */
  mia: StudentFiles & { requestId: string; teenInviteId: string; accessA: string; accessC: string };
  /** Leo, 10: the other family's student at the same academy. */
  leo: StudentFiles;
  /** Mia's parent, and her co-parent. */
  parentA: PersonaSession & { userId: string };
  coParent: PersonaSession & { userId: string };
  /** Leo's parent: same academy, other student. */
  parentB: PersonaSession & { userId: string };
  /** Staff of the academy, by role (the owner is the `coach` fixture). */
  coach: PersonaSession;
  admin: PersonaSession;
  /** Another academy: its owner, its logo, its student's photo, and that student's parent. */
  other: {
    workspaceId: string;
    owner: PersonaSession;
    logoKey: string;
    studentId: string;
    photoKey: string;
    family: PersonaSession;
  };
  /** Signed in, linked to nobody. */
  nobody: PersonaSession;
}

/** A pickup person with a photo, added by the family in the portal. */
async function addPickup(
  family: PersonaSession,
  clientId: string,
  name: string,
): Promise<{ id: string; photoKey: string }> {
  const res = await family.context.request.post(`/api/portal/students/${clientId}/pickups`, {
    multipart: {
      data: JSON.stringify({ name, relationship: "Grandmother", phone: "0917 555 0102" }),
      photo: { name: "pickup.png", mimeType: "image/png", buffer: pngImage(96, [196, 140, 112]) },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const student = (await res.json()) as PortalStudentDto;
  const person = student.pickups?.find((p) => p.name === name);
  if (!person?.photoKey) throw new Error(`${name} has no photo`);
  return { id: person.id, photoKey: person.photoKey };
}

export async function familyWorld(
  owner: Coach,
  personas: Personas,
  info: TestInfo,
): Promise<FamilyWorld> {
  const { api, request } = owner;
  const tag = uuid().replace(/-/g, "").slice(0, 10);
  await onboard(api);
  const me = await api.get<MeDto>("/me");
  const { date: today } = await api.get<TodayDto>("/today");
  const slug = await listAcademy(api, info, { enrollmentOpen: true });
  const program = await api.post<{ id: string }>("/groups", {
    name: "Evening program",
    isPublic: true,
  });
  const tier = await api.post<{ id: string }>("/packages", {
    name: "Monthly",
    credits: 6,
    priceMinor: 600000,
    validityMode: "month_end",
    programId: program.id,
    isPublic: true,
  });
  const consent = await api.post<{ id: string; version: number }>("/consent-documents", {
    kind: "waiver",
    title: "Waiver and release",
    body: "Pickleball is a sport with risks.",
    required: true,
    appliesTo: "all",
    active: true,
  });
  const logo = await uploadPng(request, "/academy/logo");
  const qr = await uploadPng(request, "/academy/payment-qr", pngImage(64, [24, 24, 24]));
  const coachPhoto = await uploadPng(request, `/coaches/${me.user.id}/photo`);

  const mia = await api.post<{ id: string }>("/clients", {
    firstName: "Mia",
    lastName: `Santos${tag}`,
    birthDate: bornYearsAgo(15),
    isJunior: true,
    medicalNotes: `LEAKMEDICAL${tag}`,
  });
  const miaPhoto = await uploadPng(request, `/clients/${mia.id}/photo`);
  const leo = await api.post<{ id: string }>("/clients", {
    firstName: "Leo",
    lastName: "Reyes",
    birthDate: bornYearsAgo(10),
    isJunior: true,
  });
  const leoPhoto = await uploadPng(
    request,
    `/clients/${leo.id}/photo`,
    pngImage(32, [10, 120, 60]),
  );

  const family = async (clientId: string, label: string, name: string) => {
    const email = testEmail(label, info);
    const linked = await linkFamily(request, { clientId, email, name, relation: "guardian" });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    const session = await personas.open({ email, name, persona: "none" });
    return { ...session, userId: (linked.body as { userId: string }).userId };
  };
  const parentA = await family(mia.id, "scope-parent-a", "Pat Santos");
  const coParent = await family(mia.id, "scope-coparent", "Sam Santos");
  const parentB = await family(leo.id, "scope-parent-b", "Lee Reyes");

  const miaPickup = await addPickup(parentA, mia.id, `Lola ${tag}`);
  const leoPickup = await addPickup(parentB, leo.id, "Lolo Reyes");
  const miaProof = await sendProofOk(parentA.context.request, mia.id, {
    amountMinor: 1000,
    method: "Bank transfer",
    reference: `BT-${tag}`,
    paidOn: today,
  });
  const leoProof = await sendProofOk(parentB.context.request, leo.id, {
    amountMinor: 2000,
    method: "Bank transfer",
    reference: "BT-LEO-1",
    paidOn: today,
  });
  // Mia's parent asks for next month's Monthly, signing the waiver, and makes her a login link.
  const request0 = await sendOk(parentA.context.request, {
    slug,
    packageId: tier.id,
    who: { kind: "child", clientId: mia.id },
    startMonth: shiftMonth(today.slice(0, 7), 1),
    answers: answersFor({ shirtSize: "", selfRating: null, medicalNotes: "" }),
    signatures: [{ documentId: consent.id, version: consent.version, signerName: "Pat Santos" }],
  });
  const teen = await portalCall(parentA.context.request, "POST", `/students/${mia.id}/teen-invite`);
  expect(teen.status, teen.text).toBe(201);
  const access = await api.get<FamilyAccessDto>(`/clients/${mia.id}/family`);
  const accessOf = (name: string) => access.links.find((l) => l.name === name)?.id ?? "";

  const staff = async (role: "coach" | "admin", name: string) => {
    const email = testEmail(`scope-${role}`, info);
    await addMember(request, { email, name, role });
    return personas.open({ email, name, persona: "none" });
  };
  const coach = await staff("coach", "Casey Coach");
  const admin = await staff("admin", "Alex Admin");

  // Another academy, with its own family.
  const otherOwner = await personas.open({
    email: testEmail("scope-other-owner", info),
    name: "Lee Owner",
    persona: "coach",
  });
  await onboard(otherOwner.api);
  const otherMe = await otherOwner.api.get<MeDto>("/me");
  const otherLogo = await uploadPng(otherOwner.context.request, "/academy/logo");
  const zed = await otherOwner.api.post<{ id: string }>("/clients", {
    firstName: "Zed",
    lastName: "Lim",
    birthDate: bornYearsAgo(11),
    isJunior: true,
  });
  const zedPhoto = await uploadPng(otherOwner.context.request, `/clients/${zed.id}/photo`);
  const otherEmail = testEmail("scope-other-family", info);
  const otherLinked = await linkFamily(otherOwner.context.request, {
    clientId: zed.id,
    email: otherEmail,
    name: "Kim Lim",
    relation: "guardian",
  });
  expect(otherLinked.status).toBe(201);
  const otherFamily = await personas.open({ email: otherEmail, name: "Kim Lim", persona: "none" });

  const nobody = await personas.open({
    email: testEmail("scope-nobody", info),
    name: "Jordan Lake",
    persona: "none",
  });

  return {
    tag,
    workspaceId: me.workspace.id,
    slug,
    today,
    tierId: tier.id,
    consent: { id: consent.id, version: consent.version },
    logoKey: logo.key ?? "",
    qrKey: qr.key ?? "",
    coachPhotoKey: coachPhoto.photoKey ?? "",
    mia: {
      id: mia.id,
      photoKey: miaPhoto.photoKey ?? "",
      pickupId: miaPickup.id,
      pickupPhotoKey: miaPickup.photoKey,
      proofId: miaProof.id,
      proofKey: miaProof.proofKey ?? "",
      requestId: request0.request.id,
      teenInviteId: (teen.json as PortalTeenInviteCreatedDto).invite.id,
      accessA: accessOf("Pat Santos"),
      accessC: accessOf("Sam Santos"),
    },
    leo: {
      id: leo.id,
      photoKey: leoPhoto.photoKey ?? "",
      pickupId: leoPickup.id,
      pickupPhotoKey: leoPickup.photoKey,
      proofId: leoProof.id,
      proofKey: leoProof.proofKey ?? "",
    },
    parentA,
    coParent,
    parentB,
    coach,
    admin,
    other: {
      workspaceId: otherMe.workspace.id,
      owner: otherOwner,
      logoKey: otherLogo.key ?? "",
      studentId: zed.id,
      photoKey: zedPhoto.photoKey ?? "",
      family: otherFamily,
    },
    nobody,
  };
}
