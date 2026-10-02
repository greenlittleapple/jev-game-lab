// Version chart: how far each run got, grouped by version, with game milestones marked on the
// axis. Renders light and dark SVGs and a Markdown table from a data file:
//   {game, unit, max, milestones: [{value, label}], groups: [{id, label}],
//    versions: [{name, policy, group, added, runs: [{run, seed, result, value, issues}]}], issues: [{id, label, fixed}], notes: []}
// issues: known bugs that affected runs; a run's optional issues lists their IDs. The table marks such a run with
// each issue's letter (its position in data.issues) and lists the letters used under it; the chart draws its dot hollow.
// result: won, lost, in progress, or stopped (the run ended without a result, e.g. the runner stopped);
// runs in progress or stopped are listed in the table but not plotted.
// An optional runNote(run) returns a short note shown after a run's value (BTD6: the lives left), or null;
// an optional tableNote(run) adds to it in the table only (BTD6: the speed).
// A version's optional rate {won, of, median, speed, factors} (BTD6: winRate in integration/btd6/progress.mjs) starts its
// table cell as "**3 of 5 won**, median round 80 (speed, factors): " and follows its run count in the chart.
// The SVG is at least 960 wide and widens so the longest result label fits; the subtitle and notes wrap to its width.
// Adapted from integration/sts2/progress-chart.mjs in jev-spire-strategist, where the value was
// the floor reached and the milestones were the boss floors.
export const THEMES = {
 light: {surface: '#fcfcfb', text: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', track: 0.35, series: ['#2a78d6', '#eb6834', '#8a4fd1'], good: '#0ca30c', goodText: '#006300'},
 dark: {surface: '#1a1a19', text: '#ffffff', secondary: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', track: 0.5, series: ['#3987e5', '#d95926', '#a37be6'], good: '#0ca30c', goodText: '#0ca30c'},
};
const FONT = `system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`;
const MIN_W = 960, LEFT = 24, RIGHT = 24;
// A conservative width estimate for system-ui text: wide enough for digits, capitals and bold.
const textWidth = (s, size) => [...String(s)].length * size * 0.62;
const wrapTo = (s, width, size) => wrap(s, Math.floor(width / (size * 0.55)));

const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (x, y, content, {size = 13, weight = 400, fill, anchor = 'start'} = {}) =>
 `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${content}</text>`;
function wrap(s, max) {
 const lines = [''];
 for (const word of s.split(' ')) {
  if (lines.at(-1) && (lines.at(-1) + ' ' + word).length > max) lines.push(word);
  else lines[lines.length - 1] = lines.at(-1) ? lines.at(-1) + ' ' + word : word;
 }
 return lines;
}
// A bar growing right from x0, square at the baseline and rounded at the data end.
const bar = (x0, x1, cy, h, fill, opacity = 1) => {
 const r = Math.min(h / 2, 4, Math.max(0, x1 - x0)), top = cy - h / 2, bottom = cy + h / 2;
 return `<path d="M${x0},${top} H${x1 - r} A${r},${r} 0 0 1 ${x1},${top + r} V${bottom - r} A${r},${r} 0 0 1 ${x1 - r},${bottom} H${x0} Z" fill="${fill}" fill-opacity="${opacity}"/>`;
};
const svg = (W, height, title, desc, t, body) =>
 `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="t d" font-family="${FONT}">\n`
 + `<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>\n`
 + `<rect width="${W}" height="${height}" rx="12" fill="${t.surface}"/>\n${body.join('\n')}\n</svg>\n`;

// The letter for an issue ID: a for the first in data.issues, b for the second, and so on.
export function issueMarker(data, id) {
 const i = (data.issues ?? []).findIndex(x => x.id === id);
 if (i < 0) throw Error(`Unknown issue ${id}; add it to issues.`);
 return String.fromCharCode(97 + i);
}
const affected = r => (r.issues?.length ?? 0) > 0;
const finished = v => v.runs.filter(r => r.value != null && r.result !== 'in progress' && r.result !== 'stopped');

export function progressSvg(data, t) {
 const X0 = 590, X1 = 870;
 const max = data.max ?? Math.max(1, ...data.milestones.map(m => m.value));
 const x = v => X0 + (X1 - X0) * Math.min(v, max) / max;
 // The result label after each row's bar: its best value, "✓ won" and the run note.
 const label = v => { const done = finished(v); if (!done.length) return '';
  const best = Math.max(...done.map(r => r.value)), won = done.some(r => r.result === 'won' && r.value === best);
  const note = data.runNote?.(done.find(r => r.value === best && (!won || r.result === 'won')));
  return `${best}${won ? ' ✓ won' : ''}${note ? ` · ${note}` : ''}`; };
 const W = Math.ceil(Math.max(MIN_W, ...data.versions.map(v => x(Math.max(0, ...finished(v).map(r => r.value))) + 12 + textWidth(label(v), 13) + RIGHT)));
 const hollow = data.versions.some(v => finished(v).some(affected));
 const subtitle = wrapTo(`${data.game}. Each dot is one run, green if it won; the bar reaches the best run.`, W - LEFT - RIGHT, 14);
 const body = [text(LEFT, 40, 'How far each version got', {size: 20, weight: 600, fill: t.text}),
  ...subtitle.map((line, i) => text(LEFT, 64 + 20 * i, esc(line), {size: 14, fill: t.secondary}))];
 let off = 20 * (subtitle.length - 1);
 if (hollow) { body.push(text(LEFT, 84 + off, 'Hollow dots: runs affected by a known issue (see the table notes).', {size: 13, fill: t.secondary})); off += 20; }
 for (const m of data.milestones) {
  body.push(text(x(m.value), 100 + off, esc(m.label), {size: 13, weight: 600, fill: t.secondary, anchor: 'middle'}),
   text(x(m.value), 117 + off, esc(`${data.unit} ${m.value}`), {size: 12, fill: t.muted, anchor: 'middle'}));
 }
 let y = 130 + off;
 const rows = [], top = y;
 if (!data.versions.length) { rows.push(text(LEFT, y + 26, 'No runs yet.', {size: 14, fill: t.secondary})); y += 40; }
 for (const [gi, g] of data.groups.entries()) {
  const versions = data.versions.filter(v => v.group === g.id);
  if (!versions.length) continue;
  const color = t.series[gi % t.series.length];
  rows.push(`<circle cx="${LEFT + 6}" cy="${y + 21}" r="6" fill="${color}"/>`, text(LEFT + 20, y + 26, esc(g.label), {size: 14, weight: 600, fill: t.text}));
  y += 38;
  for (const v of versions) {
   const done = finished(v), lines = wrap(v.added, 88);
   // Tall enough for its text and for its tallest stack of same-value dots (7 apart).
   const stack = Math.max(0, ...[...Map.groupBy(done, r => r.value).values()].map(g => g.length));
   const h = Math.max(26 + 18 * lines.length + 8, 7 * stack + 14), cy = y + h / 2;
   rows.push(`<text x="${LEFT}" y="${y + 18}" font-size="15"><tspan font-weight="600" fill="${t.text}">${esc(v.name)}</tspan><tspan fill="${t.muted}" font-size="13"> · ${done.length} run${done.length === 1 ? '' : 's'}${v.rate ? ` · ${esc(rateText(data, v.rate))}` : ''}</tspan></text>`);
   lines.forEach((line, i) => rows.push(text(LEFT, y + 38 + 18 * i, esc(line), {size: 13.5, fill: t.secondary})));
   if (done.length) {
    // The bar reaches the best finished run, including one affected by a known issue: a choice, so that the bar
    // and the dots always agree; the hollow dot and the table notes say which results a bug affected.
    const best = Math.max(...done.map(r => r.value));
    rows.push(bar(X0, x(best), cy, 6, color, t.track));
    // Runs with the same value stack vertically around the row. A win is a larger green dot, drawn on top.
    const dots = [...Map.groupBy(done, r => r.value).values()]
     .flatMap(same => same.map((r, i) => ({r, dy: (i - (same.length - 1) / 2) * 7})))
     .sort((a, b) => (a.r.result === 'won') - (b.r.result === 'won'));
    for (const {r, dy} of dots) {
     const won = r.result === 'won';
     const fill = won ? t.good : color;
     // A run affected by a known issue: hollow, outlined in its colour.
     rows.push(affected(r) ? `<circle cx="${x(r.value)}" cy="${cy + dy}" r="${won ? 5.5 : 3.5}" fill="${t.surface}" stroke="${fill}" stroke-width="2"/>`
      : `<circle cx="${x(r.value)}" cy="${cy + dy}" r="${won ? 6.5 : 4.5}" fill="${fill}" stroke="${t.surface}" stroke-width="2"/>`);
    }
    const won = done.some(r => r.result === 'won' && r.value === best);
    const note = data.runNote?.(done.find(r => r.value === best && (!won || r.result === 'won')));
    rows.push(`<text x="${x(best) + 12}" y="${cy + 5}" font-size="13" font-weight="600"><tspan fill="${t.text}">${best}</tspan>`
     + `${won ? `<tspan fill="${t.goodText}"> ✓ won</tspan>` : ''}${note ? `<tspan fill="${t.muted}" font-weight="400"> · ${esc(note)}</tspan>` : ''}</text>`);
   }
   y += h;
  }
  y += 6;
 }
 const guides = [`<line x1="${X0}" y1="${top}" x2="${X0}" y2="${y}" stroke="${t.axis}" stroke-width="1"/>`,
  ...data.milestones.map(m => `<line x1="${x(m.value)}" y1="${top}" x2="${x(m.value)}" y2="${y}" stroke="${t.grid}" stroke-width="1"/>`)];
 body.push(...guides, ...rows);
 y += 8;
 for (const note of data.notes ?? []) for (const line of wrapTo(note, W - LEFT - RIGHT, 12.5)) { y += 18; body.push(text(LEFT, y, esc(line), {size: 12.5, fill: t.muted})); }
 const plotted = data.versions.map(v => v.runs.length ? `${v.name}: best ${data.unit} ${Math.max(0, ...finished(v).map(r => r.value))}` : `${v.name}: no runs yet`).join('; ') || 'No runs yet';
 return svg(W, y + 24, 'How far each version got', plotted, t, body);
}

const rateText = (data, r) => `${r.won} of ${r.of} won, median ${data.unit} ${r.median}`;

// Markdown table view of the chart.
export function progressTable(data) {
 const value = r => r.result === 'in progress' ? `in progress (${data.unit} ${r.value})` : r.result === 'stopped' ? `stopped at ${data.unit} ${r.value}` : r.result === 'won' ? `won (${data.unit} ${r.value})` : String(r.value);
 const cell = r => { const note = [data.runNote?.(r), data.tableNote?.(r)].filter(Boolean).join(', '); return `${r.seed ? `${r.seed}: ` : ''}${value(r)}${note ? ` (${note})` : ''}`; };
 const marks = r => affected(r) ? `<sup>${r.issues.map(id => issueMarker(data, id)).join(',')}</sup>` : '';
 const rate = v => v.rate ? `**${v.rate.won} of ${v.rate.of} won**, median ${data.unit} ${v.rate.median} (${v.rate.speed}, ${v.rate.factors}): ` : '';
 const runs = v => rate(v) + v.runs.map(r => (r.result === 'won' ? `**${cell(r)}**` : cell(r)) + marks(r)).join(', ') || '-';
 // Under the table, the issues its runs are marked with, in letter order.
 const used = new Set(data.versions.flatMap(v => v.runs.flatMap(r => r.issues ?? [])));
 const notes = (data.issues ?? []).filter(i => used.has(i.id))
  .map(i => `- <sup>${issueMarker(data, i.id)}</sup> ${i.label}${i.fixed && i.fixed !== '-' ? ` Fixed: ${i.fixed}` : ''}`);
 return [`| Version | Final ${data.unit} of each run | What it added |`, '|---|---|---|',
  ...data.versions.map(v => `| ${v.name} (\`${v.policy}\`) | ${runs(v)} | ${v.added} |`), ...(notes.length ? ['', ...notes] : [])].join('\n');
}

// Indented JSON with each innermost object (a run, a milestone) on one line.
// Arrays of plain values (a run's issues) go on one line first, so a run with issues stays on one line.
export const compactJson = data => JSON.stringify(data, null, 1)
 .replace(/\[\n\s+([^{}[\]]*?)\n\s+\]/g, (_, inner) => `[${inner.replace(/\n\s+/g, ' ')}]`)
 .replace(/\{\n\s+([^{}]*?)\n\s+\}/g, (_, inner) => `{${inner.replace(/\n\s+/g, ' ')}}`) + '\n';
