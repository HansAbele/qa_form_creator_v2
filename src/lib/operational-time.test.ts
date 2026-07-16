import { afterEach, describe, expect, it } from "vitest";
import {
  addDateOnlyDays,
  assertValidOperationalTimeZone,
  getOperationalDateBounds,
  getOperationalDayStart,
  getOperationalRangeDays,
  getOperationalTimeZone,
  toOperationalDateKey,
} from "./operational-time";

const originalTimeZone = process.env.OPERATIONAL_TIME_ZONE;

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.OPERATIONAL_TIME_ZONE;
  else process.env.OPERATIONAL_TIME_ZONE = originalTimeZone;
});

describe("operational time", () => {
  it("uses UTC by default and validates configured IANA zones", () => {
    delete process.env.OPERATIONAL_TIME_ZONE;
    expect(getOperationalTimeZone()).toBe("UTC");
    expect(assertValidOperationalTimeZone("America/Havana")).toBe("America/Havana");
    expect(() => assertValidOperationalTimeZone("Not/AZone")).toThrow("zona IANA valida");
  });

  it("builds half-open UTC bounds for an operational local day", () => {
    const bounds = getOperationalDateBounds("2026-05-10", "2026-05-10", "America/Havana");

    expect(bounds.gte?.toISOString()).toBe("2026-05-10T04:00:00.000Z");
    expect(bounds.lt?.toISOString()).toBe("2026-05-11T04:00:00.000Z");
  });

  it("honors daylight-saving day lengths without losing the final milliseconds", () => {
    const spring = getOperationalDateBounds("2026-03-08", "2026-03-08", "America/Havana");
    const autumn = getOperationalDateBounds("2026-11-01", "2026-11-01", "America/Havana");

    expect(Number(spring.lt) - Number(spring.gte)).toBe(23 * 60 * 60 * 1000);
    expect(Number(autumn.lt) - Number(autumn.gte)).toBe(25 * 60 * 60 * 1000);
  });

  it("groups instants by the configured operational date", () => {
    expect(toOperationalDateKey(new Date("2026-05-10T02:00:00Z"), "America/Havana")).toBe(
      "2026-05-09",
    );
    expect(toOperationalDateKey(new Date("2026-05-10T05:00:00Z"), "America/Havana")).toBe(
      "2026-05-10",
    );
  });

  it("uses the real data span for Todo el periodo", () => {
    expect(
      getOperationalRangeDays({
        minDate: new Date("2026-01-10T12:00:00Z"),
        maxDate: new Date("2026-02-08T12:00:00Z"),
        timeZone: "UTC",
      }),
    ).toBe(30);
  });

  it("uses requested calendar dates when a range is explicit", () => {
    expect(
      getOperationalRangeDays({
        dateFrom: "2026-05-01",
        dateTo: "2026-05-10",
        minDate: new Date("2026-05-04T12:00:00Z"),
        maxDate: new Date("2026-05-06T12:00:00Z"),
        timeZone: "UTC",
      }),
    ).toBe(10);
  });

  it("rejects invalid and reversed date ranges", () => {
    expect(() => getOperationalDateBounds("2026-02-30", undefined, "UTC")).toThrow(
      "fecha valida",
    );
    expect(() => getOperationalDateBounds("2026-05-10", "2026-05-01", "UTC")).toThrow(
      "posterior",
    );
  });

  it("adds calendar days and finds exact local day starts", () => {
    expect(addDateOnlyDays("2026-12-31", 1)).toBe("2027-01-01");
    const start = getOperationalDayStart("2026-05-10", "America/Havana");
    expect(toOperationalDateKey(start, "America/Havana")).toBe("2026-05-10");
    expect(toOperationalDateKey(new Date(start.getTime() - 1), "America/Havana")).toBe(
      "2026-05-09",
    );
  });
});
