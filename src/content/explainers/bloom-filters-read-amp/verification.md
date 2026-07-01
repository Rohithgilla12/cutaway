# Verification checklist — bloom-filters-read-amp (explainer #12)

Step 5 verification pass. Every checkable technical claim from the prose and sim, verified
against PRIMARY sources: the RocksDB wiki, the RocksDB official blog, the Kirsch–Mitzenmacher
paper (Harvard postprint), and the Bloom 1970 CACM paper. Blog/SO answers are not verification
sources; the rocksdb.org blog post is treated as primary because it is published by the RocksDB
team with benchmark data and authorship attribution.

Legend: ✅ verified (source + confirming text) · ⚠️ simplification (labeled in prose) · ❌ wrong/unverifiable (fixed or cut).

Primary sources confirmed:

- Bloom 1970, Communications of the ACM 13(7), 422–426: https://dl.acm.org/doi/10.1145/362686.362692
- Kirsch & Mitzenmacher, ESA 2006 / Random Structures & Algorithms 33(2), 187–218: https://www.eecs.harvard.edu/~michaelm/postscripts/esa2006a.pdf
- RocksDB wiki, "RocksDB Bloom Filter": https://github.com/facebook/rocksdb/wiki/RocksDB-Bloom-Filter
- RocksDB blog, "Ribbon Filter" (2021-12-29): https://rocksdb.org/blog/2021/12/29/ribbon-filter.html

Cross-check method: all quantitative formula claims were evaluated numerically via `node -e`
against the sim's `theoreticalFpr()` and `optimalK()` implementations; sim tests run with
`pnpm vitest run src/content/explainers/bloom-filters-read-amp` (9 PASS, 0 FAIL). `pnpm check`
passes (0 errors, 0 warnings).

---

## A. FPR formula and optimal k

1. **`FPR = (1 − e^(−kn/m))^k`** ✅ Standard result derived from the Bloom 1970 construction;
   reproduced in every authoritative treatment (JHU lecture notes, ECE UTH notes, the K&M
   paper itself). Implemented in `bloomSim.ts → theoreticalFpr()` as
   `Math.pow(1 - Math.exp((-k * added) / m), k)` — exact match.

2. **`Optimal k = (m/n)·ln 2`** ✅ Standard result from minimising FPR over k; at this k the
   filter is exactly 50% full. Implemented in `bloomSim.ts → optimalK()` as
   `Math.max(1, Math.round((m / added) * Math.LN2))` — exact match. Verified numerically:
   at m/n = 10, optimal k = 6.93 → rounds to 7; fill at continuous optimal k = 0.500.

## B. "10 bits/key ≈ 1% FPR" (RocksDB default)

3. **RocksDB defaults to ~10 bits/key** ✅ RocksDB wiki: `NewBloomFilterPolicy(10, false)` is
   the example default; the wiki states "false positive rate near 1%."

4. **At 10 bits/key the FPR is ~1%** ✅ Numerical verification: k = 7 (optimal rounded),
   m/n = 10 → FPR = (1 − e^(−0.7))^7 ≈ 0.0082 ≈ 0.82%. Prose says "~1%"; the RocksDB wiki
   itself says "near 1%". The approximation is accurate and consistent with the authoritative
   source.

## C. Kirsch–Mitzenmacher double-hashing

5. **"two FNV-1a base hashes … Kirsch–Mitzenmacher trick: one extra multiply-add per index
   instead of a fresh hash"** ✅ K&M paper (Harvard postprint, confirmed fetchable):
   scheme is g_i(x) = h1(x) + i·h2(x) mod m — one multiply (by i) and one add per index.
   `bloomSim.ts → positions()`: `(h1 + Math.imul(i, h2)) >>> 0) % m` — exact match.
   The "one extra multiply-add" description is accurate: one `Math.imul` + one addition
   replaces a full hash call.

6. **"without measurable loss in false-positive rate"** ✅ K&M paper title and abstract:
   "Less Hashing, Same Performance: Building a Better Bloom Filter" — the whole claim of the
   paper is that double hashing achieves the same asymptotic FPR.

## D. Ribbon filter

7. **"RocksDB 6.15+"** ✅ RocksDB blog (2021): "introduced in version 6.15 last year."
   Confirmed: 6.15 is the correct version.

8. **"~30% less memory at equal FPR"** ✅ RocksDB wiki and blog both state: "saving about 30%
   of Bloom filter space." Wiki example: `NewRibbonFilterPolicy(9.9)` hits ~1% FPR at ~7
   bits/key vs Bloom's ~10 bits/key (30% reduction).

9. **"more CPU to build and query"** ✅ RocksDB blog benchmark data: build is ~4.4× slower
   (140 ns/key vs 32 ns/key for Bloom); query is ~20% slower (600 ns/key vs 500 ns/key for
   Bloom). Both build AND query are slower, so "more CPU to build and query" is accurate.
   Note: the blog adds that most extra CPU is in background construction, making it a good
   trade on memory-bound nodes — the prose captures this trade-off correctly.

## E. No false negatives

10. **"There are no false negatives, only false positives"** ✅ Standard result from the Bloom
    1970 construction: a NO answer requires at least one probed bit to be zero; zero bits can
    only be zero if no key ever set them; therefore a NO is a provable absence. Confirmed by
    the sim's `query()`: returns "NO" only when any probed bit is false, "MAYBE" otherwise.

## F. Delete causes false negative

11. **"Deleting a key means clearing its k bits … Clear it and a later query returns NO for a
    key that's actually there. That's a false negative."** ✅ This is the canonical argument
    for why plain bloom filters are insert-only. The prose is correctly stated: shared bits
    mean clearing one key's bits can zero out a bit that proves another key's membership.

## G. Filters and range scans

12. **"Plain bloom filters can't help a general range scan at all: `WHERE k BETWEEN a AND z`
    isn't a membership test, so there's nothing for the filter to rule out."** ✅ Correct.
    A bloom filter answers point-membership queries (is this exact element present?). An
    arbitrary range is not a membership query; the filter has no mechanism to bound which
    keys fall in [a, z]. RocksDB wiki confirms: whole-key filters "apply only to point
    lookups."

## H. Prefix filter characterisation

13. **"A prefix filter hashes a configured key prefix instead of the whole key, so it can
    answer 'might any key with this prefix be in this file?'"** ✅ RocksDB wiki: "When a prefix
    extractor is configured, prefix hashes are also included. Prefix-only filtering reduces
    storage requirements … prefix filters support both lookups and range seeks." The prose
    description is accurate.

## I. Saturation and fill

14. **"A filter that's 50% full gives a much lower MAYBE rate than one that's 90% full"**
    ✅ Numerical: at k = 7, FPR at 50% fill = (0.5)^7 ≈ 0.78%; at 90% fill = (0.9)^7 ≈ 47.8%.
    "Much lower" is accurate — a ~61× difference. Note: this comparison holds for the same k
    with different fill fractions; the prose is comparing runs with different bits/key (same
    n, different m), which naturally changes k too (via the optimal-k relationship). The
    qualitative direction (more fill → higher FPR) is unambiguous and correctly stated.

## J. Past optimal k, FPR worsens

15. **"Past a point, adding k makes the false-positive rate worse, not better. There's a sweet
    spot: optimal k = (m/n)·ln 2, which is where the filter ends up about half full."**
    ✅ Standard result. At k > (m/n)·ln 2, each additional hash function sets more bits per
    insert, increasing fill faster than it tightens the NO condition; FPR rises. At optimal k
    the fill is exactly 0.5 (verified numerically above).

## K. lsmReadSim derives k from bits/key

16. **"RocksDB derives k from bits/key"** ✅ `lsmReadSim.ts` line 46:
    `Math.max(1, Math.round(bpk * Math.LN2))` — this is `round((m/n)·ln 2)`, which is
    exactly the optimal-k formula. The sim correctly models the RocksDB approach of choosing k
    to minimise FPR for the allocated bits per key.

---

## Resolution log

No ❌ items — all claims verified as written. The only prose change in this pass was replacing
the `_Exact citation URLs are confirmed in the verification pass._` placeholder with four real
URLs and a fourth source entry (RocksDB blog) in the Sources section of `index.mdx`.

Claims verified with no URL-level primary source (acceptable given the nature of the claim):

- E (no false negatives) and F (delete = false negative): these follow directly from the Bloom
  1970 construction and are verified by sim behaviour, not a separate quotable source.
- G (range scans): follows from the definition of bloom filter membership queries; supported by
  the RocksDB wiki's characterisation of whole-key filters as point-lookup-only.
- J (past optimal k FPR worsens): verified numerically and is a consequence of the formula in A.
- I (fill comparison): verified numerically.

No claims required cutting or rewriting for factual error.
