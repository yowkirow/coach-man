import { describe, expect, it } from "vitest";
import {
  batchNotices,
  cancellationNotice,
  cancellationUrgent,
  DEFAULT_FAMILY_PREFS,
  deliveryTime,
  endingSoon,
  FAMILY_NOTICE_KINDS,
  type FamilyNotice,
  type FamilyPrefs,
  familyPayload,
  familyPrefsOf,
  firstLine,
  inQuietHours,
  isPayer,
  leadMoment,
  linkRecipients,
  lowOnCredits,
  NOTICE_AUDIENCE,
  type NoticeItem,
  noticeKey,
  packageSweep,
  paymentReminderDue,
  planDeliveries,
  plannedReminderAt,
  quietEndAfter,
  quietOf,
  renewalReminderDue,
  type StudentLink,
  type SweepPackage,
  sessionReminderDue,
  staffAlertRecipients,
  staffEnrollmentPayload,
  staffProofPayload,
  whoOf,
} from "../../src/shared/notifications";
import { familyNotificationPrefsSchema } from "../../src/shared/schemas";
import { isPushSinkEnabled, PUSH_SINK_PREFIX, pushRoute } from "../../src/worker/lib/push-sink";

const MNL = "Asia/Manila";
/** An instant written in Manila time (UTC+8, no daylight saving). */
const mnl = (local: string) => Date.parse(`${local}+08:00`);
const QUIET = { start: "21:00", end: "07:00" };
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const academy = { academy: "Sample Academy", timezone: MNL, locale: "en-US" };

describe("who hears about a student's news", () => {
  const links: StudentLink[] = [
    { userId: "mom", clientId: "kid", relation: "guardian", minor: true },
    { userId: "dad", clientId: "kid", relation: "guardian", minor: true },
    { userId: "teen", clientId: "kid", relation: "self", minor: true },
    { userId: "gone", clientId: "kid", relation: "guardian", minor: true, revokedAt: 1 },
  ];
  const adult: StudentLink = { userId: "adult", clientId: "me", relation: "self", minor: false };

  it("reaches every active link, never a revoked one or whoever did it", () => {
    expect(linkRecipients(links, { audience: "everyone" })).toEqual(["mom", "dad", "teen"]);
    expect(linkRecipients(links, { audience: "everyone", except: ["dad"] })).toEqual([
      "mom",
      "teen",
    ]);
    expect(linkRecipients([...links, links[0] as StudentLink], { audience: "everyone" })).toEqual([
      "mom",
      "dad",
      "teen",
    ]);
  });

  it("asks the payers for money: parents and adult students, not a teen's own login", () => {
    expect(isPayer(links[0] as StudentLink)).toBe(true);
    expect(isPayer(links[2] as StudentLink)).toBe(false);
    expect(isPayer(adult)).toBe(true);
    expect(linkRecipients(links, { audience: "payers" })).toEqual(["mom", "dad"]);
    expect(linkRecipients([adult], { audience: "payers" })).toEqual(["adult"]);
    // The teen who sent a payment proof hears how it went.
    expect(linkRecipients(links, { audience: "payers", also: ["teen"] })).toEqual([
      "mom",
      "dad",
      "teen",
    ]);
    // A revoked parent never comes back through `also`.
    expect(linkRecipients(links, { audience: "payers", also: ["gone"] })).toEqual(["mom", "dad"]);
  });

  it("picks recipients per kind: parents, a teen's own login, an adult student", () => {
    const guardian: StudentLink = {
      userId: "mom",
      clientId: "kid",
      relation: "guardian",
      minor: true,
    };
    const teen: StudentLink = { userId: "teen", clientId: "kid", relation: "self", minor: true };
    const adultSelf: StudentLink = {
      userId: "adult",
      clientId: "me",
      relation: "self",
      minor: false,
    };
    const hears = (kind: FamilyNotice["kind"]) =>
      linkRecipients([guardian, teen], { audience: NOTICE_AUDIENCE[kind] });
    for (const kind of [
      "session_reminder",
      "session_cancelled",
      "low_credits",
      "package_ending",
      "enrollment_decision",
      "comment",
      "assessment",
      "announcement",
    ] as const) {
      expect(hears(kind)).toEqual(["mom", "teen"]);
    }
    for (const kind of [
      "renewal",
      "proof_confirmed",
      "proof_rejected",
      "payment_voided",
      "payment_reminder",
    ] as const) {
      expect(hears(kind)).toEqual(["mom"]);
    }
    // An adult student hears everything about their own training.
    for (const kind of FAMILY_NOTICE_KINDS) {
      expect(linkRecipients([adultSelf], { audience: NOTICE_AUDIENCE[kind] })).toEqual(["adult"]);
    }
  });

  it("alerts owners and admins on the team, not coaches, not whoever sent it", () => {
    const team = [
      { userId: "owner", role: "owner" },
      { userId: "admin", role: "admin" },
      { userId: "coach", role: "coach" },
      { userId: "legacy", role: "member" },
      { userId: "quiet-admin", role: "admin" },
    ];
    const alertsOff = new Set(["quiet-admin"]);
    expect(staffAlertRecipients(team, { needs: ["enrollment"], alertsOff })).toEqual([
      "owner",
      "admin",
    ]);
    expect(
      staffAlertRecipients(team, { needs: ["enrollment", "money"], alertsOff, except: "admin" }),
    ).toEqual(["owner"]);
  });

  it("sends someone who is staff and family one push for one thing", () => {
    // A coach's session reminder and a parent's use the same kind and key: one log row, one push.
    const asCoach = { userId: "pat", kind: "session_reminder", refKey: "lesson-1" } as const;
    const asParent = { userId: "pat", kind: "session_reminder", refKey: "lesson-1" } as const;
    expect(noticeKey(asCoach)).toBe(noticeKey(asParent));
    const item = sessionItem({ lessonId: "lesson-1", startsAt: mnl("2026-11-06T17:00:00") });
    const twice: FamilyNotice[] = [
      { userId: "pat", workspaceId: "ws", kind: "session_reminder", refKey: "lesson-1", item },
      { userId: "pat", workspaceId: "ws", kind: "session_reminder", refKey: "lesson-1", item },
    ];
    const plan = planDeliveries({
      notices: twice,
      prefs: new Map(),
      withDevices: new Set(["pat"]),
      timezones: new Map([["ws", MNL]]),
      now: mnl("2026-11-06T16:00:00"),
    });
    expect(plan.send).toHaveLength(1);
  });
});

describe("preferences and quiet hours", () => {
  it("defaults to every category on, a reminder an hour before, and quiet 21:00 to 07:00", () => {
    expect(familyPrefsOf(null)).toEqual(DEFAULT_FAMILY_PREFS);
    expect(DEFAULT_FAMILY_PREFS).toMatchObject({
      sessions: true,
      packages: true,
      enrollment: true,
      progress: true,
      announcements: true,
      sessionLead: "1h",
      quietStart: "21:00",
      quietEnd: "07:00",
    });
    // Saved with quiet hours off: they stay off; a stored lead that isn't known falls back.
    const off = familyPrefsOf({ quietStart: null, quietEnd: null });
    expect(quietOf(off)).toBeNull();
    expect(familyPrefsOf({ sessionLead: "soon" as never }).sessionLead).toBe("1h");
  });

  it("validates saved settings: both ends of quiet hours, and different ones", () => {
    const base = { ...DEFAULT_FAMILY_PREFS };
    expect(familyNotificationPrefsSchema.safeParse(base).success).toBe(true);
    expect(
      familyNotificationPrefsSchema.safeParse({ ...base, quietStart: null, quietEnd: null })
        .success,
    ).toBe(true);
    expect(familyNotificationPrefsSchema.safeParse({ ...base, quietEnd: null }).success).toBe(
      false,
    );
    expect(
      familyNotificationPrefsSchema.safeParse({ ...base, quietStart: "07:00", quietEnd: "07:00" })
        .success,
    ).toBe(false);
    expect(familyNotificationPrefsSchema.safeParse({ ...base, sessionLead: "3h" }).success).toBe(
      false,
    );
  });

  it("knows quiet hours across midnight, in the academy's time zone", () => {
    expect(inQuietHours(mnl("2026-11-05T22:00:00"), QUIET, MNL)).toBe(true);
    expect(inQuietHours(mnl("2026-11-06T06:59:00"), QUIET, MNL)).toBe(true);
    expect(inQuietHours(mnl("2026-11-06T07:00:00"), QUIET, MNL)).toBe(false);
    expect(inQuietHours(mnl("2026-11-05T20:59:00"), QUIET, MNL)).toBe(false);
    // 22:00 in Manila is 14:00 UTC: quiet in Manila, not by UTC's clock.
    expect(inQuietHours(mnl("2026-11-05T22:00:00"), QUIET, "UTC")).toBe(false);
    // Daytime quiet hours that don't cross midnight.
    expect(inQuietHours(mnl("2026-11-05T13:00:00"), { start: "12:00", end: "14:00" }, MNL)).toBe(
      true,
    );
    expect(inQuietHours(mnl("2026-11-05T14:00:00"), { start: "12:00", end: "14:00" }, MNL)).toBe(
      false,
    );
  });

  it("holds news that arrives in quiet hours until they end", () => {
    const night = mnl("2026-11-05T22:30:00");
    expect(quietEndAfter(night, QUIET, MNL)).toBe(mnl("2026-11-06T07:00:00"));
    expect(deliveryTime(night, QUIET, MNL)).toBe(mnl("2026-11-06T07:00:00"));
    expect(deliveryTime(mnl("2026-11-06T02:00:00"), QUIET, MNL)).toBe(mnl("2026-11-06T07:00:00"));
    expect(deliveryTime(night, QUIET, MNL, true)).toBe(night);
    expect(deliveryTime(night, null, MNL)).toBe(night);
    const day = mnl("2026-11-05T15:00:00");
    expect(deliveryTime(day, QUIET, MNL)).toBe(day);
  });

  it("plans each notice: devices, categories, quiet hours, urgency", () => {
    const now = mnl("2026-11-05T22:30:00");
    const notice = (
      userId: string,
      kind: FamilyNotice["kind"],
      extra: Partial<FamilyNotice> = {},
    ) =>
      ({
        userId,
        workspaceId: "ws",
        kind,
        refKey: `${kind}-1`,
        item: commentItem(),
        ...extra,
      }) as FamilyNotice;
    const quietOff: FamilyPrefs = { ...DEFAULT_FAMILY_PREFS, quietStart: null, quietEnd: null };
    const progressOff: FamilyPrefs = { ...quietOff, progress: false };
    const plan = planDeliveries({
      notices: [
        notice("night", "comment"),
        notice("awake", "comment"),
        notice("muted", "comment"),
        notice("no-device", "comment"),
        notice("night", "session_cancelled", { refKey: "x", urgent: true }),
        notice("night", "payment_reminder", { refKey: "y", whenQuiet: "skip" }),
      ],
      prefs: new Map([
        ["awake", quietOff],
        ["muted", progressOff],
      ]),
      withDevices: new Set(["night", "awake", "muted"]),
      timezones: new Map([["ws", MNL]]),
      now,
    });
    expect(plan.send.map((n) => `${n.userId}:${n.kind}`)).toEqual([
      "awake:comment",
      "night:session_cancelled",
    ]);
    expect(plan.queue).toEqual([
      {
        notice: expect.objectContaining({ userId: "night", kind: "comment" }),
        sendAfter: mnl("2026-11-06T07:00:00"),
      },
    ]);
  });
});

describe("when a session reminder goes out (Asia/Manila)", () => {
  const start = mnl("2026-11-06T17:00:00");

  it("uses the lead time: an hour, two hours, or 7pm the evening before", () => {
    expect(leadMoment(start, "1h", MNL)).toBe(mnl("2026-11-06T16:00:00"));
    expect(leadMoment(start, "2h", MNL)).toBe(mnl("2026-11-06T15:00:00"));
    expect(leadMoment(start, "evening", MNL)).toBe(mnl("2026-11-05T19:00:00"));
    // The evening before is in the academy's calendar: a 7am session in Manila is 23:00 UTC the
    // day before, but the reminder still comes at 7pm Manila the evening before.
    expect(leadMoment(mnl("2026-11-06T07:00:00"), "evening", MNL)).toBe(mnl("2026-11-05T19:00:00"));
  });

  it("keeps reminders out of quiet hours where it can", () => {
    // 1h before a 7:30am session is 6:30, in quiet hours: quiet hours end at 7:00, still half an
    // hour ahead, so it goes then.
    expect(
      plannedReminderAt({
        startsAt: mnl("2026-11-06T07:30:00"),
        lead: "1h",
        quiet: QUIET,
        tz: MNL,
      }),
    ).toBe(mnl("2026-11-06T07:00:00"));
    // 1h before 7:15am: 7:00 would leave only 15 minutes, so it goes the evening before, just
    // before quiet hours start.
    expect(
      plannedReminderAt({
        startsAt: mnl("2026-11-06T07:15:00"),
        lead: "1h",
        quiet: QUIET,
        tz: MNL,
      }),
    ).toBe(mnl("2026-11-05T20:45:00"));
    // A 10pm session: 9pm is quiet, so 8:45pm.
    expect(
      plannedReminderAt({
        startsAt: mnl("2026-11-05T22:00:00"),
        lead: "1h",
        quiet: QUIET,
        tz: MNL,
      }),
    ).toBe(mnl("2026-11-05T20:45:00"));
    // Outside quiet hours nothing moves.
    expect(plannedReminderAt({ startsAt: start, lead: "2h", quiet: QUIET, tz: MNL })).toBe(
      mnl("2026-11-06T15:00:00"),
    );
    // Evening-before at 7pm inside someone's 6pm quiet start: moves to 5:45pm.
    expect(
      plannedReminderAt({
        startsAt: mnl("2026-11-06T09:00:00"),
        lead: "evening",
        quiet: { start: "18:00", end: "08:00" },
        tz: MNL,
      }),
    ).toBe(mnl("2026-11-05T17:45:00"));
  });

  it("is due from its planned moment until shortly before the session", () => {
    const at = (now: number) =>
      sessionReminderDue({ startsAt: start, lead: "1h", quiet: QUIET, tz: MNL, now });
    expect(at(mnl("2026-11-06T15:59:00"))).toBe(false);
    expect(at(mnl("2026-11-06T16:00:00"))).toBe(true);
    expect(at(mnl("2026-11-06T16:45:00"))).toBe(true);
    // Within ten minutes it would arrive too late to help.
    expect(at(mnl("2026-11-06T16:51:00"))).toBe(false);
    expect(at(start)).toBe(false);
  });

  it("waits for the morning when a late reminder lands in quiet hours, if there's time", () => {
    // Evening-before reminder for 9am tomorrow, planned for 7pm, but the session was booked at
    // 11pm: it waits for quiet hours to end at 7am (still two hours ahead of the session).
    const nine = mnl("2026-11-06T09:00:00");
    expect(
      sessionReminderDue({
        startsAt: nine,
        lead: "evening",
        quiet: QUIET,
        tz: MNL,
        now: mnl("2026-11-05T23:00:00"),
      }),
    ).toBe(false);
    expect(
      sessionReminderDue({
        startsAt: nine,
        lead: "evening",
        quiet: QUIET,
        tz: MNL,
        now: mnl("2026-11-06T07:00:00"),
      }),
    ).toBe(true);
    // A 6:30am session booked at 11pm can't wait for 7am: the reminder goes when it's due.
    const early = mnl("2026-11-06T06:30:00");
    expect(
      sessionReminderDue({
        startsAt: early,
        lead: "1h",
        quiet: QUIET,
        tz: MNL,
        now: mnl("2026-11-05T23:00:00"),
      }),
    ).toBe(true);
  });

  it("tells families about a cancellation they were reminded of, or within a day", () => {
    const now = mnl("2026-11-05T10:00:00");
    expect(cancellationNotice({ startsAt: now + 5 * HOUR, now, reminded: false })).toBe(true);
    expect(cancellationNotice({ startsAt: now + 3 * DAY, now, reminded: false })).toBe(false);
    expect(cancellationNotice({ startsAt: now + 30 * HOUR, now, reminded: true })).toBe(true);
    expect(cancellationNotice({ startsAt: now - HOUR, now, reminded: true })).toBe(false);
  });

  it("sends a cancellation through quiet hours only when the session is before morning", () => {
    const night = mnl("2026-11-05T22:00:00");
    expect(
      cancellationUrgent({
        startsAt: mnl("2026-11-06T07:30:00"),
        now: night,
        quiet: QUIET,
        tz: MNL,
      }),
    ).toBe(true);
    expect(
      cancellationUrgent({
        startsAt: mnl("2026-11-06T17:00:00"),
        now: night,
        quiet: QUIET,
        tz: MNL,
      }),
    ).toBe(false);
    expect(
      cancellationUrgent({
        startsAt: mnl("2026-11-06T07:30:00"),
        now: night,
        quiet: null,
        tz: MNL,
      }),
    ).toBe(false);
  });
});

describe("payment reminders", () => {
  const approved = mnl("2026-11-01T10:00:00");
  const at = (days: number, state: Parameters<typeof paymentReminderDue>[0]["state"]) =>
    paymentReminderDue({ decidedAt: approved, now: approved + days * DAY, state });

  it("reminds two days after approval and again at five, then stops", () => {
    expect(at(1.9, "unpaid")).toBeNull();
    expect(at(2, "unpaid")).toBe(1);
    expect(at(4.99, "partial")).toBe(1);
    expect(at(5, "unpaid")).toBe(2);
    expect(at(6.9, "unpaid")).toBe(2);
    expect(at(7, "unpaid")).toBeNull();
  });

  it("never while a proof waits for review, and never once paid", () => {
    expect(at(3, "proof_pending")).toBeNull();
    expect(at(5.5, "proof_pending")).toBeNull();
    expect(at(3, "paid")).toBeNull();
    expect(at(3, null)).toBeNull();
  });
});

describe("package sweeps", () => {
  const pkg = (over: Partial<SweepPackage>): SweepPackage => ({
    id: "p",
    clientId: "kid",
    name: "10-session pack",
    creditsTotal: 10,
    remaining: 4,
    status: "active",
    expiresOn: "2026-12-31",
    startMonth: null,
    ...over,
  });
  const today = "2026-11-25";

  it("flags one session left, once per package (not a single-session trial)", () => {
    expect(lowOnCredits(pkg({ remaining: 1 }), today)).toBe(true);
    expect(lowOnCredits(pkg({ remaining: 2 }), today)).toBe(false);
    expect(lowOnCredits(pkg({ remaining: 1, creditsTotal: 1 }), today)).toBe(false);
    expect(lowOnCredits(pkg({ remaining: 1, expiresOn: "2026-11-24" }), today)).toBe(false);
    expect(lowOnCredits(pkg({ remaining: 1, status: "expired" }), today)).toBe(false);
  });

  it("flags a days-valid package ending within three days with sessions left", () => {
    expect(endingSoon(pkg({ expiresOn: "2026-11-28" }), today)).toBe(true);
    expect(endingSoon(pkg({ expiresOn: "2026-11-25" }), today)).toBe(true);
    expect(endingSoon(pkg({ expiresOn: "2026-11-29" }), today)).toBe(false);
    expect(endingSoon(pkg({ expiresOn: "2026-11-28", remaining: 0 }), today)).toBe(false);
    // Month-end packages are covered by "Renew for next month".
    expect(endingSoon(pkg({ expiresOn: "2026-11-30", startMonth: "2026-11" }), today)).toBe(false);
  });

  it("offers renewal from five days before the month ends", () => {
    expect(renewalReminderDue("2026-11-24")).toBe(false);
    expect(renewalReminderDue("2026-11-25")).toBe(true);
    expect(renewalReminderDue("2026-11-30")).toBe(true);
    expect(renewalReminderDue("2026-12-26")).toBe(true);
    expect(renewalReminderDue("2026-12-25")).toBe(false);
    expect(renewalReminderDue("2027-02-23")).toBe(true);
  });

  it("builds the day's notices: renewals to the payers, credits and endings to everyone", () => {
    const links: StudentLink[] = [
      { userId: "mom", clientId: "kid", relation: "guardian", minor: true },
      { userId: "teen", clientId: "kid", relation: "self", minor: true },
    ];
    const notices = packageSweep({
      academy: { workspaceId: "ws", name: "Sample Academy", timezone: MNL, locale: "en-US" },
      today,
      packages: [pkg({ id: "low", remaining: 1 }), pkg({ id: "ending", expiresOn: "2026-11-27" })],
      renewals: [
        {
          clientId: "kid",
          fromClientPackageId: "nov",
          tierName: "Monthly A",
          endsOn: "2026-11-30",
          nextMonth: "2026-12",
        },
      ],
      students: new Map([["kid", { firstName: "Ana" }]]),
      links,
    });
    expect(notices.map((n) => `${n.userId}:${n.kind}:${n.refKey}`).sort()).toEqual([
      "mom:low_credits:low",
      "mom:package_ending:ending",
      "mom:renewal:nov",
      "teen:low_credits:low",
      "teen:package_ending:ending",
    ]);
    // Before the last five days, no renewal reminder.
    const early = packageSweep({
      academy: { workspaceId: "ws", name: "Sample Academy", timezone: MNL, locale: "en-US" },
      today: "2026-11-10",
      packages: [],
      renewals: [
        {
          clientId: "kid",
          fromClientPackageId: "nov",
          tierName: "Monthly A",
          endsOn: "2026-11-30",
          nextMonth: "2026-12",
        },
      ],
      students: new Map([["kid", { firstName: "Ana" }]]),
      links,
    });
    expect(early).toEqual([]);
  });
});

function sessionItem(over: Partial<Extract<NoticeItem, { kind: "session_reminder" }>> = {}) {
  return {
    ...academy,
    kind: "session_reminder",
    clientId: "kid",
    lessonId: "lesson-1",
    who: whoOf([{ firstName: "Ana", self: false }]),
    title: "Junior Program",
    startsAt: mnl("2026-11-06T17:00:00"),
    venue: "Tivoli Courts",
    court: "2",
    ...over,
  } as Extract<NoticeItem, { kind: "session_reminder" }>;
}

function commentItem(): Extract<NoticeItem, { kind: "comment" }> {
  return {
    ...academy,
    kind: "comment",
    clientId: "kid",
    who: whoOf([{ firstName: "Ana", self: false }]),
    itemId: "note-1",
    coach: "Pat",
  };
}

describe("what a push says", () => {
  const now = mnl("2026-11-05T19:00:00");
  // Row-like facts carry what a push must never show; the item builders pick first names only.
  const student = { firstName: "Ana", lastName: "Reyes", medicalNotes: "Asthma inhaler" };
  const all = (p: unknown) => JSON.stringify(p);

  it("names a session, its time, and place, and opens the student's schedule", () => {
    const p = familyPayload([sessionItem()], now);
    expect(p).toEqual({
      title: "Session tomorrow at 5:00 PM",
      body: "Ana · Junior Program · Court 2, Tivoli Courts",
      url: "/my/kid/schedule",
      tag: "session:lesson-1",
    });
    // The student reading about their own session isn't named.
    const own = familyPayload(
      [sessionItem({ who: whoOf([{ firstName: "Ana", self: true }]) })],
      now,
    );
    expect(own?.body).toBe("Junior Program · Court 2, Tivoli Courts");
  });

  it("batches several sessions for one person into one push", () => {
    const p = familyPayload(
      [
        sessionItem({
          lessonId: "a",
          startsAt: mnl("2026-11-06T18:30:00"),
          title: "Adult Clinic",
          who: whoOf([{ firstName: "Ben", self: false }]),
          clientId: "ben",
        }),
        sessionItem({ lessonId: "b" }),
      ],
      now,
    );
    expect(p?.title).toBe("2 sessions tomorrow");
    expect(p?.body).toBe("Ana, 5:00 PM, Junior Program · Ben, 6:30 PM, Adult Clinic");
    expect(p?.url).toBe("/my");
  });

  it("uses first names only and never medical notes", () => {
    const who = whoOf([{ ...student, self: false }]);
    const payloads = [
      familyPayload([sessionItem({ who })], now),
      familyPayload([{ ...commentItem(), who }], now),
      familyPayload(
        [
          {
            ...academy,
            kind: "low_credits",
            clientId: "kid",
            who,
            packageId: "p",
            packageName: "Monthly A",
          },
        ],
        now,
      ),
    ];
    for (const p of payloads) {
      expect(all(p)).toContain("Ana");
      expect(all(p)).not.toContain("Reyes");
      expect(all(p)).not.toContain("Asthma");
    }
  });

  it("never puts an amount on the lock screen", () => {
    const approved = familyPayload(
      [
        {
          ...academy,
          kind: "enrollment_decision",
          clientId: "kid",
          who: whoOf([{ firstName: "Ana", self: false }]),
          requestId: "req-1",
          status: "approved",
          tierName: "Monthly A",
          startMonth: "2026-12",
          amountDue: true,
          // What the request row also holds, which a push must never carry.
          ...({ amountMinor: 600000, dueMinor: 600000 } as object),
        } as NoticeItem,
      ],
      now,
    );
    expect(approved).toEqual({
      title: "Enrollment approved",
      body: "Ana is in Monthly A for December. You have an amount due: pay in CoachMan.",
      url: "/my/kid/pay?request=req-1",
      tag: "enrollment:req-1",
    });
    expect(all(approved)).not.toMatch(/6,?000|₱|PHP|\d{3,}/);
    const reminder = familyPayload(
      [
        {
          ...academy,
          kind: "payment_reminder",
          clientId: "kid",
          who: whoOf([{ firstName: "Ana", self: false }]),
          requestId: "req-1",
          tierName: "Monthly A",
        },
      ],
      now,
    );
    expect(reminder?.body).toBe("You have an amount due for Ana's Monthly A.");
    expect(reminder?.url).toBe("/my/kid/pay?request=req-1");
  });

  it("keeps the academy's reasons inside the app", () => {
    const who = whoOf([{ firstName: "Ana", self: false }]);
    const declined = familyPayload(
      [
        {
          ...academy,
          kind: "enrollment_decision",
          clientId: "kid",
          who,
          requestId: "req-2",
          status: "declined",
          tierName: "Monthly A",
          startMonth: null,
          amountDue: false,
          ...({ decisionNote: "The program is full until March" } as object),
        } as NoticeItem,
      ],
      now,
    );
    expect(declined?.title).toBe("Your enrollment request was updated");
    expect(declined?.url).toBe("/my");
    expect(all(declined)).not.toContain("full");
    const rejected = familyPayload(
      [
        {
          ...academy,
          kind: "proof_rejected",
          clientId: "kid",
          who,
          proofId: "proof-1",
          ...({ rejectReason: "The reference number doesn't match" } as object),
        } as NoticeItem,
      ],
      now,
    );
    expect(rejected?.title).toBe("Payment proof not accepted");
    expect(rejected?.url).toBe("/my/kid/payments");
    expect(all(rejected)).not.toContain("reference");
    const comment = familyPayload(
      [{ ...commentItem(), ...({ body: "Knee pain after the drill" } as object) } as NoticeItem],
      now,
    );
    expect(comment).toEqual({
      title: "Coach Pat shared a comment",
      body: "About Ana's training. Open CoachMan to read it.",
      url: "/my/kid/progress",
      tag: "note:note-1",
    });
    expect(all(comment)).not.toContain("Knee");
  });

  it("opens /my for every family push and staff paths for staff alerts", () => {
    const items: NoticeItem[] = [
      sessionItem(),
      { ...sessionItem(), kind: "session_cancelled" },
      commentItem(),
      {
        ...academy,
        kind: "proof_confirmed",
        clientId: "kid",
        who: whoOf([{ firstName: "Ana", self: false }]),
        proofId: "p1",
      },
      {
        ...academy,
        kind: "payment_voided",
        clientId: "kid",
        who: whoOf([{ firstName: "Ana", self: false }]),
        paymentId: "pay1",
      },
      {
        ...academy,
        kind: "announcement",
        clientId: null,
        announcementId: "a1",
        title: "Courts closed",
        excerpt: "Rain",
        multiAcademy: false,
      },
    ];
    for (const item of items) expect(familyPayload([item], now)?.url).toMatch(/^\/my(\/|$)/);
    const staff = staffEnrollmentPayload({
      requestId: "r1",
      studentFirstName: "Ana Reyes",
      tierName: "Monthly A",
      renewal: false,
    });
    expect(staff).toEqual({
      title: "New enrollment request",
      body: "Ana · Monthly A",
      url: "/enrollments/r1",
      tag: "staff-enrollment:r1",
    });
    expect(staffProofPayload({ proofId: "p9", studentFirstName: "Ana" })).toEqual({
      title: "Payment proof to review",
      body: "For Ana. Review it in Money.",
      url: "/money",
      tag: "staff-proof:p9",
    });
  });

  it("gives an announcement's title and first line, naming the academy when it helps", () => {
    const body = "Courts 1 and 2 are closed on Saturday.\n\nWe'll use the indoor hall.";
    const item = {
      ...academy,
      kind: "announcement",
      clientId: null,
      announcementId: "a1",
      title: "Saturday schedule",
      excerpt: firstLine(body),
      multiAcademy: false,
    } as const;
    expect(familyPayload([item], now)).toEqual({
      title: "Saturday schedule",
      body: "Courts 1 and 2 are closed on Saturday.",
      url: "/my/announcements",
      tag: "announcement:a1",
    });
    expect(familyPayload([{ ...item, multiAcademy: true }], now)?.body).toBe(
      "Sample Academy: Courts 1 and 2 are closed on Saturday.",
    );
    expect(firstLine(`${"word ".repeat(60)}end`).length).toBeLessThanOrEqual(120);
  });

  it("travels one push per person and kind", () => {
    const n = (userId: string, kind: FamilyNotice["kind"], refKey: string) =>
      ({ userId, kind, refKey }) as Pick<FamilyNotice, "userId" | "kind" | "refKey">;
    const groups = batchNotices([
      n("mom", "comment", "1"),
      n("mom", "comment", "2"),
      n("mom", "assessment", "3"),
      n("dad", "comment", "1"),
    ]);
    expect(groups.map((g) => g.length)).toEqual([2, 1, 1]);
  });
});

describe("the push test sink", () => {
  const SECRET = "a-long-enough-secret-value";
  const sink = `${PUSH_SINK_PREFIX}abc`;

  it("is never on in production, whatever else is set", () => {
    const env = { APP_ENV: "production", E2E_AUTH_BYPASS: "1", E2E_BYPASS_SECRET: SECRET };
    expect(isPushSinkEnabled(env)).toBe(false);
    // A sink address is refused there: never sent over the network, never recorded.
    expect(pushRoute(env, sink)).toBe("refuse");
    expect(pushRoute(env, "https://fcm.googleapis.com/fcm/send/x")).toBe("network");
  });

  it("needs the E2E bypass outside production", () => {
    expect(isPushSinkEnabled({ APP_ENV: "staging" })).toBe(false);
    expect(isPushSinkEnabled({ APP_ENV: "development", E2E_AUTH_BYPASS: "1" })).toBe(false);
    expect(
      isPushSinkEnabled({
        APP_ENV: "development",
        E2E_AUTH_BYPASS: "1",
        E2E_BYPASS_SECRET: "short",
      }),
    ).toBe(false);
    const env = { APP_ENV: "development", E2E_AUTH_BYPASS: "1", E2E_BYPASS_SECRET: SECRET };
    expect(isPushSinkEnabled(env)).toBe(true);
    expect(pushRoute(env, sink)).toBe("sink");
    // Only the sink prefix: anything else still goes to its push service.
    expect(pushRoute(env, "https://push-sink.invalid.example.com/x")).toBe("network");
  });
});
