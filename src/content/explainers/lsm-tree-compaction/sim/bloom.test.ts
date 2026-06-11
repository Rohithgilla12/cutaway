import { describe, it, expect } from "vitest";
import { createBloom, memberKeys, nonMemberKey, memberKey, UNIVERSE_SIZE } from "./bloom";

// ---------------------------------------------------------------------------
// 1. Zero false negatives — exhaustive 200-key sweep.
// ---------------------------------------------------------------------------
describe("zero false negatives", () => {
  it("every added key from a 200-key sweep always mightContain", () => {
    const bloom = createBloom();
    const keys = memberKeys(200);
    for (const k of keys) bloom.add(k);
    for (const k of keys) {
      expect(bloom.mightContain(k), `false negative for key ${k}`).toBe(true);
    }
  });

  it("adding then immediately querying never misses — incremental", () => {
    const bloom = createBloom();
    const keys = memberKeys(200);
    for (const k of keys) {
      bloom.add(k);
      expect(bloom.mightContain(k), `missed immediately after add: ${k}`).toBe(true);
    }
  });

  it("mightContain returns true for every added key regardless of how many other keys are in the filter", () => {
    for (let n = 1; n <= 200; n += 7) {
      const bloom = createBloom();
      const keys = memberKeys(n);
      for (const k of keys) bloom.add(k);
      for (const k of keys) {
        expect(bloom.mightContain(k), `false negative at n=${n} for ${k}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. False positives: at least one exists AND rate stays under ~15% at 12 keys.
// ---------------------------------------------------------------------------
describe("false positives", () => {
  it("at least one false positive occurs in a sweep of non-members after adding 12 keys", () => {
    const bloom = createBloom();
    const added = memberKeys(12);
    for (const k of added) bloom.add(k);

    const addedSet = new Set(added);
    let fpCount = 0;
    for (let i = 0; i < UNIVERSE_SIZE; i++) {
      const q = nonMemberKey(i);
      if (addedSet.has(q)) continue;
      if (bloom.mightContain(q)) fpCount += 1;
    }
    expect(fpCount).toBeGreaterThan(0);
  });

  it("false-positive rate stays under 15% at 12 added keys", () => {
    const bloom = createBloom();
    const added = memberKeys(12);
    for (const k of added) bloom.add(k);

    const addedSet = new Set(added);
    let queries = 0;
    let fps = 0;
    for (let i = 0; i < UNIVERSE_SIZE; i++) {
      const q = nonMemberKey(i);
      if (addedSet.has(q)) continue;
      queries += 1;
      if (bloom.mightContain(q)) fps += 1;
    }
    const fpRate = fps / queries;
    expect(fpRate).toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------------------
// 3. Determinism — same key always hashes to the same bit positions.
// ---------------------------------------------------------------------------
describe("determinism", () => {
  it("same key added to two independent bloom instances hits the same bits", () => {
    const a = createBloom();
    const b = createBloom();
    a.add("user:42");
    b.add("user:42");
    const bitsA = a.bits();
    const bitsB = b.bits();
    expect(JSON.stringify(bitsA)).toBe(JSON.stringify(bitsB));
  });

  it("probePositions are stable across calls and instances", () => {
    const a = createBloom();
    const b = createBloom();
    const posA = a.probePositions("determinism-test");
    const posB = b.probePositions("determinism-test");
    expect(posA).toEqual(posB);
    expect(a.probePositions("determinism-test")).toEqual(posA);
  });

  it("reset returns to all-zero bits and zero keyCount", () => {
    const bloom = createBloom();
    for (const k of memberKeys(10)) bloom.add(k);
    expect(bloom.keyCount()).toBe(10);
    bloom.reset();
    expect(bloom.keyCount()).toBe(0);
    expect(bloom.bits().every((b) => !b)).toBe(true);
  });

  it("after reset adding the same key produces the same bits as a fresh filter", () => {
    const fresh = createBloom();
    fresh.add("reset-repro");
    const bitsAfterFresh = JSON.stringify(fresh.bits());

    fresh.add("noise-key");
    fresh.reset();
    fresh.add("reset-repro");
    expect(JSON.stringify(fresh.bits())).toBe(bitsAfterFresh);
  });
});

// ---------------------------------------------------------------------------
// 4. bits() length is 64.
// ---------------------------------------------------------------------------
describe("bits() length", () => {
  it("bits() always returns exactly 64 booleans", () => {
    const bloom = createBloom();
    expect(bloom.bits().length).toBe(64);
    for (const k of memberKeys(50)) bloom.add(k);
    expect(bloom.bits().length).toBe(64);
  });

  it("bits() returns a snapshot — mutating it does not affect the filter", () => {
    const bloom = createBloom();
    bloom.add("snapshot-test");
    const bits = bloom.bits() as boolean[];
    const before = JSON.stringify(bits);
    bits[0] = !bits[0];
    expect(JSON.stringify(bloom.bits())).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 5. Key-universe helpers.
// ---------------------------------------------------------------------------
describe("key-universe helpers", () => {
  it("memberKey and nonMemberKey never produce the same string for any index", () => {
    for (let i = 0; i < UNIVERSE_SIZE; i++) {
      expect(memberKey(i)).not.toBe(nonMemberKey(i));
    }
  });

  it("memberKeys(n) returns exactly n distinct keys", () => {
    for (const n of [0, 1, 10, 50, 200]) {
      const keys = memberKeys(n);
      expect(keys.length).toBe(n);
      expect(new Set(keys).size).toBe(n);
    }
  });
});
