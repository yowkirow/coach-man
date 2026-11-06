import type { PublicCoachDto, PublicPackageDto, PublicProgramDto } from "@shared/api-types";
import { describe, expect, it } from "vitest";
import {
  academyVenues,
  arcGeometry,
  coachProof,
  firstSentence,
  fromPriceMinor,
  headlineParts,
  nextSession,
  programVenue,
  ribbonCopies,
  ribbonText,
  scheduleLineParts,
  showcaseTier,
  tierInclusions,
} from "../../src/app/features/public/site-data";

function tier(id: string, extra: Partial<PublicPackageDto> = {}): PublicPackageDto {
  return {
    id,
    programId: null,
    name: `Tier ${id}`,
    priceMinor: 100000,
    credits: 4,
    sessionsLabel: null,
    validityMode: "days",
    validityDays: 30,
    inclusions: [],
    audience: null,
    commitmentNote: null,
    includesUniform: false,
    asksSelfRating: false,
    highlight: false,
    coach: null,
    ...extra,
  };
}

const court = { name: "Riverside Park Courts", address: "Riverside Park" };
const hall = { name: "North Hall", address: null };

function program(id: string, extra: Partial<PublicProgramDto> = {}): PublicProgramDto {
  return {
    id,
    name: `Program ${id}`,
    description: null,
    level: null,
    ageMin: null,
    ageMax: null,
    capacity: null,
    scheduleNote: null,
    schedule: [],
    venue: null,
    coaches: [],
    nextSessionAt: null,
    ...extra,
  };
}

function person(id: string, extra: Partial<PublicCoachDto> = {}): PublicCoachDto {
  return {
    id,
    name: `Coach ${id}`,
    title: null,
    bio: null,
    photoKey: null,
    portraitKey: null,
    certifications: [],
    highlights: [],
    specialties: [],
    languages: [],
    yearsCoaching: null,
    duprRating: null,
    ...extra,
  };
}

describe("the academy website's packages", () => {
  it("adds the uniform once, unless an inclusion already names it", () => {
    expect(tierInclusions(tier("a", { includesUniform: true }))).toEqual([
      "Training uniform included",
    ]);
    expect(
      tierInclusions(tier("b", { includesUniform: true, inclusions: ["Training shirt"] })),
    ).toEqual(["Training shirt"]);
  });

  it("shows one real package's inclusions: the featured one, else the one with the most", () => {
    const trial = tier("a", { inclusions: ["One coached session"] });
    const monthly = tier("b", { inclusions: ["Court fees", "Drills"], includesUniform: true });
    const plus = tier("c", { inclusions: ["Court fees"], highlight: true });
    expect(showcaseTier([trial, monthly, plus])?.id).toBe("c");
    expect(showcaseTier([trial, monthly])?.id).toBe("b");
    // A featured tier with nothing listed gives way to one that lists something.
    expect(showcaseTier([tier("d", { highlight: true }), trial])?.id).toBe("a");
    expect(showcaseTier([tier("e")])).toBeNull();
  });

  it("finds a program's lowest price per head (or the ones in no program)", () => {
    const packages = [
      tier("a", { programId: "p1", priceMinor: 600000 }),
      tier("b", { programId: "p1", priceMinor: 150000 }),
      tier("c", { priceMinor: 90000 }),
    ];
    expect(fromPriceMinor(packages, "p1")).toBe(150000);
    expect(fromPriceMinor(packages, null)).toBe(90000);
    expect(fromPriceMinor(packages, "p2")).toBeNull();
  });
});

describe("where and when the academy plays", () => {
  const weekly = (venue: typeof court | typeof hall | null) => ({
    weekdays: [2, 4],
    startTime: "19:00",
    durationMinutes: 180,
    venue,
  });

  it("uses a program's first weekly session with a venue, else its default", () => {
    expect(programVenue({ schedule: [weekly(null), weekly(court)], venue: hall })).toEqual(court);
    expect(programVenue({ schedule: [weekly(null)], venue: hall })).toEqual(hall);
    expect(programVenue({ schedule: [], venue: null })).toBeNull();
  });

  it("lists every venue once, in the programs' order", () => {
    const programs = [
      program("p1", { schedule: [weekly(court)], venue: court }),
      program("p2", { schedule: [weekly(hall)], venue: { ...court } }),
    ];
    expect(academyVenues(programs)).toEqual([court, hall]);
  });

  it("picks the soonest next session", () => {
    const programs = [
      program("p1", { nextSessionAt: 2_000 }),
      program("p2", { nextSessionAt: 1_000 }),
      program("p3"),
    ];
    expect(nextSession(programs)?.program.id).toBe("p2");
    expect(nextSession([program("p4")])).toBeNull();
  });
});

describe("the coaches' proof", () => {
  it("takes highlights one coach at a time, then certifications, up to the limit", () => {
    const a = person("a", { highlights: ["Gold 4.5", "Silver 5.0"], certifications: ["PPR Pro"] });
    const b = person("b", { highlights: ["Bronze 4.0"], certifications: ["IPTPA 2"] });
    const c = person("c");
    const proof = coachProof([a, b, c], 4);
    expect(proof.map((p) => `${p.person.id}:${p.text}`)).toEqual([
      "a:Gold 4.5",
      "b:Bronze 4.0",
      "a:Silver 5.0",
      "a:PPR Pro",
    ]);
    expect(proof.at(-1)?.kind).toBe("certification");
    expect(coachProof([c])).toEqual([]);
  });
});

describe("the hero's words", () => {
  it("splits a headline at a written clause break only", () => {
    expect(headlineParts("Train with purpose, play with joy")).toEqual({
      quiet: "Train with purpose,",
      strong: "play with joy",
    });
    expect(headlineParts("The Pickle Spot Academy")).toEqual({
      quiet: "",
      strong: "The Pickle Spot Academy",
    });
    // One word on either side reads as a list, not two clauses.
    expect(headlineParts("Dink, drop, drive")).toEqual({ quiet: "", strong: "Dink, drop, drive" });
  });

  it("takes the about text's first sentence when it's short enough", () => {
    expect(firstSentence("We coach juniors and adults. Since 2019.")).toBe(
      "We coach juniors and adults.",
    );
    expect(firstSentence("No full stop here")).toBe("No full stop here");
    expect(firstSentence(`${"long ".repeat(50)}.`)).toBeNull();
    expect(firstSentence(null)).toBeNull();
  });

  it("splits a schedule line after its last dot, so the time range can stay on one line", () => {
    expect(scheduleLineParts("Tue & Thu · 7:00 – 10:00 PM")).toEqual({
      lead: "Tue & Thu · ",
      time: "7:00 – 10:00 PM",
    });
    expect(scheduleLineParts("Saturdays, 8 to 11")).toEqual({
      lead: "Saturdays, 8 to 11",
      time: "",
    });
  });

  it("joins the arc's words with dots and ends on one, so the line repeats cleanly", () => {
    expect(ribbonText(["Evening program", null, " All levels ", ""])).toBe(
      "Evening program  ·  All levels  ·  ",
    );
    expect(ribbonText([])).toBe("");
  });

  it("repeats a line enough to cover its path and wrap", () => {
    expect(ribbonCopies(1000, 300)).toBe(5);
    expect(ribbonCopies(1000, 0)).toBe(1);
    expect(ribbonCopies(100_000, 1)).toBe(40);
  });

  it("draws the arc in pixels: the ball centered, the trail in from the left, the band out", () => {
    const wide = arcGeometry(1440, 300);
    expect(wide.cx).toBe(720);
    expect(wide.before.startsWith("M -86.4 ")).toBe(true);
    expect(wide.after).toContain(`M ${720 + wide.pillW / 2} ${wide.cy}`);
    expect(wide.fontSize).toBe(20);
    const phone = arcGeometry(390, 210);
    expect(phone.fontSize).toBe(13);
    expect(phone.pillW).toBeLessThan(wide.pillW);
  });
});
