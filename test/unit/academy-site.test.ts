import type { PublicCoachDto, PublicPackageDto, PublicProgramDto } from "@shared/api-types";
import { PORTRAIT_FRAMING, SCENE_FRAMING } from "@shared/framing";
import { describe, expect, it } from "vitest";
import {
  academyVenues,
  compactTime,
  displayEm,
  firstSentence,
  fitLines,
  fromPriceMinor,
  heroPhoto,
  lowestPriceMinor,
  nextSession,
  programVenue,
  scheduleLineParts,
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
    portraitFraming: null,
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

  it("finds a program's lowest price per head (or the ones in no program)", () => {
    const packages = [
      tier("a", { programId: "p1", priceMinor: 600000 }),
      tier("b", { programId: "p1", priceMinor: 150000 }),
      tier("c", { priceMinor: 90000 }),
    ];
    expect(fromPriceMinor(packages, "p1")).toBe(150000);
    expect(fromPriceMinor(packages, null)).toBe(90000);
    expect(fromPriceMinor(packages, "p2")).toBeNull();
    // The hero's sticker: the lowest across every tier.
    expect(lowestPriceMinor(packages)).toBe(90000);
    expect(lowestPriceMinor([])).toBeNull();
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

describe("the hero's words", () => {
  it("takes the cover, else the first website photo, else a coach's portrait", () => {
    const photo = { id: "ph1", key: "ws/1/public/photos/a.jpg", caption: null, framing: null };
    const photos = [photo];
    const coaches = [person("a"), person("b", { photoKey: "sq.jpg", portraitKey: "tall.jpg" })];
    const none = { coverFraming: null };
    expect(heroPhoto({ ...none, coverKey: "cover.jpg", photos, coaches })).toEqual({
      key: "cover.jpg",
      kind: "cover",
      framing: SCENE_FRAMING,
    });
    expect(heroPhoto({ ...none, coverKey: null, photos, coaches })?.kind).toBe("photo");
    // A portrait keeps the face in by default.
    expect(heroPhoto({ ...none, coverKey: null, photos: [], coaches })).toEqual({
      key: "tall.jpg",
      kind: "coach",
      framing: PORTRAIT_FRAMING,
    });
    expect(heroPhoto({ ...none, coverKey: null, photos: [], coaches: [person("c")] })).toBeNull();
    // The framing the academy set comes along, kept in range.
    const set = { x: 30, y: 12.5, zoom: 1.6 };
    expect(heroPhoto({ coverKey: "c.jpg", coverFraming: set, photos, coaches })?.framing).toEqual(
      set,
    );
    const framed = [{ ...photo, id: "ph2", framing: { x: 140, y: -5, zoom: 9 } }];
    expect(heroPhoto({ ...none, coverKey: null, photos: framed, coaches })?.framing).toEqual({
      x: 100,
      y: 0,
      zoom: 3,
    });
    const tall = [person("d", { portraitKey: "p.jpg", portraitFraming: set })];
    expect(heroPhoto({ ...none, coverKey: null, photos: [], coaches: tall })?.framing).toEqual(set);
  });

  it("sets a time range the pubmat way", () => {
    expect(compactTime("7:00 – 10:00 PM")).toBe("7–10 PM");
    expect(compactTime("10:30 AM – 1:00 PM")).toBe("10:30 AM–1 PM");
    // Intl puts thin and narrow no-break spaces around the dash and before the period.
    expect(compactTime("8:00\u2009–\u200911:00\u202fAM")).toBe("8–11\u202fAM");
  });

  it("measures display caps from the cut's own widths", () => {
    // Measured from the shipped font: the sample runs 10.10em before tracking and word spacing.
    expect(displayEm("THE PICKLE SPOT ACADEMY")).toBeCloseTo(10.158 - 0.23 + 3 * 0.08, 2);
    expect(displayEm("the pickle spot academy")).toBe(displayEm("THE PICKLE SPOT ACADEMY"));
    expect(displayEm("")).toBe(0);
  });

  it("splits a name into the lines that let it run largest", () => {
    const three = fitLines("The Pickle Spot Academy", 3);
    expect(three.lines).toEqual(["The Pickle", "Spot", "Academy"]);
    expect(three.em).toBeCloseTo(displayEm("THE PICKLE"), 6);
    expect(fitLines("The Pickle Spot Academy", 2).lines).toEqual(["The Pickle", "Spot Academy"]);
    expect(fitLines("Daryll's coaching", 3).lines).toEqual(["Daryll's", "coaching"]);
    expect(fitLines("Ace", 3)).toEqual({ lines: ["Ace"], em: displayEm("Ace") });
    expect(fitLines("  ", 3)).toEqual({ lines: [], em: 0 });
  });

  it("weighs balance when a sticker can sit beside a short line", () => {
    // "Spot" alone in the middle is a hole; "The" alone on top leaves room for "Now enrolling".
    const phone = fitLines("The Pickle Spot Academy", 3, { slot: 0.5 });
    expect(phone.lines).toEqual(["The", "Pickle Spot", "Academy"]);
    expect(phone.em).toBeCloseTo(displayEm("PICKLE SPOT"), 6);
    expect(phone.slot?.line).toBe(0);
    expect(phone.slot?.free).toBeCloseTo(1 - displayEm("THE") / displayEm("PICKLE SPOT"), 6);
    // A short last line holds it as well.
    const club = fitLines("Manila Pickleball Club", 3, { slot: 0.5 });
    expect(club.lines).toEqual(["Manila", "Pickleball", "Club"]);
    expect(club.slot?.line).toBe(2);
    // No line short enough: the largest split, with no slot.
    expect(fitLines("Smash Academy", 3, { slot: 0.5 })).toEqual(fitLines("Smash Academy", 3));
    expect(fitLines("Ace", 3, { slot: 0.5 }).slot).toBeUndefined();
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
});
