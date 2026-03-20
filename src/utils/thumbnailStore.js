// src/utils/thumbnailStore.js
// Lightweight IndexedDB wrapper for storing mind map thumbnail images

const DB_NAME = 'notetaker_thumbnails';
const DB_VERSION = 1;
const STORE_NAME = 'thumbnails';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a thumbnail data URL for a mind map.
 */
export async function saveThumbnail(mindMapId, dataUrl) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id: mindMapId, dataUrl, updatedAt: Date.now() });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (err) {
    console.warn('Failed to save thumbnail:', err);
  }
}

/**
 * Get a thumbnail data URL for a mind map.
 */
export async function getThumbnail(mindMapId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(mindMapId);
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result?.dataUrl || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Delete a thumbnail.
 */
export async function deleteThumbnail(mindMapId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(mindMapId);
  } catch {
    // silent
  }
}

/**
 * Get all thumbnails at once (for batch loading on dashboard).
 */
export async function getAllThumbnails() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const map = new Map();
        (request.result || []).forEach(item => map.set(item.id, item.dataUrl));
        resolve(map);
      };
      request.onerror = () => resolve(new Map());
    });
  } catch {
    return new Map();
  }
}

/**
 * Helper: draw a rounded rect (polyfill for older browsers)
 */
function drawRoundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  // Manual fallback
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Parse translate3d(Xpx, Ypx, 0) from an inline style transform string.
 * Returns {x, y} or null.
 */
function parseTranslate3d(transformStr) {
  if (!transformStr) return null;
  const m = transformStr.match(/translate3d\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/);
  if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  const m2 = transformStr.match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/);
  if (m2) return { x: parseFloat(m2[1]), y: parseFloat(m2[2]) };
  return null;
}

/**
 * Capture a thumbnail from the mind map editor.
 * Reads world-space positions from each node's translate3d transform
 * so ALL nodes are included (zoomed-out overview), and renders text labels.
 *
 * @param {HTMLElement} outerElement - The editor's outer container
 * @param {number} [maxSize=480] - Max thumbnail dimension
 * @returns {string|null} data URL or null
 */
export function captureThumbnail(outerElement, maxSize = 480) {
  try {
    if (!outerElement) return null;

    // Find all node elements
    const nodeEls = outerElement.querySelectorAll('[data-mindmap-node]');
    if (!nodeEls || nodeEls.length === 0) return null;

    // Read world-space positions from translate3d transforms
    const nodeData = [];
    nodeEls.forEach(el => {
      const pos = parseTranslate3d(el.style.transform);
      if (!pos) return;

      const w = el.offsetWidth || 150;
      const h = el.offsetHeight || 60;
      const bgColor = el.style.backgroundColor || '#1e1e1e';
      const textColor = el.style.color || '#fff';

      // Get text content — first try span, then general textContent
      let text = '';
      const span = el.querySelector('span');
      if (span) {
        text = span.textContent || '';
      } else {
        // Could be a textarea (editing) or image
        text = el.textContent || '';
      }
      text = text.trim();

      nodeData.push({
        x: pos.x,
        y: pos.y,
        w,
        h,
        bg: bgColor,
        textColor,
        text,
        fontSize: parseFloat(el.style.fontSize) || 14,
        borderRadius: parseFloat(el.style.borderRadius) || 8,
      });
    });

    if (nodeData.length === 0) return null;

    // Compute bounding box of ALL nodes in world space
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodeData.forEach(n => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    });

    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    if (bboxW <= 0 || bboxH <= 0) return null;

    // Scale to fit within maxSize, maintaining aspect ratio
    const scale = Math.min(maxSize / bboxW, maxSize / bboxH, 2);
    const canvasW = Math.round(bboxW * scale);
    const canvasH = Math.round(bboxH * scale);

    // Use devicePixelRatio for sharp text on Retina/HiDPI displays
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = canvasW + 'px';
    canvas.style.height = canvasH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Dark background
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw each node as a rounded rectangle with text
    nodeData.forEach(n => {
      const sx = (n.x - minX) * scale;
      const sy = (n.y - minY) * scale;
      const sw = n.w * scale;
      const sh = n.h * scale;
      const sr = Math.min(n.borderRadius * scale, sw / 2, sh / 2);

      // Node background
      ctx.fillStyle = n.bg;
      drawRoundRect(ctx, sx, sy, sw, sh, sr);
      ctx.fill();

      // Subtle border
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = Math.max(1, scale * 0.5);
      ctx.stroke();

      // Draw text if node is large enough to show it
      if (n.text && sw > 20 && sh > 10) {
        const fontSize = Math.max(7, Math.min(n.fontSize * scale, sh * 0.6));
        ctx.font = `500 ${fontSize}px Inter, -apple-system, sans-serif`;
        ctx.fillStyle = n.textColor;
        ctx.textBaseline = 'middle';

        // Clip text to node bounds
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx + 2, sy + 2, sw - 4, sh - 4);
        ctx.clip();

        // Cap input text to avoid slow processing on huge text blocks
        const inputText = n.text.length > 200 ? n.text.slice(0, 200) + '…' : n.text;

        // Multi-line: split by newlines, limit lines shown
        const lineHeight = fontSize * 1.3;
        const maxLines = Math.max(1, Math.floor((sh - 4) / lineHeight));
        const allLines = inputText.split('\n').slice(0, maxLines);
        const maxTextW = sw - (8 * scale);

        // Fast binary-search truncation per line
        const truncatedLines = allLines.map(line => {
          if (ctx.measureText(line).width <= maxTextW) return line;
          let lo = 0, hi = line.length;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(line.slice(0, mid) + '…').width <= maxTextW) lo = mid;
            else hi = mid - 1;
          }
          return line.slice(0, lo) + '…';
        });

        const totalTextHeight = truncatedLines.length * lineHeight;
        const startY = sy + (sh - totalTextHeight) / 2 + lineHeight / 2;

        truncatedLines.forEach((line, i) => {
          ctx.fillText(line, sx + 4 * scale, startY + i * lineHeight);
        });

        ctx.restore();
      }
    });

    return canvas.toDataURL('image/webp', 0.7);
  } catch (err) {
    console.warn('Thumbnail capture failed:', err);
    return null;
  }
}

