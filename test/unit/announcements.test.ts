import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_MAX_AHEAD_MS,
  announcementExcerpt,
  announcementParagraphs,
  announcementState,
  audienceKey,
  compareLive,
  type FamilyAudience,
  linkify,
  reachesFamily,
  resolvePublish,
  sortForState,
} from "../../src/shared/announcements";
import { announcementSchema } from "../../src/shared/schemas";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const family: FamilyAudience = {
  workspaceIds: new Set(["ws1", "ws2"]),
  programs: new Set([audienceKey("ws1", "juniors")]),
  events: new Set([audienceKey("ws1", "camp"), audienceKey("ws2", "clinic")]),
};

const live = {
  workspaceId: "ws1",
  audience: "all" as const,
  audienceId: null,
  publishedAt: NOW - HOUR,
  expiresAt: null,
};

describe("where an announcement stands", () => {
  it("draft, scheduled, live, expired", () => {
    expect(announcementState({ publishedAt: null, expiresAt: null }, NOW)).toBe("draft");
    expect(announcementState({ publishedAt: null, expiresAt: NOW - 1 }, NOW)).toBe("draft");
    expect(announcementState({ publishedAt: NOW + 1, expiresAt: null }, NOW)).toBe("scheduled");
    expect(announcementState({ publishedAt: NOW, expiresAt: null }, NOW)).toBe("live");
    expect(announcementState({ publishedAt: NOW - 1, expiresAt: NOW + 1 }, NOW)).toBe("live");
    expect(announcementState({ publishedAt: NOW - 10, expiresAt: NOW }, NOW)).toBe("expired");
  });
});

describe("which families an announcement reaches", () => {
  it("everyone: every family with a student at that academy", () => {
    expect(reachesFamily(live, family, NOW)).toBe(true);
    expect(reachesFamily({ ...live, workspaceId: "ws2" }, family, NOW)).toBe(true);
    // Another academy's announcement never reaches them.
    expect(reachesFamily({ ...live, workspaceId: "ws3" }, family, NOW)).toBe(false);
  });

  it("a program: only families of its current members, in that academy", () => {
    const program = { ...live, audience: "program" as const, audienceId: "juniors" };
    expect(reachesFamily(program, family, NOW)).toBe(true);
    expect(reachesFamily({ ...program, audienceId: "adults" }, family, NOW)).toBe(false);
    // Same program id, another academy: not theirs.
    expect(reachesFamily({ ...program, workspaceId: "ws2" }, family, NOW)).toBe(false);
    expect(reachesFamily({ ...program, audienceId: null }, family, NOW)).toBe(false);
  });

  it("an event: only families of students registered for it (not cancelled)", () => {
    const camp = { ...live, audience: "event" as const, audienceId: "camp" };
    expect(reachesFamily(camp, family, NOW)).toBe(true);
    expect(reachesFamily({ ...camp, audienceId: "tournament" }, family, NOW)).toBe(false);
    expect(reachesFamily({ ...camp, workspaceId: "ws2", audienceId: "clinic" }, family, NOW)).toBe(
      true,
    );
    expect(reachesFamily({ ...camp, workspaceId: "ws2" }, family, NOW)).toBe(false);
  });

  it("drafts, scheduled ones still ahead, and expired ones reach nobody", () => {
    expect(reachesFamily({ ...live, publishedAt: null }, family, NOW)).toBe(false);
    expect(reachesFamily({ ...live, publishedAt: NOW + HOUR }, family, NOW)).toBe(false);
    expect(reachesFamily({ ...live, expiresAt: NOW }, family, NOW)).toBe(false);
    // The scheduled one appears once its time comes, and goes once it ends.
    const scheduled = { ...live, publishedAt: NOW + HOUR, expiresAt: NOW + 3 * HOUR };
    expect(reachesFamily(scheduled, family, NOW + HOUR)).toBe(true);
    expect(reachesFamily(scheduled, family, NOW + 3 * HOUR)).toBe(false);
  });

  it("a family with no students reaches nothing", () => {
    const none: FamilyAudience = {
      workspaceIds: new Set(),
      programs: new Set(),
      events: new Set(),
    };
    expect(reachesFamily(live, none, NOW)).toBe(false);
  });
});

describe("the order they're read in", () => {
  const a = (id: string, over: Partial<Parameters<typeof compareLive>[0]> = {}) => ({
    id,
    pinned: false,
    publishedAt: NOW,
    expiresAt: null,
    updatedAt: NOW,
    ...over,
  });

  it("pinned first, then newest first", () => {
    const items = [
      a("old", { publishedAt: NOW - 3 * HOUR }),
      a("new", { publishedAt: NOW - HOUR }),
      a("pinned-old", { pinned: true, publishedAt: NOW - 9 * HOUR }),
      a("pinned-new", { pinned: true, publishedAt: NOW - 2 * HOUR }),
    ];
    expect(items.sort(compareLive).map((i) => i.id)).toEqual([
      "pinned-new",
      "pinned-old",
      "new",
      "old",
    ]);
  });

  it("each staff tab: drafts by last edit, scheduled soonest, expired latest ended", () => {
    expect(
      sortForState("draft", [a("x", { updatedAt: 1 }), a("y", { updatedAt: 2 })]).map((i) => i.id),
    ).toEqual(["y", "x"]);
    expect(
      sortForState("scheduled", [
        a("later", { publishedAt: NOW + 2 * HOUR }),
        a("soon", { publishedAt: NOW + HOUR }),
      ]).map((i) => i.id),
    ).toEqual(["soon", "later"]);
    expect(
      sortForState("expired", [
        a("long-ago", { expiresAt: NOW - 9 * HOUR }),
        a("just", { expiresAt: NOW - HOUR }),
      ]).map((i) => i.id),
    ).toEqual(["just", "long-ago"]);
  });
});

describe("when a save publishes it", () => {
  it("a draft has no time; now is the server's now", () => {
    expect(resolvePublish({ mode: "draft", now: NOW })).toEqual({
      ok: true,
      publishedAt: null,
      expiresAt: null,
    });
    expect(resolvePublish({ mode: "now", now: NOW })).toMatchObject({ publishedAt: NOW });
  });

  it("saving one that's already live keeps its time (a typo fix isn't news again)", () => {
    const current = { publishedAt: NOW - HOUR, expiresAt: null };
    expect(resolvePublish({ mode: "now", current, now: NOW })).toMatchObject({
      publishedAt: NOW - HOUR,
    });
    // A scheduled one published now goes live now.
    expect(
      resolvePublish({
        mode: "now",
        current: { publishedAt: NOW + HOUR, expiresAt: null },
        now: NOW,
      }),
    ).toMatchObject({ publishedAt: NOW });
  });

  it("scheduling needs a time ahead, within a year", () => {
    expect(resolvePublish({ mode: "schedule", publishAt: NOW + HOUR, now: NOW })).toMatchObject({
      ok: true,
      publishedAt: NOW + HOUR,
    });
    expect(resolvePublish({ mode: "schedule", publishAt: NOW, now: NOW })).toMatchObject({
      ok: false,
      field: "publishAt",
    });
    expect(resolvePublish({ mode: "schedule", now: NOW })).toMatchObject({ ok: false });
    expect(
      resolvePublish({
        mode: "schedule",
        publishAt: NOW + ANNOUNCEMENT_MAX_AHEAD_MS + 1,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, field: "publishAt" });
  });

  it("an end must come after it goes live and not have passed", () => {
    expect(resolvePublish({ mode: "now", expiresAt: NOW + HOUR, now: NOW })).toMatchObject({
      ok: true,
      expiresAt: NOW + HOUR,
    });
    expect(resolvePublish({ mode: "now", expiresAt: NOW - 1, now: NOW })).toMatchObject({
      ok: false,
      field: "expiresAt",
    });
    expect(
      resolvePublish({
        mode: "schedule",
        publishAt: NOW + 2 * HOUR,
        expiresAt: NOW + HOUR,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, field: "expiresAt" });
    // An end that's already stored may stay as it is (editing an expired announcement's text).
    expect(
      resolvePublish({
        mode: "now",
        expiresAt: NOW - HOUR,
        current: { publishedAt: NOW - 2 * HOUR, expiresAt: NOW - HOUR },
        now: NOW,
      }),
    ).toMatchObject({ ok: true, expiresAt: NOW - HOUR });
  });
});

describe("the composer's input", () => {
  const base = { title: "Courts closed", body: "Resurfacing on Saturday.", publish: "now" };

  it("a program or event audience names one; scheduling names a time", () => {
    expect(announcementSchema.safeParse({ ...base, audience: "all" }).success).toBe(true);
    expect(announcementSchema.safeParse({ ...base, audience: "program" }).success).toBe(false);
    expect(
      announcementSchema.safeParse({
        ...base,
        audience: "event",
        audienceId: "0196f3a2-0000-7000-8000-000000000000",
      }).success,
    ).toBe(true);
    expect(
      announcementSchema.safeParse({ ...base, audience: "all", publish: "schedule" }).success,
    ).toBe(false);
  });

  it("the body is plain text, trimmed, with Windows line breaks made plain", () => {
    const parsed = announcementSchema.parse({
      ...base,
      audience: "all",
      body: "  One\r\n\r\nTwo  ",
    });
    expect(parsed.body).toBe("One\n\nTwo");
    expect(parsed.pinned).toBe(false);
    expect(announcementSchema.safeParse({ ...base, audience: "all", body: "   " }).success).toBe(
      false,
    );
  });
});

describe("the body: paragraphs and links, never HTML", () => {
  it("paragraphs split on blank lines; single line breaks stay inside one", () => {
    expect(announcementParagraphs("First line\nsame paragraph\n\n  \nSecond\r\n\r\nThird")).toEqual(
      ["First line\nsame paragraph", "Second", "Third"],
    );
    expect(announcementParagraphs("   ")).toEqual([]);
  });

  it("finds http, https, and www links; sentence punctuation stays outside", () => {
    expect(linkify("Sign up at https://example.com/camp. See you!")).toEqual([
      { kind: "text", text: "Sign up at " },
      { kind: "link", text: "https://example.com/camp", href: "https://example.com/camp" },
      { kind: "text", text: ". See you!" },
    ]);
    expect(linkify("Map: www.example.com/map")).toEqual([
      { kind: "text", text: "Map: " },
      { kind: "link", text: "www.example.com/map", href: "https://www.example.com/map" },
    ]);
    expect(linkify("(details: https://example.com/a_(b))")).toEqual([
      { kind: "text", text: "(details: " },
      { kind: "link", text: "https://example.com/a_(b)", href: "https://example.com/a_(b)" },
      { kind: "text", text: ")" },
    ]);
  });

  it("never links scripts, markup, or other schemes", () => {
    const text = 'javascript:alert(1) <a href="https://evil.example">x</a> data:text/html,hi';
    const links = linkify(text).filter((s) => s.kind === "link");
    expect(links).toEqual([
      { kind: "link", text: "https://evil.example", href: "https://evil.example/" },
    ]);
    // Everything else stays text the app shows as text.
    expect(
      linkify(text)
        .map((s) => s.text)
        .join(""),
    ).toBe(text);
    expect(linkify("Plain words only")).toEqual([{ kind: "text", text: "Plain words only" }]);
  });

  it("a one-line excerpt for compact cards", () => {
    expect(announcementExcerpt("Short note")).toBe("Short note");
    const long = `${"word ".repeat(60)}end`;
    const excerpt = announcementExcerpt(long, 40);
    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});
