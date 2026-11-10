import type { APIRequestContext } from "@playwright/test";
import type { EmailKind } from "../src/shared/email";
import { BYPASS_HEADER, bypassSecret, expect } from "./support";

// Helpers for the email spec. Emails never leave the machine: outside production, with the E2E
// bypass on, the Worker records every email in its test sink instead of sending it (see
// src/worker/lib/email-sink.ts), and the specs read what was recorded for an address.

export interface SinkEmail {
  id: string;
  workspaceId: string | null;
  toEmail: string;
  kind: EmailKind;
  subject: string;
  text: string;
  html: string;
  fromName: string | null;
  replyTo: string | null;
  createdAt: number;
}

const bypass = () => ({ [BYPASS_HEADER]: bypassSecret() });

/** Every email the sink recorded for an address, oldest first. */
export async function emailSinkOf(
  request: APIRequestContext,
  address: string,
): Promise<SinkEmail[]> {
  const res = await request.get(`/api/test/email-sink?to=${encodeURIComponent(address)}`, {
    headers: bypass(),
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { items: SinkEmail[] }).items;
}

/**
 * Waits until an address has `count` emails (of `kind`, when given), then returns them: updates
 * and staff alerts go out after the response.
 */
export async function emailsTo(
  request: APIRequestContext,
  address: string,
  kind?: EmailKind,
  count = 1,
): Promise<SinkEmail[]> {
  let found: SinkEmail[] = [];
  await expect
    .poll(
      async () => {
        found = (await emailSinkOf(request, address)).filter((e) => !kind || e.kind === kind);
        return found.length;
      },
      { timeout: 20_000, intervals: [250, 500, 1000] },
    )
    .toBeGreaterThanOrEqual(count);
  return found;
}

/** The first email of a kind to reach an address (waiting for it). */
export async function firstEmailTo(
  request: APIRequestContext,
  address: string,
  kind: EmailKind,
): Promise<SinkEmail> {
  const [first] = await emailsTo(request, address, kind);
  if (!first) throw new Error(`No ${kind} email reached ${address}`);
  return first;
}

/** The link behind an email's button, as its text writes it ("<label>: <url>"). */
export function actionLink(email: SinkEmail): string {
  const match = email.text.match(/^.+: (https?:\/\/\S+)$/m);
  if (!match?.[1]) throw new Error(`No link in the email "${email.subject}"`);
  return match[1];
}

/** A link's path and query, for comparing with the app's own routes. */
export const pathOf = (link: string) => {
  const url = new URL(link);
  return `${url.pathname}${url.search}`;
};
