export interface BackendCostParams {
  baselinePerBackendMB?: number;
  workMemMB?: number;
  activeFraction?: number;
  opsPerActiveQuery?: number;
}

export interface BackendCostResult {
  baselineMB: number;
  workMemWorstCaseMB: number;
  totalMB: number;
}

/**
 * Estimate memory cost of running `connections` Postgres backends.
 *
 * Constraints the model can't express:
 * - Baseline per-backend: ~5–10 MB per idle backend (RSS of one postgres process,
 *   shared memory excluded). Labeled "est." everywhere in the UI.
 * - work_mem is allocated per sort/hash *operation* (not per connection).
 *   Worst case: every active query runs `opsPerActiveQuery` concurrent sort/hash ops.
 * - activeFraction: fraction of connections doing work simultaneously (0–1).
 *   Under sustained high load 0.5 is a reasonable peak estimate; 0.25 is moderate.
 */
export function backendCost(
  connections: number,
  { baselinePerBackendMB = 10, workMemMB = 4, activeFraction = 0.5, opsPerActiveQuery = 2 }: BackendCostParams = {},
): BackendCostResult {
  const baselineMB = connections * baselinePerBackendMB;
  const workMemWorstCaseMB = connections * activeFraction * opsPerActiveQuery * workMemMB;
  const totalMB = baselineMB + workMemWorstCaseMB;
  return { baselineMB, workMemWorstCaseMB, totalMB };
}
