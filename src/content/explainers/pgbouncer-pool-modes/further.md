# Further — PgBouncer pool modes parking lot

Material deliberately cut from `index.mdx` to keep it to one question (what the three pool modes do to your connections, and which one to pick). Each item is a candidate for a future explainer or a footnote if the piece ever expands.

## Alternative poolers (the one-line versions promised in the article)

- **pgcat** — Rust, multithreaded, with built-in load balancing across replicas, sharding, and failover; aims to be a drop-in PgBouncer replacement that also does the read/write split a bare pooler punts on. Worth a "pooler that also routes" explainer.
- **Odyssey** — Yandex's multithreaded C pooler, designed for high core counts where PgBouncer's single-threaded event loop becomes the bottleneck. The threading model is the interesting contrast.
- **Amazon RDS Proxy** — managed, transaction-pooling-only, with IAM auth and automatic failover handling; trades configurability for not running the thing yourself. The managed/serverless angle (connection pinning when it detects session state) is a good sidebar.
- **Supavisor** — Supabase's Elixir/Erlang pooler, built for multi-tenant cloud (one pooler fleet, many databases) and horizontal scaling via the BEAM. The "pooler as a distributed system" framing is its own piece.

The threading story alone (PgBouncer single-threaded event loop vs pgcat/Odyssey/Supavisor multithreaded) is a candidate explainer: when does the pooler itself become the bottleneck, and what does adding cores actually buy.

## `max_prepared_statements` internals (how the 1.21 mitigation actually works)

The article says 1.21+ "tracks and transparently prepares." The mechanism is worth a walk-through: PgBouncer inspects protocol-level Parse/Bind/Execute messages, assigns each unique query string an internal name of the form `PGBOUNCER_{id}`, rewrites the client's commands to use that internal name, and maintains a per-server map of which internal statements are already prepared on each backend. When a client's transaction lands on a backend that lacks the statement, PgBouncer injects the `PREPARE` before forwarding the `EXECUTE`. This is effectively a statement cache living in the pooler. Good "break it" interaction: cap the cache and watch eviction/re-prepare thrash under a workload with more distinct statements than the cap. Out of scope here because the article is about modes, and this is one mode's escape hatch.

## Per-`(database, user)` pools and the sizing math the sim flattens

The sim models one database, one user, one pool. Real PgBouncer keeps a separate server pool per `(database, user)` pair, which is why `default_pool_size` is per-pool and the file-descriptor accounting multiplies by databases × users. The full sizing picture — `default_pool_size`, `min_pool_size` (default 0, keeps warm connections), `reserve_pool_size` (default 0, burst capacity above the normal pool), `reserve_pool_timeout`, and how `max_db_connections` / `max_user_connections` cap the aggregate — is a configuration explainer on its own. The interaction would let the reader watch min_pool_size warm connections and reserve_pool absorb a burst.

## idle-in-transaction and the backend you forgot to release

The sim has no "open transaction sitting idle" state — a client is either running a statement or between transactions. Real transaction-mode pooling pins a backend for the *entire* open transaction, including the time a client sits in `BEGIN` doing nothing (idle-in-transaction). This is a top cause of pool saturation that looks mysterious: a handful of clients holding backends open while not running queries. `idle_in_transaction_session_timeout` (Postgres side) and `idle_transaction_timeout` (PgBouncer side) exist precisely to reap these. A good failure-mode interaction: add an idle-in-transaction client and watch effective pool size shrink without any visible query load.

## query_wait_timeout: disconnect vs the sim's recoverable error

Real PgBouncer *disconnects* the client when `query_wait_timeout` fires; the sim models it as a recoverable error with backoff so the demo keeps flowing rather than losing the client. The real behavior (client sees a dropped connection, must reconnect) interacts with the thundering-reconnect failure from the article's intro — a saturated pool timing out clients can trigger the exact reconnect stampede that saturates it further. That feedback loop is its own explainer.

## server_reset_query tuning (DISCARD ALL vs DEALLOCATE ALL)

The article notes `DISCARD ALL` runs on session-mode release. The cheaper alternative `DEALLOCATE ALL` drops only prepared statements and leaves other cached state, and `server_reset_query_always` forces the reset even in transaction/statement mode (default 0). The tradeoff between cleanup thoroughness and the per-release cost of running the reset query is a tuning sidebar, not a mode concept.

## The connection-cost numbers, properly

The article asserts process-per-connection and `work_mem` multiplication. A deeper treatment would measure it: per-backend baseline RSS, the shared-memory growth as `max_connections` rises, the context-switch cost of N idle backends, and where exactly throughput peaks and rolls over as connections climb. That measurement-driven "how expensive is a Postgres connection, actually" piece pairs naturally with this one but is a different question (the cost, not the pooling).
