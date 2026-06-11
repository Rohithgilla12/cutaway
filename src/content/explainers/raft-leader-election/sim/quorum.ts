export function intersection(a: Set<number>, b: Set<number>): Set<number> {
  const result = new Set<number>();
  for (const x of a) {
    if (b.has(x)) result.add(x);
  }
  return result;
}

export function isMajority(s: Set<number>, n = 5): boolean {
  return s.size > n / 2;
}
