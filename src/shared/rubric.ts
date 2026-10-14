import { PICKLEBALL_RUBRIC } from "./rubrics/pickleball";

export interface RubricSkill {
  category: string;
  name: string;
  description: string;
}

export interface SportRubric {
  sport: string;
  label: string;
  skills: RubricSkill[];
}

// Sport-agnostic registry: adding a sport means adding a rubric here.
export const RUBRICS: Record<string, SportRubric> = {
  pickleball: PICKLEBALL_RUBRIC,
};

export const SPORTS = Object.values(RUBRICS).map((r) => ({ id: r.sport, label: r.label }));

export function rubricFor(sport: string): SportRubric {
  return RUBRICS[sport] ?? PICKLEBALL_RUBRIC;
}
