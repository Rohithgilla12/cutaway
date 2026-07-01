function fnv1a32(s: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const SALT_A = 0x00000000;
const SALT_B = 0x9e3779b1;

export interface BloomFilter {
  insert(key: string): void;
  query(key: string): "NO" | "MAYBE";
  probeBits(key: string): number[];
  bits(): readonly boolean[];
  setBitCount(): number;
  keyCount(): number;
  reset(): void;
  config(): { m: number; k: number };
  measuredFpr(probeSet: readonly string[]): number;
  theoreticalFpr(): number;
  optimalK(): number;
}

export function createBloom(m: number, k: number): BloomFilter {
  const arr = new Array<boolean>(m).fill(false);
  let added = 0;

  function positions(key: string): number[] {
    const h1 = fnv1a32(key, SALT_A);
    const h2 = fnv1a32(key, SALT_B) | 1;
    const out: number[] = [];
    for (let i = 0; i < k; i++) out.push(((h1 + Math.imul(i, h2)) >>> 0) % m);
    return out;
  }

  return {
    insert(key) {
      for (const p of positions(key)) arr[p] = true;
      added += 1;
    },
    query(key) {
      return positions(key).every((p) => arr[p]) ? "MAYBE" : "NO";
    },
    probeBits(key) {
      return positions(key);
    },
    bits() {
      return arr.slice();
    },
    setBitCount() {
      let c = 0;
      for (const b of arr) if (b) c += 1;
      return c;
    },
    keyCount() {
      return added;
    },
    reset() {
      arr.fill(false);
      added = 0;
    },
    config() {
      return { m, k };
    },
    measuredFpr(probeSet) {
      if (probeSet.length === 0) return 0;
      let fp = 0;
      for (const q of probeSet) if (this.query(q) === "MAYBE") fp += 1;
      return fp / probeSet.length;
    },
    theoreticalFpr() {
      if (added === 0) return 0;
      return Math.pow(1 - Math.exp((-k * added) / m), k);
    },
    optimalK() {
      if (added === 0) return k;
      return Math.max(1, Math.round((m / added) * Math.LN2));
    },
  };
}

export const memberKey = (i: number): string => `user:${i}`;
export const missKey = (i: number): string => `miss:${i}`;
export const memberKeys = (n: number): string[] => Array.from({ length: n }, (_, i) => memberKey(i));
export const missKeys = (n: number): string[] => Array.from({ length: n }, (_, i) => missKey(i));
