// RepoDocs AI — offscreen document. Classic script (loaded after vendored jspdf/docx UMD bundles),
// so it can use window.jspdf / window.docx globals that an MV3 module service worker cannot load directly.
// Also the only context with a real DOM, used for: SVG rasterization, full-page screenshot stitching,
// raw image measuring, and HTML parsing for website analysis.

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

// Extracts title/description/headings/nav-link text from raw HTML for website-mode analysis.
function parseHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('title')?.textContent?.trim() || '';
  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim()
    || doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() || '';
  const headings = [...doc.querySelectorAll('h1, h2, h3')].map(h => h.textContent.trim()).filter(Boolean).slice(0, 25);
  const navLinks = [...doc.querySelectorAll('nav a, header a')].map(a => a.textContent.trim()).filter(Boolean).slice(0, 20);
  const textExcerpt = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 3000);
  return { title, description, headings, navLinks, textExcerpt };
}

// ---------- PDF ----------
function buildPdf({ cover, pages, footerLabel }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  function footer(pageLabel) {
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(footerLabel, MARGIN, PAGE_H - 28);
    doc.text(pageLabel, PAGE_W - MARGIN, PAGE_H - 28, { align: 'right' });
  }

  function pageHeader(title) {
    doc.addPage();
    doc.setFillColor(15, 17, 23);
    doc.rect(0, 0, PAGE_W, 70, 'F');
    doc.setTextColor(251, 191, 36);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(title, MARGIN, 45);
  }

  function sectionPage(title, text, pageNum) {
    pageHeader(title);
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(text || '', CONTENT_W);
    doc.text(lines, MARGIN, 110);
    footer(String(pageNum));
  }

  function imagePage(title, img, pageNum, captionText) {
    pageHeader(title);
    if (img) {
      const { w, h } = fitImage(CONTENT_W, PAGE_H - 200, img.width, img.height);
      const x = MARGIN + (CONTENT_W - w) / 2;
      doc.addImage(img.dataUrl, 'PNG', x, 100, w, h);
      if (captionText) {
        doc.setTextColor(110, 110, 110);
        doc.setFontSize(9);
        doc.text(captionText, PAGE_W / 2, 100 + h + 20, { align: 'center' });
      }
    }
    footer(String(pageNum));
  }

  // Cover
  doc.setFillColor(15, 17, 23);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  doc.setTextColor(251, 191, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('Project Documentation', PAGE_W / 2, 320, { align: 'center' });
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text(cover.title, PAGE_W / 2, 360, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(180, 180, 180);
  const desc = doc.splitTextToSize(cover.subtitle || 'AI-generated analysis and breakdown.', 420);
  doc.text(desc, PAGE_W / 2, 400, { align: 'center' });
  doc.setFontSize(10);
  doc.setTextColor(140, 140, 140);
  doc.text(cover.generatedLabel, PAGE_W / 2, PAGE_H - 60, { align: 'center' });

  let p = 2;
  for (const page of pages) {
    if (page.type === 'section') sectionPage(page.title, page.text, p++);
    else if (page.type === 'image') imagePage(page.title, page.image, p++, page.caption);
  }

  return doc.output('datauristring');
}

// ---------- DOCX ----------
async function buildDocx({ cover, pages, footerLabel }) {
  const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, PageBreak } = window.docx;

  function heading(text) {
    return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { after: 200 } });
  }
  function body(text) {
    return new Paragraph({ children: [new TextRun((text || '').toString())], spacing: { after: 200 } });
  }
  function image(img, caption, maxW = 480) {
    if (!img) return new Paragraph({ text: '' });
    const ratio = Math.min(maxW / img.width, 1);
    const blocks = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ type: 'png', data: dataUrlToUint8Array(img.dataUrl), transformation: { width: img.width * ratio, height: img.height * ratio } })],
      }),
    ];
    if (caption) blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: caption, italics: true, size: 18 })], spacing: { after: 200 } }));
    return blocks;
  }

  const children = [
    new Paragraph({ text: 'Project Documentation', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: cover.title, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: cover.subtitle || 'AI-generated analysis and breakdown.', alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
    new Paragraph({ text: cover.generatedLabel, alignment: AlignmentType.CENTER, spacing: { after: 600 } }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  for (const page of pages) {
    if (page.type === 'section') {
      children.push(heading(page.title), body(page.text));
    } else if (page.type === 'image') {
      children.push(heading(page.title));
      const blocks = image(page.image, page.caption);
      if (Array.isArray(blocks)) children.push(...blocks);
      else children.push(blocks);
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
      } else if (msg.type === 'parse-html') {
        const result = parseHtml(msg.payload.html);
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
