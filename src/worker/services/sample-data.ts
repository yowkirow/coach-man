import { and, eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "../../shared/ids";
import { currencyDigits } from "../../shared/money";
import { addDays, todayIn, weekdayOf } from "../../shared/time";
import { chunkRows } from "../db/client";
import {
  assessment,
  assessmentScore,
  charge,
  client,
  clientCoach,
  clientPackage,
  creditLedger,
  event,
  eventRegistration,
  goal,
  groupMember,
  lesson,
  lessonSeries,
  note,
  organization,
  packageTemplate,
  payment,
  rate,
  ratingSnapshot,
  skill,
  trainingGroup,
  venue,
} from "../db/schema";
import { inList } from "../lib/sql";
import type { Ctx } from "../types";
import { runBatch } from "./credits";
import { bookClientsIntoLessons, createLessons } from "./lessons";
import { rebuildAllocations } from "./money";

/** Rough price multipliers so synthetic demo prices look plausible in the workspace currency. */
const PRICE_SCALE: Record<string, number> = {
  USD: 1,
  PHP: 25,
  SGD: 1.3,
  MYR: 4,
  AUD: 1.5,
  CAD: 1.4,
  EUR: 0.9,
  GBP: 0.8,
  HKD: 8,
  IDR: 15000,
  INR: 80,
  JPY: 150,
  KRW: 1300,
  NZD: 1.6,
  THB: 35,
  VND: 25000,
  MXN: 18,
};

export interface SampleIds {
  clients: string[];
  groups: string[];
  venues: string[];
  rates: string[];
  packages: string[];
  events: string[];
  series: string[];
  lessons: string[];
}

const SAMPLE_CLIENTS = [
  {
    firstName: "Ana",
    lastName: "Reyes",
    level: "2.5",
    email: "ana.reyes@example.com",
    phone: "+1 555 0101",
  },
  {
    firstName: "Ben",
    lastName: "Ocampo",
    level: "2.5",
    email: "ben.ocampo@example.com",
    phone: "+1 555 0102",
  },
  {
    firstName: "Carla",
    lastName: "Tan",
    level: "3.0",
    email: "carla.tan@example.com",
    phone: "+1 555 0103",
  },
  {
    firstName: "Dev",
    lastName: "Patel",
    level: "2.5",
    email: "dev.patel@example.com",
    phone: "+1 555 0104",
  },
  {
    firstName: "Elle",
    lastName: "Santos",
    level: "2.5",
    email: "elle.santos@example.com",
    phone: "+1 555 0105",
  },
  {
    firstName: "Felix",
    lastName: "Cruz",
    level: "3.0",
    email: "felix.cruz@example.com",
    phone: "+1 555 0106",
  },
  {
    firstName: "Liam",
    lastName: "Gomez",
    level: "3.5",
    email: "liam.gomez@example.com",
    phone: "+1 555 0107",
  },
  {
    firstName: "Maya",
    lastName: "Chen",
    level: "3.5",
    email: "maya.chen@example.com",
    phone: "+1 555 0108",
  },
  {
    firstName: "Noah",
    lastName: "Lim",
    level: "3.5",
    email: "noah.lim@example.com",
    phone: "+1 555 0109",
  },
  {
    firstName: "Priya",
    lastName: "Nair",
    level: "4.0",
    email: "priya.nair@example.com",
    phone: "+1 555 0110",
  },
  {
    firstName: "Sam",
    lastName: "Okafor",
    level: "3.5",
    email: "sam.okafor@example.com",
    phone: "+1 555 0111",
  },
  {
    firstName: "Jun",
    lastName: "Park",
    level: "2.5",
    isJunior: true,
    guardianName: "Grace Park",
    guardianPhone: "+1 555 0190",
  },
  {
    firstName: "Zoe",
    lastName: "Lee",
    level: "2.0",
    isJunior: true,
    guardianName: "Martin Lee",
    guardianPhone: "+1 555 0191",
  },
  {
    firstName: "Tessa",
    lastName: "Ruiz",
    level: "3.0",
    email: "tessa.ruiz@example.com",
    phone: "+1 555 0112",
  },
] as const;

/** Creates a believable, clearly-labelled sample workspace (all clients tagged "sample"). */
export async function seedSampleData(ctx: Ctx): Promise<SampleIds> {
  const { db, workspaceId, settings } = ctx;
  const tz = settings.timezone;
  const today = todayIn(tz);
  const digits = currencyDigits(settings.currency);
  const scale = PRICE_SCALE[settings.currency] ?? 1;
  const price = (major: number) => {
    const raw = major * scale;
    const step = raw >= 1000 ? 50 : raw >= 100 ? 5 : 1;
    return Math.round(raw / step) * step * 10 ** digits;
  };
  const now = Date.now();

  const ids: SampleIds = {
    clients: [],
    groups: [],
    venues: [],
    rates: [],
    packages: [],
    events: [],
    series: [],
    lessons: [],
  };
  const riverside = uuidv7();
  const northside = uuidv7();
  ids.venues.push(riverside, northside);

  const rPrivate = uuidv7();
  const rSemi = uuidv7();
  const rGroup = uuidv7();
  const rClinic = uuidv7();
  ids.rates.push(rPrivate, rSemi, rGroup, rClinic);

  const pPrivate10 = uuidv7();
  const pGroup10 = uuidv7();
  const pGroup5 = uuidv7();
  // A sample program priced like a monthly rates sheet: a trial, and two month-end tiers.
  const pTrial = uuidv7();
  const pMonthly = uuidv7();
  const pMonthlyPlus = uuidv7();
  ids.packages.push(pPrivate10, pGroup10, pGroup5, pTrial, pMonthly, pMonthlyPlus);

  const gBeginners = uuidv7();
  const gIntermediate = uuidv7();
  const gJuniors = uuidv7();
  const gEvening = uuidv7();
  ids.groups.push(gBeginners, gIntermediate, gJuniors, gEvening);

  const clientIds = SAMPLE_CLIENTS.map(() => uuidv7());
  ids.clients.push(...clientIds);
  const byName = (first: string) =>
    clientIds[SAMPLE_CLIENTS.findIndex((c) => c.firstName === first)] as string;

  await runBatch(ctx, [
    db.insert(venue).values([
      {
        id: riverside,
        workspaceId,
        name: "Riverside Park Courts",
        address: "Riverside Park",
        courtCount: 6,
      },
      {
        id: northside,
        workspaceId,
        name: "Northside Rec Center",
        address: "Indoor gym, 2nd floor",
        courtCount: 3,
      },
    ]),
    db.insert(rate).values([
      {
        id: rPrivate,
        workspaceId,
        name: "Private lesson",
        kind: "private",
        durationMinutes: 60,
        priceMinor: price(60),
        unit: "session",
      },
      {
        id: rSemi,
        workspaceId,
        name: "Semi-private (per player)",
        kind: "semi_private",
        durationMinutes: 60,
        priceMinor: price(40),
        unit: "session",
      },
      {
        id: rGroup,
        workspaceId,
        name: "Group session",
        kind: "group",
        durationMinutes: 90,
        priceMinor: price(25),
        unit: "session",
      },
      {
        id: rClinic,
        workspaceId,
        name: "Clinic",
        kind: "clinic",
        durationMinutes: 120,
        priceMinor: price(35),
        unit: "session",
      },
    ]),
    // One statement per tier: a tier binds ~20 values, and D1 allows 100 per statement.
    ...(
      [
        {
          id: pPrivate10,
          workspaceId,
          name: "10 private lessons",
          credits: 10,
          lessonKinds: ["private"],
          priceMinor: price(540),
          validityDays: 120,
        },
        {
          id: pGroup10,
          workspaceId,
          name: "10-session pack",
          credits: 10,
          lessonKinds: ["group", "clinic"],
          priceMinor: price(220),
          validityDays: 90,
        },
        {
          id: pGroup5,
          workspaceId,
          name: "5-session pack",
          credits: 5,
          lessonKinds: ["group", "clinic"],
          priceMinor: price(115),
          validityDays: 60,
        },
        {
          id: pTrial,
          workspaceId,
          name: "Trial",
          description: "Sample tier.",
          credits: 1,
          lessonKinds: ["group"],
          priceMinor: price(60),
          validityDays: 30,
          programId: gEvening,
          sessionsLabel: "1 session",
          validityMode: "days" as const,
          inclusions: [
            "One three-hour coached session",
            "Drills and live play",
            "Court fee included",
          ],
          audience: "Trying the program, or getting back into play.",
          asksSelfRating: true,
          isPublic: true,
          sortOrder: 0,
        },
        {
          id: pMonthly,
          workspaceId,
          name: "Monthly",
          description: "Sample tier.",
          credits: 6,
          lessonKinds: ["group"],
          priceMinor: price(240),
          validityDays: null,
          programId: gEvening,
          sessionsLabel: "4–6 sessions",
          validityMode: "month_end" as const,
          inclusions: [
            "Three-hour coached sessions",
            "Drills, live play, and game review",
            "Court fees included",
            "Training shirt",
          ],
          audience: "Players getting ready for a tournament.",
          includesUniform: true,
          asksSelfRating: true,
          isPublic: true,
          sortOrder: 10,
        },
        {
          id: pMonthlyPlus,
          workspaceId,
          name: "Monthly plus",
          description: "Sample tier.",
          credits: 9,
          lessonKinds: ["group"],
          priceMinor: price(280),
          validityDays: null,
          programId: gEvening,
          sessionsLabel: "7–9 sessions",
          validityMode: "month_end" as const,
          inclusions: [
            "Three-hour coached sessions",
            "Drills, live play, and game review",
            "Court fees included",
            "Training shirt",
          ],
          audience: "Players working on their game over the long term.",
          commitmentNote: "Best over at least two months.",
          includesUniform: true,
          asksSelfRating: true,
          isPublic: true,
          highlight: true,
          sortOrder: 20,
        },
      ] satisfies (typeof packageTemplate.$inferInsert)[]
    ).map((row) => db.insert(packageTemplate).values(row)),
    ...(
      [
        {
          id: gBeginners,
          workspaceId,
          name: "Beginners",
          level: "2.0–2.5",
          color: "#dff04a",
          capacity: 8,
          defaultRateId: rGroup,
          defaultVenueId: riverside,
          description: "Fundamentals: serve, return, dinks, and kitchen-line basics.",
          coachUserId: ctx.userId,
        },
        {
          id: gIntermediate,
          workspaceId,
          name: "Intermediate drills",
          level: "3.0–3.5",
          color: "#7cc4ff",
          capacity: 8,
          defaultRateId: rGroup,
          defaultVenueId: riverside,
          description: "Third-shot drops, resets, and transition-zone work.",
          coachUserId: ctx.userId,
        },
        {
          id: gJuniors,
          workspaceId,
          name: "Juniors",
          level: "Ages 9–14",
          color: "#ffb020",
          capacity: 10,
          defaultRateId: rGroup,
          defaultVenueId: northside,
          description: "Weekend juniors program.",
          coachUserId: ctx.userId,
        },
        {
          id: gEvening,
          workspaceId,
          name: "Evening program",
          level: "All levels",
          color: "#b3a8f5",
          capacity: 16,
          defaultRateId: rGroup,
          defaultVenueId: riverside,
          description: "Sample program: demo data you can remove in Settings.",
          coachUserId: ctx.userId,
          isPublic: true,
          publicDescription:
            "Sample program for trying CoachMan: three-hour evening sessions of drills, live play, and game review.",
          ageMin: 10,
          sortOrder: 0,
        },
      ] satisfies (typeof trainingGroup.$inferInsert)[]
    ).map((row) => db.insert(trainingGroup).values(row)),
    ...chunkRows(
      SAMPLE_CLIENTS.map((c, i) => ({
        id: clientIds[i] as string,
        workspaceId,
        firstName: c.firstName,
        lastName: c.lastName,
        level: c.level,
        email: "email" in c ? c.email : null,
        phone: "phone" in c ? c.phone : null,
        isJunior: "isJunior" in c ? c.isJunior : false,
        guardianName: "guardianName" in c ? c.guardianName : null,
        guardianPhone: "guardianPhone" in c ? c.guardianPhone : null,
        birthDate:
          c.firstName === "Tessa"
            ? `1994-${today.slice(5)}`
            : c.firstName === "Jun"
              ? "2014-03-08"
              : c.firstName === "Zoe"
                ? "2015-11-21"
                : null,
        dominantHand: c.firstName === "Noah" ? "left" : "right",
        status: "active" as const,
        tags: ["sample"],
        source: "Sample data",
        joinedOn: addDays(today, -120 + i * 5),
        medicalNotes:
          c.firstName === "Felix" ? "Recovering from a calf strain — keep sprints light." : null,
        createdAt: now,
        updatedAt: now,
      })),
      30,
    ).map((rows) => db.insert(client).values(rows)),
    // The person who adds the sample coaches it, like any student they add.
    ...chunkRows(
      clientIds.map((clientId, i) => ({
        id: uuidv7(),
        workspaceId,
        clientId,
        coachUserId: ctx.userId,
        role: "primary" as const,
        startedOn: addDays(today, -120 + i * 5),
        assignedBy: ctx.userId,
        createdAt: now,
      })),
      9,
    ).map((rows) => db.insert(clientCoach).values(rows)),
  ]);

  const membership = (groupId: string, names: string[]) =>
    names.map((n) => ({
      id: uuidv7(),
      workspaceId,
      groupId,
      clientId: byName(n),
      joinedOn: addDays(today, -60),
    }));
  await runBatch(
    ctx,
    chunkRows(
      [
        ...membership(gBeginners, ["Ana", "Ben", "Carla", "Dev", "Elle", "Felix"]),
        ...membership(gIntermediate, ["Maya", "Noah", "Priya", "Sam", "Tessa"]),
        ...membership(gJuniors, ["Jun", "Zoe"]),
      ],
      7,
    ).map((rows) => db.insert(groupMember).values(rows)),
  );

  // Packages with history used before CoachMan, so balances look lived-in.
  const sold: {
    clientId: string;
    templateId: string;
    name: string;
    credits: number;
    kinds: ("group" | "clinic" | "private")[];
    priceMinor: number;
    daysAgo: number;
    validity: number;
    used: number;
    paid: number;
  }[] = [
    {
      clientId: byName("Ana"),
      templateId: pGroup10,
      name: "10-session pack",
      credits: 10,
      kinds: ["group", "clinic"],
      priceMinor: price(220),
      daysAgo: 30,
      validity: 90,
      used: 3,
      paid: 1,
    },
    {
      clientId: byName("Ben"),
      templateId: pGroup10,
      name: "10-session pack",
      credits: 10,
      kinds: ["group", "clinic"],
      priceMinor: price(220),
      daysAgo: 50,
      validity: 90,
      used: 6,
      paid: 0.5,
    },
    {
      clientId: byName("Carla"),
      templateId: pGroup10,
      name: "10-session pack",
      credits: 10,
      kinds: ["group", "clinic"],
      priceMinor: price(220),
      daysAgo: 80,
      validity: 90,
      used: 9,
      paid: 1,
    },
    {
      clientId: byName("Elle"),
      templateId: pGroup10,
      name: "10-session pack",
      credits: 10,
      kinds: ["group", "clinic"],
      priceMinor: price(220),
      daysAgo: 6,
      validity: 90,
      used: 1,
      paid: 0,
    },
    {
      clientId: byName("Felix"),
      templateId: pGroup5,
      name: "5-session pack",
      credits: 5,
      kinds: ["group", "clinic"],
      priceMinor: price(115),
      daysAgo: 3,
      validity: 60,
      used: 0,
      paid: 1,
    },
    {
      clientId: byName("Liam"),
      templateId: pPrivate10,
      name: "10 private lessons",
      credits: 10,
      kinds: ["private"],
      priceMinor: price(540),
      daysAgo: 40,
      validity: 120,
      used: 6,
      paid: 1,
    },
    {
      clientId: byName("Maya"),
      templateId: pGroup10,
      name: "10-session pack",
      credits: 10,
      kinds: ["group", "clinic"],
      priceMinor: price(220),
      daysAgo: 85,
      validity: 90,
      used: 7,
      paid: 1,
    },
    {
      clientId: byName("Priya"),
      templateId: pGroup5,
      name: "5-session pack",
      credits: 5,
      kinds: ["group", "clinic"],
      priceMinor: price(115),
      daysAgo: 20,
      validity: 60,
      used: 2,
      paid: 1,
    },
  ];
  const statements: unknown[] = [];
  for (const s of sold) {
    const id = uuidv7();
    const purchasedOn = addDays(today, -s.daysAgo);
    statements.push(
      db.insert(clientPackage).values({
        id,
        workspaceId,
        clientId: s.clientId,
        packageId: s.templateId,
        name: s.name,
        creditsTotal: s.credits,
        lessonKinds: s.kinds,
        priceMinor: s.priceMinor,
        purchasedOn,
        expiresOn: addDays(purchasedOn, s.validity - 1),
        status: "active",
      }),
      db.insert(charge).values({
        id: uuidv7(),
        workspaceId,
        clientId: s.clientId,
        kind: "package",
        description: `${s.name} (${s.credits} sessions)`,
        amountMinor: s.priceMinor,
        clientPackageId: id,
        occurredOn: purchasedOn,
        createdBy: ctx.userId,
      }),
    );
    if (s.used > 0) {
      statements.push(
        db.insert(creditLedger).values({
          id: uuidv7(),
          workspaceId,
          clientPackageId: id,
          clientId: s.clientId,
          delta: -s.used,
          reason: "adjustment",
          note: "Sessions used before CoachMan (sample data)",
          createdBy: ctx.userId,
        }),
      );
    }
    if (s.paid > 0) {
      statements.push(
        db.insert(payment).values({
          id: uuidv7(),
          workspaceId,
          clientId: s.clientId,
          amountMinor: Math.round(s.priceMinor * s.paid),
          method: s.paid === 1 ? "Bank transfer" : "Cash",
          paidOn: purchasedOn,
          note: `For ${s.name}`,
          createdBy: ctx.userId,
        }),
      );
    }
  }
  await runBatch(ctx, statements);

  // Recurring schedule that always includes today, so the Today screen has something on court.
  const wd = weekdayOf(today);
  const track = (r: { lessonIds: string[]; seriesId: string | null }) => {
    if (r.seriesId) ids.series.push(r.seriesId);
    else ids.lessons.push(...r.lessonIds);
    return r;
  };
  track(
    await createLessons(ctx, {
      kind: "group",
      date: today,
      startTime: "07:00",
      durationMinutes: 90,
      venueId: riverside,
      court: "3",
      groupId: gBeginners,
      rateId: rGroup,
      clientIds: [],
      recurrence: { weekdays: [wd, (wd + 2) % 7], endsOn: null },
    }),
  );
  track(
    await createLessons(ctx, {
      kind: "private",
      date: today,
      startTime: "09:00",
      durationMinutes: 60,
      venueId: riverside,
      court: "1",
      rateId: rPrivate,
      clientIds: [byName("Liam")],
      recurrence: { weekdays: [wd], endsOn: null },
    }),
  );
  track(
    await createLessons(ctx, {
      kind: "group",
      date: addDays(today, 1),
      startTime: "18:30",
      durationMinutes: 90,
      venueId: riverside,
      court: "4",
      groupId: gIntermediate,
      rateId: rGroup,
      clientIds: [],
      recurrence: { weekdays: [(wd + 1) % 7, (wd + 3) % 7], endsOn: null },
    }),
  );
  track(
    await createLessons(ctx, {
      kind: "semi_private",
      date: addDays(today, 2),
      startTime: "17:00",
      durationMinutes: 60,
      venueId: northside,
      court: "2",
      rateId: rSemi,
      clientIds: [byName("Noah"), byName("Sam")],
      recurrence: null,
    }),
  );
  // The sample program meets Tuesday and Thursday evenings, from the next one after today (so
  // Today's sessions stay as they were).
  let firstEvening = addDays(today, 1);
  while (![2, 4].includes(weekdayOf(firstEvening))) firstEvening = addDays(firstEvening, 1);
  track(
    await createLessons(ctx, {
      kind: "group",
      date: firstEvening,
      startTime: "19:00",
      durationMinutes: 180,
      venueId: riverside,
      court: "1–2",
      groupId: gEvening,
      rateId: rGroup,
      clientIds: [],
      recurrence: { weekdays: [2, 4], endsOn: null },
    }),
  );

  // Summer camp running this week, with a session later today.
  const camp = uuidv7();
  ids.events.push(camp);
  await db.insert(event).values({
    id: camp,
    workspaceId,
    kind: "camp",
    name: "Summer Camp · Juniors",
    description:
      "Five afternoons of games, drills, and a mini round-robin on the last day. Water and paddles provided.",
    startsOn: addDays(today, -2),
    endsOn: addDays(today, 2),
    venueId: riverside,
    capacity: 16,
    priceMinor: price(180),
    earlyBirdPriceMinor: price(150),
    earlyBirdUntil: addDays(today, -20),
    level: "Ages 9–14",
    ageMin: 9,
    ageMax: 14,
    status: "open",
    coachUserId: ctx.userId,
  });
  const campSession = track(
    await createLessons(ctx, {
      kind: "event",
      title: "Summer Camp · Day 3",
      date: today,
      startTime: "16:00",
      durationMinutes: 120,
      venueId: riverside,
      court: "2–3",
      eventId: camp,
      clientIds: [],
      recurrence: null,
    }),
  );
  const campers = [byName("Jun"), byName("Zoe"), byName("Tessa")];
  const regStatements: unknown[] = [];
  for (const [i, clientId] of campers.entries()) {
    const regId = uuidv7();
    const chargeId = uuidv7();
    regStatements.push(
      db.insert(charge).values({
        id: chargeId,
        workspaceId,
        clientId,
        kind: "event",
        description: "Summer Camp · Juniors",
        amountMinor: price(150),
        registrationId: regId,
        occurredOn: addDays(today, -25),
        createdBy: ctx.userId,
      }),
      db.insert(eventRegistration).values({
        id: regId,
        workspaceId,
        eventId: camp,
        clientId,
        status: "registered",
        priceMinor: price(150),
        chargeId,
        registeredAt: now - (30 - i) * 86_400_000,
      }),
    );
    if (i < 2) {
      regStatements.push(
        db.insert(payment).values({
          id: uuidv7(),
          workspaceId,
          clientId,
          amountMinor: price(150),
          method: "E-wallet",
          paidOn: addDays(today, -24),
          note: "Summer camp",
          createdBy: ctx.userId,
        }),
      );
    }
  }
  await runBatch(ctx, regStatements);
  await bookClientsIntoLessons(ctx, campSession.lessonIds, campers);

  // Progress history for a couple of players.
  const skills = await db.select().from(skill).where(eq(skill.workspaceId, workspaceId));
  const scoreFor = (name: string, base: number) =>
    Math.max(1, Math.min(5, base + ((name.length * 7) % 3) - 1));
  const progress: unknown[] = [];
  for (const [first, levels] of [
    ["Ana", [2, 3]],
    ["Maya", [3, 3]],
  ] as const) {
    for (const [i, base] of levels.entries()) {
      const aid = uuidv7();
      progress.push(
        db.insert(assessment).values({
          id: aid,
          workspaceId,
          clientId: byName(first),
          assessedOn: addDays(today, i === 0 ? -70 : -14),
          overallLevel: first === "Ana" ? (i === 0 ? "2.0" : "2.5") : "3.5",
          notes: i === 0 ? "Baseline assessment." : "Clear progress on soft game.",
          createdBy: ctx.userId,
        }),
        ...chunkRows(
          skills.map((s) => ({
            id: uuidv7(),
            workspaceId,
            assessmentId: aid,
            skillId: s.id,
            score: scoreFor(s.name, base + (i === 1 && s.category === "Shots" ? 1 : 0)),
            note: null,
          })),
          6,
        ).map((rows) => db.insert(assessmentScore).values(rows)),
      );
    }
  }
  progress.push(
    db.insert(goal).values([
      {
        id: uuidv7(),
        workspaceId,
        clientId: byName("Ana"),
        title: "Land 7 of 10 third-shot drops in the kitchen",
        targetDate: addDays(today, 45),
        status: "active",
        createdBy: ctx.userId,
      },
      {
        id: uuidv7(),
        workspaceId,
        clientId: byName("Ana"),
        title: "Play a full round-robin at the 2.5 social",
        status: "achieved",
        achievedOn: addDays(today, -10),
        createdBy: ctx.userId,
      },
      {
        id: uuidv7(),
        workspaceId,
        clientId: byName("Maya"),
        title: "Reach a 3.75 DUPR rating",
        targetDate: addDays(today, 90),
        status: "active",
        createdBy: ctx.userId,
      },
    ]),
    db.insert(ratingSnapshot).values([
      {
        id: uuidv7(),
        workspaceId,
        clientId: byName("Maya"),
        source: "dupr",
        value: 3.41,
        recordedOn: addDays(today, -90),
      },
      {
        id: uuidv7(),
        workspaceId,
        clientId: byName("Maya"),
        source: "dupr",
        value: 3.55,
        recordedOn: addDays(today, -45),
      },
      {
        id: uuidv7(),
        workspaceId,
        clientId: byName("Maya"),
        source: "dupr",
        value: 3.62,
        recordedOn: addDays(today, -7),
      },
    ]),
    db.insert(note).values([
      {
        id: uuidv7(),
        workspaceId,
        clientId: byName("Ana"),
        body: "Paddle face too open on drops — work on a firmer wrist.",
        pinned: true,
        createdBy: ctx.userId,
        createdAt: now - 6 * 86_400_000,
        updatedAt: now - 6 * 86_400_000,
      },
      {
        id: uuidv7(),
        workspaceId,
        clientId: byName("Carla"),
        body: "Asked about the next 10-session pack.",
        createdBy: ctx.userId,
        createdAt: now - 2 * 86_400_000,
        updatedAt: now - 2 * 86_400_000,
      },
    ]),
    db
      .update(client)
      .set({ duprRating: 3.62, duprId: "SAMPLE-0001" })
      .where(eq(client.id, byName("Maya"))),
  );
  await runBatch(ctx, progress);

  for (const clientId of clientIds) await rebuildAllocations(ctx, clientId);

  const org = await db.query.organization.findFirst({ where: eq(organization.id, workspaceId) });
  const meta = safeJson(org?.metadata);
  await db
    .update(organization)
    .set({ metadata: JSON.stringify({ ...meta, sample: ids }) })
    .where(eq(organization.id, workspaceId));
  return ids;
}

function safeJson(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Removes only what the sample seeder created (ids tracked in organization.metadata). */
export async function removeSampleData(ctx: Ctx): Promise<number> {
  const { db, workspaceId } = ctx;
  const org = await db.query.organization.findFirst({ where: eq(organization.id, workspaceId) });
  const meta = safeJson(org?.metadata);
  const ids = meta.sample as SampleIds | undefined;
  if (!ids) return 0;
  const inWs = <T extends SQLiteTable & { id: SQLiteColumn; workspaceId: SQLiteColumn }>(
    table: T,
    list: string[],
  ) =>
    list.length
      ? [db.delete(table).where(and(eq(table.workspaceId, workspaceId), inList(table.id, list)))]
      : [];
  await runBatch(ctx, [
    ...(ids.series.length
      ? [
          db
            .delete(lesson)
            .where(and(eq(lesson.workspaceId, workspaceId), inList(lesson.seriesId, ids.series))),
        ]
      : []),
    ...(ids.events.length
      ? [
          db
            .delete(lesson)
            .where(and(eq(lesson.workspaceId, workspaceId), inList(lesson.eventId, ids.events))),
        ]
      : []),
    ...inWs(lesson, ids.lessons),
    ...inWs(lessonSeries, ids.series),
    ...inWs(client, ids.clients),
    ...inWs(event, ids.events),
    ...inWs(trainingGroup, ids.groups),
    ...inWs(packageTemplate, ids.packages),
    ...inWs(rate, ids.rates),
    ...inWs(venue, ids.venues),
  ]);
  delete meta.sample;
  await db
    .update(organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(organization.id, workspaceId));
  return ids.clients.length;
}

export async function hasSampleData(ctx: Pick<Ctx, "db" | "workspaceId">): Promise<boolean> {
  const org = await ctx.db.query.organization.findFirst({
    where: eq(organization.id, ctx.workspaceId),
  });
  return Boolean(safeJson(org?.metadata).sample);
}
