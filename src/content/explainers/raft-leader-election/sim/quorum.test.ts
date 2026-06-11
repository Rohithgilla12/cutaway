import { describe, it, expect } from "vitest";
import { intersection, isMajority } from "./quorum";

const NODES = [0, 1, 2, 3, 4];

function subsets(arr: number[], size: number): Set<number>[] {
  if (size === 0) return [new Set()];
  if (size > arr.length) return [];
  const [head, ...tail] = arr;
  const withHead = subsets(tail, size - 1).map((s) => new Set([head, ...s]));
  const withoutHead = subsets(tail, size);
  return [...withHead, ...withoutHead];
}

describe("intersection", () => {
  it("returns the common elements of two sets", () => {
    expect(intersection(new Set([0, 1, 2]), new Set([2, 3, 4]))).toEqual(new Set([2]));
    expect(intersection(new Set([0, 1, 2]), new Set([0, 1, 2]))).toEqual(new Set([0, 1, 2]));
    expect(intersection(new Set([0, 1]), new Set([3, 4]))).toEqual(new Set());
  });

  it("is commutative", () => {
    const a = new Set([0, 2, 4]);
    const b = new Set([1, 2, 3]);
    expect(intersection(a, b)).toEqual(intersection(b, a));
  });
});

describe("isMajority", () => {
  it("returns true for sets larger than half of n (default n=5)", () => {
    expect(isMajority(new Set([0, 1, 2]))).toBe(true);
    expect(isMajority(new Set([0, 1, 2, 3]))).toBe(true);
    expect(isMajority(new Set([0, 1, 2, 3, 4]))).toBe(true);
  });

  it("returns false for sets of size 2 or fewer (n=5)", () => {
    expect(isMajority(new Set([0, 1]))).toBe(false);
    expect(isMajority(new Set([0]))).toBe(false);
    expect(isMajority(new Set())).toBe(false);
  });

  it("respects the n parameter", () => {
    expect(isMajority(new Set([0]), 3)).toBe(false);
    expect(isMajority(new Set([0, 1]), 3)).toBe(true);
    expect(isMajority(new Set([0, 1, 2]), 3)).toBe(true);
    expect(isMajority(new Set([0, 1, 2]), 7)).toBe(false);
    expect(isMajority(new Set([0, 1, 2, 3]), 7)).toBe(true);
    expect(isMajority(new Set([0, 1, 2]), 6)).toBe(false);
    expect(isMajority(new Set([0, 1, 2, 3]), 6)).toBe(true);
    expect(isMajority(new Set([0, 1, 2, 3, 4]), 6)).toBe(true);
    expect(isMajority(new Set([0, 1, 2, 3]), 5)).toBe(true);
  });

  it("exhaustive: every 3-element subset of {0..4} is a majority", () => {
    const majorities = subsets(NODES, 3);
    expect(majorities).toHaveLength(10);
    for (const s of majorities) {
      expect(isMajority(s), `${[...s].join(",")} should be a majority`).toBe(true);
    }
  });

  it("exhaustive: every 2-element subset of {0..4} is NOT a majority", () => {
    const pairs = subsets(NODES, 2);
    expect(pairs).toHaveLength(10);
    for (const s of pairs) {
      expect(isMajority(s), `${[...s].join(",")} should not be a majority`).toBe(false);
    }
  });
});

describe("quorum intersection (exhaustive)", () => {
  it("every pair of 3-element subsets of {0..4} has non-empty intersection", () => {
    const majorities = subsets(NODES, 3);
    expect(majorities).toHaveLength(10);
    for (const a of majorities) {
      for (const b of majorities) {
        const overlap = intersection(a, b);
        expect(overlap.size, `[${[...a].join(",")}] ∩ [${[...b].join(",")}] = {} (expected non-empty)`).toBeGreaterThan(
          0,
        );
      }
    }
  });
});
