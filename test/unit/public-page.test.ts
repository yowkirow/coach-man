import { describe, expect, it } from "vitest";
import type { PublicAcademyDto } from "../../src/shared/api-types";
import type {
  academyPhoto,
  academyProfile,
  consentDocument,
  lessonSeries,
  packageTemplate,
  teamPerson,
  trainingGroup,
  workspaceSettings,
} from "../../src/worker/db/schema";
import {
  academyPageMeta,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  escapeHtml,
  PUBLIC_DATA_ID,
  parseAcademyPath,
  publicImageUrl,
  renderDataIsland,
  renderMetaTags,
  summarize,
} from "../../src/worker/lib/page-meta";
import {
  isListed,
  teamPersonFacts,
  toProgramCoachRefs,
  toPublicAcademy,
  toPublicAcademyPhoto,
  toPublicCoach,
  toPublicCoachRef,
  toPublicConsentDocument,
  toPublicConsentRef,
  toPublicPackage,
  toPublicProgram,
  toPublicWeeklySession,
} from "../../src/worker/lib/public-dto";

const LEAK = "LEAK";
const APP = "https://coachman.cloud";

const profile = (over: Partial<typeof academyProfile.$inferSelect> = {}) =>
  ({
    workspaceId: `${LEAK}-ws`,
    tagline: "No shortcuts, all game",
    about: "Evening training for every level.",
    contactPhone: "0917 555 0142",
    contactEmail: "hello@academy.example",
    address: "12 Riverside Drive",
    mapUrl: "https://maps.example/academy",
    socials: { facebook: "https://facebook.com/academy", [`${LEAK}social`]: "https://x" },
    logoKey: "ws/abc/public/logo-1.png",
    coverKey: null,
    paymentInstructions: `${LEAK} GCash 0917`,
    paymentQrKey: `ws/abc/public/${LEAK}-qr.png`,
    policies: "Cancel a day ahead.",
    enrollmentOpen: true,
    listed: true,
    createdAt: 1,
    updatedAt: 2,
    ...over,
  }) satisfies typeof academyProfile.$inferSelect;

const group = {
  id: "program-1",
  workspaceId: `${LEAK}-ws`,
  name: "Evening program",
  level: "All levels",
  description: `${LEAK} internal description`,
  color: `${LEAK}color`,
  capacity: 16,
  defaultRateId: `${LEAK}-rate`,
  defaultVenueId: `${LEAK}-venue`,
  archivedAt: null,
  coachUserId: `${LEAK}-user`,
  assistantCoachIds: [`${LEAK}-assistant`],
  isPublic: true,
  publicDescription: "Three-hour evening sessions.",
  scheduleNote: "Every Tue & Thu, 7–10pm",
  ageMin: 10,
  ageMax: null,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 2,
} satisfies typeof trainingGroup.$inferSelect;

const tier = {
  id: "tier-1",
  workspaceId: `${LEAK}-ws`,
  name: "Monthly plus",
  credits: 9,
  lessonKinds: ["group"],
  priceMinor: 700000,
  validityDays: 90,
  description: `${LEAK} staff-only description`,
  active: true,
  programId: "program-1",
  coachUserId: `${LEAK}-coach-user`,
  sessionsLabel: "7–9 sessions",
  validityMode: "month_end",
  inclusions: ["Three-hour sessions", "Court fees included"],
  audience: "Long-term development.",
  commitmentNote: "Best over at least two months.",
  includesUniform: true,
  asksSelfRating: true,
  isPublic: true,
  highlight: true,
  sortOrder: 20,
  createdAt: 1,
  updatedAt: 2,
} satisfies typeof packageTemplate.$inferSelect;

const series = {
  id: `${LEAK}-series`,
  workspaceId: `${LEAK}-ws`,
  kind: "group",
  title: `${LEAK} series title`,
  groupId: "program-1",
  venueId: `${LEAK}-venue`,
  court: `${LEAK}court`,
  rateId: `${LEAK}-rate`,
  priceMinor: 12345,
  capacity: 16,
  weekdays: [4, 2],
  startTime: "19:00",
  durationMinutes: 180,
  startsOn: "2026-11-03",
  endsOn: null,
  timezone: "Asia/Manila",
  participantIds: [`${LEAK}-client`],
  materializedThrough: "2026-12-29",
  active: true,
  coachUserId: `${LEAK}-user`,
  assistantCoachIds: [],
  createdAt: 1,
  updatedAt: 2,
} satisfies typeof lessonSeries.$inferSelect;

const consent = {
  id: "doc-1",
  workspaceId: `${LEAK}-ws`,
  kind: "waiver",
  title: "Activity waiver and release",
  body: "I understand the risks.",
  version: 3,
  required: true,
  appliesTo: "all",
  active: true,
  createdAt: 1,
  updatedAt: 2,
} satisfies typeof consentDocument.$inferSelect;

const settings = {
  currency: "PHP",
  locale: "en-PH",
  timezone: "Asia/Manila",
  weekStartsOn: 1,
} satisfies Pick<
  typeof workspaceSettings.$inferSelect,
  "currency" | "locale" | "timezone" | "weekStartsOn"
>;

const coach = {
  profileId: "coach-profile-1",
  name: "Coach Ana",
  title: "Head coach",
  bio: "Ten years on court.",
  photoKey: "ws/abc/public/coaches/u-1.png",
  portraitKey: "ws/abc/public/coaches/u-1-portrait-1.jpg",
  certifications: ["RPO licensed"],
  highlights: ["Gold, Women's Doubles 4.5, Manila Open 2025"],
  specialties: ["Juniors"],
  languages: ["English", "Filipino"],
  yearsCoaching: 10,
  duprRating: 4.5,
};

const photo = {
  id: "photo-1",
  workspaceId: `${LEAK}-ws`,
  key: "ws/abc/public/photos/0196-1.jpg",
  caption: "Evening drills on court 3",
  sortOrder: 7,
  createdAt: 1,
  updatedAt: 2,
} satisfies typeof academyPhoto.$inferSelect;

function academy(): PublicAcademyDto {
  return toPublicAcademy({ name: "Riverside Academy", slug: "riverside" }, profile(), settings, {
    programs: [
      toPublicProgram(group, {
        schedule: [toPublicWeeklySession(series, { name: "Riverside Courts", address: null })],
        venue: { name: "Riverside Courts", address: "Riverside Park" },
        coaches: [toPublicCoachRef(coach, true)],
        nextSessionAt: 1_800_000_000_000,
      }),
    ],
    packages: [toPublicPackage(tier, toPublicCoachRef(coach, false))],
    coaches: [toPublicCoach(coach)],
    photos: [toPublicAcademyPhoto(photo)],
    consents: [toPublicConsentRef(consent)],
    today: "2026-11-05",
  });
}

describe("public academy DTOs", () => {
  it("carry nothing private: internal descriptions, payment details, ids, rates, rosters", () => {
    const json = JSON.stringify(academy());
    expect(json).not.toContain(LEAK);
    expect(json).not.toContain("12345");
  });

  it("keep what the page needs", () => {
    const a = academy();
    expect(a).toMatchObject({
      slug: "riverside",
      name: "Riverside Academy",
      tagline: "No shortcuts, all game",
      socials: { facebook: "https://facebook.com/academy" },
      enrollmentOpen: true,
      currency: "PHP",
    });
    expect(a.programs[0]).toMatchObject({
      description: "Three-hour evening sessions.",
      scheduleNote: "Every Tue & Thu, 7–10pm",
      schedule: [{ weekdays: [2, 4], startTime: "19:00", durationMinutes: 180 }],
    });
    expect(a.packages[0]).toMatchObject({
      priceMinor: 700000,
      sessionsLabel: "7–9 sessions",
      validityMode: "month_end",
      // A month-end tier's day count would mislead.
      validityDays: null,
      highlight: true,
      coach: { id: "coach-profile-1", name: "Coach Ana", lead: false },
    });
    expect(a.programs[0]?.coaches).toEqual([
      {
        id: "coach-profile-1",
        name: "Coach Ana",
        title: "Head coach",
        photoKey: "ws/abc/public/coaches/u-1.png",
        lead: true,
      },
    ]);
    expect(a.consents).toEqual([
      {
        id: "doc-1",
        kind: "waiver",
        title: "Activity waiver and release",
        version: 3,
        appliesTo: "all",
      },
    ]);
    expect(toPublicConsentDocument(consent).body).toBe("I understand the risks.");
  });

  it("carry the website photos as a file and a caption, nothing else", () => {
    const a = academy();
    expect(a.photos).toEqual([
      {
        id: "photo-1",
        key: "ws/abc/public/photos/0196-1.jpg",
        caption: "Evening drills on court 3",
      },
    ]);
    expect(toPublicAcademyPhoto({ ...photo, caption: null })).toEqual({
      id: "photo-1",
      key: "ws/abc/public/photos/0196-1.jpg",
      caption: null,
    });
  });

  it("list an academy only when it chose to be listed under a real address", () => {
    expect(isListed({ slug: "riverside" }, { listed: true })).toBe(true);
    expect(isListed({ slug: "riverside" }, { listed: false })).toBe(false);
    expect(isListed({ slug: "riverside" }, null)).toBe(false);
    expect(isListed({ slug: "ws-0192c7a1" }, { listed: true })).toBe(false);
  });

  it("name a program's lead, and never an assistant in a hidden lead's place", () => {
    const kim = { ...coach, profileId: "coach-profile-2", name: "Coach Kim" };
    const lee = { ...coach, profileId: "coach-profile-3", name: "Coach Lee" };
    const shown = new Map([
      ["user-ana", coach],
      ["user-kim", kim],
      ["user-lee", lee],
    ]);
    const refs = (
      program: { coachUserId: string | null; assistantCoachIds: string[] },
      coaches = shown,
    ) => toProgramCoachRefs(program, coaches).map((r) => [r.name, r.lead]);
    // The lead first, then the assistants in their order; the lead is listed once.
    expect(
      refs({ coachUserId: "user-kim", assistantCoachIds: ["user-lee", "user-kim", "user-ana"] }),
    ).toEqual([
      ["Coach Kim", true],
      ["Coach Lee", false],
      ["Coach Ana", false],
    ]);
    // A lead whose profile is hidden (or who left) isn't named, and nobody takes their place.
    const hidden = new Map([...shown].filter(([id]) => id !== "user-kim"));
    expect(
      refs({ coachUserId: "user-kim", assistantCoachIds: ["user-lee", "user-ana"] }, hidden),
    ).toEqual([
      ["Coach Lee", false],
      ["Coach Ana", false],
    ]);
    expect(refs({ coachUserId: null, assistantCoachIds: ["user-ana"] })).toEqual([
      ["Coach Ana", false],
    ]);
    expect(refs({ coachUserId: "user-gone", assistantCoachIds: [] })).toEqual([]);
  });

  it("carry a team page person's portrait and highlights, copied", () => {
    const dto = toPublicCoach(coach);
    expect(dto).toEqual({
      id: "coach-profile-1",
      name: "Coach Ana",
      title: "Head coach",
      bio: "Ten years on court.",
      photoKey: "ws/abc/public/coaches/u-1.png",
      portraitKey: "ws/abc/public/coaches/u-1-portrait-1.jpg",
      certifications: ["RPO licensed"],
      highlights: ["Gold, Women's Doubles 4.5, Manila Open 2025"],
      specialties: ["Juniors"],
      languages: ["English", "Filipino"],
      yearsCoaching: 10,
      duprRating: 4.5,
    });
    // The DTO owns its lists: changing it never changes the facts it came from.
    dto.highlights.push("Changed");
    expect(coach.highlights).toEqual(["Gold, Women's Doubles 4.5, Manila Open 2025"]);
  });

  it("show a display-only person without who added them, their order, or the switch", () => {
    const person = {
      id: "person-1",
      workspaceId: `${LEAK}-ws`,
      name: "Coach Ben",
      title: "Visiting coach",
      bio: "Plays the pro tour.",
      portraitKey: "ws/abc/public/coaches/person-person-1-1.jpg",
      certifications: ["PPR"],
      highlights: ["Silver, Mixed Doubles Open, PNG 2024"],
      duprRating: 5.1,
      specialties: ["Dinking"],
      languages: ["English"],
      yearsCoaching: 6,
      isPublic: true,
      sortOrder: 4,
      createdBy: `${LEAK}-user`,
      createdAt: 1,
      updatedAt: 2,
    } satisfies typeof teamPerson.$inferSelect;
    const dto = toPublicCoach(teamPersonFacts(person));
    expect(dto).toMatchObject({
      id: "person-1",
      name: "Coach Ben",
      photoKey: null,
      portraitKey: "ws/abc/public/coaches/person-person-1-1.jpg",
      highlights: ["Silver, Mixed Doubles Open, PNG 2024"],
    });
    expect(Object.keys(dto).sort()).toEqual(Object.keys(toPublicCoach(coach)).sort());
    expect(JSON.stringify(dto)).not.toContain(LEAK);
  });
});

describe("link preview tags", () => {
  const listed = {
    name: `Ana's "Pickle" <Academy> & Co`,
    slug: "anas-pickle",
    tagline: "<script>alert(1)</script>",
    about: null,
    logoKey: "ws/abc/public/logo 1.png",
    coverKey: null,
  };

  it("escape every value", () => {
    const html = renderMetaTags(academyPageMeta({ academy: listed, page: "home", appUrl: APP }));
    expect(html).toContain("<title>Ana&#39;s &quot;Pickle&quot; &lt;Academy&gt; &amp; Co</title>");
    expect(html).toContain(
      '<meta property="og:title" content="Ana&#39;s &quot;Pickle&quot; &lt;Academy&gt; &amp; Co" />',
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml(`'"<>&`)).toBe("&#39;&quot;&lt;&gt;&amp;");
  });

  it("describe a listed academy with its own words and logo", () => {
    const meta = academyPageMeta({
      academy: { ...listed, name: "Riverside Academy", tagline: "Steady hands" },
      page: "home",
      appUrl: `${APP}/`,
    });
    expect(meta).toEqual({
      title: "Riverside Academy",
      description: "Steady hands",
      image: `${APP}/api/public/files/ws/abc/public/logo%201.png`,
      twitterCard: "summary",
      url: `${APP}/a/anas-pickle`,
    });
    const html = renderMetaTags(meta);
    for (const tag of ["og:title", "og:description", "og:image", "og:url"]) {
      expect(html).toContain(`property="${tag}"`);
    }
    expect(html).toContain('name="twitter:card" content="summary"');
  });

  it("fall back to the about text, then a plain line, and use a cover as a large card", () => {
    const fromAbout = academyPageMeta({
      academy: {
        ...listed,
        tagline: null,
        about: `Evening training.\n\n${"Long text ".repeat(40)}`,
      },
      page: "home",
      appUrl: APP,
    });
    expect(fromAbout.description.startsWith("Evening training. Long text")).toBe(true);
    expect(fromAbout.description.length).toBeLessThanOrEqual(160);
    expect(fromAbout.description.endsWith("…")).toBe(true);

    const plain = academyPageMeta({
      academy: {
        ...listed,
        name: "Riverside",
        tagline: "  ",
        about: null,
        coverKey: "ws/abc/public/cover-1.jpg",
      },
      page: "home",
      appUrl: APP,
    });
    expect(plain.description).toBe("Programs, schedule, rates, and coaches at Riverside.");
    expect(plain.twitterCard).toBe("summary_large_image");
    expect(plain.image).toBe(`${APP}/api/public/files/ws/abc/public/cover-1.jpg`);
  });

  it("title the rates sheet", () => {
    const meta = academyPageMeta({
      academy: { ...listed, name: "Riverside", tagline: "Steady hands" },
      page: "rates",
      appUrl: APP,
    });
    expect(meta.title).toBe("Rates and packages · Riverside");
    expect(meta.description).toBe("Rates and packages at Riverside. Steady hands");
    expect(meta.url).toBe(`${APP}/a/anas-pickle/rates`);
  });

  it("use CoachMan's own tags for unknown and unlisted academies", () => {
    expect(academyPageMeta({ academy: null, page: "rates", appUrl: APP })).toEqual({
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      image: `${APP}/icons/icon-512.png`,
      twitterCard: "summary",
      url: `${APP}/`,
    });
  });

  it("read the academy and page from the path", () => {
    expect(parseAcademyPath("/a/riverside")).toEqual({ slug: "riverside", page: "home" });
    expect(parseAcademyPath("/a/riverside/")).toEqual({ slug: "riverside", page: "home" });
    expect(parseAcademyPath("/a/riverside/rates")).toEqual({ slug: "riverside", page: "rates" });
    expect(parseAcademyPath("/a/riverside/enroll")).toEqual({ slug: "riverside", page: "enroll" });
    expect(parseAcademyPath("/a/")).toBeNull();
    expect(parseAcademyPath("/a/%E0%A4%A")).toBeNull();
    expect(parseAcademyPath("/a/x/y/z")).toBeNull();
  });

  it("summarize at a word", () => {
    expect(summarize("  short   text ")).toBe("short text");
    expect(summarize("one two three four five", 12)).toBe("one two…");
    expect(publicImageUrl(`${APP}/`, "ws/a b/public/x#1.png")).toBe(
      `${APP}/api/public/files/ws/a%20b/public/x%231.png`,
    );
  });
});

describe("the page's data block", () => {
  it("can't close its tag or open markup, and parses back to the same data", () => {
    const data = { name: "</script><script>alert(1)</script>", note: "<!-- & \u2028 -->" };
    const html = renderDataIsland(data);
    expect(html.startsWith(`<script type="application/json" id="${PUBLIC_DATA_ID}">`)).toBe(true);
    const inner = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
    expect(inner).not.toMatch(/[<>&\u2028]/);
    expect(JSON.parse(inner)).toEqual(data);
  });
});
