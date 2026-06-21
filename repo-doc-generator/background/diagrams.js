// RepoDocs AI — SVG diagram builders. Pure string generation, no DOM. ES module, imported by background.js.
// Output SVGs are later rasterized to PNG by offscreen/offscreen.js (canvas needs a DOM, which a service worker lacks).

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- Repository structure tree diagram ----------

function buildFolderTree(tree) {
  const root = { name: '', children: new Map(), type: 'tree' };
  for (const entry of tree) {
    const parts = entry.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const key = parts[i];
      if (!node.children.has(key)) {
        node.children.set(key, { name: key, children: new Map(), type: isLast ? entry.type : 'tree' });
      }
      node = node.children.get(key);
    }
  }
  return root;
}

// Flattens the tree into rows: { depth, name, type, lastChild[] } for SVG layout, capped for readability.
function flattenTree(root, maxDepth = 3, maxChildrenPerNode = 7) {
  const rows = [];
  function walk(node, depth) {
    if (depth > maxDepth) return;
    const entries = [...node.children.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const shown = entries.slice(0, maxChildrenPerNode);
    const hidden = entries.length - shown.length;
    for (const child of shown) {
      rows.push({ depth, name: child.name, type: child.type });
      if (child.type === 'tree') walk(child, depth + 1);
    }
    if (hidden > 0) rows.push({ depth, name: `+ ${hidden} more`, type: 'more' });
  }
  walk(root, 0);
  return rows;
}

export function buildStructureDiagram(tree, repoName) {
  const root = buildFolderTree(tree);
  const rows = flattenTree(root).slice(0, 60);
  const rowH = 26;
  const indent = 28;
  const padTop = 50;
  const width = 920;
  const height = padTop + rows.length * rowH + 30;

  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  lines.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#0f1117"/>`);
  lines.push(`<text x="24" y="32" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" fill="#fbbf24">${esc(repoName)}/</text>`);

  rows.forEach((row, i) => {
    const y = padTop + i * rowH;
    const x = 24 + row.depth * indent;
    let icon, color;
    if (row.type === 'tree') { icon = '\u{1F4C1}'; color = '#f59e0b'; }
    else if (row.type === 'more') { icon = '…'; color = '#64748b'; }
    else { icon = '\u{1F4C4}'; color = '#94a3b8'; }
    lines.push(`<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="${color}">${icon}  ${esc(row.name)}</text>`);
  });

  lines.push('</svg>');
  return lines.join('\n');
}

// ---------- Feature / functionality mindmap ----------

// items: [{ label, children?: string[] }] — up to 8 branches drawn radially around the center.
export function buildMindmap(centerLabel, items) {
  const width = 980;
  const height = 760;
  const cx = width / 2;
  const cy = height / 2;
  const branchRadius = 230;
  const branches = items.slice(0, 8);
  const n = branches.length || 1;

  const palette = ['#fbbf24', '#f59e0b', '#fb923c', '#facc15', '#eab308', '#fde68a', '#f97316', '#fcd34d'];

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#0f1117"/>`);

  branches.forEach((branch, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const bx = cx + branchRadius * Math.cos(angle);
    const by = cy + branchRadius * Math.sin(angle);
    const color = palette[i % palette.length];

    parts.push(`<line x1="${cx}" y1="${cy}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="2.5" stroke-opacity="0.7"/>`);

    const label = esc(branch.label || '');
    const boxW = Math.max(120, label.length * 7.5 + 24);
    parts.push(`<rect x="${bx - boxW / 2}" y="${by - 18}" width="${boxW}" height="36" rx="10" fill="#1e2535" stroke="${color}" stroke-width="2"/>`);
    parts.push(`<text x="${bx}" y="${by + 5}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="#e2e8f0">${label}</text>`);

    const children = (branch.children || []).slice(0, 3);
    children.forEach((child, j) => {
      const cAngle = angle + (j - (children.length - 1) / 2) * 0.32;
      const cr = branchRadius + 110;
      const ccx = cx + cr * Math.cos(cAngle);
      const ccy = cy + cr * Math.sin(cAngle);
      parts.push(`<line x1="${bx}" y1="${by}" x2="${ccx}" y2="${ccy}" stroke="${color}" stroke-width="1.5" stroke-opacity="0.45"/>`);
      const clabel = esc(child);
      const cw = Math.max(90, clabel.length * 6.2 + 16);
      parts.push(`<rect x="${ccx - cw / 2}" y="${ccy - 13}" width="${cw}" height="26" rx="8" fill="#161b27" stroke="${color}" stroke-opacity="0.6" stroke-width="1.5"/>`);
      parts.push(`<text x="${ccx}" y="${ccy + 4}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="10.5" fill="#94a3b8">${clabel}</text>`);
    });
  });

  // Center node drawn last so its connector lines sit underneath it.
  const centerText = esc(centerLabel);
  const centerW = Math.max(160, centerText.length * 9 + 40);
  parts.push(`<rect x="${cx - centerW / 2}" y="${cy - 26}" width="${centerW}" height="52" rx="14" fill="#0f1117" stroke="#fbbf24" stroke-width="3"/>`);
  parts.push(`<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" fill="#fbbf24">${centerText}</text>`);

  parts.push('</svg>');
  return parts.join('\n');
}
