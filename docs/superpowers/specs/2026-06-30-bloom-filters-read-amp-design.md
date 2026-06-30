# Explainer #12 — Bloom filters & the read-amp gap

**Slug:** `bloom-filters-read-amp`
**Roadmap #:** 12 (beyond the original PRD roadmap, which ended at #7)
**One question:** *How does a bloom filter cut LSM read amplification, and what does the accuracy cost you?*

This explainer closes a thread left open by two earlier pieces: the `lsm-tree-compaction` (#5) and
`compaction-strategies` (#7) parking lots both name bloom filters as the deliberate omission that lets
read amplification decouple from sorted-run count. #12 pays that down.

## Core interaction (FIG. 01) — the filter up close

The reader manipulates a single bloom filter and watches its behaviour emerge from fill ratio.

**What the reader controls:**
- **Insert key** — add a key; its `k` hash functions light up `k` bits in the array.
- **m (bits/key)** — slider sizing the bit array relative to inserted keys `n`. Fewer bits → faster saturation.
- **k (hash count)** — slider, with a live hint of the optimal `k = (m/n)·ln2`.
- **Query key** — probe a present or never-inserted key; show the per-bit verdict and the NO / MAYBE result.

**Live readout (folds in the former FIG. 03):** current fill ratio, measured FPR over a fixed probe set,
and the theoretical FPR `(1 − e^(−kn/m))^k`, with RocksDB's 10-bits/key ≈ 1 % marked on the scale.

**What the reader can BREAK:**
- **(a) Starve it.** Drag bits/key down or insert past capacity → fill ratio → 1 → every query returns
  MAYBE → the filter is useless (FPR → 100 %).
- **(b) Over-hash.** Crank `k` too high → each insert sets more bits → the array saturates sooner → FPR gets
  *worse*, not better. Teaches that `k` is a balance, not "more is better."

**What breaking it teaches:** a bloom filter has no false negatives but a tunable false-positive rate that is
purely a function of fill ratio (`m`, `k`, `n`). It degrades gracefully into "always maybe," and bits/key is
the one knob that buys accuracy — paid for in memory.

A reader who skips all prose and only plays with FIG. 01 still leaves knowing: filters say *no* for certain
and *maybe* probabilistically, and that you trade memory for fewer false maybes.

## Supporting visualization (FIG. 02) — the read-amp payoff

A point lookup descending an LSM with `N` sorted runs, each fronted by a per-run bloom filter. Negative
filters skip runs entirely; false-positive filters cost a wasted probe (disk read + block decode). The
bits/key knob carries over from FIG. 01: starve the filters and read amplification climbs back toward `N`.

This is the bridge back to #5/#7 — it shows *why the structure earns its memory* in a real read path, rather
than the filter in isolation.

## Sim core (pure, deterministic TS; tests precede UI)

Two sim units, both in `sim/`:
- `bloomSim.ts` — bit array, `insert(key)`, `query(key) → NO | MAYBE`, derived stats (fill, measured FPR,
  theoretical FPR). Hashes via **Kirsch–Mitzenmacher double hashing** (`h_i = h1 + i·h2 mod m`), the way real
  filters derive `k` indices from two base hashes — not `k` independent hash functions.
- `lsmReadSim.ts` (FIG. 02) — `N` runs each with a `bloomSim` instance + a key set; `lookup(key)` returns the
  per-run verdict sequence and the probe count (= read amplification for that lookup).

**Invariants under unit test (must pass before any UI):**
1. **No false negatives** — every inserted key always queries MAYBE (all its bits are set).
2. **Monotonic degradation** — inserting more keys only ever turns a NO into a MAYBE, never the reverse, so
   measured FPR over a fixed probe set is non-decreasing in `n`.
3. **Determinism** — same seed + same key sequence → identical bit array and identical query verdicts.
4. **Theoretical-vs-measured FPR** — measured FPR over a large random probe set tracks `(1 − e^(−kn/m))^k`
   within a tolerance band (sanity check the model, not exact equality).

## Prose arc

1. **Hook** — an LSM point lookup for a key that isn't there has to touch every sorted run before it can say
   "not found." Concrete number: read amp = `N` on a miss.
2. **Naive fix** — keep every key in memory to answer "is it here?" Too big; that's the index you were trying
   not to hold.
3. **The filter** — a bit array + `k` hashes that answers "definitely not" or "maybe," in a few bytes per key.
4. **Core interaction (FIG. 01).**
5. **Failure modes** — saturation; over-hashing; *and* why you can't delete from a plain bloom filter without
   risking a false negative (clearing a bit shared with another key).
6. **Real-world grounding** — RocksDB: 10 bits/key default (~1 % FPR), full-key vs prefix filters, and ribbon
   filters (RocksDB 6.15+) as the modern memory/CPU successor.
7. **FIG. 02 — read-amp payoff** sits in 5/6, tying accuracy back to read amplification.
8. **Wrapping up** — terse decision guidance (bits/key for point-lookup-heavy workloads; filters don't help
   range scans; budget memory against the FPR you can tolerate).
9. **Sources.**

## Primary sources (verification gates publishing)

- Bloom, B. H. (1970), "Space/Time Trade-offs in Hash Coding with Allowable Errors" — the original FPR result.
- Kirsch & Mitzenmacher, "Less Hashing, Same Performance" — the double-hashing technique.
- RocksDB wiki: *RocksDB Bloom Filter* (bits/key default, full-key vs prefix, ribbon filters).
- FPR formula `(1 − e^(−kn/m))^k` and optimal `k = (m/n)·ln2` — verified against the above, not blog restatements.

## Scope guard (parking-lot, NOT in #12)

Counting bloom filters, cuckoo filters, ribbon-filter internals, blocked bloom filters, prefix-filter range
tricks. Each named in one sentence at most; details go to `further.md`.

## Decisions settled in brainstorm

- Core interaction is the **single filter** (structure-centered), not the LSM read path. The read path is the
  one supporting viz.
- Keep **both** `m` and `k` sliders — the over-hashing failure mode is worth the extra knob.
- **Fold the FPR curve into FIG. 01's live readout**; no separate FIG. 03.

## Definition of done

- [ ] Core interaction approved (done — this doc)
- [ ] Reader can trigger ≥1 failure mode (saturation, over-hashing)
- [ ] Sim core pure TS with passing invariant tests (1–4 above)
- [ ] Visualization works in reduced-motion stepped mode and at 360px touch
- [ ] Verification checklist complete; claims ✅ or labeled ⚠️; user reviewed
- [ ] Sources section present
- [ ] Edge-state QA pass complete
- [ ] Banned-phrase scan done
