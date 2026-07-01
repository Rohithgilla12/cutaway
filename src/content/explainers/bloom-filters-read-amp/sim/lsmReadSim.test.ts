import { describe, it, expect } from "vitest";
import { createLsmRead } from "./lsmReadSim";

describe("lsm read path", () => {
  it("a key present in a run is always found (filter never skips a containing run)", () => {
    const lsm = createLsmRead({ runs: 4, keysPerRun: 50, bitsPerKey: 10 });
    for (let r = 0; r < lsm.runCount(); r++) {
      const key = lsm.runKey(r, 0);
      expect(lsm.lookup(key).found, `lost key in run ${r}`).toBe(true);
    }
  });

  it("runsProbed never exceeds runCount", () => {
    const lsm = createLsmRead({ runs: 6, keysPerRun: 40, bitsPerKey: 8 });
    for (let i = 0; i < 200; i++) {
      const res = lsm.lookup(`miss:${i}`);
      expect(res.runsProbed).toBeLessThanOrEqual(lsm.runCount());
    }
  });

  it("starving bits/key raises average probes on a miss workload (monotone)", () => {
    const lsm = createLsmRead({ runs: 5, keysPerRun: 60, bitsPerKey: 16 });
    const avgProbes = () => {
      let total = 0;
      for (let i = 0; i < 300; i++) total += lsm.lookup(`miss:${i}`).runsProbed;
      return total / 300;
    };
    lsm.setBitsPerKey(16);
    const hi = avgProbes();
    lsm.setBitsPerKey(2);
    const lo = avgProbes();
    expect(lo).toBeGreaterThanOrEqual(hi);
  });
});
