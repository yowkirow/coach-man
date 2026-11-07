import { describe, expect, it } from "vitest";
import { allocate } from "../../src/worker/services/money";

describe("allocate (payments settle the oldest charges first)", () => {
  it("splits one payment across charges in order", () => {
    const out = allocate(
      [
        { id: "c1", amountMinor: 1000 },
        { id: "c2", amountMinor: 2000 },
      ],
      [{ id: "p1", amountMinor: 2500 }],
    );
    expect(out).toEqual([
      { paymentId: "p1", chargeId: "c1", amountMinor: 1000 },
      { paymentId: "p1", chargeId: "c2", amountMinor: 1500 },
    ]);
  });

  it("lets several payments fill one charge", () => {
    const out = allocate(
      [{ id: "c1", amountMinor: 3000 }],
      [
        { id: "p1", amountMinor: 1000 },
        { id: "p2", amountMinor: 2000 },
      ],
    );
    expect(out).toEqual([
      { paymentId: "p1", chargeId: "c1", amountMinor: 1000 },
      { paymentId: "p2", chargeId: "c1", amountMinor: 2000 },
    ]);
  });

  it("leaves overpayments unallocated (client credit)", () => {
    const out = allocate([{ id: "c1", amountMinor: 1000 }], [{ id: "p1", amountMinor: 1500 }]);
    expect(out).toEqual([{ paymentId: "p1", chargeId: "c1", amountMinor: 1000 }]);
  });

  it("ignores zero and negative charges", () => {
    const out = allocate(
      [
        { id: "credit", amountMinor: -500 },
        { id: "zero", amountMinor: 0 },
        { id: "c1", amountMinor: 700 },
      ],
      [{ id: "p1", amountMinor: 700 }],
    );
    expect(out).toEqual([{ paymentId: "p1", chargeId: "c1", amountMinor: 700 }]);
  });

  it("never allocates more than either side", () => {
    const charges = [
      { id: "a", amountMinor: 1234 },
      { id: "b", amountMinor: 999 },
      { id: "c", amountMinor: 50 },
    ];
    const payments = [
      { id: "x", amountMinor: 1000 },
      { id: "y", amountMinor: 1000 },
    ];
    const out = allocate(charges, payments);
    const total = out.reduce((n, a) => n + a.amountMinor, 0);
    expect(total).toBe(2000);
    for (const c of charges) {
      const got = out.filter((a) => a.chargeId === c.id).reduce((n, a) => n + a.amountMinor, 0);
      expect(got).toBeLessThanOrEqual(c.amountMinor);
    }
  });
});
