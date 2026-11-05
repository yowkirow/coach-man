import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { APIRequestContext, TestInfo } from "@playwright/test";
import type {
  EnrollmentDetailDto,
  PaymentProofDto,
  PortalPaymentProofDto,
} from "../src/shared/api-types";
import { type EnrollAcademy, newChildBody, openEnrollment, sendOk } from "./enroll-support";
import {
  type Coach,
  expect,
  type PersonaSession,
  type Personas,
  pngImage,
  type RawResponse,
  testEmail,
} from "./support";

// Helpers for the payment proof specs (WS4c): an approved enrollment with something to pay, proofs
// sent straight to the portal API (multipart with a screenshot, or JSON for cash), and images.

/** What the academy's page says about paying: a GCash number and a bank account to copy. */
export const PAY_INSTRUCTIONS =
  "GCash 0917 555 0142 (Riverside). BPI 1234-5678-90. Send the screenshot here once you've paid.";

/** The academy's own payment method names (it renamed E-wallet to GCash). */
export const METHODS = ["Cash", "GCash", "Bank transfer"];

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A PNG of random noise, like a big photo of a receipt: noise doesn't compress, so it weighs about
 * width × height × 3 bytes (1100 × 800 is ~2.6 MB, over the 1.5 MB the API takes), and the app
 * has to make it smaller before sending it.
 */
export function noisePng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++)
    rows.push(Buffer.concat([Buffer.from([0]), randomBytes(width * 3)]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A small screenshot stand-in (a solid PNG, well under the limit). */
export const screenshot = (rgb: [number, number, number] = [32, 92, 220]) => pngImage(120, rgb);

async function rawOf(res: import("@playwright/test").APIResponse): Promise<RawResponse> {
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status(), text, json };
}

/**
 * POST /api/portal/students/:clientId/payment-proofs as whoever `request` is signed in as: a
 * multipart form with the screenshot, or JSON alone (cash at the court).
 */
export async function sendProof(
  request: APIRequestContext,
  clientId: string,
  data: Record<string, unknown>,
  image: Buffer | null = screenshot(),
  mimeType = "image/png",
): Promise<RawResponse> {
  const url = `/api/portal/students/${clientId}/payment-proofs`;
  const res = image
    ? await request.post(url, {
        multipart: {
          data: JSON.stringify(data),
          proof: { name: "payment.png", mimeType, buffer: image },
        },
      })
    : await request.post(url, { data });
  return rawOf(res);
}

/** Sends a proof and expects it made (201). */
export async function sendProofOk(
  request: APIRequestContext,
  clientId: string,
  data: Record<string, unknown>,
  image: Buffer | null = screenshot(),
): Promise<PortalPaymentProofDto> {
  const res = await sendProof(request, clientId, data, image);
  expect(res.status, res.text).toBe(201);
  return res.json as PortalPaymentProofDto;
}

export interface Approved {
  setup: EnrollAcademy;
  parent: PersonaSession;
  requestId: string;
  clientId: string;
  /** What approving charged (the Monthly tier's price). */
  dueMinor: number;
  today: string;
}

/**
 * A listed academy with payment instructions and its own method names, a parent who enrolled
 * their new child Mia in Monthly for this month, and the owner's approval: ₱6,000 to pay.
 */
export async function approvedEnrollment(
  seeded: Coach,
  personas: Personas,
  info: TestInfo,
  child = { firstName: "Mia", lastName: "Santos" },
): Promise<Approved> {
  await seeded.api.patch("/workspace", { paymentMethods: METHODS });
  const setup = await openEnrollment(seeded, info, {
    name: "Riverside Pickleball Academy",
    paymentInstructions: PAY_INSTRUCTIONS,
  });
  const parent = await personas.open({
    email: testEmail("proof-parent", info),
    name: "Pat Santos",
    persona: "none",
  });
  const birth = new Date();
  birth.setUTCFullYear(birth.getUTCFullYear() - 12);
  birth.setUTCDate(birth.getUTCDate() - 30);
  const sent = await sendOk(
    parent.context.request,
    newChildBody(setup, {
      firstName: child.firstName,
      lastName: child.lastName,
      birthDate: birth.toISOString().slice(0, 10),
      startMonth: setup.thisMonth,
    }),
  );
  const detail = await seeded.api.post<EnrollmentDetailDto>(
    `/enrollments/${sent.request.id}/approve`,
    {},
  );
  expect(detail.status).toBe("approved");
  return {
    setup,
    parent,
    requestId: sent.request.id,
    clientId: detail.student.clientId,
    dueMinor: detail.payment?.dueMinor ?? 0,
    today: setup.academy.today,
  };
}

/** The staff view of one proof. */
export function proofOf(seeded: Coach, id: string) {
  return seeded.api.get<PaymentProofDto>(`/payment-proofs/${id}`);
}
