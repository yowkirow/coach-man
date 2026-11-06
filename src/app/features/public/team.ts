import type { PublicAcademyDto, PublicCoachDto, PublicProgramDto } from "@shared/api-types";

/** `?program=` for the whole team on the team page. */
export const EVERYONE = "all";

export interface ProgramTeam {
  program: PublicProgramDto;
  /** Who coaches it, lead first, as the program lists them. */
  people: PublicCoachDto[];
  /** The lead coach's id, when their profile is public. */
  leadId: string | null;
}

/**
 * Each public program with the people coaching it whose profiles are public, in the academy's
 * order. A program nobody public coaches is left out: the team page has no one to show for it.
 */
export function programTeams(
  academy: Pick<PublicAcademyDto, "programs" | "coaches">,
): ProgramTeam[] {
  const byId = new Map(academy.coaches.map((c) => [c.id, c]));
  const out: ProgramTeam[] = [];
  for (const program of academy.programs) {
    const people: PublicCoachDto[] = [];
    let leadId: string | null = null;
    for (const ref of program.coaches) {
      const person = byId.get(ref.id);
      if (!person || people.includes(person)) continue;
      people.push(person);
      if (ref.lead) leadId = person.id;
    }
    if (people.length) out.push({ program, people, leadId });
  }
  return out;
}

export type TeamView =
  | {
      kind: "program";
      team: ProgramTeam;
      /** Everyone on the team who doesn't coach this program, in the academy's order. */
      others: PublicCoachDto[];
    }
  | { kind: "everyone"; people: PublicCoachDto[] };

/**
 * What the team page shows for `?program=`: that program's coaches and the rest of the team, or
 * everyone. Without a choice (or with a program that has no public coaches) it opens on the first
 * program with a team, as the academy page opens on its first program; with no program teams at
 * all, on everyone.
 */
export function teamView(
  academy: Pick<PublicAcademyDto, "coaches">,
  teams: ProgramTeam[],
  programParam: string | undefined,
): TeamView {
  if (programParam !== EVERYONE) {
    const team = teams.find((t) => t.program.id === programParam) ?? teams[0];
    if (team) {
      const inTeam = new Set(team.people.map((p) => p.id));
      return { kind: "program", team, others: academy.coaches.filter((c) => !inTeam.has(c.id)) };
    }
  }
  return { kind: "everyone", people: academy.coaches };
}

/** The programs someone coaches, in the academy's order. */
export function programsOf(teams: ProgramTeam[], personId: string): PublicProgramDto[] {
  return teams.filter((t) => t.people.some((p) => p.id === personId)).map((t) => t.program);
}

/** The photo the team page shows: the half-body portrait, else the square photo, else none. */
export function teamPhotoKey(p: Pick<PublicCoachDto, "portraitKey" | "photoKey">): string | null {
  return p.portraitKey ?? p.photoKey ?? null;
}

/** "2 coaches", "1 coach": a program's team in words (its lead carries a "Program lead" tag). */
export function teamCountLine(team: ProgramTeam): string {
  const n = team.people.length;
  return `${n} ${n === 1 ? "coach" : "coaches"}`;
}
