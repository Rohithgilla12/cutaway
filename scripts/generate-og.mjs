import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrap(title, max = 26) {
  const lines = [];
  let line = "";
  for (const word of title.split(/\s+/)) {
    if (line && (line + " " + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function postSvg({ number, title }) {
  const num = String(number).padStart(2, "0");
  const lines = wrap(title);
  const fontSize = lines.length > 2 ? 56 : 64;
  const lineHeight = fontSize * 1.25;
  const blockTop = 300 - ((lines.length - 1) * lineHeight) / 2;
  const titleText = lines
    .map(
      (l, i) =>
        `<text x="64" y="${Math.round(blockTop + i * lineHeight)}" font-family="monospace" font-size="${fontSize}" font-weight="600" letter-spacing="-2" fill="#16181a">${esc(l)}</text>`,
    )
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fcfcfa" />
  <rect x="40" y="40" width="1120" height="550" fill="none" stroke="#16181a" stroke-width="2" />
  <line x1="40" y1="110" x2="1160" y2="110" stroke="#16181a" stroke-width="2" />
  <text x="64" y="84" font-family="monospace" font-size="22" letter-spacing="2" fill="#16181a">CUTAWAY/${num}</text>
  <text x="1136" y="84" font-family="monospace" font-size="22" letter-spacing="2" fill="#6b6f76" text-anchor="end">INTERACTIVE</text>
  ${titleText}
  <text x="64" y="${Math.round(blockTop + lines.length * lineHeight + 16)}" font-family="sans-serif" font-size="30" fill="#3f4347">Break it yourself and watch what happens.</text>
  <g>
    <rect x="64" y="470" width="36" height="36" fill="#1a7f4b" />
    <rect x="112" y="470" width="36" height="36" fill="#1a7f4b" />
    <rect x="160" y="470" width="36" height="36" fill="#b07d10" />
    <rect x="208" y="470" width="36" height="36" fill="none" stroke="#8a8f98" stroke-width="2" stroke-dasharray="6 4" />
  </g>
  <text x="1136" y="552" font-family="monospace" font-size="24" fill="#6b6f76" text-anchor="end">cutaway.gilla.fun</text>
</svg>`;
}

await sharp("assets/og.svg").png().toFile("public/og.png");
console.log("wrote public/og.png");

mkdirSync("public/og", { recursive: true });
const base = "src/content/explainers";
const slugs = readdirSync(base, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
for (const slug of slugs) {
  const fm = readFileSync(`${base}/${slug}/index.mdx`, "utf8").split("---")[1] ?? "";
  const title = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const number = fm.match(/^number:\s*(\d+)/m)?.[1];
  if (!title || !number) {
    console.error(`skipping ${slug}: missing title or number in frontmatter`);
    continue;
  }
  await sharp(Buffer.from(postSvg({ number, title }))).png().toFile(`public/og/${slug}.png`);
  console.log(`wrote public/og/${slug}.png`);
}
