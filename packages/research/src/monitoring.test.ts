import { describe, expect, it } from "vitest";
import { isMonitorDue } from "./monitoring";

describe("isMonitorDue", () => {
  const now = new Date("2026-07-26T12:00:00Z");

  it("is never due when paused, regardless of last scan time", () => {
    expect(isMonitorDue({ cadence: "paused", isActive: true, lastScannedAt: null }, now)).toBe(false);
    expect(isMonitorDue({ cadence: "paused", isActive: true, lastScannedAt: new Date("2000-01-01T00:00:00Z") }, now)).toBe(false);
  });

  it("is never due when inactive, even under a live cadence", () => {
    expect(isMonitorDue({ cadence: "daily", isActive: false, lastScannedAt: null }, now)).toBe(false);
  });

  it("is due on first scan (never scanned, active, non-paused cadence)", () => {
    expect(isMonitorDue({ cadence: "daily", isActive: true, lastScannedAt: null }, now)).toBe(true);
    expect(isMonitorDue({ cadence: "weekly", isActive: true, lastScannedAt: null }, now)).toBe(true);
  });

  it("daily cadence is due once 24h have elapsed, not before", () => {
    const justUnder = new Date(now.getTime() - (24 * 60 * 60 * 1000 - 1));
    const exactly = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    expect(isMonitorDue({ cadence: "daily", isActive: true, lastScannedAt: justUnder }, now)).toBe(false);
    expect(isMonitorDue({ cadence: "daily", isActive: true, lastScannedAt: exactly }, now)).toBe(true);
  });

  it("weekly cadence is due once 7 days have elapsed, not before", () => {
    const justUnder = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000 - 1));
    const exactly = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(isMonitorDue({ cadence: "weekly", isActive: true, lastScannedAt: justUnder }, now)).toBe(false);
    expect(isMonitorDue({ cadence: "weekly", isActive: true, lastScannedAt: exactly }, now)).toBe(true);
  });

  it("a daily monitor scanned an hour ago is not due", () => {
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    expect(isMonitorDue({ cadence: "daily", isActive: true, lastScannedAt: anHourAgo }, now)).toBe(false);
  });
});
