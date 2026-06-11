import { describe, it, expect } from "vitest";
import { backendCost } from "./backendCost";

const GB_IN_MB = 1024;

describe("backendCost", () => {
  it("returns zero for zero connections", () => {
    const result = backendCost(0);
    expect(result.baselineMB).toBe(0);
    expect(result.workMemWorstCaseMB).toBe(0);
    expect(result.totalMB).toBe(0);
  });

  it("is monotonic in connections (default params)", () => {
    const steps = [10, 50, 100, 500, 1000, 2000, 5000];
    let prev = backendCost(0).totalMB;
    for (const n of steps) {
      const cur = backendCost(n).totalMB;
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it("is monotonic in connections (custom params)", () => {
    const params = { baselinePerBackendMB: 5, workMemMB: 16, activeFraction: 0.25, opsPerActiveQuery: 2 };
    let prev = backendCost(0, params).totalMB;
    for (const n of [1, 10, 100, 1000, 5000]) {
      const cur = backendCost(n, params).totalMB;
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it("5,000 connections with defaults exceeds 64 GB total", () => {
    const result = backendCost(5000);
    // Displayed example numbers: baselineMB=50000, workMemWorstCaseMB=20000, totalMB=70000
    expect(result.baselineMB).toBe(50_000);
    expect(result.workMemWorstCaseMB).toBe(20_000);
    expect(result.totalMB).toBe(70_000);
    expect(result.totalMB).toBeGreaterThan(64 * GB_IN_MB);
  });

  it("totalMB equals baselineMB + workMemWorstCaseMB", () => {
    for (const n of [1, 100, 1000, 5000]) {
      const r = backendCost(n);
      expect(r.totalMB).toBe(r.baselineMB + r.workMemWorstCaseMB);
    }
  });

  it("respects custom baselinePerBackendMB", () => {
    const r = backendCost(100, { baselinePerBackendMB: 5 });
    expect(r.baselineMB).toBe(500);
  });

  it("respects custom workMemMB", () => {
    const r = backendCost(100, { workMemMB: 16, activeFraction: 1, opsPerActiveQuery: 1 });
    expect(r.workMemWorstCaseMB).toBe(1600);
  });

  it("baseline and work_mem components are both non-negative for any positive connections", () => {
    const r = backendCost(1000);
    expect(r.baselineMB).toBeGreaterThan(0);
    expect(r.workMemWorstCaseMB).toBeGreaterThan(0);
  });
});
