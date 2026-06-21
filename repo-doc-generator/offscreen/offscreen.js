// RepoDocs AI — offscreen document. Classic script (loaded after vendored jspdf/docx UMD bundles),
// so it can use window.jspdf / window.docx globals that an MV3 module service worker cannot load directly.
// Also the only context with a real DOM, used for: SVG rasterization, full-page screenshot stitching,
// raw image measuring, and assembling the final PDF/DOCX from a flat list of content blocks.

const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = src;
  });
}

async function svgToPng(svgString) {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function measureDataUrl(dataUrl) {
  const img = await loadImage(dataUrl);
  return { dataUrl, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
}

// Stitches scroll-captured visible-tab slices into one tall PNG (full-page screenshot).
async function stitchSlices({ slices, viewportWidth, viewportHeight, scrollHeight }) {
  const first = await loadImage(slices[0].dataUrl);
  const dpr = (first.naturalWidth || first.width) / viewportWidth;
  const canvasW = Math.round(viewportWidth * dpr);
  const canvasH = Math.round(scrollHeight * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  for (const slice of slices) {
    const img = slice === slices[0] ? first : await loadImage(slice.dataUrl);
    ctx.drawImage(img, 0, Math.round(slice.y * dpr));
  }

  return { dataUrl: canvas.toDataURL('image/png'), width: canvasW, height: canvasH };
}

// Crops a captured visible-tab screenshot to a CSS-pixel rect (scaled by the page's devicePixelRatio).
async function cropToRect({ dataUrl, rect }) {
  const img = await loadImage(dataUrl);
  const dpr = rect.dpr || 1;
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.round(rect.width * dpr);
  const sh = Math.round(rect.height * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return { dataUrl: canvas.toDataURL('image/png'), width: sw, height: sh };
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fitImage(maxW, maxH, w, h) {
  const ratio = Math.min(maxW / w, maxH / h, 1);
  return { w: w * ratio, h: h * ratio };
}

// Splits a section's text into renderable lines: { bullet:boolean, text }.
function splitParagraphs(text) {
  return (text || '')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => {
      const bullet = /^([-*•]|\d+[.)])\s+/.test(p);
      return { bullet, text: p.replace(/^([-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '') };
    });
}

// ---------- PDF (flowing layout) ----------
function buildPdf({ cover, blocks, footerLabel }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  let y = 0;
  let pageNum = 1;

  function footer() {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(footerLabel, MARGIN, PAGE_H - 28);
    doc.text(String(pageNum), PAGE_W - MARGIN, PAGE_H - 28, { align: 'right' });
  }

  function newContentPage() {
    doc.addPage();
    pageNum++;
    // slim running header
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.text(cover.title, MARGIN, 34);
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(1.5);
    doc.line(MARGIN, 40, PAGE_W - MARGIN, 40);
    y = 62;
    footer();
  }

  function ensure(h) {
    if (y + h > PAGE_H - 50) newContentPage();
  }

  function heading(text) {
    ensure(34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.setTextColor(180, 83, 9);
    doc.text(text, MARGIN, y);
    y += 7;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 14;
  }

  function bodyText(text) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(40, 40, 40);
    const lh = 14;
    for (const para of splitParagraphs(text)) {
      const indent = para.bullet ? 14 : 0;
      const lines = doc.splitTextToSize(para.text, CONTENT_W - indent);
      lines.forEach((line, idx) => {
        ensure(lh);
        if (para.bullet && idx === 0) {
          doc.setTextColor(180, 83, 9);
          doc.text('•', MARGIN, y);
          doc.setTextColor(40, 40, 40);
        }
        doc.text(line, MARGIN + indent, y);
        y += lh;
      });
      y += para.bullet ? 3 : 6;
    }
    y += 4;
  }

  function factsBlock(items) {
    const cardPad = 12;
    const lineH = 16;
    const rows = Math.ceil(items.length / 2);
    const cardH = cardPad * 2 + rows * lineH;
    ensure(cardH + 8);
    doc.setFillColor(247, 248, 250);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.6);
    doc.roundedRect(MARGIN, y, CONTENT_W, cardH, 6, 6, 'FD');
    const colW = CONTENT_W / 2;
    let cx = MARGIN + cardPad;
    let cy = y + cardPad + 10;
    items.forEach((pair, i) => {
      const col = i % 2;
      const x = MARGIN + cardPad + col * colW;
      const ry = cy + Math.floor(i / 2) * lineH;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`${pair[0]}: `, x, ry);
      const labelW = doc.getTextWidth(`${pair[0]}: `);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 30, 30);
      doc.text(doc.splitTextToSize(String(pair[1]), colW - cardPad - labelW)[0] || '', x + labelW, ry);
    });
    void cx;
    y += cardH + 14;
  }

  function diagramBlock(title, img, caption) {
    if (!img) return;
    heading(title);
    const avail = PAGE_H - 50 - y;
    let { w, h } = fitImage(CONTENT_W, Math.min(avail, 460), img.width, img.height);
    if (h > avail - 24) {
      newContentPage();
      ({ w, h } = fitImage(CONTENT_W, Math.min(PAGE_H - 50 - y, 460), img.width, img.height));
    }
    const x = MARGIN + (CONTENT_W - w) / 2;
    doc.addImage(img.dataUrl, 'PNG', x, y, w, h);
    y += h + 8;
    if (caption) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(120, 120, 120);
      doc.text(caption, PAGE_W / 2, y, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      y += 16;
    }
    y += 6;
  }

  // Two-up image grid; size-adjusted so multiple screenshots share a page.
  function galleryBlock(title, images) {
    if (!images?.length) return;
    heading(title);
    const cols = 2;
    const gap = 14;
    const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
    const cellMaxH = 190;
    let col = 0;
    let rowTop = y;
    let rowH = 0;

    for (const im of images) {
      if (col === 0) {
        ensure(cellMaxH + 34);
        rowTop = y;
        rowH = 0;
      }
      const { w, h } = fitImage(cellW, cellMaxH, im.width, im.height);
      const cellX = MARGIN + col * (cellW + gap);
      const x = cellX + (cellW - w) / 2;
      doc.addImage(im.dataUrl, 'PNG', x, rowTop, w, h);
      let bottom = rowTop + h;
      if (im.caption) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        const cl = doc.splitTextToSize(im.caption, cellW).slice(0, 2);
        doc.text(cl, cellX + cellW / 2, rowTop + h + 11, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        bottom += 4 + cl.length * 10;
      }
      rowH = Math.max(rowH, bottom - rowTop);
      col++;
      if (col >= cols) {
        col = 0;
        y = rowTop + rowH + 16;
      }
    }
    if (col !== 0) y = rowTop + rowH + 16;
  }

  // ---- Cover ----
  doc.setFillColor(15, 17, 23);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  doc.setTextColor(251, 191, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('Project Documentation', PAGE_W / 2, 320, { align: 'center' });
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text(doc.splitTextToSize(cover.title, 460), PAGE_W / 2, 360, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(180, 180, 180);
  const desc = doc.splitTextToSize(cover.subtitle || 'AI-generated developer breakdown.', 420);
  doc.text(desc, PAGE_W / 2, 400, { align: 'center' });
  doc.setFontSize(10);
  doc.setTextColor(140, 140, 140);
  doc.text(cover.generatedLabel, PAGE_W / 2, PAGE_H - 60, { align: 'center' });

  // ---- Content (flowing) ----
  newContentPage();
  for (const block of blocks) {
    if (block.type === 'facts') factsBlock(block.items);
    else if (block.type === 'section') { heading(block.title); bodyText(block.text); }
    else if (block.type === 'diagram') diagramBlock(block.title, block.image, block.caption);
    else if (block.type === 'gallery') galleryBlock(block.title, block.images);
  }

  return doc.output('datauristring');
}

// ---------- DOCX (flowing layout) ----------
async function buildDocx({ cover, blocks, footerLabel }) {
  const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, PageBreak } = window.docx;

  function heading(text) {
    return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 160, after: 120 } });
  }
  function paras(text) {
    const out = [];
    for (const p of splitParagraphs(text)) {
      out.push(new Paragraph({
        children: [new TextRun(p.text)],
        bullet: p.bullet ? { level: 0 } : undefined,
        spacing: { after: p.bullet ? 60 : 140 },
      }));
    }
    if (!out.length) out.push(new Paragraph({ text: '' }));
    return out;
  }
  function factsParas(items) {
    return items.map(([k, v]) => new Paragraph({
      children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(String(v))],
      spacing: { after: 40 },
    }));
  }
  function imagePara(img, caption, maxW) {
    const ratio = Math.min(maxW / img.width, 1);
    const blocks2 = [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ type: 'png', data: dataUrlToUint8Array(img.dataUrl), transformation: { width: img.width * ratio, height: img.height * ratio } })],
      spacing: { after: caption ? 40 : 160 },
    })];
    if (caption) blocks2.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: caption, italics: true, size: 18 })], spacing: { after: 160 } }));
    return blocks2;
  }

  const children = [
    new Paragraph({ text: 'Project Documentation', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: cover.title, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: cover.subtitle || 'AI-generated developer breakdown.', alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
    new Paragraph({ text: cover.generatedLabel, alignment: AlignmentType.CENTER, spacing: { after: 400 } }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  for (const block of blocks) {
    if (block.type === 'facts') {
      children.push(...factsParas(block.items));
    } else if (block.type === 'section') {
      children.push(heading(block.title), ...paras(block.text));
    } else if (block.type === 'diagram') {
      if (block.image) children.push(heading(block.title), ...imagePara(block.image, block.caption, 520));
    } else if (block.type === 'gallery') {
      if (block.images?.length) {
        children.push(heading(block.title));
        for (const im of block.images) children.push(...imagePara(im, im.caption, 300));
      }
    }
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  return blobToDataUrl(blob);
}

// ---------- message handling ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;

  (async () => {
    try {
      if (msg.type === 'rasterize-svgs') {
        const result = {};
        for (const { key, svg } of msg.payload.items) result[key] = await svgToPng(svg);
        sendResponse({ result });
      } else if (msg.type === 'measure') {
        const result = await Promise.all(msg.payload.dataUrls.map(measureDataUrl));
        sendResponse({ result });
      } else if (msg.type === 'stitch') {
        const result = await stitchSlices(msg.payload);
        sendResponse({ result });
      } else if (msg.type === 'crop') {
        const result = await cropToRect(msg.payload);
        sendResponse({ result });
      } else if (msg.type === 'build-pdf') {
        const result = buildPdf(msg.payload);
        sendResponse({ result });
      } else if (msg.type === 'build-docx') {
        const result = await buildDocx(msg.payload);
        sendResponse({ result });
      } else {
        sendResponse({ error: 'Unknown offscreen message type: ' + msg.type });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true;
});
