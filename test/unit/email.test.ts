import { describe, expect, it } from "vitest";
import { placeholderEmail } from "../../src/shared/domain";
import {
  type EmailDraft,
  emailFailureReason,
  enrollmentDecisionEmail,
  enrollmentReceivedEmail,
  familyInviteEmail,
  fromNameOf,
  inviteEmailNote,
  isDeliverableEmail,
  oneLine,
  proofDecisionEmail,
  renderEmail,
  replyLine,
  staffEnrollmentRequestEmail,
  staffInviteEmail,
  staffProofEmail,
} from "../../src/shared/email";
import { familyInviteSchema } from "../../src/shared/schemas";
import { dayLabel } from "../../src/shared/time";
import { isEmailSinkEnabled } from "../../src/worker/lib/email-sink";

const ORIGIN = "https://coachman.cloud";
const LINK = `${ORIGIN}/join/abc123`;
const MIA = { firstName: "Mia", self: false };
const SELF = { firstName: "Pat", self: true };

/** Everything a reader sees in a draft, as one string. */
const wordsOf = (d: EmailDraft) =>
  [
    d.subject,
    d.preheader ?? "",
    d.heading,
    ...d.paragraphs,
    ...(d.details ?? []).flat(),
    d.action?.label ?? "",
    ...d.footer,
  ].join("\n");

describe("renderEmail", () => {
  const evil = `<b onclick="x()">Ana & 'Ben'</b>`;
  const escaped = "&lt;b onclick=&quot;x()&quot;&gt;Ana &amp; &#39;Ben&#39;&lt;/b&gt;";

  it("escapes every value in the HTML", () => {
    const { html } = renderEmail({
      preheader: evil,
      heading: evil,
      paragraphs: [evil, evil],
      action: { label: evil, url: `${ORIGIN}/my?a=1&b="<x>"` },
      details: [[evil, evil]],
      footer: [evil, evil],
    });
    expect(html).not.toContain("<b onclick");
    // Preheader, heading, title, two paragraphs, the button, two detail cells, two footer lines.
    expect(html.split(escaped).length - 1).toBe(10);
    expect(html).toContain(`href="${ORIGIN}/my?a=1&amp;b=&quot;&lt;x&gt;&quot;"`);
    expect(html).not.toContain('b="<x>"');
  });

  it("puts the action's link in both parts, and the text has no markup", () => {
    const draft = staffInviteEmail({
      academy: "Riverside",
      inviter: "Ana Reyes",
      role: "coach",
      email: "sam@gmail.com",
      link: LINK,
      expires: "Tue, Nov 17",
      replies: true,
    });
    const { html, text } = renderEmail(draft);
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain(`Or open this link: <a href="${LINK}"`);
    expect(text).toContain(`Join Riverside: ${LINK}`);
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain("Sign in with Google as sam@gmail.com.");
    expect(text.endsWith("Reply to this email to reach Ana Reyes.\n")).toBe(true);
  });

  it("is a quiet 560px column: inline styles, one lime button, no images or tracking", () => {
    const { html } = renderEmail({
      heading: "Payment proof to review",
      paragraphs: ["For Mia. Review it in Money."],
      action: { label: "Open Money", url: `${ORIGIN}/money` },
      footer: ["Sent by CoachMan for Riverside."],
    });
    expect(html).toContain("max-width:560px");
    expect(html).toContain('<!--[if mso]><table role="presentation" width="560"');
    expect(html.match(/#daee63/g)).toHaveLength(2);
    expect(html).toContain("color:#111111");
    expect(html).not.toMatch(/<img|<style|<link|<script|class=/i);
    expect(html).toContain('<html lang="en">');
  });

  it("leaves out the button, details, and preheader when there are none", () => {
    const { html, text } = renderEmail({
      heading: "Hi",
      paragraphs: ["One line."],
      footer: ["Sent by CoachMan."],
    });
    expect(html).not.toContain("Or open this link");
    expect(html).not.toContain("display:none");
    expect(text).toBe("Hi\n\nOne line.\n\nSent by CoachMan.\n");
  });
});

describe("staff invite email", () => {
  const base = {
    academy: "Riverside Pickleball",
    inviter: "Ana Reyes",
    email: "sam@gmail.com",
    link: LINK,
    expires: "Tue, Nov 17",
    replies: true,
  };

  it("says who invited them, as what, which account to use, and until when", () => {
    const d = staffInviteEmail({ ...base, role: "front_desk" });
    expect(d.subject).toBe("Join Riverside Pickleball on CoachMan");
    expect(d.paragraphs).toEqual([
      "Ana Reyes invited you to join Riverside Pickleball on CoachMan as front desk staff.",
      "Sign in with Google as sam@gmail.com.",
      "The link works once, until Tue, Nov 17.",
    ]);
    expect(d.action).toEqual({ label: "Join Riverside Pickleball", url: LINK });
    expect(d.footer).toEqual([
      "Sent by CoachMan for Riverside Pickleball.",
      "Ana Reyes invited this address to Riverside Pickleball's team.",
      "Reply to this email to reach Ana Reyes.",
    ]);
  });

  it("names each role as a sentence does", () => {
    expect(staffInviteEmail({ ...base, role: "coach" }).paragraphs[0]).toContain("as a coach.");
    expect(staffInviteEmail({ ...base, role: "admin" }).paragraphs[0]).toContain("as an admin.");
  });

  it("says replies aren't read when the inviter has no address to reply to", () => {
    const d = staffInviteEmail({ ...base, role: "coach", replies: false });
    expect(d.footer.at(-1)).toBe("Replies to this address aren't read.");
  });
});

describe("family invite email", () => {
  const base = { academy: "Riverside", link: LINK, expires: "Wed, Nov 18", replies: false };

  it("invites a parent to follow the student, with how to sign in and until when", () => {
    const d = familyInviteEmail({ ...base, firstName: "Mia", relation: "guardian" });
    expect(d.subject).toBe("Riverside invited you to its family portal");
    expect(d.heading).toBe("Follow Mia's training");
    expect(d.paragraphs).toEqual([
      "Riverside invited you to follow Mia's training on CoachMan: sessions, progress, coaches' comments, and payments.",
      "Sign in with Google, or create a passkey on your phone. No password needed.",
      "The link works once, until Wed, Nov 18.",
    ]);
    expect(d.action).toEqual({ label: "Open the invite", url: LINK });
    expect(d.footer).toEqual([
      "Sent by CoachMan for Riverside.",
      "Riverside invited this address to its family portal.",
      "Replies to this address aren't read.",
    ]);
  });

  it("invites a student to their own login, and replies reach the academy when it has an address", () => {
    const d = familyInviteEmail({ ...base, firstName: "Ana", relation: "self", replies: true });
    expect(d.paragraphs[0]).toBe(
      "Riverside invited you to see your own training on CoachMan: sessions, progress, coaches' comments, and payments.",
    );
    expect(d.footer.at(-1)).toBe("Reply to this email to reach Riverside.");
  });
});

describe("enrollment received email", () => {
  const base = {
    academy: "Riverside",
    origin: ORIGIN,
    clientId: "c-1",
    tierName: "Monthly",
    starts: "December 2026",
    renewal: false,
    replies: true,
  };

  it("tells whoever sent a request that the academy will review it", () => {
    const d = enrollmentReceivedEmail({ ...base, student: MIA });
    expect(d.subject).toBe("We got your request for Mia");
    expect(d.paragraphs).toEqual([
      "You asked to enroll Mia in Monthly from December 2026.",
      "Riverside will review it and let you know.",
    ]);
    expect(d.action).toEqual({ label: "See your request", url: `${ORIGIN}/my/c-1/payments` });
    expect(d.footer.slice(1)).toEqual([
      "You asked to enroll Mia.",
      "Reply to this email to reach Riverside.",
    ]);
  });

  it("words a renewal, an adult's own request, and a trial without a month", () => {
    expect(
      enrollmentReceivedEmail({ ...base, student: MIA, renewal: true, starts: "January 2027" })
        .paragraphs[0],
    ).toBe("You asked to renew Mia's Monthly for January 2027.");
    const self = enrollmentReceivedEmail({ ...base, student: SELF });
    expect(self.subject).toBe("We got your enrollment request");
    expect(self.paragraphs[0]).toBe("You asked to enroll in Monthly from December 2026.");
    expect(
      enrollmentReceivedEmail({ ...base, student: MIA, tierName: "Trial", starts: null })
        .paragraphs[0],
    ).toBe("You asked to enroll Mia in Trial.");
  });
});

describe("enrollment decision email", () => {
  const base = {
    academy: "Riverside",
    origin: ORIGIN,
    requestId: "r-1",
    clientId: "c-1",
    tierName: "Monthly",
    starts: "December 2026",
    amountDue: false,
    replies: false,
  };

  it("approved: who's in, from when, and to pay from the portal when something is owed", () => {
    const d = enrollmentDecisionEmail({
      ...base,
      student: MIA,
      status: "approved",
      amountDue: true,
    });
    expect(d.subject).toBe("Mia is in: Monthly from December 2026");
    expect(d.heading).toBe("Enrollment approved");
    expect(d.paragraphs).toEqual([
      "Mia is in: Monthly from December 2026.",
      "Pay from the portal: it shows what's due and how to pay.",
    ]);
    expect(d.action).toEqual({
      label: "Pay from the portal",
      url: `${ORIGIN}/my/c-1/pay?request=r-1`,
    });
    expect(d.footer[1]).toBe("You're linked to Mia in Riverside's family portal.");
    // Never an amount.
    expect(wordsOf(d)).not.toMatch(/₱|PHP|\$|\d+,\d{3}|\d+\.\d{2}/);
  });

  it("approved with nothing owed opens the portal; the student's own login reads it as theirs", () => {
    const paid = enrollmentDecisionEmail({ ...base, student: MIA, status: "approved" });
    expect(paid.paragraphs).toEqual(["Mia is in: Monthly from December 2026."]);
    expect(paid.action).toEqual({ label: "Open CoachMan", url: `${ORIGIN}/my` });
    const self = enrollmentDecisionEmail({
      ...base,
      student: SELF,
      status: "approved",
      starts: null,
    });
    expect(self.subject).toBe("You're in: Monthly");
    expect(self.footer[1]).toBe("You have your own login to Riverside's family portal.");
  });

  it("waitlisted and declined, never with the academy's reason", () => {
    const waitlisted = enrollmentDecisionEmail({ ...base, student: MIA, status: "waitlisted" });
    expect(waitlisted.subject).toBe("Mia is on the waitlist for Monthly");
    expect(waitlisted.paragraphs[0]).toBe("Mia is on the waitlist for Monthly.");
    expect(waitlisted.action?.url).toBe(`${ORIGIN}/my`);
    const declined = enrollmentDecisionEmail({ ...base, student: MIA, status: "declined" });
    expect(declined.subject).toBe("Your request for Mia was updated");
    expect(declined.paragraphs).toEqual([
      "Open CoachMan to see Riverside's reply about Mia's request.",
    ]);
    expect(declined.action?.url).toBe(`${ORIGIN}/my`);
    expect(
      enrollmentDecisionEmail({ ...base, student: SELF, status: "declined" }).paragraphs[0],
    ).toBe("Open CoachMan to see Riverside's reply about your request.");
  });
});

describe("payment proof decision email", () => {
  const base = {
    academy: "Riverside",
    origin: ORIGIN,
    clientId: "c-1",
    screenshot: true,
    replies: true,
  };

  it("confirmed: payment received, linking to Payments", () => {
    const d = proofDecisionEmail({ ...base, student: MIA, confirmed: true });
    expect(d.subject).toBe("Payment received for Mia");
    expect(d.paragraphs).toEqual(["Riverside confirmed the payment for Mia."]);
    expect(d.action).toEqual({ label: "See payments", url: `${ORIGIN}/my/c-1/payments` });
    expect(wordsOf(d)).not.toMatch(/\d/);
  });

  it("not accepted: says so without the reason, and asks for another", () => {
    const d = proofDecisionEmail({ ...base, student: MIA, confirmed: false });
    expect(d.subject).toBe("Payment proof not accepted for Mia");
    expect(d.paragraphs).toEqual([
      "Riverside couldn't accept the payment screenshot for Mia. Open the portal to see why and send another.",
    ]);
    expect(d.action?.url).toBe(`${ORIGIN}/my/c-1/payments`);
    const cash = proofDecisionEmail({
      ...base,
      student: SELF,
      confirmed: false,
      screenshot: false,
    });
    expect(cash.paragraphs[0]).toBe(
      "Riverside couldn't accept the payment proof for you. Open the portal to see why and send another.",
    );
  });
});

describe("staff alert emails", () => {
  it("a new request or renewal names the student and the package, and opens it", () => {
    const d = staffEnrollmentRequestEmail({
      academy: "Riverside",
      origin: ORIGIN,
      requestId: "r-1",
      studentFirstName: "Mia Santos",
      tierName: "Monthly",
      renewal: false,
    });
    expect(d.subject).toBe("New enrollment request for Mia");
    expect(d.details).toEqual([
      ["Student", "Mia"],
      ["Package", "Monthly"],
    ]);
    expect(d.action).toEqual({ label: "Review the request", url: `${ORIGIN}/enrollments/r-1` });
    expect(d.footer).toEqual([
      "Sent by CoachMan for Riverside.",
      "You're on Riverside's team. To stop these, turn off Enrollments & payments in Settings, Notifications.",
      "Replies to this address aren't read.",
    ]);
    expect(wordsOf(d)).not.toContain("Santos");
    const renewal = staffEnrollmentRequestEmail({
      academy: "Riverside",
      origin: ORIGIN,
      requestId: "r-2",
      studentFirstName: "Mia",
      tierName: "Monthly",
      renewal: true,
    });
    expect(renewal.subject).toBe("Renewal request for Mia");
    expect(renewal.heading).toBe("Renewal request");
  });

  it("a payment proof to review never says how much", () => {
    const d = staffProofEmail({ academy: "Riverside", origin: ORIGIN, studentFirstName: "Mia" });
    expect(d.subject).toBe("Payment proof to review for Mia");
    expect(d.paragraphs).toEqual(["For Mia. Review it in Money."]);
    expect(d.action).toEqual({ label: "Open Money", url: `${ORIGIN}/money` });
    expect(wordsOf(d)).not.toMatch(/\d/);
  });
});

describe("who and what an email may be sent to", () => {
  it("takes one real address", () => {
    for (const ok of [
      "sam@gmail.com",
      " Sam@Gmail.COM ",
      "pat.santos+cm@school.edu.ph",
      "e2e-parent@coachman.test",
    ]) {
      expect(isDeliverableEmail(ok), ok).toBe(true);
    }
  });

  it("skips passkey-only placeholders, .invalid domains, blanks, and anything malformed", () => {
    for (const bad of [
      placeholderEmail("0199f1b2-7c3d-7e4f-8a5b-6c7d8e9f0a1b"),
      placeholderEmail("0199f1b2-7c3d-7e4f-8a5b-6c7d8e9f0a1b").toUpperCase(),
      "pat@school.invalid",
      "pat@push-sink.invalid",
      "",
      "   ",
      null,
      undefined,
      "pat",
      "pat@",
      "@gmail.com",
      "pat@gmail",
      "pat@gmail.",
      "pat@@gmail.com",
      "pat santos@gmail.com",
      "a@b.com, c@d.com",
      "a@b.com;c@d.com",
      "Pat <pat@gmail.com>",
      "pat@gmail.com\r\nBcc: x@y.com",
    ]) {
      expect(isDeliverableEmail(bad), String(bad)).toBe(false);
    }
  });

  it("puts one line in a header: the sender's name and the subject", () => {
    expect(fromNameOf("Riverside Pickleball")).toBe("Riverside Pickleball via CoachMan");
    expect(fromNameOf("  ")).toBe("CoachMan");
    expect(fromNameOf("Smash\r\nBcc: x@y.com")).toBe("Smash Bcc: x@y.com via CoachMan");
    expect(oneLine("We got your request for Mi\n\ta")).toBe("We got your request for Mi a");
  });

  it("the family invite's address is trimmed and lowercased, and empty means none", () => {
    expect(familyInviteSchema.parse({ relation: "guardian", email: " Pat@Gmail.COM " })).toEqual({
      relation: "guardian",
      email: "pat@gmail.com",
    });
    expect(familyInviteSchema.parse({ relation: "self", email: "" }).email).toBeNull();
    expect(familyInviteSchema.parse({ relation: "self" }).email).toBeUndefined();
    expect(familyInviteSchema.safeParse({ relation: "guardian", email: "pat" }).success).toBe(
      false,
    );
  });

  it("the invite link's last day reads as the app writes it", () => {
    expect(dayLabel("2026-11-17", "en-US")).toBe("Tue, Nov 17");
    expect(dayLabel("2026-11-17", "en-GB")).toBe("Tue 17 Nov");
  });
});

describe("when an invite's email didn't go", () => {
  it("the sheet says where it went, or why not", () => {
    expect(inviteEmailNote({ emailedTo: "sam@gmail.com", emailError: null })).toBe(
      "We emailed the link to sam@gmail.com.",
    );
    expect(
      inviteEmailNote({ emailedTo: null, emailError: emailFailureReason("E_RATE_LIMIT_EXCEEDED") }),
    ).toBe(
      "We couldn't email the link: Too many emails went out at once. Copy it and send it yourself.",
    );
    expect(inviteEmailNote({ emailedTo: null, emailError: null })).toBeNull();
  });

  it("gives every failure a short sentence", () => {
    for (const code of [
      "undeliverable",
      "not_configured",
      "E_SENDER_NOT_VERIFIED",
      "E_RECIPIENT_SUPPRESSED",
      "E_RATE_LIMIT_EXCEEDED",
      "E_DAILY_LIMIT_EXCEEDED",
      "E_RECIPIENT_NOT_ALLOWED",
      "E_DELIVERY_FAILED",
      "E_VALIDATION_ERROR",
      "E_SOMETHING_NEW",
    ]) {
      expect(emailFailureReason(code)).toMatch(/^[A-Z].+\.$/);
    }
    expect(emailFailureReason("undeliverable")).toBe("That address can't receive email.");
    expect(emailFailureReason("E_SOMETHING_NEW")).toBe("The email service didn't take it.");
  });

  it("the footer says whether replies are read", () => {
    expect(replyLine("Riverside")).toBe("Reply to this email to reach Riverside.");
    expect(replyLine(null)).toBe("Replies to this address aren't read.");
  });
});

describe("the email sink", () => {
  const SECRET = "x".repeat(32);

  it("is never on in production, whatever else is set", () => {
    expect(
      isEmailSinkEnabled({
        APP_ENV: "production",
        E2E_AUTH_BYPASS: "1",
        E2E_BYPASS_SECRET: SECRET,
      }),
    ).toBe(false);
  });

  it("needs the E2E bypass outside production", () => {
    expect(isEmailSinkEnabled({ APP_ENV: "staging" })).toBe(false);
    expect(isEmailSinkEnabled({ APP_ENV: "development", E2E_AUTH_BYPASS: "1" })).toBe(false);
    expect(
      isEmailSinkEnabled({
        APP_ENV: "development",
        E2E_AUTH_BYPASS: "1",
        E2E_BYPASS_SECRET: "short",
      }),
    ).toBe(false);
    expect(
      isEmailSinkEnabled({ APP_ENV: "staging", E2E_AUTH_BYPASS: "1", E2E_BYPASS_SECRET: SECRET }),
    ).toBe(true);
  });
});
