import { describe, it, expect } from "vitest";
import { createBloom, memberKeys, missKeys } from "./bloomSim";

describe("no false negatives", () => {
  it("every inserted key queries MAYBE, for a range of (m,k,n)", () => {
    for (const m of [128, 512, 2048]) {
      for (const k of [1, 3, 7]) {
        const f = createBloom(m, k);
        const keys = memberKeys(80);
        for (const key of keys) f.insert(key);
        for (const key of keys) {
          expect(f.query(key), `false negative m=${m} k=${k} key=${key}`).toBe("MAYBE");
        }
      }
    }
  });
});

describe("monotonic degradation", () => {
  it("inserting more keys never turns a MAYBE back into a NO over a fixed probe set", () => {
    const f = createBloom(256, 3);
    const probes = missKeys(150);
    const members = memberKeys(60);
    let prevMaybe = 0;
    for (let n = 0; n <= members.length; n++) {
      if (n > 0) f.insert(members[n - 1]);
      const maybe = probes.filter((q) => f.query(q) === "MAYBE").length;
      expect(maybe, `maybe count dropped at n=${n}`).toBeGreaterThanOrEqual(prevMaybe);
      prevMaybe = maybe;
    }
  });
});

describe("determinism", () => {
  it("same (m,k) + same insert sequence → identical bits and verdicts", () => {
    const a = createBloom(512, 4);
    const b = createBloom(512, 4);
    for (const key of memberKeys(40)) { a.insert(key); b.insert(key); }
    expect(JSON.stringify(a.bits())).toBe(JSON.stringify(b.bits()));
    for (const q of missKeys(50)) expect(a.query(q)).toBe(b.query(q));
  });

  it("reset returns to all-zero", () => {
    const f = createBloom(128, 3);
    for (const key of memberKeys(20)) f.insert(key);
    f.reset();
    expect(f.setBitCount()).toBe(0);
    expect(f.keyCount()).toBe(0);
  });
});

describe("FPR model", () => {
  it("measured FPR tracks theoretical within tolerance over a large probe set", () => {
    const m = 4096, k = 4;
    const f = createBloom(m, k);
    for (const key of memberKeys(400)) f.insert(key);
    const measured = f.measuredFpr(missKeys(2000));
    const theo = f.theoreticalFpr();
    expect(Math.abs(measured - theo)).toBeLessThan(0.05);
  });

  it("probeBits returns exactly k indices within [0,m)", () => {
    const f = createBloom(200, 5);
    const pos = f.probeBits("user:7");
    expect(pos.length).toBe(5);
    for (const p of pos) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(200); }
  });
});
