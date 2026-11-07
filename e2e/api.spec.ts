import type {
  LedgerLineDto,
  LessonDetailDto,
  StatementDto,
  TodayDto,
} from "../src/shared/api-types";
import { expect, onboard, test, uuid } from "./support";

// API-level golden paths through the real Worker + D1: the numbers coaches trust must hold.
test.describe("credits and money", () => {
  test.skip(({ isMobile }) => isMobile, "API flows run once (desktop project)");

  test("sell, check in, replay, undo, and pay keep credits and balance honest", {
    tag: "@smoke",
  }, async ({ coach }) => {
    const { api } = coach;
    await onboard(api);
    const tpl = await api.post<{ id: string }>("/packages", {
      name: "5-session pack",
      credits: 5,
      priceMinor: 250000,
      validityDays: 60,
    });
    const client = await api.post<{ id: string }>("/clients", {
      firstName: "Gab",
      lastName: "Reyes",
    });
    const sold = await api.post<{ remaining: number }>(`/clients/${client.id}/packages`, {
      packageId: tpl.id,
    });
    expect(sold.remaining).toBe(5);

    const { date } = await api.get<TodayDto>("/today");
    const created = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date,
      startTime: "09:00",
      durationMinutes: 60,
      clientIds: [client.id],
    });
    const entry = created.lesson.roster[0];
    expect(entry?.status).toBe("booked");
    if (!entry) return;

    const mid = uuid();
    const checkIn = () =>
      api.post<{ replay: boolean; lesson: LessonDetailDto }>(
        `/attendance/${entry.attendanceId}`,
        { status: "present", mutationId: mid },
        { "Idempotency-Key": mid },
      );
    const first = await checkIn();
    expect(first.lesson.roster[0]?.packageRemaining).toBe(4);

    // An offline client may resend the same mutation: it must not use a second credit.
    await checkIn();
    const ledger = await api.get<LedgerLineDto[]>(`/clients/${client.id}/ledger`);
    expect(ledger.filter((l) => l.reason === "use")).toHaveLength(1);

    const undoId = uuid();
    const undone = await api.post<{ lesson: LessonDetailDto }>(
      `/attendance/${entry.attendanceId}`,
      { status: "booked", mutationId: undoId },
      { "Idempotency-Key": undoId },
    );
    expect(undone.lesson.roster[0]?.packageRemaining).toBe(5);

    let statement = await api.get<StatementDto>(`/clients/${client.id}/statement`);
    expect(statement.balanceMinor).toBe(250000);
    await api.post("/payments", {
      clientId: client.id,
      amountMinor: 250000,
      method: "Cash",
      paidOn: date,
    });
    statement = await api.get<StatementDto>(`/clients/${client.id}/statement`);
    expect(statement.balanceMinor).toBe(0);
  });

  test("without credits a check-in charges the session rate, and undo voids it", async ({
    coach,
  }) => {
    const { api } = coach;
    await onboard(api);
    const rate = await api.post<{ id: string }>("/rates", {
      name: "Private lesson",
      kind: "private",
      durationMinutes: 60,
      priceMinor: 80000,
      unit: "session",
    });
    const client = await api.post<{ id: string }>("/clients", {
      firstName: "Iya",
      lastName: "Cruz",
    });
    const { date } = await api.get<TodayDto>("/today");
    const created = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date,
      startTime: "10:00",
      durationMinutes: 60,
      rateId: rate.id,
      clientIds: [client.id],
    });
    const entry = created.lesson.roster[0];
    if (!entry) throw new Error("No roster entry");

    const mid = uuid();
    const checked = await api.post<{ lesson: LessonDetailDto }>(
      `/attendance/${entry.attendanceId}`,
      {
        status: "present",
        mutationId: mid,
      },
    );
    expect(checked.lesson.roster[0]?.chargeMinor).toBe(80000);
    expect((await api.get<StatementDto>(`/clients/${client.id}/statement`)).balanceMinor).toBe(
      80000,
    );

    await api.post(`/attendance/${entry.attendanceId}`, { status: "booked", mutationId: uuid() });
    expect((await api.get<StatementDto>(`/clients/${client.id}/statement`)).balanceMinor).toBe(0);
  });

  test("cancelling a session gives used credits back", async ({ coach }) => {
    const { api } = coach;
    await onboard(api);
    const tpl = await api.post<{ id: string }>("/packages", {
      name: "10-pack",
      credits: 10,
      priceMinor: 0,
    });
    const client = await api.post<{ id: string }>("/clients", {
      firstName: "Mika",
      lastName: "Lim",
    });
    await api.post(`/clients/${client.id}/packages`, { packageId: tpl.id });
    const { date } = await api.get<TodayDto>("/today");
    const created = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "group",
      date,
      startTime: "17:00",
      durationMinutes: 90,
      clientIds: [client.id],
    });
    const entry = created.lesson.roster[0];
    if (!entry) throw new Error("No roster entry");
    const checked = await api.post<{ lesson: LessonDetailDto }>(
      `/attendance/${entry.attendanceId}`,
      {
        status: "present",
        mutationId: uuid(),
      },
    );
    expect(checked.lesson.roster[0]?.packageRemaining).toBe(9);

    const cancelled = await api.post<LessonDetailDto>(
      `/lessons/${created.lesson.lesson.id}/cancel`,
      {
        reason: "Rain",
      },
    );
    expect(cancelled.lesson.status).toBe("cancelled");
    const ledger = await api.get<LedgerLineDto[]>(`/clients/${client.id}/ledger`);
    expect(ledger[0]?.runningRemaining).toBe(10);
  });
});

test.describe("test bypass gate", () => {
  test.skip(({ isMobile }) => isMobile, "Runs once");

  test("test endpoints are invisible without the secret", { tag: "@smoke" }, async ({
    request,
  }) => {
    const res = await request.post("/api/test/sign-in", {
      data: { email: "intruder@example.com" },
    });
    expect(res.status()).toBe(404);
    const wrong = await request.post("/api/test/sign-in", {
      headers: { "x-e2e-bypass": "not-the-secret-not-the-secret" },
      data: { email: "intruder@example.com" },
    });
    expect(wrong.status()).toBe(404);
  });
});
