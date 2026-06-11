# Verification checklist — pgbouncer-pool-modes (explainer #3)

Step 5 verification pass. Every checkable technical claim from the prose and component
captions, verified against PRIMARY sources only: pgbouncer.org/config.html,
pgbouncer.org/features.html, pgbouncer.org/changelog.html, and postgresql.org/docs/current.
Blog/SO answers are not verification sources.

Legend: ✅ verified (source + confirming text) · ⚠️ simplification (must be labeled in prose —
checked it IS) · ❌ wrong/unverifiable (fixed or cut).

Primary sources used:
- PgBouncer config: https://www.pgbouncer.org/config.html
- PgBouncer features (per-mode SQL matrix): https://www.pgbouncer.org/features.html
- PgBouncer changelog (1.21 prepared-statement support): https://www.pgbouncer.org/changelog.html
- HikariCP pool sizing (folklore caveat): https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing
- PG connections established: https://www.postgresql.org/docs/current/connect-estab.html
- PG work_mem: https://www.postgresql.org/docs/current/runtime-config-resource.html
- PG max_connections: https://www.postgresql.org/docs/current/runtime-config-connection.html

Cross-check method: the two coached experiments and the default state were executed against the
actual sim core (seed `0xc0ffee`) via a throwaway vitest harness; results quoted under section F.

---

## A. Postgres connection-cost claims

1. **"Postgres uses a process-per-connection model … 'is called postmaster and listens at a
   specified TCP/IP port for incoming connections. Whenever it detects a request for a
   connection, it spawns a new backend process.'"**
   ✅ connect-estab: verbatim — "This supervisor process is called postmaster and listens at a
   specified TCP/IP port for incoming connections. Whenever it detects a request for a
   connection, it spawns a new backend process." Quote is exact.

2. **"`work_mem` … defaults to 4 MB and is allocated *per sort or hash operation*, not per
   connection."** + the multiplication quote.
   ✅ runtime-config-resource: "The default value is four megabytes (4MB)." / "a complex query
   might perform several sort and hash operations at the same time … several running sessions
   could be doing such operations concurrently. Therefore, the total memory used could be many
   times the value of work_mem." Exact match.

3. **"a three-way hash join can claim 12 MB"** (3 × 4 MB).
   ✅ Arithmetic consistent with #2 (per-operation 4 MB × 3 concurrent operations). Framed as an
   illustration, not a documented constant. Correct.

4. **"max_connections = 100 … 'typically 100… but might be less if your kernel settings will not
   support it'"**
   ✅ runtime-config-connection: "The default is typically 100 connections, but might be less if
   your kernel settings will not support it (as determined during initdb)." Exact.

5. **"Postgres 'sizes certain resources based directly on the value of max_connections,' so
   raising it inflates shared-memory structures whether or not the connections are used."**
   ✅ runtime-config-connection: "PostgreSQL sizes certain resources based directly on the value
   of max_connections. Increasing its value leads to higher allocation of those resources,
   including shared memory." Exact.

## B. Hook math (800-pod scenario)

6. **"800 pods times 20 connections is 16,000."**
   ✅ Arithmetic: 800 × 20 = 16,000. Correct. The naive "make it 2,000" raise is an illustrative
   value (below 16,000); prose only says "set the limit above that," so the math is presented
   coherently — the 16,000 vs max_connections 100 contrast is the load-bearing figure and it adds
   up.

7. **"`FATAL: sorry, too many clients already`"** (Postgres rejection string).
   ✅ Standard Postgres error emitted when connections exceed max_connections (errcode
   53300 too_many_connections). Verbatim-accurate error text. Verified.

## C. PgBouncer pool-mode semantics

8. **Session mode "releases the backend only when the client disconnects."**
   ✅ config pool_mode session: "Server is released back to pool after client disconnects." Exact.

9. **Transaction mode "releases the backend at every COMMIT or ROLLBACK."**
   ✅ config pool_mode transaction: "Server is released back to pool after transaction finishes."
   COMMIT/ROLLBACK = transaction finishes. Verified.

10. **Statement mode "releases the backend after every individual statement … forbids
    multi-statement transactions … 'Transactions spanning multiple statements are disallowed in
    this mode.'"**
    ✅ config pool_mode statement: "Server is released back to pool after query finishes.
    Transactions spanning multiple statements are disallowed in this mode." Exact quote.

## D. PgBouncer parameter defaults

11. **max_client_conn default 100 (the M side — total clients PgBouncer accepts).**
    ✅ config: default 100. Verified.

12. **default_pool_size default 20 (server connections per database/user pair); "per pool, not
    global."**
    ✅ config: default 20. Per-(database,user) pool semantics confirmed in config + features
    framing. Verified.

13. **query_wait_timeout default 120 s.**
    ✅ config: "Default: 120.0" seconds. Verified.

14. **"that timeout is query_wait_timeout … In production, 120 seconds is a long time to hold a
    client hostage."** Behavior on timeout.
    ✅ config: "If the query is not assigned to a server during that time, the client is
    disconnected." The prose frames it as the client being held then released to a timeout;
    consistent. The disconnect-vs-recoverable detail is a SIMPLIFICATION (see claim 26).

15. **max_prepared_statements default 200; "PgBouncer 1.21 added max_prepared_statements";
    "tracks protocol-level named prepared statements"; "transparently prepares it first"; "Setting
    it to 0 disables that."**
    ✅ config: default 200, "tracks protocol-level named prepared statements related commands …
    in transaction and statement pooling mode"; 0 → "prepared statement support for transaction
    and statement pooling is disabled." Version: changelog 1.21.0 "Add support for protocol-level
    named prepared statements." All confirmed. "Transparently prepares it first" is a faithful
    paraphrase of the documented inject-PREPARE-then-EXECUTE behavior.

16. **server_reset_query default DISCARD ALL.**
    ✅ config: "Default: DISCARD ALL." Verified.

17. **server_reset_query_always defaults to 0; reset "is not used" in transaction mode "because
    in that mode, clients must not use any session-based features."**
    ✅ config: server_reset_query_always default 0 → "the server_reset_query will be run only in
    pools that are in sessions-pooling mode" (skipped in transaction/statement). Rationale text
    matches the documented reasoning. Verified.

18. **FD formula: "max_client_conn + max pool_size × databases × users".**
    ✅ config: "max_client_conn + (max pool_size * total databases * total users)" (per-user
    case). Exact match.

## E. Transaction-mode feature compatibility (features.html Yes/Never matrix)

19. **"PgBouncer's feature matrix marks each of these 'Never' in transaction pooling, against
    'Yes' in session pooling."** — SET/RESET.
    ✅ features: "SET/RESET | Yes | Never." Verified.

20. **LISTEN / NOTIFY both unsafe in transaction mode.**
    ❌→FIXED. features lists LISTEN and NOTIFY as SEPARATE rows: "LISTEN | Yes | Never" but
    "NOTIFY | Yes | Yes." NOTIFY is explicitly permitted in transaction pooling. The draft lumped
    `LISTEN` / `NOTIFY` together as "Never," which is wrong for NOTIFY. **Corrected**: prose now
    scopes the break to `LISTEN` and adds a parenthetical that NOTIFY is the matrix's "Yes"
    exception (a notification completes within its sending transaction; it is LISTEN that needs a
    durable session).

21. **WITH HOLD cursors — Never in transaction mode.**
    ✅ features: "WITH HOLD CURSOR | Yes | Never." Verified.

22. **PRESERVE ROWS temp tables — Never in transaction mode.**
    ✅ features: "PRESERVE/DELETE ROWS temp tables | Yes | Never." Verified.

23. **LOAD — Never in transaction mode.**
    ✅ features: "LOAD statement | Yes | Never." Verified.

24. **Session-level advisory locks (`pg_advisory_lock`) — Never in transaction mode.**
    ✅ features: "Session-level advisory locks | Yes | Never." The matrix labels the row exactly
    "Session-level advisory locks," matching the prose's `pg_advisory_lock` framing. Verified.

25. **"Transaction-scoped advisory locks (`pg_advisory_xact_lock`) are fine, because they are
    released at COMMIT — the same boundary at which the backend is released."**
    ✅ (by inference — labeled). The features matrix has NO row for transaction-level advisory
    locks; it only marks "Session-level" as Never. The prose's claim is a correct deduction from
    documented Postgres semantics: `pg_advisory_xact_lock` auto-releases at transaction end
    (PG docs, Advisory Lock Functions), which coincides with the transaction-mode release boundary,
    so it cannot leak across backends. Logically sound, standard semantics, not contradicted by any
    primary source. Left as-is; the prose itself supplies the "released at COMMIT" justification,
    so the reasoning is visible to the reader. No fix.

## F. Prose ↔ sim ↔ viz cross-check (coached sequences executed, seed 0xc0ffee)

26. **Default state: "Leave the figure on its default — session mode … With 8 clients and a pool
    of 3."** + "Reset the figure, set clients to 16, pool_size to 1."
    ✅ Executed: snapshot on load is mode `session`, clientCount 8, poolSize 3, load low,
    prepared off. Matches sim DEFAULT_CLIENTS=8, DEFAULT_POOL_SIZE=3, init mode "session". The
    figure caption's control names (mode radios, clients/pool_size steppers, load + PREPARE
    toggles) match PoolViz exactly.

27. **Prepared-statement coached sequence: "set transaction mode, drop pool_size to 2, turn
    PREPARE: on, and set load: HIGH … the event log starts printing `prepared statement "S_1"
    does not exist`."**
    ✅ Executed: with mode transaction / clients 8 / pool 2 / load high / prepared on, the event
    log emits `client N: prepared statement "S_1" does not exist` within a few seconds. The exact
    error substring `prepared statement "S_1" does not exist` matches the sim's `failClient`
    message in `startNextQuery`. The per-server prepared chips render `S_1` (sim names the stmt
    "S_1"; PoolViz renders `c{client}:S_1` keys via prepKey — the chip text shows the keyed name).
    Mechanism description (PREPARE lands on one backend's session, next xact routed to a different
    backend, EXECUTE fails) matches sim semantics exactly.

28. **Saturation coached sequence: "set clients to 16, pool_size to 1, and load: HIGH … the
    `timeouts` counter starts climbing."**
    ✅ Executed: mode transaction / clients 16 / pool 1 / load high produces timeouts > 0. Matches
    sim test 6 and the `query_wait_timeout` path. The amber wait-queue badge + `timeouts` Stat are
    wired in PoolViz/LaneDiagram. Verified.

29. **"That timeout is query_wait_timeout, whose real default is 120 seconds. The sim scales it
    down to 5 seconds."** (5s-vs-120s scaling LABELED in prose.)
    ✅ Sim: QUERY_WAIT_TIMEOUT_MS = 5000, with a code comment citing the real 120s default. Prose
    states both numbers and the scaling rationale explicitly ("only faster"). ⚠️ scaling labeled
    in place — verified.

30. **Mode-release semantics: session = pin until disconnect + server_reset_query (DISCARD ALL)
    shown as amber "reset" lane; transaction = release per COMMIT, no reset by default.**
    ✅ Matches sim: session-mode finishTransaction keeps the link, disconnect (SESSION_DISCONNECT
    _CHANCE 0.22) triggers releaseServer(runReset=true) → "reset" state for SERVER_RESET_MS;
    transaction/statement release with runReset=false. Prose's "~22% of completions" matches the
    constant. LaneDiagram colors server "reset" as `--color-pending` (amber). Consistent.

31. **"server_reset_query_always defaults to 0" + reset is a session-mode-only safety net.**
    ✅ Matches config (claim 17) and sim SIMPLIFICATIONS[3]. Prose ⚠️-labels that the sim models
    the reset on session release only. Verified + labeled.

## G. Simplification labels (must be flagged in prose — checked they ARE)

32. **Prepared-statement failure requires `max_prepared_statements = 0` / PgBouncer < 1.21.**
    ⚠️ Prose: "The sim deliberately models the max_prepared_statements = 0 path … (This is called
    out in the sim's SIMPLIFICATIONS.)" Matches SIMPLIFICATIONS[2]. Correctly labeled in place.

33. **query_wait_timeout scaled to 5s; real PgBouncer DISCONNECTS on timeout (sim models a
    recoverable backoff).**
    ⚠️ Prose labels the 5s/120s scaling (claim 29). The disconnect-vs-recoverable detail is
    SIMPLIFICATIONS[1] and lives in further.md, not in prose. The prose makes no claim that
    contradicts the disconnect behavior (it says the pool "holds a client hostage" then times
    out), so no in-prose mislabel. Acceptable: the sim-internal modeling choice need not surface in
    prose as long as prose states nothing false. Verified.

34. **Per-(database,user) pool flattening: "the per-pool subtlety the sim flattens."**
    ⚠️ Prose explicitly states the sim flattens one db/user/pool and that default_pool_size is
    per-pool. Matches SIMPLIFICATIONS[0]. Correctly labeled in place.

## H. Production grounding / folklore caveat

35. **HikariCP folklore: "The famous 'connections ≈ cores × 2' rule is HikariCP guidance for a
    CPU-bound JDBC pool."**
    ❌→FIXED. HikariCP's own pool-sizing page gives the formula `((core_count * 2) +
    effective_spindle_count)` and frames the 2× multiplier as accounting for disk/network I/O
    BLOCKING — explicitly NOT CPU-bound guidance ("databases experience blocking on disk and
    network I/O … allowing additional connections to utilize CPU while others wait"). Calling it
    "CPU-bound" inverts the source's reasoning. **Corrected**: prose now describes it as a
    rounding of HikariCP's `(core_count × 2) + effective_spindle_count` formula and explains the
    multiplier exists because I/O blocks. Still correctly framed as not-PgBouncer-doctrine.

36. **"PgBouncer's own documentation does not hand you a single number; it gives you the
    file-descriptor accounting … and leaves the pool size to your workload."**
    ✅ Consistent with config (no recommended pool_size number is given; the FD formula is the
    sizing guidance offered). Verified.

37. **Alternative poolers (pgcat, Odyssey, RDS Proxy, Supavisor) parked to further.md.**
    ✅ One-question discipline held: each pooler gets one line in the prose and the detail lives in
    further.md. Verified.

---

## Result tally

- ✅ verified: 35
- ⚠️ simplifications (all confirmed labeled in place / non-contradictory): claims 29, 31, 32, 33,
  34 — counted within the 35 as verified-and-labeled.
- ❌ wrong → fixed: 2 (claim 20 NOTIFY; claim 35 HikariCP "CPU-bound").
- cut: 0.

## Corrections applied (Part A/B fixes)

1. **NOTIFY in transaction mode (claim 20).** Draft grouped `LISTEN` / `NOTIFY` as both "Never."
   The features matrix marks NOTIFY "Yes" in transaction pooling (LISTEN "Never"). Rewrote the
   bullet to scope the break to `LISTEN` and added a parenthetical explaining NOTIFY is the
   exception (it completes within its sending transaction). This was the single highest-risk
   matrix error — a senior reader running NOTIFY-only code under transaction pooling would have
   been wrongly told to avoid it.

2. **HikariCP "CPU-bound" caveat (claim 35).** Draft called the cores×2 rule "HikariCP guidance
   for a CPU-bound JDBC pool." HikariCP's own doc frames the formula as accommodating I/O
   blocking, not CPU-bound work. Rewrote to cite the actual formula `(core_count × 2) +
   effective_spindle_count` and the I/O-blocking rationale, preserving the (correct) point that it
   is not PgBouncer doctrine.

## Part B — content / teaching review

- **Banned-phrase scan: clean.** No "simply" / "just" minimizers, no "delve" / "leverage" /
  "magic" / "dive in" / "in today's world," no exclamation marks, no 3+ em-dash filler chains.
- **Senior calibration:** assumes shipped-production knowledge; never explains transactions,
  processes, GUCs, or the wire protocol from scratch. Correct altitude.
- **Question → interaction → interpretation flow:** the central question ("when does the pooler
  take the backend back?") is posed in prose, answered by the mode control + lane diagram, and
  interpreted per mode. The two breaks (prepared-statement, saturation) each pose the symptom,
  drive it in the figure, then explain the mechanism. Flow holds.
- **Hook math coherent:** 800 × 20 = 16,000 vs max_connections 100 is the load-bearing contrast
  and is arithmetically sound (claim 6).
- **One-question discipline:** the piece stays on "what the modes do and which to pick";
  per-(db,user) pools, the 1.21 mitigation internals, idle-in-transaction, reset-query tuning,
  and alternative poolers are all parked in further.md with one-line stubs in prose.
- **Sources honesty:** every cited default and the feature matrix appear in the Sources section
  with the correct primary URLs. After the NOTIFY fix, the prose now matches the cited
  features.html matrix exactly.
- **Length:** ≈ 2,400 words of prose (within 1,500–3,000).

## No-touch code observations (report only — sim/viz NOT modified)

- None blocking. The sim, LaneDiagram, and PoolViz controls match the prose as written (after the
  two prose fixes). The sim's modeling choices (recoverable-timeout backoff, single pool,
  max_prepared_statements=0 path) are all disclosed in SIMPLIFICATIONS and either surfaced in
  prose or parked in further.md.
- Minor (no action): the per-server prepared chips render the internal keyed name (`c{client}:S_1`
  via prepKey) rather than a bare `S_1`. The prose says the chips show "S_1 … resident on one
  lane," which is true as a substring; the key prefix is an implementation detail that does not
  contradict the prose. Recorded so a future chip-label change re-checks the caption.

## Reviewer note (Step 5 gate)

Per the skill's Step 5, the human must review and approve this checklist before publishing. The
explainer remains `draft: true` in frontmatter; this checklist is the artifact for that review.

## Edge-state QA (2026-06-11)

Exercised in a real browser (built site, Playwright): default session-mode state already teaches (8 clients pinning 3
servers → waiters time out); staged the prepared-statement break in 4 presses (transaction → pool_size 2 → PREPARE on
→ load HIGH) — exact error string filled the event log, prepared_missing climbed in danger red, per-client S_1 chips
visible per server; wait-queue FIFO annotation correct; 360px layout clean after a mode-radiogroup flex-wrap fix
applied during QA; zero console errors/warnings. Stepped reduced-motion mode and spam safety covered by code review +
17 sim invariant tests.
