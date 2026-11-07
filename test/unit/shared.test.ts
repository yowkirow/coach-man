import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyShort, minorToInput, parseMoney } from "../../src/shared/money";
import {
  addDays,
  ageOn,
  daysBetween,
  formatDuration,
  localDate,
  localTime,
  weekdayOf,
  zonedToEpoch,
} from "../../src/shared/time";
import { occurrenceDates } from "../../src/worker/services/lessons";

describe("money parsing and formatting", () => {
  it("parses grouped and decimal input into minor units", () => {
    expect(parseMoney("1,500", "PHP")).toBe(150000);
    expect(parseMoney("1,500.50", "PHP")).toBe(150050);
    expect(parseMoney("₱ 625", "PHP")).toBe(62500);
    expect(parseMoney("12.5", "USD")).toBe(1250);
    expect(parseMoney("1.500,50", "EUR")).toBe(150050);
  });

  it("respects zero-decimal currencies", () => {
    expect(parseMoney("1,500", "JPY")).toBe(1500);
    expect(parseMoney("1.5", "JPY")).toBeNull();
  });

  it("rejects empty or invalid input", () => {
    expect(parseMoney("", "PHP")).toBeNull();
    expect(parseMoney("abc", "PHP")).toBeNull();
    expect(parseMoney("1.234", "PHP")).toBe(123400);
  });

  it("round-trips through the input format", () => {
    expect(minorToInput(150050, "PHP")).toBe("1500.50");
    expect(parseMoney(minorToInput(150050, "PHP"), "PHP")).toBe(150050);
  });

  it("formats full and short amounts", () => {
    expect(formatMoney(150000, "USD", "en-US")).toBe("$1,500.00");
    expect(formatMoneyShort(150000, "USD", "en-US")).toBe("$1,500");
    expect(formatMoneyShort(150050, "USD", "en-US")).toBe("$1,500.50");
  });
});

describe("calendar dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows weekdays and spans", () => {
    expect(weekdayOf("2026-10-14")).toBe(3); // Wednesday
    expect(daysBetween("2026-10-01", "2026-10-15")).toBe(14);
  });

  it("computes ages on a date", () => {
    expect(ageOn("2014-10-15", "2026-10-14")).toBe(11);
    expect(ageOn("2014-10-14", "2026-10-14")).toBe(12);
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
  });
});

describe("timezones", () => {
  it("maps local wall time to instants and back (Manila, no DST)", () => {
    const t = zonedToEpoch("2026-10-14", "07:00", "Asia/Manila");
    expect(new Date(t).toISOString()).toBe("2026-10-13T23:00:00.000Z");
    expect(localDate(t, "Asia/Manila")).toBe("2026-10-14");
    expect(localTime(t, "Asia/Manila")).toBe("07:00");
  });

  it("keeps wall time across a DST change (New York, fall back on 1 Nov 2026)", () => {
    const before = zonedToEpoch("2026-10-31", "07:00", "America/New_York");
    const after = zonedToEpoch("2026-11-01", "07:00", "America/New_York");
    expect(localTime(before, "America/New_York")).toBe("07:00");
    expect(localTime(after, "America/New_York")).toBe("07:00");
    expect(after - before).toBe(25 * 3_600_000);
  });
});

describe("weekly recurrence", () => {
  it("lists matching weekdays within the series and window", () => {
    // Tuesdays (2) and Thursdays (4)
    const dates = occurrenceDates(
      { weekdays: [2, 4], startsOn: "2026-10-01", endsOn: null },
      "2026-10-01",
      "2026-10-15",
    );
    expect(dates).toEqual(["2026-10-01", "2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15"]);
  });

  it("clips to the series start and end dates", () => {
    const dates = occurrenceDates(
      { weekdays: [1], startsOn: "2026-10-10", endsOn: "2026-10-26" },
      "2026-10-01",
      "2026-11-30",
    );
    expect(dates).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("returns nothing when the window ends before the series starts", () => {
    expect(
      occurrenceDates(
        { weekdays: [1, 2, 3], startsOn: "2026-12-01", endsOn: null },
        "2026-10-01",
        "2026-10-31",
      ),
    ).toEqual([]);
  });
});
