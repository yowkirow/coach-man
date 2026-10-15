import type { ClientListItemDto } from "@shared/api-types";
import { clientSchema } from "@shared/schemas";
import { DATE_RE } from "@shared/time";
import Papa from "papaparse";
import { normPhone } from "../clients/client-utils";

/** What a CSV column can fill. "skip" leaves the column out. */
export type FieldKey =
  | "skip"
  | "fullName"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "level"
  | "duprRating"
  | "birthDate"
  | "isJunior"
  | "guardianName"
  | "guardianPhone"
  | "guardianEmail"
  | "emergencyName"
  | "emergencyPhone"
  | "tags"
  | "status"
  | "joinedOn"
  | "notes";

export const FIELD_LABELS: Record<FieldKey, string> = {
  skip: "Don't import",
  fullName: "Full name (first and last)",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  level: "Level",
  duprRating: "DUPR rating",
  birthDate: "Birth date",
  isJunior: "Junior (yes or no)",
  guardianName: "Guardian name",
  guardianPhone: "Guardian phone",
  guardianEmail: "Guardian email",
  emergencyName: "Emergency contact",
  emergencyPhone: "Emergency phone",
  tags: "Tags",
  status: "Status",
  joinedOn: "Client since",
  notes: "Notes",
};

export const FIELD_ORDER = Object.keys(FIELD_LABELS) as FieldKey[];

/** Header spellings we recognise, compared lowercase with punctuation and spaces removed. */
const SYNONYMS: Record<Exclude<FieldKey, "skip">, string[]> = {
  fullName: [
    "name",
    "fullname",
    "clientname",
    "playername",
    "studentname",
    "student",
    "member",
    "membername",
    "contactname",
    "client",
    "player",
  ],
  firstName: ["firstname", "first", "givenname", "fname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname", "lname"],
  email: ["email", "emailaddress", "mail", "emailid"],
  phone: [
    "phone",
    "phonenumber",
    "mobile",
    "mobilenumber",
    "cell",
    "cellphone",
    "cellnumber",
    "tel",
    "telephone",
    "contactnumber",
    "whatsapp",
    "number",
  ],
  level: ["level", "skilllevel", "skill", "playinglevel", "ntrp", "division"],
  duprRating: ["dupr", "duprrating", "rating"],
  birthDate: ["birthdate", "dateofbirth", "dob", "birthday", "born"],
  isJunior: ["junior", "isjunior", "minor", "youth", "kid"],
  guardianName: [
    "guardian",
    "guardianname",
    "parent",
    "parentname",
    "parentguardian",
    "parentorguardian",
  ],
  guardianPhone: ["guardianphone", "parentphone", "parentmobile", "guardianmobile", "parentnumber"],
  guardianEmail: ["guardianemail", "parentemail"],
  emergencyName: ["emergencycontact", "emergencyname", "emergency", "emergencycontactname", "ice"],
  emergencyPhone: ["emergencyphone", "emergencynumber", "emergencycontactphone", "icephone"],
  tags: ["tags", "tag", "labels", "label"],
  status: ["status", "clientstatus", "state", "membership"],
  joinedOn: [
    "joined",
    "joinedon",
    "clientsince",
    "since",
    "membersince",
    "startdate",
    "signupdate",
    "signedup",
  ],
  notes: ["notes", "note", "comments", "comment", "remarks", "memo", "info"],
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function guessField(header: string): FieldKey {
  const h = squash(header);
  if (!h) return "skip";
  for (const [field, words] of Object.entries(SYNONYMS) as [FieldKey, string[]][]) {
    if (words.includes(h)) return field;
  }
  return "skip";
}

/** One field per column: the first column claiming a field keeps it. */
export function guessMapping(headers: string[]): FieldKey[] {
  const taken = new Set<FieldKey>();
  const out = headers.map((h) => {
    const f = guessField(h);
    if (f === "skip" || taken.has(f)) return "skip";
    taken.add(f);
    return f;
  });
  // A separate first/last pair wins over a combined name column.
  if (out.includes("firstName") && out.includes("fullName"))
    return out.map((f) => (f === "fullName" ? "skip" : f));
  return out;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export const MAX_ROWS = 10_000;
/** The import endpoint's per-request row limit (clientImportSchema). */
export const CHUNK = 2000;

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  const [head, ...body] = result.data;
  const width = Math.max(head?.length ?? 0, ...body.slice(0, 50).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => head?.[i]?.trim() || `Column ${i + 1}`);
  return {
    headers,
    rows: body.filter((r) => r.some((cell) => cell.trim() !== "")),
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Reads the date formats spreadsheets produce. Slashed dates follow the workspace locale
 * (month first for en-US) unless the first number can only be a day.
 */
export function parseDate(raw: string, monthFirst: boolean): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (DATE_RE.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return validYmd(y ?? 0, m ?? 0, d ?? 0);
  }
  let m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += y > 30 ? 1900 : 2000;
    const dayFirst = a > 12 || (!monthFirst && b <= 12);
    return dayFirst ? validYmd(y, b, a) : validYmd(y, a, b);
  }
  m = s.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i);
  if (m) return validYmd(Number(m[3]), MONTHS.indexOf(m[2]?.toLowerCase() ?? "") + 1, Number(m[1]));
  m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m) return validYmd(Number(m[3]), MONTHS.indexOf(m[1]?.toLowerCase() ?? "") + 1, Number(m[2]));
  return null;
}

const STATUS_WORDS: Record<string, "active" | "lead" | "paused" | "archived"> = {
  active: "active",
  current: "active",
  yes: "active",
  member: "active",
  client: "active",
  lead: "lead",
  prospect: "lead",
  trial: "lead",
  inquiry: "lead",
  enquiry: "lead",
  interested: "lead",
  new: "lead",
  paused: "paused",
  pause: "paused",
  inactive: "paused",
  onhold: "paused",
  hold: "paused",
  break: "paused",
  onbreak: "paused",
  archived: "archived",
  archive: "archived",
  former: "archived",
  past: "archived",
  left: "archived",
  quit: "archived",
};

const YES = new Set(["yes", "y", "true", "1", "x", "junior", "jr", "minor", "kid", "youth"]);

export interface RowCheck {
  /** Line in the file; the header is line 1, so data starts at 2. */
  line: number;
  name: string;
  input: Record<string, unknown>;
  /** Why the row can't be imported. */
  problem: string | null;
  /** Why the row is probably someone already in CoachMan (or earlier in the file). */
  duplicateOf: string | null;
  /** Values that were adjusted or left out; the row still imports. */
  warnings: string[];
}

export interface CheckContext {
  existing: ClientListItemDto[];
  monthFirst: boolean;
  today: string;
}

const importRow = clientSchema.omit({ id: true, groupIds: true });

const FIELD_NAMES: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  level: "Level",
  duprRating: "DUPR rating",
  birthDate: "Birth date",
  guardianName: "Guardian name",
  guardianPhone: "Guardian phone",
  guardianEmail: "Guardian email",
  emergencyName: "Emergency contact",
  emergencyPhone: "Emergency phone",
  tags: "Tags",
  notes: "Notes",
  status: "Status",
  joinedOn: "Client since",
};

/** Builds the API row for each CSV line and says why any line can't (or shouldn't) be imported. */
export function checkRows(csv: ParsedCsv, mapping: FieldKey[], ctx: CheckContext): RowCheck[] {
  const emails = new Map<string, string>();
  const phones = new Map<string, string>();
  for (const c of ctx.existing) {
    const name = `${c.firstName} ${c.lastName}`.trim();
    if (c.email) emails.set(c.email.toLowerCase(), name);
    const p = normPhone(c.phone);
    if (p) phones.set(p, name);
  }
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const col = (field: FieldKey) => mapping.indexOf(field);

  return csv.rows.map((cells, i) => {
    const line = i + 2;
    const get = (field: FieldKey) => {
      const at = col(field);
      return at === -1 ? "" : (cells[at] ?? "").trim();
    };
    const warnings: string[] = [];
    let firstName = get("firstName");
    let lastName = get("lastName");
    const full = get("fullName");
    if (full && !firstName) {
      if (full.includes(",")) {
        const [last, ...rest] = full.split(",");
        lastName ||= (last ?? "").trim();
        firstName = rest.join(" ").trim();
      } else {
        const parts = full.split(/\s+/);
        if (parts.length > 1 && !lastName) lastName = parts.pop() ?? "";
        firstName = parts.join(" ");
      }
    }

    const input: Record<string, unknown> = { firstName, lastName };
    const text = (field: FieldKey, max: number) => {
      const v = get(field);
      if (!v) return;
      if (v.length > max) {
        warnings.push(`${FIELD_LABELS[field]} shortened to ${max} characters`);
        input[field] = v.slice(0, max);
      } else input[field] = v;
    };
    const email = get("email").toLowerCase();
    if (email) input.email = email;
    text("phone", 40);
    text("level", 40);
    text("guardianName", 80);
    text("guardianPhone", 40);
    const guardianEmail = get("guardianEmail").toLowerCase();
    if (guardianEmail) input.guardianEmail = guardianEmail;
    text("emergencyName", 80);
    text("emergencyPhone", 40);
    text("notes", 2000);

    let problem: string | null = null;
    const dupr = get("duprRating");
    if (dupr) {
      const n = Number(dupr.replace(",", "."));
      if (Number.isFinite(n) && n >= 1 && n <= 8) input.duprRating = Math.round(n * 1000) / 1000;
      else warnings.push(`DUPR "${dupr}" left out (use 1.0–8.0)`);
    }
    const birth = get("birthDate");
    if (birth) {
      const d = parseDate(birth, ctx.monthFirst);
      if (!d || d > ctx.today) problem = `Birth date "${birth}" isn't a date we can read`;
      else input.birthDate = d;
    }
    const joined = get("joinedOn");
    if (joined) {
      const d = parseDate(joined, ctx.monthFirst);
      if (d) input.joinedOn = d;
      else warnings.push(`Client since "${joined}" left out`);
    }
    if (col("isJunior") !== -1) input.isJunior = YES.has(get("isJunior").toLowerCase());
    else if (typeof input.birthDate === "string") {
      const [by = 0, bm = 0, bd = 0] = input.birthDate.split("-").map(Number);
      const [ty = 0, tm = 0, td = 0] = ctx.today.split("-").map(Number);
      const age = ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
      if (age < 18) input.isJunior = true;
    }
    const tags = get("tags");
    if (tags) {
      const list = [
        ...new Set(
          tags
            .split(/[;,|]/)
            .map((t) => t.trim().slice(0, 30))
            .filter(Boolean),
        ),
      ];
      if (list.length > 20) warnings.push("Only the first 20 tags kept");
      input.tags = list.slice(0, 20);
    }
    const status = get("status");
    if (status) {
      const s = STATUS_WORDS[squash(status)];
      if (s) input.status = s;
      else warnings.push(`Status "${status}" read as Active`);
    }

    if (!problem && !firstName) problem = "No name";
    if (!problem) {
      const parsed = importRow.safeParse(input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = String(issue?.path[0] ?? "");
        problem =
          field === "email"
            ? `Email "${email}" doesn't look right`
            : field === "guardianEmail"
              ? `Guardian email "${guardianEmail}" doesn't look right`
              : `${FIELD_NAMES[field] ?? "A value"}: ${issue?.message ?? "isn't valid"}`;
      }
    }

    let duplicateOf: string | null = null;
    const phone = normPhone(typeof input.phone === "string" ? input.phone : "");
    if (!problem) {
      if (email && emails.has(email)) duplicateOf = `Same email as ${emails.get(email)}`;
      else if (phone && phones.has(phone)) duplicateOf = `Same phone as ${phones.get(phone)}`;
      else if (email && seenEmail.has(email))
        duplicateOf = `Same email as line ${seenEmail.get(email)}`;
      else if (phone && seenPhone.has(phone))
        duplicateOf = `Same phone as line ${seenPhone.get(phone)}`;
      if (email && !seenEmail.has(email)) seenEmail.set(email, line);
      if (phone && !seenPhone.has(phone)) seenPhone.set(phone, line);
    }

    return {
      line,
      name: `${firstName} ${lastName}`.trim() || full || "(no name)",
      input,
      problem,
      duplicateOf,
      warnings,
    };
  });
}

/** Columns plus two clearly fictional rows, so the expected shape is obvious. */
export const TEMPLATE_CSV = [
  "First name,Last name,Email,Phone,Level,Birth date,Guardian,Guardian phone,Tags,Status,Notes",
  "Alex,Example,alex@example.com,+1 555 0100,3.0,,,,morning; doubles,Active,Prefers early sessions",
  "Sam,Sample,,+1 555 0101,2.5,2012-05-14,Jordan Sample,+1 555 0102,junior,Lead,Trial lesson booked",
].join("\r\n");
