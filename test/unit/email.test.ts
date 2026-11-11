import { describe, expect, it } from "vitest";
import { placeholderEmail } from "../../src/shared/domain";
import {
  type EmailDraft,
  emailFailureReason,
  emailFooterLine,
  enrollmentDecisionEmail,
  enrollmentReceivedEmail,
  familyInviteEmail,
  fromNameOf,
  inviteEmailNote,
  isDeliverableEmail,
  oneLine,
  proofDecisionEmail,
  renderEmail,
  signInCodeEmail,
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
    d.academy,
    d.heading,
    ...d.steps.flatMap((s) => [s.title, s.text ?? ""]),
    d.action?.label ?? "",
  ].join("\n");

/** A draft's progress line as [state, title, text] rows. */
const stepsOf = (d: EmailDraft) => d.steps.map((s) => [s.state, s.title, s.text ?? null]);

/** The rendered HTML from <body> on: what the light email draws with its inline styles. */
const bodyOf = (html: string) => html.slice(html.indexOf("<body"));

describe("renderEmail", () => {
  const evil = `<b onclick="x()">Ana & 'Ben'</b>`;
  const escaped = "&lt;b onclick=&quot;x()&quot;&gt;Ana &amp; &#39;Ben&#39;&lt;/b&gt;";

  it("escapes every value in the HTML", () => {
    const { html } = renderEmail({
      academy: evil,
      logoUrl: `${ORIGIN}/logo.png?a=1&b="<x>"`,
      preheader: evil,
      heading: evil,
      steps: [
        { state: "done", title: evil, text: evil },
        { state: "now", title: evil, text: evil },
      ],
      action: { label: evil, url: `${ORIGIN}/my?a=1&b="<x>"` },
    });
    expect(html).not.toContain("<b onclick");
    // The header's name, the preheader, the title, two step titles, two step texts, the button,
    // and the footer; the heading binds its last two words.
    expect(html.split(escaped).length - 1).toBe(9);
    expect(html).toContain(`>${escaped.replace("&amp; &#39;", "&amp;\u00a0&#39;")}</h1>`);
    expect(html).toContain(`href="${ORIGIN}/my?a=1&amp;b=&quot;&lt;x&gt;&quot;"`);
    expect(html).toContain(`src="${ORIGIN}/logo.png?a=1&amp;b=&quot;&lt;x&gt;&quot;"`);
    expect(html).not.toContain('b="<x>"');
  });

  it("puts the button in the step that's now, its link in both parts, and the text has no markup", () => {
    const draft = staffInviteEmail({
      academy: "Riverside",
      inviter: "Ana Reyes",
      role: "coach",
      email: "sam@gmail.com",
      link: LINK,
      expires: "Tue, Nov 17",
    });
    const { html, text } = renderEmail(draft);
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain(`Or open this link: <a href="${LINK}"`);
    // A real heading, never leaving one word on its last line.
    expect(html).toContain(">Join Riverside on\u00a0CoachMan</h1>");
    // The inbox previews the preheader, padded so it stops there.
    expect(html).toContain(
      'mso-hide:all;">Ana Reyes invited you as a coach. The link works once, until Tue, Nov 17.&#847;&zwnj;&nbsp;',
    );
    const button = html.indexOf(">Join Riverside</a>");
    expect(html.indexOf(">Sign in</td>")).toBeLessThan(button);
    expect(button).toBeLessThan(html.indexOf("You&#39;re on the team"));
    expect(text).toBe(
      `${[
        "Join Riverside on CoachMan",
        "1. Ana Reyes invited you\nTo join as a coach.",
        `2. Sign in\nAs sam@gmail.com, with Google or a code we email you. The link works once, until Tue, Nov 17.\nJoin Riverside: ${LINK}`,
        "3. You're on the team\nStudents, progress, the schedule, and check-in. No prices or payments.",
        "Sent with CoachMan for Riverside",
      ].join("\n\n")}\n`,
    );
    expect(text).not.toMatch(/[<>]/);
  });

  it("draws the line ink below done steps and Outline Gray after, and spends lime on the step that's now", () => {
    const { html } = renderEmail({
      academy: "Riverside",
      heading: "Enrollment approved",
      steps: [
        { state: "done", title: "Request sent" },
        { state: "done", title: "Approved" },
        { state: "now", title: "Pay what's due" },
        { state: "next", title: "Paid" },
      ],
      action: { label: "Pay", url: `${ORIGIN}/my` },
    });
    const body = bodyOf(html);
    expect(body.match(/class="cm-done"/g)).toHaveLength(2);
    expect(body.match(/class="cm-next"/g)).toHaveLength(1);
    // The last step has no line below it.
    expect(
      body.match(/class="cm-line-done" style="width:0;border-left:2px solid #111111;/g),
    ).toHaveLength(2);
    expect(
      body.match(/class="cm-line-next" style="width:0;border-left:2px solid #cfcfd4;/g),
    ).toHaveLength(1);
    // Lime is the circle of the step that's now (its fill and its border), nothing else.
    expect(body.match(/#daee63/g)).toHaveLength(2);
    // Dark fills wear a border of their own color, for apps that darken emails on their own.
    expect(body).toContain("border:2px solid #111111;background-color:#111111;");
    expect(body).toContain(
      "border:1px solid #111111;border-radius:999px;background-color:#111111;",
    );
  });

  it("is a 520px column with a dark scheme, and its only image is the academy's logo", () => {
    const plain = renderEmail({
      academy: "The Pickle Spot Academy",
      heading: "Hi",
      steps: [{ state: "now", title: "One" }],
    }).html;
    expect(plain).toContain("max-width:520px");
    expect(plain).toContain('<!--[if mso]><table role="presentation" width="520"');
    expect(plain).toContain('<meta name="color-scheme" content="light dark">');
    expect(plain).toContain("@media (prefers-color-scheme:dark)");
    expect(plain).toContain('<html lang="en">');
    // Without a logo, the academy's initials, and nothing to load.
    expect(plain).toContain(">TP</td>");
    expect(plain).not.toMatch(/<img|<link|<script|https?:/i);
    const logo = `${ORIGIN}/api/public/files/ws/w-1/public/logo.png`;
    const withLogo = renderEmail({
      academy: "The Pickle Spot Academy",
      logoUrl: logo,
      heading: "Hi",
      steps: [{ state: "now", title: "One" }],
    }).html;
    expect(withLogo.match(/<img /g)).toHaveLength(1);
    expect(withLogo).toContain(`<img src="${logo}" alt=""`);
    expect(withLogo).not.toContain(">TP</td>");
  });

  it("ends with one footer line, and puts the button under the line when no step is now", () => {
    const { html, text } = renderEmail({
      academy: "Riverside",
      heading: "Hi",
      steps: [{ state: "done", title: "Sent" }],
      action: { label: "Open", url: `${ORIGIN}/my` },
    });
    expect(text).toBe(`Hi\n\n1. Sent\n\nOpen: ${ORIGIN}/my\n\nSent with CoachMan for Riverside\n`);
    expect(html).toContain(">Sent with CoachMan for Riverside</td>");
    expect(html).toContain(">Open</a>");
    expect(html).not.toMatch(/Reply to this email|Replies to this address/);
  });

  it("leaves out the button and its link when there's none, and previews the step that's now", () => {
    const { html, text } = renderEmail({
      academy: "Riverside",
      heading: "Hi",
      steps: [
        { state: "done", title: "Sent" },
        { state: "now", title: "Confirmed", text: "Riverside confirmed it." },
      ],
    });
    expect(html).not.toContain("Or open this link");
    expect(html).toContain('mso-hide:all;">Riverside confirmed it.&#847;');
    expect(text).toBe(
      "Hi\n\n1. Sent\n\n2. Confirmed\nRiverside confirmed it.\n\nSent with CoachMan for Riverside\n",
    );
  });
});

describe("every email", () => {
  const drafts: EmailDraft[] = [
    staffInviteEmail({
      academy: "Riverside",
      inviter: "Ana",
      role: "coach",
      email: "sam@gmail.com",
      link: LINK,
      expires: "Tue, Nov 17",
    }),
    familyInviteEmail({
      academy: "Riverside",
      firstName: "Mia",
      relation: "self",
      link: LINK,
      expires: "Tue, Nov 17",
    }),
    enrollmentReceivedEmail({
      academy: "Riverside",
      origin: ORIGIN,
      clientId: "c-1",
      student: MIA,
      tierName: "Monthly",
      starts: null,
      renewal: true,
    }),
    ...(["approved", "waitlisted", "declined"] as const).flatMap((status) =>
      [true, false].map((amountDue) =>
        enrollmentDecisionEmail({
          academy: "Riverside",
          origin: ORIGIN,
          requestId: "r-1",
          clientId: "c-1",
          student: MIA,
          status,
          tierName: "Monthly",
          starts: null,
          amountDue,
        }),
      ),
    ),
    ...[true, false].map((confirmed) =>
      proofDecisionEmail({
        academy: "Riverside",
        origin: ORIGIN,
        clientId: "c-1",
        student: SELF,
        confirmed,
        screenshot: false,
      }),
    ),
    staffEnrollmentRequestEmail({
      academy: "Riverside",
      origin: ORIGIN,
      requestId: "r-1",
      studentFirstName: "Mia",
      tierName: "Monthly",
      renewal: false,
    }),
    staffProofEmail({ academy: "Riverside", origin: ORIGIN, studentFirstName: "Mia" }),
  ];

  it("runs done steps, then one step that's now, then next steps, with its button in it", () => {
    const order = { done: 0, now: 1, next: 2 } as const;
    for (const d of drafts) {
      const states = d.steps.map((s) => order[s.state]);
      expect(states, d.subject).toEqual([...states].sort());
      expect(
        d.steps.filter((s) => s.state === "now"),
        d.subject,
      ).toHaveLength(1);
      expect(d.action?.url, d.subject).toMatch(/^https:\/\//);
    }
  });

  it("signs off with one line naming the academy", () => {
    for (const d of drafts) {
      expect(renderEmail(d).text.trimEnd().split("\n\n").at(-1), d.subject).toBe(
        emailFooterLine("Riverside"),
      );
    }
    expect(emailFooterLine("Riverside")).toBe("Sent with CoachMan for Riverside");
  });
});

describe("staff invite email", () => {
  const base = {
    academy: "Riverside Pickleball",
    inviter: "Ana Reyes",
    email: "sam@gmail.com",
    link: LINK,
    expires: "Tue, Nov 17",
  };

  it("says who invited them, as what, which address to sign in as and until when, then what the role does", () => {
    const d = staffInviteEmail({ ...base, role: "front_desk" });
    expect(d.subject).toBe("Join Riverside Pickleball on CoachMan");
    expect(d.preheader).toBe(
      "Ana Reyes invited you as front desk staff. The link works once, until Tue, Nov 17.",
    );
    expect(d.academy).toBe("Riverside Pickleball");
    expect(stepsOf(d)).toEqual([
      ["done", "Ana Reyes invited you", "To join as front desk staff."],
      [
        "now",
        "Sign in",
        "As sam@gmail.com, with Google or a code we email you. The link works once, until Tue, Nov 17.",
      ],
      [
        "next",
        "You're on the team",
        "Payments, enrollments, check-in, the schedule, and family invites. Doesn't coach; no prices, settings, or team.",
      ],
    ]);
    expect(d.action).toEqual({ label: "Join Riverside Pickleball", url: LINK });
  });

  it("names each role as a sentence does, and someone when the inviter has no name", () => {
    expect(staffInviteEmail({ ...base, role: "coach" }).steps[0]?.text).toBe("To join as a coach.");
    expect(staffInviteEmail({ ...base, role: "admin" }).steps[0]?.text).toBe(
      "To join as an admin.",
    );
    expect(staffInviteEmail({ ...base, role: "coach", inviter: "  " }).steps[0]?.title).toBe(
      "Someone invited you",
    );
  });
});

describe("family invite email", () => {
  const base = { academy: "Riverside", link: LINK, expires: "Wed, Nov 18" };

  it("invites a parent to follow the student, with how to sign in and until when", () => {
    const d = familyInviteEmail({ ...base, firstName: "Mia", relation: "guardian" });
    expect(d.subject).toBe("Riverside invited you to its family portal");
    expect(d.heading).toBe("Follow Mia's training");
    expect(stepsOf(d)).toEqual([
      ["done", "Riverside invited you", "To follow Mia's training on CoachMan."],
      [
        "now",
        "Accept the invite",
        "Sign in with Google, a code by email, or a passkey on your phone. No password needed. The link works once, until Wed, Nov 18.",
      ],
      ["next", "You're in", "Mia's sessions, progress, coaches' comments, and payments."],
    ]);
    expect(d.action).toEqual({ label: "Open the invite", url: LINK });
  });

  it("invites a student to their own login", () => {
    const d = familyInviteEmail({ ...base, firstName: "Ana", relation: "self" });
    expect(d.heading).toBe("See your own training");
    expect(d.steps[0]?.text).toBe("To see your own training on CoachMan.");
    expect(d.steps[2]?.text).toBe("Your sessions, progress, coaches' comments, and payments.");
  });
});

describe("sign-in code email", () => {
  const base = { code: "042917", email: "sam@outlook.com", minutes: 10 };

  it("leads with the code, comes from CoachMan without an invite, and has no button", () => {
    const d = signInCodeEmail({ ...base, academy: null, invite: null });
    expect(d.subject).toBe("042917 is your CoachMan code");
    expect(d.preheader).toBe("Enter it on CoachMan within 10 minutes.");
    expect(d.heading).toBe("Your sign-in code");
    expect([d.academy, d.brand]).toEqual(["CoachMan", "coachman"]);
    expect(stepsOf(d)).toEqual([
      ["done", "You asked for a code", "To sign in to CoachMan as sam@outlook.com."],
      ["now", "Enter this code", "It works once, for the next 10 minutes."],
      ["next", "You're signed in", null],
    ]);
    expect(d.code).toBe("042917");
    expect(d.action).toBeUndefined();
    expect(d.footer).toBe(
      "Didn't ask for a code? Ignore this email: nobody can sign in without it.",
    );
  });

  it("with an invite, is the academy's and says what signing in leads to", () => {
    const staff = signInCodeEmail({ ...base, academy: "Riverside", invite: "staff" });
    expect([staff.academy, staff.brand]).toEqual(["Riverside", undefined]);
    expect(stepsOf(staff)).toEqual([
      ["done", "You asked for a code", "To join Riverside on CoachMan as sam@outlook.com."],
      ["now", "Enter this code", "It works once, for the next 10 minutes."],
      ["next", "You're signed in", "Then join Riverside."],
    ]);
    const family = signInCodeEmail({ ...base, academy: "Riverside", invite: "family" });
    expect(stepsOf(family)).toEqual([
      ["done", "You asked for a code", "To accept Riverside's invite as sam@outlook.com."],
      ["now", "Enter this code", "It works once, for the next 10 minutes."],
      ["next", "You're signed in", "Then accept the invite."],
    ]);
    expect(signInCodeEmail({ ...base, academy: " ", invite: "staff" }).academy).toBe(
      "Your academy",
    );
  });
});

describe("a code in an email", () => {
  const draft = signInCodeEmail({
    code: "042917",
    email: "sam@outlook.com",
    minutes: 10,
    academy: null,
    invite: null,
  });
  const ICON = `${ORIGIN}/icons/icon-192.png`;

  it("sits once in a well in the step that's now, and on its own line in the text", () => {
    const { html, text } = renderEmail({ ...draft, logoUrl: ICON });
    const body = bodyOf(html);
    // Not in the title or the preview: only in the well.
    expect(html.split("042917")).toHaveLength(2);
    expect(body).toMatch(
      /<td class="cm-code" style="[^"]*background-color:#f3f3f4;[^"]*font-size:32px;[^"]*font-weight:300;letter-spacing:0\.12em;font-variant-numeric:tabular-nums;[^"]*">042917<\/td>/,
    );
    expect(body.indexOf(">Enter this code</td>")).toBeLessThan(body.indexOf(">042917<"));
    expect(body.indexOf(">042917<")).toBeLessThan(
      body.indexOf("It works once, for the next 10 minutes."),
    );
    expect(html).not.toContain("href");
    expect(html).not.toContain("Or open this link");
    expect(html).toContain(".cm-code{background-color:#1c1c1e!important;color:#ffffff!important}");
    expect(text).toBe(
      `${[
        "Your sign-in code",
        "1. You asked for a code\nTo sign in to CoachMan as sam@outlook.com.",
        "2. Enter this code\n042917\nIt works once, for the next 10 minutes.",
        "3. You're signed in",
        "Didn't ask for a code? Ignore this email: nobody can sign in without it.",
      ].join("\n\n")}\n`,
    );
  });

  it("is escaped, and a footer of its own replaces the usual line", () => {
    const { html, text } = renderEmail({
      academy: "Riverside",
      heading: "Hi",
      steps: [{ state: "now", title: "Enter this code" }],
      code: "<b>1&2</b>",
      footer: "Didn't <ask>?",
    });
    expect(html).toContain(">&lt;b&gt;1&amp;2&lt;/b&gt;</td>");
    expect(html).not.toContain("<b>1&2</b>");
    expect(html).toContain(">Didn&#39;t &lt;ask&gt;?</td>");
    expect(html).not.toContain("Sent with CoachMan for");
    expect(text).toBe("Hi\n\n1. Enter this code\n<b>1&2</b>\n\nDidn't <ask>?\n");
  });

  it("shows CoachMan's own header: the app icon as the tile, its name, and no byline", () => {
    const own = bodyOf(renderEmail({ ...draft, logoUrl: ICON }).html);
    expect(own).toContain(
      `<img src="${ICON}" alt="" width="44" height="44" style="display:block;width:44px;height:44px;border:0;border-radius:14px;">`,
    );
    expect(own).toContain(">CoachMan</div>");
    expect(own).not.toContain("via CoachMan");
    expect(own).not.toContain('class="cm-logo"');
    // With an invite, the academy's tile, its name, and "via CoachMan".
    const academy = bodyOf(
      renderEmail(
        signInCodeEmail({
          code: "042917",
          email: "sam@outlook.com",
          minutes: 10,
          academy: "Riverside",
          invite: "family",
        }),
      ).html,
    );
    expect(academy).toContain(">R</td>");
    expect(academy).toContain(">Riverside</div>");
    expect(academy).toContain(">via CoachMan</div>");
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
  };

  it("tells whoever sent a request that the academy will review it", () => {
    const d = enrollmentReceivedEmail({ ...base, student: MIA });
    expect(d.subject).toBe("We got your request for Mia");
    expect(stepsOf(d)).toEqual([
      ["done", "Request sent", "You asked to enroll Mia in Monthly from December 2026."],
      ["now", "Under review", "Riverside will review it and let you know."],
    ]);
    expect(d.action).toEqual({ label: "See your request", url: `${ORIGIN}/my/c-1/payments` });
  });

  it("words a renewal, an adult's own request, and a trial without a month", () => {
    expect(
      enrollmentReceivedEmail({ ...base, student: MIA, renewal: true, starts: "January 2027" })
        .steps[0]?.text,
    ).toBe("You asked to renew Mia's Monthly for January 2027.");
    const self = enrollmentReceivedEmail({ ...base, student: SELF });
    expect(self.subject).toBe("We got your enrollment request");
    expect(self.steps[0]?.text).toBe("You asked to enroll in Monthly from December 2026.");
    expect(
      enrollmentReceivedEmail({ ...base, student: MIA, tierName: "Trial", starts: null }).steps[0]
        ?.text,
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
    expect(stepsOf(d)).toEqual([
      ["done", "Request sent", "Monthly from December 2026."],
      ["done", "Approved", "Mia is in."],
      ["now", "Pay what's due", "The portal shows how much and how to pay."],
    ]);
    expect(d.action).toEqual({
      label: "Pay from the portal",
      url: `${ORIGIN}/my/c-1/pay?request=r-1`,
    });
    // Never an amount.
    expect(wordsOf(d)).not.toMatch(/₱|PHP|\$|\d+,\d{3}|\d+\.\d{2}/);
  });

  it("approved with nothing owed opens the portal; the student's own login reads it as theirs", () => {
    const paid = enrollmentDecisionEmail({ ...base, student: MIA, status: "approved" });
    expect(stepsOf(paid)).toEqual([
      ["done", "Request sent", "Monthly from December 2026."],
      ["now", "Approved", "Mia is in."],
    ]);
    expect(paid.action).toEqual({ label: "Open CoachMan", url: `${ORIGIN}/my` });
    const self = enrollmentDecisionEmail({
      ...base,
      student: SELF,
      status: "approved",
      starts: null,
    });
    expect(self.subject).toBe("You're in: Monthly");
    expect(stepsOf(self)).toEqual([
      ["done", "Request sent", "Monthly."],
      ["now", "Approved", "You're in."],
    ]);
  });

  it("waitlisted and declined, never with the academy's reason", () => {
    const waitlisted = enrollmentDecisionEmail({ ...base, student: MIA, status: "waitlisted" });
    expect(waitlisted.subject).toBe("Mia is on the waitlist for Monthly");
    expect(stepsOf(waitlisted).slice(1)).toEqual([
      [
        "now",
        "On the waitlist",
        "Mia is on the waitlist. Open CoachMan for any note from Riverside.",
      ],
      ["next", "If a place opens", "You'll get an email when they approve it."],
    ]);
    expect(waitlisted.action?.url).toBe(`${ORIGIN}/my`);
    const declined = enrollmentDecisionEmail({ ...base, student: MIA, status: "declined" });
    expect(declined.subject).toBe("Your request for Mia was updated");
    expect(stepsOf(declined)).toEqual([
      ["done", "Request sent", "Monthly from December 2026."],
      ["now", "Read their reply", "Open CoachMan to see Riverside's reply about Mia's request."],
    ]);
    expect(declined.action?.url).toBe(`${ORIGIN}/my`);
    expect(
      enrollmentDecisionEmail({ ...base, student: SELF, status: "declined" }).steps[1]?.text,
    ).toBe("Open CoachMan to see Riverside's reply about your request.");
  });
});

describe("payment proof decision email", () => {
  const base = {
    academy: "Riverside",
    origin: ORIGIN,
    clientId: "c-1",
    screenshot: true,
  };

  it("confirmed: payment received, linking to Payments", () => {
    const d = proofDecisionEmail({ ...base, student: MIA, confirmed: true });
    expect(d.subject).toBe("Payment received for Mia");
    expect(d.heading).toBe("Payment confirmed");
    expect(stepsOf(d)).toEqual([
      ["done", "Payment proof sent", null],
      ["now", "Confirmed", "Riverside confirmed the payment for Mia."],
    ]);
    expect(d.action).toEqual({ label: "See payments", url: `${ORIGIN}/my/c-1/payments` });
    expect(wordsOf(d)).not.toMatch(/\d/);
  });

  it("not accepted: says so without the reason, and asks for another", () => {
    const d = proofDecisionEmail({ ...base, student: MIA, confirmed: false });
    expect(d.subject).toBe("Payment proof not accepted for Mia");
    expect(stepsOf(d)).toEqual([
      ["done", "Payment proof sent", null],
      [
        "now",
        "Send another",
        "Riverside couldn't accept the payment screenshot for Mia. Open the portal to see why and send another.",
      ],
      ["next", "Confirmed", "Once Riverside accepts it."],
    ]);
    expect(d.action).toEqual({ label: "See why", url: `${ORIGIN}/my/c-1/payments` });
    const cash = proofDecisionEmail({
      ...base,
      student: SELF,
      confirmed: false,
      screenshot: false,
    });
    expect(cash.steps[1]?.text).toBe(
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
    expect(stepsOf(d)).toEqual([
      ["done", "Request sent", "For Mia: Monthly."],
      ["now", "Review it", "Approve, waitlist, or decline it in Enrollments."],
      ["next", "The family hears back", "CoachMan lets them know what you decide."],
    ]);
    expect(d.action).toEqual({ label: "Review the request", url: `${ORIGIN}/enrollments/r-1` });
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
    expect(stepsOf(d)).toEqual([
      ["done", "Payment proof sent", "For Mia."],
      ["now", "Review it", "Confirm it in Money, or mark it not accepted."],
      ["next", "The family hears back", "CoachMan lets them know either way."],
    ]);
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
