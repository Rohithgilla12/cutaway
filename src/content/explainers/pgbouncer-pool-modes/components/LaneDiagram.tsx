import type { PoolSnapshot } from "../sim/poolSim";

const VIEW_W = 700;
const VIEW_H = 340;

const CLIENT_COL_X = 60;
const SERVER_COL_X = 560;

const CLIENT_W = 32;
const CLIENT_H = 24;
const SERVER_W = 64;
const SERVER_H = 40;

function clientFill(state: string): string {
  switch (state) {
    case "intxn":
      return "var(--color-entity)";
    case "waiting":
      return "var(--color-pending)";
    case "error":
      return "var(--color-danger)";
    default:
      return "var(--color-dead)";
  }
}

function serverFill(state: string): string {
  switch (state) {
    case "active":
      return "var(--color-entity)";
    case "reset":
      return "var(--color-pending)";
    default:
      return "var(--color-dead)";
  }
}

function clientY(idx: number, total: number): number {
  const spacing = Math.min(22, (VIEW_H - 40) / Math.max(total, 1));
  const totalH = spacing * (total - 1);
  const startY = (VIEW_H - totalH) / 2;
  return startY + idx * spacing;
}

function serverY(idx: number, total: number): number {
  const spacing = Math.min(56, (VIEW_H - 40) / Math.max(total, 1));
  const totalH = spacing * (total - 1);
  const startY = (VIEW_H - totalH) / 2;
  return startY + idx * spacing;
}

interface Props {
  snap: PoolSnapshot;
}

export function LaneDiagram({ snap }: Props) {
  const { clients, servers, pulses } = snap;
  const clientCount = clients.length;
  const serverCount = servers.length;

  const clientCenters: [number, number][] = clients.map((_, i) => [CLIENT_COL_X, clientY(i, clientCount)]);

  const serverCenters: [number, number][] = servers.map((_, i) => [SERVER_COL_X, serverY(i, serverCount)]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      aria-label="Pool lane diagram — clients left column, servers right column, animated query pulses along connection lanes"
      style={{ display: "block" }}
    >
      {/* Active connection lines */}
      {clients.map((c) => {
        if (c.currentServer === null) return null;
        const [cx, cy] = clientCenters[c.id];
        const si = servers.findIndex((s) => s.id === c.currentServer);
        if (si < 0) return null;
        const [sx, sy] = serverCenters[si];
        return (
          <line
            key={`link-${c.id}`}
            x1={cx + CLIENT_W / 2}
            y1={cy}
            x2={sx - SERVER_W / 2}
            y2={sy}
            stroke="var(--color-rule)"
            strokeWidth={1}
            opacity={0.7}
          />
        );
      })}

      {/* Query pulse dots */}
      {pulses.map((p) => {
        const ci = p.clientId;
        const si = servers.findIndex((s) => s.id === p.serverId);
        if (ci < 0 || ci >= clientCount || si < 0) return null;
        const [cx, cy] = clientCenters[ci];
        const [sx, sy] = serverCenters[si];
        const x1 = cx + CLIENT_W / 2;
        const y1 = cy;
        const x2 = sx - SERVER_W / 2;
        const y2 = sy;
        const x = x1 + (x2 - x1) * p.progress;
        const y = y1 + (y2 - y1) * p.progress;
        return <circle key={`pulse-${p.clientId}`} cx={x} cy={y} r={5} fill="var(--color-entity)" opacity={0.9} />;
      })}

      {/* Client squares */}
      {clients.map((c, i) => {
        const [cx, cy] = clientCenters[i];
        const fill = clientFill(c.state);
        return (
          <rect
            key={`c-${c.id}`}
            x={cx - CLIENT_W / 2}
            y={cy - CLIENT_H / 2}
            width={CLIENT_W}
            height={CLIENT_H}
            rx={3}
            fill={fill}
            opacity={c.state === "idle" ? 0.45 : 1}
          />
        );
      })}

      {/* Server rounded rects */}
      {servers.map((s, i) => {
        const [sx, sy] = serverCenters[i];
        const fill = serverFill(s.state);
        return (
          <rect
            key={`s-${s.id}`}
            x={sx - SERVER_W / 2}
            y={sy - SERVER_H / 2}
            width={SERVER_W}
            height={SERVER_H}
            rx={6}
            fill={fill}
            opacity={s.state === "idle" ? 0.45 : 1}
          />
        );
      })}
    </svg>
  );
}
