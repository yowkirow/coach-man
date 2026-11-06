import type { PublicCoachDto, PublicProgramDto } from "@shared/api-types";
import { describe, expect, it } from "vitest";
import {
  EVERYONE,
  programsOf,
  programTeams,
  teamCountLine,
  teamPhotoKey,
  teamView,
} from "../../src/app/features/public/team";
import { academyPageMeta, parseAcademyPath } from "../../src/worker/lib/page-meta";

const APP = "https://coachman.cloud";

function person(id: string, extra: Partial<PublicCoachDto> = {}): PublicCoachDto {
  return {
    id,
    name: `Coach ${id.toUpperCase()}`,
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

function program(id: string, coaches: { id: string; lead?: boolean }[]): PublicProgramDto {
  return {
    id,
    name: `Program ${id}`,
    coaches: coaches.map((c) => ({
      id: c.id,
      name: `Coach ${c.id.toUpperCase()}`,
      title: null,
      photoKey: null,
      lead: c.lead ?? false,
    })),
  } as unknown as PublicProgramDto;
}

// a leads juniors with b assisting; c leads adults (b assists there too); d is display-only.
const a = person("a");
const b = person("b");
const c = person("c");
const d = person("d");
const academy = {
  coaches: [a, b, c, d],
  programs: [
    program("juniors", [{ id: "a", lead: true }, { id: "b" }]),
    program("adults", [{ id: "c", lead: true }, { id: "b" }]),
    // Its only coach's profile is hidden: nobody to show, so it's left out.
    program("hidden", [{ id: "zz", lead: true }]),
  ],
};

describe("the team page by program", () => {
  const teams = programTeams(academy);

  it("pairs each program with the public people coaching it, lead first", () => {
    expect(teams.map((t) => t.program.id)).toEqual(["juniors", "adults"]);
    expect(teams[0]?.people.map((p) => p.id)).toEqual(["a", "b"]);
    expect(teams[0]?.leadId).toBe("a");
    expect(teams[1]?.leadId).toBe("c");
  });

  it("never makes an assistant the lead when the lead's profile is hidden", () => {
    const [team] = programTeams({
      coaches: [b],
      programs: [program("p", [{ id: "hidden-lead", lead: true }, { id: "b" }])],
    });
    expect(team?.people.map((p) => p.id)).toEqual(["b"]);
    expect(team?.leadId).toBeNull();
    expect(team && teamCountLine(team)).toBe("1 coach");
  });

  it("opens on the program asked for, with everyone else after", () => {
    const view = teamView(academy, teams, "adults");
    expect(view.kind).toBe("program");
    if (view.kind !== "program") return;
    expect(view.team.people.map((p) => p.id)).toEqual(["c", "b"]);
    expect(view.others.map((p) => p.id)).toEqual(["a", "d"]);
  });

  it("opens on the first program without a choice, or with one that has no team", () => {
    for (const asked of [undefined, "hidden", "gone"]) {
      const view = teamView(academy, teams, asked);
      expect(view.kind === "program" && view.team.program.id).toBe("juniors");
    }
  });

  it("shows everyone when asked, or when no program has a team", () => {
    const all = teamView(academy, teams, EVERYONE);
    expect(all.kind === "everyone" && all.people.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    const none = teamView({ coaches: [d] }, [], undefined);
    expect(none.kind === "everyone" && none.people.map((p) => p.id)).toEqual(["d"]);
  });

  it("lists the programs someone coaches, in the academy's order", () => {
    expect(programsOf(teams, "b").map((p) => p.id)).toEqual(["juniors", "adults"]);
    expect(programsOf(teams, "d")).toEqual([]);
  });

  it("counts a program's team in words", () => {
    expect(teams[0] && teamCountLine(teams[0])).toBe("2 coaches");
    const [solo] = programTeams({
      coaches: [a],
      programs: [program("p", [{ id: "a", lead: true }])],
    });
    expect(solo && teamCountLine(solo)).toBe("1 coach");
  });

  it("prefers the half-body portrait, then the square photo", () => {
    expect(teamPhotoKey({ portraitKey: "p.jpg", photoKey: "s.jpg" })).toBe("p.jpg");
    expect(teamPhotoKey({ portraitKey: null, photoKey: "s.jpg" })).toBe("s.jpg");
    expect(teamPhotoKey({ portraitKey: null, photoKey: null })).toBeNull();
  });
});

describe("the team page's link preview", () => {
  const base = {
    name: "Riverside Pickleball",
    slug: "riverside",
    tagline: null,
    about: null,
    logoKey: "ws/w1/public/logo-1.png",
    coverKey: null,
  };

  it("reads /a/<slug>/team", () => {
    expect(parseAcademyPath("/a/riverside/team")).toEqual({ slug: "riverside", page: "team" });
    expect(parseAcademyPath("/a/riverside/team/")).toEqual({ slug: "riverside", page: "team" });
  });

  it("names the first people and shows the first face", () => {
    const meta = academyPageMeta({
      academy: {
        ...base,
        coaches: [
          { name: "Ana Cruz", portraitKey: null, photoKey: null },
          { name: "Ben Reyes", portraitKey: "ws/w1/public/coaches/b-portrait.jpg", photoKey: null },
          { name: "Cy Lim", portraitKey: null, photoKey: "ws/w1/public/coaches/c.jpg" },
          { name: "Di Tan", portraitKey: null, photoKey: null },
        ],
      },
      page: "team",
      appUrl: APP,
    });
    expect(meta.title).toBe("Meet the team · Riverside Pickleball");
    expect(meta.description).toBe(
      "Meet the team at Riverside Pickleball: Ana Cruz, Ben Reyes, Cy Lim, and 1 more.",
    );
    expect(meta.image).toBe(`${APP}/api/public/files/ws/w1/public/coaches/b-portrait.jpg`);
    expect(meta.twitterCard).toBe("summary");
    expect(meta.url).toBe(`${APP}/a/riverside/team`);
  });

  it("falls back to the cover (large) or the logo, and reads well with few people", () => {
    const two = academyPageMeta({
      academy: {
        ...base,
        coverKey: "ws/w1/public/cover.jpg",
        coaches: [
          { name: "Ana Cruz", portraitKey: null, photoKey: null },
          { name: "Ben Reyes", portraitKey: null, photoKey: null },
        ],
      },
      page: "team",
      appUrl: APP,
    });
    expect(two.description).toBe("Meet the team at Riverside Pickleball: Ana Cruz and Ben Reyes.");
    expect(two.image).toBe(`${APP}/api/public/files/ws/w1/public/cover.jpg`);
    expect(two.twitterCard).toBe("summary_large_image");
    const none = academyPageMeta({ academy: { ...base, coaches: [] }, page: "team", appUrl: APP });
    expect(none.description).toBe("Meet the team at Riverside Pickleball.");
    expect(none.image).toBe(`${APP}/api/public/files/ws/w1/public/logo-1.png`);
  });
});
