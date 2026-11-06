import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ImportResultDto } from "../../shared/api-types";
import { ATTENDANCE_LABELS, LESSON_KIND_LABELS } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import { minorToInput } from "../../shared/money";
import { clientImportSchema } from "../../shared/schemas";
import { localDate, localTime, todayIn } from "../../shared/time";
import { chunkRows } from "../db/client";
import * as schema from "../db/schema";
import { auditEntry } from "../lib/audit";
import { notFound } from "../lib/errors";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import { packagesForClients, runBatch } from "../services/credits";
import { lessonTitle } from "../services/lessons";
import type { AppBindings } from "../types";

const { attendance, charge, client, clientPackage, event, lesson, payment, trainingGroup } = schema;

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

function csvResponse(name: string, body: string) {
  return new Response(`\uFEFF${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

const normPhone = (p: string | null | undefined) => (p ? p.replace(/[^\d+]/g, "") : "");

export const dataRoutes = new Hono<AppBindings>()
  .post("/clients/import", requireCap("data"), v("json", clientImportSchema), async (c) => {
    const ctx = ctxOf(c);
    const { rows, skipDuplicates } = c.req.valid("json");
    const existing = await ctx.db
      .select({ email: client.email, phone: client.phone })
      .from(client)
      .where(eq(client.workspaceId, ctx.workspaceId));
    const emails = new Set(existing.map((e) => e.email?.toLowerCase()).filter(Boolean));
    const phones = new Set(existing.map((e) => normPhone(e.phone)).filter(Boolean));
    const result: ImportResultDto = { created: 0, skipped: [] };
    const today = todayIn(ctx.settings.timezone);
    const inserts: (typeof client.$inferInsert)[] = [];
    rows.forEach((row, i) => {
      const email = row.email?.toLowerCase() ?? null;
      const phone = normPhone(row.phone);
      if (skipDuplicates && ((email && emails.has(email)) || (phone && phones.has(phone)))) {
        result.skipped.push({
          row: i + 1,
          reason: "Already in your clients (same email or phone)",
        });
        return;
      }
      if (email) emails.add(email);
      if (phone) phones.add(phone);
      inserts.push({
        ...row,
        id: uuidv7(),
        workspaceId: ctx.workspaceId,
        email,
        tags: row.tags ?? [],
        joinedOn: row.joinedOn ?? today,
        source: row.source ?? "CSV import",
      });
    });
    // client has 30 columns; at most 3 rows per statement under the 100-parameter cap.
    const chunks = chunkRows(inserts, 30);
    for (let i = 0; i < chunks.length; i += 40) {
      await runBatch(
        ctx,
        chunks.slice(i, i + 40).map((chunk) => ctx.db.insert(client).values(chunk)),
      );
    }
    result.created = inserts.length;
    await auditEntry(ctx, "import", "client", null, {
      created: result.created,
      skipped: result.skipped.length,
    });
    return c.json(result, 201);
  })

  .get("/export/:file", requireCap("data"), async (c) => {
    const ctx = ctxOf(c);
    const { db, workspaceId, settings } = ctx;
    const tz = settings.timezone;
    const file = c.req.param("file");
    const money = (minor: number) => minorToInput(minor, settings.currency);

    if (file === "clients.csv") {
      const rows = await db
        .select()
        .from(client)
        .where(eq(client.workspaceId, workspaceId))
        .orderBy(asc(client.firstName), asc(client.lastName));
      const pkgs = await packagesForClients(
        ctx,
        rows.map((r) => r.id),
      );
      const credits = new Map<string, number>();
      for (const p of pkgs)
        if (p.status === "active")
          credits.set(p.clientId, (credits.get(p.clientId) ?? 0) + p.remaining);
      return csvResponse(
        "coachman-clients.csv",
        toCsv(
          [
            "First name",
            "Last name",
            "Email",
            "Phone",
            "Status",
            "Level",
            "DUPR",
            "Birth date",
            "Junior",
            "Guardian",
            "Guardian phone",
            "Emergency contact",
            "Emergency phone",
            "Tags",
            "Credits left",
            "Joined",
            "Notes",
          ],
          rows.map((r) => [
            r.firstName,
            r.lastName,
            r.email,
            r.phone,
            r.status,
            r.level,
            r.duprRating,
            r.birthDate,
            r.isJunior ? "yes" : "no",
            r.guardianName,
            r.guardianPhone,
            r.emergencyName,
            r.emergencyPhone,
            r.tags.join("; "),
            credits.get(r.id) ?? 0,
            r.joinedOn,
            r.notes,
          ]),
        ),
      );
    }

    if (file === "attendance.csv") {
      const rows = await db
        .select({
          a: attendance,
          l: lesson,
          firstName: client.firstName,
          lastName: client.lastName,
          groupName: trainingGroup.name,
          eventName: event.name,
          packageName: clientPackage.name,
        })
        .from(attendance)
        .innerJoin(lesson, eq(lesson.id, attendance.lessonId))
        .innerJoin(client, eq(client.id, attendance.clientId))
        .leftJoin(trainingGroup, eq(trainingGroup.id, lesson.groupId))
        .leftJoin(event, eq(event.id, lesson.eventId))
        .leftJoin(clientPackage, eq(clientPackage.id, attendance.consumedPackageId))
        .where(eq(attendance.workspaceId, workspaceId))
        .orderBy(asc(lesson.startsAt));
      return csvResponse(
        "coachman-attendance.csv",
        toCsv(
          [
            "Date",
            "Start",
            "Session",
            "Type",
            "Court",
            "Session status",
            "Client",
            "Attendance",
            "Paid with",
          ],
          rows.map((r) => [
            localDate(r.l.startsAt, tz),
            localTime(r.l.startsAt, tz),
            lessonTitle(r.l, r.groupName, r.eventName, null),
            LESSON_KIND_LABELS[r.l.kind],
            r.l.court,
            r.l.status,
            `${r.firstName} ${r.lastName}`.trim(),
            ATTENDANCE_LABELS[r.a.status],
            r.packageName ??
              (r.a.chargeId ? "Pay per session" : r.a.complimentary ? "Complimentary" : ""),
          ]),
        ),
      );
    }

    if (file === "payments.csv") {
      const rows = await db
        .select({ p: payment, firstName: client.firstName, lastName: client.lastName })
        .from(payment)
        .innerJoin(client, eq(client.id, payment.clientId))
        .where(eq(payment.workspaceId, workspaceId))
        .orderBy(asc(payment.paidOn));
      return csvResponse(
        "coachman-payments.csv",
        toCsv(
          [
            "Paid on",
            "Client",
            `Amount (${settings.currency})`,
            "Method",
            "Reference",
            "Note",
            "Voided",
          ],
          rows.map((r) => [
            r.p.paidOn,
            `${r.firstName} ${r.lastName}`.trim(),
            money(r.p.amountMinor),
            r.p.method,
            r.p.reference,
            r.p.note,
            r.p.voidedAt ? "yes" : "",
          ]),
        ),
      );
    }

    if (file === "charges.csv") {
      const rows = await db
        .select({ ch: charge, firstName: client.firstName, lastName: client.lastName })
        .from(charge)
        .innerJoin(client, eq(client.id, charge.clientId))
        .where(eq(charge.workspaceId, workspaceId))
        .orderBy(asc(charge.occurredOn));
      return csvResponse(
        "coachman-charges.csv",
        toCsv(
          ["Date", "Client", "Type", "Description", `Amount (${settings.currency})`, "Voided"],
          rows.map((r) => [
            r.ch.occurredOn,
            `${r.firstName} ${r.lastName}`.trim(),
            r.ch.kind,
            r.ch.description,
            money(r.ch.amountMinor),
            r.ch.voidedAt ? "yes" : "",
          ]),
        ),
      );
    }

    if (file === "packages.csv") {
      const clients = await db
        .select({ id: client.id, firstName: client.firstName, lastName: client.lastName })
        .from(client)
        .where(eq(client.workspaceId, workspaceId));
      const pkgs = await packagesForClients(
        ctx,
        clients.map((x) => x.id),
        { includeInactive: true },
      );
      const names = new Map(clients.map((x) => [x.id, `${x.firstName} ${x.lastName}`.trim()]));
      return csvResponse(
        "coachman-packages.csv",
        toCsv(
          ["Client", "Package", "Credits", "Remaining", "Purchased", "Expires", "Status"],
          pkgs.map((p) => [
            names.get(p.clientId),
            p.name,
            p.creditsTotal,
            p.remaining,
            p.purchasedOn,
            p.expiresOn,
            p.status,
          ]),
        ),
      );
    }

    if (file === "workspace.json") {
      const tables = {
        workspaceSettings: schema.workspaceSettings,
        venues: schema.venue,
        clients: schema.client,
        groups: schema.trainingGroup,
        groupMembers: schema.groupMember,
        rates: schema.rate,
        packages: schema.packageTemplate,
        clientPackages: schema.clientPackage,
        creditLedger: schema.creditLedger,
        series: schema.lessonSeries,
        lessons: schema.lesson,
        attendance: schema.attendance,
        events: schema.event,
        registrations: schema.eventRegistration,
        charges: schema.charge,
        payments: schema.payment,
        skills: schema.skill,
        assessments: schema.assessment,
        assessmentScores: schema.assessmentScore,
        goals: schema.goal,
        notes: schema.note,
        ratings: schema.ratingSnapshot,
        // The academy's own records from the academy features: a full backup has them too. Invite
        // links aren't records (and hold token hashes), so they stay out.
        academyProfile: schema.academyProfile,
        coachProfiles: schema.coachProfile,
        teamPeople: schema.teamPerson,
        studentCoaches: schema.clientCoach,
        familyAccess: schema.clientAccess,
        enrollmentRequests: schema.enrollmentRequest,
        paymentProofs: schema.paymentSubmission,
        consentDocuments: schema.consentDocument,
        consentDocumentVersions: schema.consentDocumentVersion,
        consentSignatures: schema.consentSignature,
        pickupPeople: schema.authorizedPickup,
        announcements: schema.announcement,
        auditLog: schema.auditLog,
      } as const;
      const [academy] = await db
        .select({ name: schema.organization.name, slug: schema.organization.slug })
        .from(schema.organization)
        .where(eq(schema.organization.id, workspaceId));
      const out: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        format: "coachman-export-v1",
        academy: academy ?? null,
      };
      for (const [name, table] of Object.entries(tables)) {
        out[name] = await db.select().from(table).where(eq(table.workspaceId, workspaceId));
      }
      return new Response(JSON.stringify(out, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="coachman-export-${todayIn(tz)}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }

    throw notFound("Export");
  });
