import { describe, it, expect } from "vitest";
import { createWalSim, SIMPLIFICATIONS, type WalSim, type WalSnapshot } from "./walSim";

const PAGE_COUNT = 8;

// Independent oracle: re-derive expected on-disk page state purely from the
// post-crash snapshot. Recovery must equal: start from the checkpoint disk image,
// then replay every durable, CRC-valid record with LSN > checkpointLsn, stopping
// at the first torn record (and the durable boundary).
function oraclePages(snap: WalSnapshot): number[] {
  const pages = snap.pages.map((p) => p.disk); // checkpoint image
  const ordered = [...snap.records].sort((a, b) => a.lsn - b.lsn);
  for (const r of ordered) {
    if (r.durability === "torn") break; // truncate tail at CRC mismatch
    if (r.durability !== "durable") continue; // buffered = never written
    if (r.lsn <= snap.checkpointLsn) continue;
    if (r.kind === "update" && r.pageId !== undefined && r.value !== undefined) {
      pages[r.pageId] = r.value;
    }
  }
  return pages;
}

// Drive a randomized operation sequence deterministically off a seed, WITHOUT
// using Math.random (so the test itself is reproducible).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Op =
  | { t: "commit" }
  | { t: "step"; dt: number }
  | { t: "load"; on: boolean }
  | { t: "fsync"; on: boolean }
  | { t: "checkpoint" };

function randomOps(seed: number, n: number): Op[] {
  const r = lcg(seed);
  const ops: Op[] = [];
  for (let i = 0; i < n; i++) {
    const x = r();
    if (x < 0.4) ops.push({ t: "commit" });
    else if (x < 0.7) ops.push({ t: "step", dt: 1 + Math.floor(r() * 120) });
    else if (x < 0.8) ops.push({ t: "load", on: r() < 0.7 });
    else if (x < 0.9) ops.push({ t: "fsync", on: r() < 0.5 });
    else ops.push({ t: "checkpoint" });
  }
  return ops;
}

function applyOp(sim: WalSim, op: Op): void {
  switch (op.t) {
    case "commit":
      sim.commit();
      break;
    case "step":
      sim.step(op.dt);
      break;
    case "load":
      sim.setLoad(op.on);
      break;
    case "fsync":
      sim.setFsyncOnCommit(op.on);
      break;
    case "checkpoint":
      sim.checkpoint();
      break;
  }
}

describe("walSim recovery invariant (oracle sweep)", () => {
  it("post-recovery pages equal the independent oracle for any crash point", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ops = randomOps(seed, 30);
      // Crash after each prefix of the op sequence.
      for (let crashAt = 0; crashAt <= ops.length; crashAt++) {
        const sim = createWalSim(seed);
        for (let i = 0; i < crashAt; i++) applyOp(sim, ops[i]);
        sim.crash();
        const crashed = sim.snapshot();
        const expected = oraclePages(crashed);

        sim.recoverAll();
        const recovered = sim.snapshot();

        expect(recovered.phase).toBe("recovered");
        const got = recovered.pages.map((p) => p.memory);
        expect(got).toEqual(expected);
      }
    }
  });
});

describe("fsync-on durability", () => {
  it("every acked txn survives any crash when fsyncOnCommit is ON", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const ops = randomOps(seed, 25).filter((o) => o.t !== "fsync"); // keep fsync ON
      for (let crashAt = 0; crashAt <= ops.length; crashAt++) {
        const sim = createWalSim(seed);
        sim.setFsyncOnCommit(true);
        for (let i = 0; i < crashAt; i++) applyOp(sim, ops[i]);

        const beforeCrash = sim.snapshot();
        const ackedTxids = beforeCrash.txns
          .filter((t) => t.status === "acked")
          .map((t) => t.txid);

        sim.crash();
        sim.recoverAll();
        const after = sim.snapshot();

        for (const txid of ackedTxids) {
          const t = after.txns.find((x) => x.txid === txid);
          expect(t, `txn ${txid} present after recovery`).toBeDefined();
          expect(t!.status, `acked txn ${txid} must survive`).toBe("survived");
        }
      }
    }
  });
});

describe("fsync-off loss", () => {
  it("an acked txn still in wal_buffer at crash is lost and never resurrected", () => {
    const sim = createWalSim(7);
    sim.setFsyncOnCommit(false);
    sim.commit(); // acks immediately, records sit in buffer
    const s1 = sim.snapshot();
    const acked = s1.txns.filter((t) => t.status === "acked");
    expect(acked.length).toBe(1);
    // Its commit record must still be buffered (not durable).
    const commitRec = s1.records.find(
      (r) => r.txid === acked[0].txid && r.kind === "commit",
    );
    expect(commitRec!.durability).toBe("buffered");

    sim.crash();
    const crashed = sim.snapshot();
    const lostTxn = crashed.txns.find((t) => t.txid === acked[0].txid);
    expect(lostTxn!.status).toBe("lost");

    sim.recoverAll();
    const after = sim.snapshot();
    const finalTxn = after.txns.find((t) => t.txid === acked[0].txid);
    expect(finalTxn!.status).toBe("lost"); // never resurrected
    expect(after.lost).toBeGreaterThanOrEqual(1);
  });

  it("a background flush (>=200ms) makes fsync-off commits durable", () => {
    const sim = createWalSim(7);
    sim.setFsyncOnCommit(false);
    sim.commit();
    sim.step(250); // background flush window elapses
    sim.step(10); // advance the in-flight flush to completion
    const s = sim.snapshot();
    expect(s.lastDurableLsn).toBeGreaterThanOrEqual(3);
    sim.crash();
    sim.recoverAll();
    const after = sim.snapshot();
    expect(after.survived).toBeGreaterThanOrEqual(1);
  });
});

describe("torn tail", () => {
  it("crash mid-flush truncates at the first CRC-invalid record", () => {
    const sim = createWalSim(3);
    // fsync ON: commit forces a flush. Crash before it completes => mid-flush.
    sim.commit(); // lsns 1,2,3 ; flush in flight
    sim.commit(); // lsns 4,5,6 ; batched into same flush window? commit2 piggybacks
    const mid = sim.snapshot();
    expect(mid.flushInFlight).toBe(true);

    sim.crash();
    const crashed = sim.snapshot();
    const torn = crashed.records.filter((r) => r.durability === "torn");
    expect(torn.length).toBe(1); // only the first record of the in-flight batch
    const tornLsn = torn[0].lsn;

    sim.recoverAll();
    const after = sim.snapshot();
    // Nothing at or past the torn LSN was replayed.
    for (const r of after.records) {
      if (r.lsn >= tornLsn) expect(r.replayed).toBe(false);
    }
    // Recovery log mentions the CRC mismatch / truncation.
    expect(after.recoveryLog.some((l) => /CRC mismatch|torn/.test(l))).toBe(true);
  });

  it("torn tail: pages match oracle (replays nothing past the torn point)", () => {
    const sim = createWalSim(11);
    sim.checkpoint(); // establish a clean checkpoint
    sim.commit();
    sim.commit();
    sim.crash(); // mid-flush
    const crashed = sim.snapshot();
    const expected = oraclePages(crashed);
    sim.recoverAll();
    const after = sim.snapshot();
    expect(after.pages.map((p) => p.memory)).toEqual(expected);
  });
});

describe("at most once replay (idempotent in result terms)", () => {
  it("recoverStep replaying record-by-record matches the oracle exactly", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ops = randomOps(seed, 24);
      const sim = createWalSim(seed);
      for (const op of ops) applyOp(sim, op);
      sim.crash();
      const crashed = sim.snapshot();
      const expected = oraclePages(crashed);

      sim.startRecovery();
      // Step until recovered, with a guard.
      let guard = crashed.records.length + 8;
      while (sim.snapshot().phase === "recovering" && guard-- > 0) {
        sim.recoverStep();
      }
      const after = sim.snapshot();
      expect(after.phase).toBe("recovered");
      expect(after.pages.map((p) => p.memory)).toEqual(expected);
      // No record marked replayed more than once is impossible to over-apply because
      // each list entry is consumed once; assert each replayed record is durable+valid.
      for (const r of after.records) {
        if (r.replayed) {
          expect(r.durability).toBe("durable");
          expect(r.lsn).toBeLessThanOrEqual(after.lastDurableLsn);
        }
      }
    }
  });
});

describe("group commit", () => {
  it("fsyncCount < commitCount over a busy interval with load on and fsync on", () => {
    const sim = createWalSim(5);
    sim.setFsyncOnCommit(true);
    sim.setLoad(true);
    // Large steps pack multiple commits into each flush window (group commit).
    for (let i = 0; i < 30; i++) sim.step(100);
    const s = sim.snapshot();
    expect(s.commitCount).toBeGreaterThan(10);
    expect(s.fsyncCount).toBeLessThan(s.commitCount);
  });
});

describe("determinism", () => {
  it("same seed + identical call sequence => JSON-equal snapshots at every step", () => {
    const seed = 99;
    const ops = randomOps(seed, 60);
    const a = createWalSim(seed);
    const b = createWalSim(seed);
    for (const op of ops) {
      applyOp(a, op);
      applyOp(b, op);
      expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    }
    // And through a crash + recovery.
    a.crash();
    b.crash();
    a.recoverAll();
    b.recoverAll();
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  });

  it("reset returns to a deterministic initial state for the same seed", () => {
    const a = createWalSim(42);
    const fresh = JSON.stringify(a.snapshot());
    for (let i = 0; i < 10; i++) a.commit();
    a.crash();
    a.recoverAll();
    a.reset();
    expect(JSON.stringify(a.snapshot())).toBe(fresh);
  });
});

describe("event-in-any-state safety", () => {
  it("spamming every method in every phase never throws or corrupts", () => {
    const sim = createWalSim(13);
    const phases = ["running", "crashed", "recovering", "recovered"] as const;

    const driveTo = (target: (typeof phases)[number]): void => {
      sim.reset();
      if (target === "running") return;
      sim.commit();
      sim.crash();
      if (target === "crashed") return;
      sim.startRecovery();
      if (target === "recovering") return;
      sim.recoverAll(); // -> recovered
    };

    const spam = (): void => {
      sim.step(5);
      sim.commit();
      sim.setLoad(true);
      sim.setLoad(false);
      sim.setFsyncOnCommit(false);
      sim.setFsyncOnCommit(true);
      sim.checkpoint();
      sim.crash();
      sim.startRecovery();
      sim.recoverStep();
      sim.recoverAll();
    };

    for (const p of phases) {
      driveTo(p);
      for (let i = 0; i < 20; i++) {
        expect(() => spam()).not.toThrow();
        const s = sim.snapshot();
        // Internal consistency invariants that must hold in every phase.
        expect(s.lastDurableLsn).toBeLessThanOrEqual(s.lastLsn);
        expect(s.checkpointLsn).toBeLessThanOrEqual(s.lastDurableLsn);
        expect(s.pages.length).toBe(PAGE_COUNT);
        expect(s.fsyncCount).toBeGreaterThanOrEqual(0);
        // counters never exceed total txns
        const total = s.txns.length;
        expect(s.acked + s.survived + s.lost).toBeLessThanOrEqual(total);
      }
    }
  });

  it("commit() during crashed/recovering/recovered is a no-op", () => {
    const sim = createWalSim(1);
    sim.commit();
    sim.crash();
    const before = sim.snapshot().lastLsn;
    sim.commit();
    expect(sim.snapshot().lastLsn).toBe(before);
    sim.startRecovery();
    sim.commit();
    expect(sim.snapshot().lastLsn).toBe(before);
    sim.recoverAll();
    sim.commit();
    expect(sim.snapshot().lastLsn).toBe(before);
  });
});

describe("metadata", () => {
  it("exports a non-empty SIMPLIFICATIONS list", () => {
    expect(Array.isArray(SIMPLIFICATIONS)).toBe(true);
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(3);
    expect(SIMPLIFICATIONS.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });
});
