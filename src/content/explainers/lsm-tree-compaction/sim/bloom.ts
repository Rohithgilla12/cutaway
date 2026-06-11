const BITS = 64;
export const K = 3;

// FNV-1a 32-bit with a salt so each of the k hash functions is independent.
function fnv1a32(s: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const SALTS: readonly [number, number, number] = [0x00000000, 0xdeadbeef, 0x13371337];

function bitPositions(key: string): [number, number, number] {
  return [fnv1a32(key, SALTS[0]) % BITS, fnv1a32(key, SALTS[1]) % BITS, fnv1a32(key, SALTS[2]) % BITS];
}

export interface BloomFilter {
  add(key: string): void;
  mightContain(key: string): boolean;
  bits(): readonly boolean[];
  probePositions(key: string): [number, number, number];
  reset(): void;
  keyCount(): number;
}

export function createBloom(): BloomFilter {
  const arr = new Array<boolean>(BITS).fill(false);
  let added = 0;

  return {
    add(key) {
      const [a, b, c] = bitPositions(key);
      arr[a] = true;
      arr[b] = true;
      arr[c] = true;
      added += 1;
    },
    mightContain(key) {
      const [a, b, c] = bitPositions(key);
      return arr[a] && arr[b] && arr[c];
    },
    bits() {
      return arr.slice();
    },
    probePositions(key) {
      return bitPositions(key);
    },
    reset() {
      arr.fill(false);
      added = 0;
    },
    keyCount() {
      return added;
    },
  };
}

// Key-universe helpers for the viz.
//
// The "member" pool is built by hashing a seed into key strings so the set is
// deterministic for a given seed. The non-member stream is a separate sequence
// that provably does not overlap with the member pool (it uses a distinct prefix).

export const MEMBER_PREFIX = "m";
export const NONMEMBER_PREFIX = "q";
export const UNIVERSE_SIZE = 200;

function keyForIndex(prefix: string, i: number): string {
  return `${prefix}${i.toString().padStart(3, "0")}`;
}

export function memberKeys(n: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < n && i < UNIVERSE_SIZE; i++) {
    keys.push(keyForIndex(MEMBER_PREFIX, i));
  }
  return keys;
}

export function nonMemberKey(index: number): string {
  return keyForIndex(NONMEMBER_PREFIX, index % UNIVERSE_SIZE);
}

export function memberKey(index: number): string {
  return keyForIndex(MEMBER_PREFIX, index % UNIVERSE_SIZE);
}
