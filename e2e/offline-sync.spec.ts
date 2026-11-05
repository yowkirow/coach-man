import type {
  ClientDetailDto,
  LedgerLineDto,
  LessonDetailDto,
  TodayDto,
} from "../src/shared/api-types";
import { addMember, expect, onboard, test, testEmail, uuid, visit, watchErrors } from "./support";

// Offline check-in with roles in place (plan: "On court, even offline"; spec §3): a coach, who sees
// credits but no money, checks a player in with no connection; when it returns, the change syncs
// exactly once. Delivered again (a retry after a lost answer, a second tab), it's a replay: one
// credit used, whatever happens, and still no money in what the coach gets back.

/** Any money field in a JSON payload: an amount in minor units, `"…Minor": <number|null>`. */
const MONEY_FIELD = /"[A-Za-z]+Minor":\s*(-?\d|null)/;

test.describe("offline check-in", () => {
  test("a coach's offline check-in syncs exactly once and uses one credit", async ({
    coach: owner,
    personas,
  }, info) => {
    const { api } = owner;
    await onboard(api);
    const email = testEmail("offline-coach", info);
    const { userId } = await addMember(owner.request, { email, name: "Sam Rivera", role: "coach" });
    const pack = await api.post<{ id: string }>("/packages", {
      name: "5-session pack",
      credits: 5,
      priceMinor: 250000,
      validityDays: 60,
    });
    const kai = await api.post<{ id: string }>("/clients", {
      firstName: "Kai",
      lastName: "Mendoza",
    });
    const sold = await api.post<{ id: string }>(`/clients/${kai.id}/packages`, {
      packageId: pack.id,
    });
    const { date } = await api.get<TodayDto>("/today");
    const created = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
      kind: "private",
      date,
      startTime: "06:00",
      durationMinutes: 60,
      clientIds: [kai.id],
      coachUserId: userId,
    });
    const lessonId = created.lesson.lesson.id;
    const attendanceId = created.lesson.roster[0]?.attendanceId ?? "";

    const coach = await personas.open({ email, name: "Sam Rivera", persona: "none" });
    const page = coach.page;
    const errors = watchErrors(page);
    const sent: { body: string; key: string | undefined }[] = [];
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        new URL(r.url()).pathname === `/api/v1/attendance/${attendanceId}`
      ) {
        sent.push({ body: r.postData() ?? "", key: r.headers()["idempotency-key"] });
      }
    });

    await visit(page, `/sessions/${lessonId}`);
    const checkIn = page.getByRole("button", { name: "Check in Kai Mendoza", exact: true });
    await expect(checkIn).toBeVisible();
    // The coach sees what check-in needs, credits, and no price.
    await expect(
      page.getByRole("button", { name: /^Kai Mendoza: Booked\. 5 of 5 left · 5-session pack\./ }),
    ).toBeVisible();

    // No connection on court: the check-in shows at once and waits.
    await coach.context.setOffline(true);
    await checkIn.click();
    const checkedIn = page.getByRole("button", {
      name: "Kai Mendoza is checked in. Undo check-in",
    });
    await expect(checkedIn).toBeVisible();
    await expect(page.getByText("Waiting to sync").first()).toBeVisible();
    expect(sent).toEqual([]);

    // Back online: it syncs by itself, once.
    const synced = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith(`/api/v1/attendance/${attendanceId}`),
    );
    await coach.context.setOffline(false);
    const answer = await synced;
    expect(answer.status()).toBe(200);
    const text = await answer.text();
    expect(JSON.parse(text)).toMatchObject({ replay: false });
    expect(text).not.toMatch(MONEY_FIELD);
    await expect(page.getByText("Waiting to sync")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /^Kai Mendoza: Checked in\. 4 of 5 left · 5-session pack\./,
      }),
    ).toBeVisible();
    expect(sent).toHaveLength(1);
    const [first] = sent;
    if (!first?.key) throw new Error("The check-in went out without its idempotency key");
    expect(JSON.parse(first.body)).toMatchObject({ status: "present", mutationId: first.key });

    // The academy's books: present, one credit used.
    const usesOf = async () =>
      (await api.get<LedgerLineDto[]>(`/clients/${kai.id}/ledger`)).filter(
        (l) => l.reason === "use",
      );
    const remaining = async () =>
      (await api.get<ClientDetailDto>(`/clients/${kai.id}`)).packages.find((p) => p.id === sold.id)
        ?.remaining;
    expect(await usesOf()).toHaveLength(1);
    expect(await remaining()).toBe(4);

    // The same change delivered again, with its key (the stored answer, still without money) and
    // without it (the mutation id): replays, and still one credit.
    const resend = await coach.context.request.post(`/api/v1/attendance/${attendanceId}`, {
      data: JSON.parse(first.body),
      headers: { "Idempotency-Key": first.key },
    });
    expect(resend.status()).toBe(200);
    expect(resend.headers()["idempotent-replay"]).toBe("true");
    expect(await resend.text()).not.toMatch(MONEY_FIELD);
    const byMutation = await coach.api.post<{ replay: boolean }>(
      `/attendance/${attendanceId}`,
      JSON.parse(first.body),
    );
    expect(byMutation.replay).toBe(true);
    expect(await usesOf()).toHaveLength(1);
    expect(await remaining()).toBe(4);
    // A new change is a new mutation: undoing gives the credit back, once.
    await coach.api.post(`/attendance/${attendanceId}`, { status: "booked", mutationId: uuid() });
    expect(await remaining()).toBe(5);

    // After a reload, the coach's screen agrees, without a price anywhere.
    await coach.api.post(`/attendance/${attendanceId}`, { status: "present", mutationId: uuid() });
    await visit(page, `/sessions/${lessonId}`);
    await expect(checkedIn).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^Kai Mendoza: Checked in\. 4 of 5 left · 5-session pack\./,
      }),
    ).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("₱");
    expect(errors).toEqual([]);
  });

  // A weak court signal can hold a request for seconds while the phone reports it's online. If the
  // app reloads (or closes) then, the check-in must not be lost, nor counted twice.
  for (const reached of [false, true]) {
    test(`a check-in in flight when the app reloads still syncs exactly once (${reached ? "answer lost" : "never arrived"})`, async ({
      coach: owner,
      personas,
    }, info) => {
      const { api } = owner;
      await onboard(api);
      const email = testEmail(`inflight-coach-${reached}`, info);
      const { userId } = await addMember(owner.request, {
        email,
        name: "Sam Rivera",
        role: "coach",
      });
      const pack = await api.post<{ id: string }>("/packages", {
        name: "5-session pack",
        credits: 5,
        priceMinor: 250000,
        validityDays: 60,
      });
      const kai = await api.post<{ id: string }>("/clients", {
        firstName: "Kai",
        lastName: "Mendoza",
      });
      const sold = await api.post<{ id: string }>(`/clients/${kai.id}/packages`, {
        packageId: pack.id,
      });
      const { date } = await api.get<TodayDto>("/today");
      const created = await api.post<{ lesson: LessonDetailDto }>("/lessons", {
        kind: "private",
        date,
        startTime: "06:00",
        durationMinutes: 60,
        clientIds: [kai.id],
        coachUserId: userId,
      });
      const lessonId = created.lesson.lesson.id;
      const attendanceId = created.lesson.roster[0]?.attendanceId ?? "";
      const usesOf = async () =>
        (await api.get<LedgerLineDto[]>(`/clients/${kai.id}/ledger`)).filter(
          (l) => l.reason === "use",
        );
      const remaining = async () =>
        (await api.get<ClientDetailDto>(`/clients/${kai.id}`)).packages.find(
          (p) => p.id === sold.id,
        )?.remaining;

      const coach = await personas.open({ email, name: "Sam Rivera", persona: "none" });
      const page = coach.page;
      await visit(page, `/sessions/${lessonId}`);
      const checkIn = page.getByRole("button", { name: "Check in Kai Mendoza", exact: true });
      await expect(checkIn).toBeVisible();

      // The request hangs: it never reaches the server, or the server records it and the answer
      // never comes back. It stays held until the reload has abandoned it.
      const route = `**/api/v1/attendance/${attendanceId}`;
      let hold = true;
      let held = 0;
      let delivered = 0;
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(route, async (r) => {
        if (!hold) return r.continue();
        held += 1;
        if (reached) {
          await r.fetch();
          delivered += 1;
        }
        await released;
        await r.abort().catch(() => undefined);
      });
      await checkIn.click();
      await expect(
        page.getByRole("button", { name: "Kai Mendoza is checked in. Undo check-in" }),
      ).toBeVisible();
      await expect.poll(() => held).toBe(1);
      if (reached) await expect.poll(() => delivered).toBe(1);
      // The device keeps a copy of the change in flight.
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              new Promise<number>((resolve) => {
                const open = indexedDB.open("keyval-store");
                open.onerror = () => resolve(-1);
                open.onsuccess = () => {
                  const get = open.result
                    .transaction("keyval", "readonly")
                    .objectStore("keyval")
                    .get("coachman-query-cache");
                  get.onerror = () => resolve(-1);
                  get.onsuccess = () => {
                    const raw = get.result;
                    const saved = typeof raw === "string" ? JSON.parse(raw) : raw;
                    const mutations: { mutationKey?: unknown[] }[] =
                      saved?.clientState?.mutations ?? [];
                    resolve(mutations.filter((m) => m.mutationKey?.[0] === "attendance").length);
                  };
                };
              }),
          ),
        )
        .toBe(1);
      expect(await usesOf()).toHaveLength(reached ? 1 : 0);

      // The app reloads with the connection back: the saved check-in goes out by itself.
      hold = false;
      const synced = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" && r.url().endsWith(`/api/v1/attendance/${attendanceId}`),
      );
      await visit(page, `/sessions/${lessonId}`);
      release();
      const answer = await synced;
      expect(answer.status()).toBe(200);
      // Delivered before, it's answered from the stored reply (the same change, not a new one).
      expect(answer.headers()["idempotent-replay"]).toBe(reached ? "true" : undefined);
      await expect(
        page.getByRole("button", {
          name: /^Kai Mendoza: Checked in\. 4 of 5 left · 5-session pack\./,
        }),
      ).toBeVisible();
      await expect(page.getByText("Waiting to sync")).toHaveCount(0);
      expect(await usesOf()).toHaveLength(1);
      expect(await remaining()).toBe(4);
    });
  }
});
