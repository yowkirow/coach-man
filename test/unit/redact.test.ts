import { describe, expect, it } from "vitest";
import { isMoneyField, MONEY_LISTS, redactMoney } from "../../src/worker/lib/redact";

describe("money redaction", () => {
  it("removes *Minor numbers at every depth, in objects and arrays", () => {
    const input = {
      client: { id: "c1", firstName: "Ana", balanceMinor: 1200, creditsRemaining: 3 },
      packages: [
        { id: "p1", priceMinor: 500, remaining: 2 },
        { id: "p2", priceMinor: 0, remaining: 0 },
      ],
      lessons: [
        {
          id: "l1",
          roster: [
            { clientId: "c1", chargeMinor: 800, balanceMinor: -50, chargeId: "ch1" },
            { clientId: "c2", chargeMinor: null, balanceMinor: 0, chargeId: null },
          ],
        },
      ],
      nested: [[{ amountMinor: 1 }, { amountMinor: 2, label: "x" }]],
    };
    expect(redactMoney(input)).toEqual({
      client: { id: "c1", firstName: "Ana", creditsRemaining: 3 },
      packages: [
        { id: "p1", remaining: 2 },
        { id: "p2", remaining: 0 },
      ],
      lessons: [
        {
          id: "l1",
          roster: [
            { clientId: "c1", chargeId: "ch1" },
            { clientId: "c2", chargeId: null },
          ],
        },
      ],
      nested: [[{}, { label: "x" }]],
    });
  });

  it("empties lists of who owes, keeping their shape", () => {
    const today = {
      date: "2026-11-03",
      alerts: {
        balancesDue: [{ clientId: "c1", name: "Ana Reyes", balanceMinor: 1500 }],
        lowCredits: [{ clientId: "c2", name: "Ben", remaining: 1 }],
      },
    };
    expect(redactMoney(today)).toEqual({
      date: "2026-11-03",
      alerts: { balancesDue: [], lowCredits: [{ clientId: "c2", name: "Ben", remaining: 1 }] },
    });
    expect(MONEY_LISTS.has("balancesDue")).toBe(true);
  });

  it("keeps fields that end in Minor but aren't money", () => {
    const input = { isMinor: true, labelMinor: "C minor", priceMinor: 100, nullMinor: null };
    expect(redactMoney(input)).toEqual({ isMinor: true, labelMinor: "C minor" });
    expect(isMoneyField("isMinor", false)).toBe(false);
    expect(isMoneyField("earlyBirdPriceMinor", null)).toBe(true);
    expect(isMoneyField("price", 100)).toBe(false);
  });

  it("passes scalars and empty values through and never mutates the input", () => {
    expect(redactMoney(null)).toBeNull();
    expect(redactMoney(42)).toBe(42);
    expect(redactMoney("text")).toBe("text");
    expect(redactMoney([])).toEqual([]);
    expect(redactMoney({})).toEqual({});
    const input = { event: { priceMinor: 9000, name: "Camp" }, list: [{ paidMinor: 1 }] };
    const copy = structuredClone(input);
    redactMoney(input);
    expect(input).toEqual(copy);
  });

  it("leaves no money key anywhere in a large mixed payload", () => {
    const payload = {
      event: { priceMinor: 1, earlyBirdPriceMinor: null, paidMinor: 2, dueMinor: 3 },
      registrations: Array.from({ length: 20 }, (_, i) => ({
        id: `r${i}`,
        priceMinor: i,
        paidMinor: i,
      })),
      summary: { chargedMinor: 1, receivedMinor: 2, outstandingMinor: 3, months: [] },
    };
    const json = JSON.stringify(redactMoney(payload));
    expect(json).not.toMatch(/Minor"/);
    expect(json).toContain('"r19"');
  });
});
