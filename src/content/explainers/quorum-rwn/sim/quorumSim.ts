export const STANDIN_COUNT = 2;
export const MAX_N = 7;

export interface HomeNodeView {
  id: number;
  value: string;
  version: number;
  reachable: boolean;
  lastWriteTarget: boolean; // part of the most recent write quorum
  lastReadResponder: boolean; // part of the most recent read quorum
  repaired: boolean; // updated by read repair on the last read
}

export interface StandinView {
  id: number;
  reachable: boolean;
  holding: { value: string; version: number; forNodeId: number } | null;
  lastWriteTarget: boolean;
}

export type OpMode = "strict" | "sloppy" | "failed";

export interface WriteResult {
  version: number;
  value: string;
  homeTargets: number[];
  standinTargets: number[];
  mode: OpMode;
  acks: number;
  reason: string;
}

export interface ReadResult {
  responders: number[];
  value: string;
  version: number;
  fresh: boolean;
  mode: "ok" | "failed";
  reason: string;
}

export interface QuorumSnapshot {
  n: number;
  r: number;
  w: number;
  sloppy: boolean;
  readRepair: boolean;
  guaranteedOverlap: boolean; // R + W > N
  committedVersion: number;
  committedValue: string;
  home: HomeNodeView[];
  standins: StandinView[];
  reachableCount: number;
  lastWrite: WriteResult | null;
  lastRead: ReadResult | null;
  overlap: number[]; // home node ids in both last write targets and last read responders
  consistency: "overlap-guaranteed" | "stale-possible";
  eventLog: string[];
}

export interface QuorumSim {
  write(): WriteResult;
  read(): ReadResult;
  togglePartition(nodeId: number): void;
  toggleStandinPartition(nodeId: number): void;
  setN(n: number): void;
  setR(r: number): void;
  setW(w: number): void;
  setSloppy(on: boolean): void;
  setReadRepair(on: boolean): void;
  reset(): void;
  snapshot(): QuorumSnapshot;
}

export const SIMPLIFICATIONS: readonly string[] = [
  "One key. A real Dynamo-style store hashes many keys around a ring; each key's N replicas are the N nodes following its hash, so a partition affects different keys differently.",
  "The coordinator picks the first reachable replicas by index. Real systems use the key's preference list from consistent hashing; the R+W>N overlap guarantee holds regardless of which replicas are chosen, so the simplification doesn't change the result.",
  "Versions are a single monotonic counter, so 'newest wins' is unambiguous. Real Dynamo uses vector clocks and can surface sibling versions that conflict and need application-level reconciliation; last-write-wins with wall-clock timestamps is the other common choice.",
  "Sloppy quorum uses a small fixed pool of stand-in nodes. Real sloppy quorum walks past the unreachable preferred replicas to the next healthy nodes on the ring, with no separate pool.",
  "Reads and writes are instantaneous and never partially fail mid-quorum. There is no request timeout, no coordinator failure, no concurrent-write race within a single version.",
  "Read repair here updates only the replicas that responded to the read. Real systems also run anti-entropy (Merkle-tree) repair in the background to fix replicas no read touched.",
];

export function createQuorumSim(): QuorumSim {
  let n: number;
  let r: number;
  let w: number;
  let sloppy: boolean;
  let readRepair: boolean;
  let committedVersion: number;
  let committedValue: string;
  let home: { value: string; version: number; reachable: boolean; repaired: boolean }[];
  let standins: { reachable: boolean; holding: { value: string; version: number; forNodeId: number } | null }[];
  let lastWrite: WriteResult | null;
  let lastRead: ReadResult | null;
  let eventLog: string[];

  function log(line: string): void {
    eventLog.push(line);
    if (eventLog.length > 60) eventLog.shift();
  }

  function init(): void {
    n = 5;
    r = 2;
    w = 2;
    sloppy = false;
    readRepair = true;
    committedVersion = 0;
    committedValue = "v0";
    home = Array.from({ length: MAX_N }, () => ({ value: "v0", version: 0, reachable: true, repaired: false }));
    standins = Array.from({ length: STANDIN_COUNT }, () => ({ reachable: true, holding: null }));
    lastWrite = null;
    lastRead = null;
    eventLog = [];
  }

  function clearMarks(): void {
    for (const h of home) h.repaired = false;
  }

  function reachableHomeIds(): number[] {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) if (home[i].reachable) ids.push(i);
    return ids;
  }

  function doWrite(): WriteResult {
    clearMarks();
    const version = committedVersion + 1;
    const value = `v${version}`;
    const reachable = reachableHomeIds();

    if (reachable.length >= w) {
      const homeTargets = reachable.slice(0, w);
      for (const id of homeTargets) {
        home[id].value = value;
        home[id].version = version;
      }
      committedVersion = version;
      committedValue = value;
      lastWrite = {
        version,
        value,
        homeTargets,
        standinTargets: [],
        mode: "strict",
        acks: w,
        reason: `strict quorum: ${w} of ${n} replicas acked`,
      };
      log(`WRITE ${value}: strict quorum on replicas {${homeTargets.join(", ")}} — committed`);
      return lastWrite;
    }

    if (sloppy) {
      const availStandins: number[] = [];
      for (let i = 0; i < standins.length; i++) if (standins[i].reachable) availStandins.push(i);
      const needed = w - reachable.length;
      if (reachable.length + availStandins.length >= w) {
        const standinTargets = availStandins.slice(0, needed);
        const downHome: number[] = [];
        for (let i = 0; i < n; i++) if (!home[i].reachable) downHome.push(i);
        for (const id of reachable) {
          home[id].value = value;
          home[id].version = version;
        }
        standinTargets.forEach((sid, k) => {
          standins[sid].holding = { value, version, forNodeId: downHome[k] ?? downHome[0] ?? 0 };
        });
        committedVersion = version;
        committedValue = value;
        lastWrite = {
          version,
          value,
          homeTargets: reachable,
          standinTargets,
          mode: "sloppy",
          acks: w,
          reason: `sloppy quorum: ${reachable.length} replica(s) + ${standinTargets.length} stand-in(s) acked; data held for handoff`,
        };
        log(`WRITE ${value}: SLOPPY quorum — ${standinTargets.length} ack(s) parked on stand-ins, invisible to a strict read`);
        return lastWrite;
      }
    }

    lastWrite = {
      version: committedVersion,
      value: committedValue,
      homeTargets: [],
      standinTargets: [],
      mode: "failed",
      acks: reachable.length,
      reason: `write failed: only ${reachable.length} of ${w} required replicas reachable`,
    };
    log(`WRITE ${value}: FAILED — ${reachable.length}/${w} replicas reachable (strict quorum unavailable)`);
    return lastWrite;
  }

  function doRead(): ReadResult {
    clearMarks();
    const reachable = reachableHomeIds();
    if (reachable.length < r) {
      lastRead = {
        responders: [],
        value: committedValue,
        version: -1,
        fresh: false,
        mode: "failed",
        reason: `read failed: only ${reachable.length} of ${r} required replicas reachable`,
      };
      log(`READ: FAILED — ${reachable.length}/${r} replicas reachable`);
      return lastRead;
    }
    const responders = reachable.slice(0, r);
    let bestVersion = -1;
    let bestValue = "v0";
    for (const id of responders) {
      if (home[id].version > bestVersion) {
        bestVersion = home[id].version;
        bestValue = home[id].value;
      }
    }
    if (readRepair) {
      for (const id of responders) {
        if (home[id].version < bestVersion) {
          home[id].value = bestValue;
          home[id].version = bestVersion;
          home[id].repaired = true;
        }
      }
    }
    const fresh = bestVersion === committedVersion;
    lastRead = {
      responders,
      value: bestValue,
      version: bestVersion,
      fresh,
      mode: "ok",
      reason: fresh
        ? `fresh: a responder held the latest version (${committedVersion})`
        : `STALE: newest committed is v${committedVersion} but the read quorum only saw ${bestValue}`,
    };
    log(
      `READ from {${responders.join(", ")}} → ${bestValue}` +
        (fresh ? " (fresh)" : ` (STALE — latest is ${committedValue})`),
    );
    return lastRead;
  }

  function deliverHints(nodeId: number): void {
    for (const s of standins) {
      if (s.holding && s.holding.forNodeId === nodeId) {
        if (home[nodeId].version < s.holding.version) {
          home[nodeId].value = s.holding.value;
          home[nodeId].version = s.holding.version;
        }
        log(`hinted handoff: stand-in delivered ${s.holding.value} to replica ${nodeId}`);
        s.holding = null;
      }
    }
  }

  function snapshotImpl(): QuorumSnapshot {
    const writeHome = new Set(lastWrite?.homeTargets ?? []);
    const writeStandin = new Set(lastWrite?.standinTargets ?? []);
    const readResp = new Set(lastRead?.mode === "ok" ? lastRead.responders : []);
    const overlap: number[] = [];
    for (let i = 0; i < n; i++) if (writeHome.has(i) && readResp.has(i)) overlap.push(i);

    return {
      n,
      r,
      w,
      sloppy,
      readRepair,
      guaranteedOverlap: r + w > n,
      committedVersion,
      committedValue,
      home: Array.from({ length: n }, (_, i) => ({
        id: i,
        value: home[i].value,
        version: home[i].version,
        reachable: home[i].reachable,
        lastWriteTarget: writeHome.has(i),
        lastReadResponder: readResp.has(i),
        repaired: home[i].repaired,
      })),
      standins: standins.map((s, i) => ({
        id: i,
        reachable: s.reachable,
        holding: s.holding ? { ...s.holding } : null,
        lastWriteTarget: writeStandin.has(i),
      })),
      reachableCount: reachableHomeIds().length,
      lastWrite: lastWrite ? { ...lastWrite } : null,
      lastRead: lastRead ? { ...lastRead } : null,
      overlap,
      consistency: r + w > n ? "overlap-guaranteed" : "stale-possible",
      eventLog: [...eventLog],
    };
  }

  init();

  return {
    write: doWrite,
    read: doRead,
    togglePartition(nodeId: number) {
      if (nodeId < 0 || nodeId >= n) return;
      home[nodeId].reachable = !home[nodeId].reachable;
      if (home[nodeId].reachable) {
        log(`replica ${nodeId} healed`);
        deliverHints(nodeId);
      } else {
        log(`replica ${nodeId} partitioned (unreachable)`);
      }
    },
    toggleStandinPartition(nodeId: number) {
      if (nodeId < 0 || nodeId >= standins.length) return;
      standins[nodeId].reachable = !standins[nodeId].reachable;
    },
    setN(newN: number) {
      n = Math.max(3, Math.min(MAX_N, Math.round(newN)));
      if (r > n) r = n;
      if (w > n) w = n;
    },
    setR(newR: number) {
      r = Math.max(1, Math.min(n, Math.round(newR)));
    },
    setW(newW: number) {
      w = Math.max(1, Math.min(n, Math.round(newW)));
    },
    setSloppy(on: boolean) {
      sloppy = on;
    },
    setReadRepair(on: boolean) {
      readRepair = on;
    },
    reset: init,
    snapshot: snapshotImpl,
  };
}
