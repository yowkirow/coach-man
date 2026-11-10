// Who hears about a session. A session's lead and assistant coaches get its reminder; a session
// with no coach on the team (none set, or they left) falls back to the owners, admins, and front
// desk, so nothing goes unannounced. They also get the academy-wide daily digest; coaches get one
// about their own sessions and students. Pure, so the rules are unit-tested.

import { normalizeRole, type StaffRole } from "../../shared/roles";

export interface StaffRef {
  userId: string;
  role: string;
}

export interface CoachedSession {
  coachUserId: string | null;
  assistantCoachIds: readonly string[];
}

/** The roles that look after the whole academy, not just their own sessions. */
const ACADEMY_WIDE: readonly StaffRole[] = ["owner", "admin", "front_desk"];

const isAcademyWide = (role: string) => ACADEMY_WIDE.includes(normalizeRole(role));

/** The user ids that get a session's reminder. */
export function sessionRecipients(session: CoachedSession, staff: readonly StaffRef[]): string[] {
  const onTeam = new Set(staff.map((s) => s.userId));
  const coaches = [
    ...new Set(
      [session.coachUserId, ...session.assistantCoachIds].filter(
        (id): id is string => Boolean(id) && onTeam.has(id as string),
      ),
    ),
  ];
  if (coaches.length) return coaches;
  return [...new Set(staff.filter((s) => isAcademyWide(s.role)).map((s) => s.userId))];
}

/** Whether `userId` should be reminded about this session. */
export function isRecipient(
  session: CoachedSession,
  userId: string,
  staff: readonly StaffRef[],
): boolean {
  return sessionRecipients(session, staff).includes(userId);
}

/** What a member's daily digest covers: the whole academy, or their own sessions and students. */
export function digestScope(role: string): "academy" | "own" {
  return isAcademyWide(role) ? "academy" : "own";
}

/** The sessions that belong in a member's digest. */
export function digestSessions<T extends CoachedSession>(
  sessions: readonly T[],
  member: StaffRef,
  staff: readonly StaffRef[],
): T[] {
  if (digestScope(member.role) === "academy") return [...sessions];
  return sessions.filter((s) => isRecipient(s, member.userId, staff));
}
