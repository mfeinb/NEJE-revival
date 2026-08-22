// Tiny dependency-free 3MF previewer used when ForgeCAD's headless renderer is
// unavailable. It makes a painter-sorted isometric SVG for visual QA.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const input = process.argv[2] ?? "enclosure/neje_dk8kz_enclosure.3mf";
const output = process.argv[3] ?? "enclosure/neje_dk8kz_enclosure-preview.svg";
const xml = execFileSync("unzip", ["-p", input, "3D/3dmodel.model"], {
  encoding: "utf8",
});

const objects = [...xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)];
const colors = ["#d98b2b", "#30343b"];
const rz = -30 * Math.PI / 180;
const rx = 58 * Math.PI / 180;

function rotate([x, y, z]) {
  const x1 = x * Math.cos(rz) - y * Math.sin(rz);
  const y1 = x * Math.sin(rz) + y * Math.cos(rz);
  return [
    x1,
    y1 * Math.cos(rx) - z * Math.sin(rx),
    y1 * Math.sin(rx) + z * Math.cos(rx),
  ];
}

function shade(hex, amount) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * amount)))).join(",")})`;
}

const faces = [];
for (const match of objects) {
  const attrs = match[1];
  const body = match[2];
  const pindex = Number(attrs.match(/pindex="(\d+)"/)?.[1] ?? 0);
  const vertices = [...body.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)]
    .map((m) => rotate([Number(m[1]), Number(m[2]), Number(m[3])]));
  for (const tri of body.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) {
    const pts = [vertices[Number(tri[1])], vertices[Number(tri[2])], vertices[Number(tri[3])]];
    const a = pts[0], b = pts[1], c = pts[2];
    const ux = b[0] - a[0], uy = b[1] - a[1];
    const vx = c[0] - a[0], vy = c[1] - a[1];
    const signed = ux * vy - uy * vx;
    const light = signed < 0 ? 1.08 : 0.72;
    faces.push({
      pts,
      depth: (a[2] + b[2] + c[2]) / 3,
      fill: shade(colors[pindex] ?? colors[0], light),
    });
  }
}

faces.sort((a, b) => a.depth - b.depth);
const all = faces.flatMap((f) => f.pts);
const minX = Math.min(...all.map((p) => p[0]));
const maxX = Math.max(...all.map((p) => p[0]));
const minY = Math.min(...all.map((p) => p[1]));
const maxY = Math.max(...all.map((p) => p[1]));
const pad = 12;
const polygons = faces.map((f) =>
  `<polygon points="${f.pts.map((p) => `${(p[0] - minX + pad).toFixed(2)},${(p[1] - minY + pad).toFixed(2)}`).join(" ")}" fill="${f.fill}" stroke="#15171a" stroke-width="0.18"/>`
).join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(maxX - minX + 2 * pad).toFixed(2)} ${(maxY - minY + 2 * pad).toFixed(2)}">
<rect width="100%" height="100%" fill="#f3f0e9"/>
<g>${polygons}</g>
</svg>\n`;
writeFileSync(output, svg);
console.log(`Wrote ${output} (${faces.length} triangles)`);
