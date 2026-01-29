const express = require('express');
const cors = require('cors');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

const PORT = Number(process.env.CITRIX_CAPTURE_PORT || 3177);

const app = express();
app.use(express.json({ limit: '10mb' }));

let worker = null;
let workerLang = null;

async function getOcrWorker(preferredLang) {
  const lang = String(preferredLang || '').trim() || 'por';
  if (worker && workerLang === lang) return worker;

  if (worker) {
    try {
      await worker.terminate();
    } catch {
      // ignore
    }
    worker = null;
    workerLang = null;
  }

  const w = await createWorker(lang);
  worker = w;
  workerLang = lang;
  return worker;
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normalizeRegion(r) {
  const x = clamp01(r?.x);
  const y = clamp01(r?.y);
  const w = clamp01(r?.w);
  const h = clamp01(r?.h);

  // Ensure positive area.
  const ww = Math.max(0.001, w);
  const hh = Math.max(0.001, h);

  // Keep within bounds.
  const xx = Math.min(x, 1 - 0.001);
  const yy = Math.min(y, 1 - 0.001);
  const maxW = 1 - xx;
  const maxH = 1 - yy;
  return {
    x: xx,
    y: yy,
    w: Math.min(ww, maxW),
    h: Math.min(hh, maxH),
  };
}

async function cropForOcr(pngBuffer, region01) {
  const meta = await sharp(pngBuffer).metadata();
  const imgW = Number(meta.width) || 0;
  const imgH = Number(meta.height) || 0;
  if (!imgW || !imgH) throw new Error('invalid_image_dimensions');

  const r = normalizeRegion(region01);
  const left = Math.max(0, Math.floor(r.x * imgW));
  const top = Math.max(0, Math.floor(r.y * imgH));
  const width = Math.max(1, Math.floor(r.w * imgW));
  const height = Math.max(1, Math.floor(r.h * imgH));

  // Preprocess for OCR: crop -> resize -> grayscale -> normalize.
  // Keep it conservative to avoid blowing up artifacts.
  const resizedW = Math.min(2200, Math.max(300, width * 2));

  return sharp(pngBuffer)
    .extract({ left, top, width: Math.min(width, imgW - left), height: Math.min(height, imgH - top) })
    .resize({ width: resizedW, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
}

function pickSgss(text) {
  const t = String(text || '');
  const m = t.match(/\bSGSS\s*\d{6,}\b/i);
  if (!m) return '';
  return m[0].replace(/\s+/g, '').toUpperCase();
}

function pickTipoEmpresa(text) {
  // Usually comes as a single line; clean up repeated whitespace.
  const t = String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

// The helper is bound to 127.0.0.1 only, so permissive CORS is fine and keeps UX simple.
app.use(cors());

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'citrix-capture-helper', port: PORT });
});

// Returns available displays (when supported by screenshot-desktop).
app.get('/displays', async (_req, res) => {
  try {
    const fn = screenshot && typeof screenshot.listDisplays === 'function' ? screenshot.listDisplays : null;
    if (!fn) {
      return res.json({ ok: true, displays: [] });
    }

    const displays = await fn();
    const out = Array.isArray(displays)
      ? displays.map((d, i) => ({
          index: i,
          id: d?.id,
          name: d?.name,
          width: d?.width,
          height: d?.height,
        }))
      : [];
    res.json({ ok: true, displays: out });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'displays_failed';
    res.status(500).json({ ok: false, error: msg });
  }
});

// Returns a base64 PNG screenshot.
// Body: { screen?: number|string }  (index or display id; omit for primary)
app.post('/capture', async (req, res) => {
  try {
    const rawScreen = req.body?.screen;
    const hasScreen = rawScreen !== undefined && rawScreen !== null && String(rawScreen).trim() !== '';

    let screenParam = undefined;
    let screenUsed = undefined;
    let screenIdUsed = undefined;

    if (hasScreen) {
      const asNum = Number(rawScreen);
      const isNum = Number.isFinite(asNum) && String(rawScreen).trim() !== '';
      if (isNum) {
        const idx = Math.max(0, Math.floor(asNum));
        screenUsed = idx;

        // On Windows, screenshot-desktop often expects a display id like "\\\\.\\DISPLAY2".
        const fn = screenshot && typeof screenshot.listDisplays === 'function' ? screenshot.listDisplays : null;
        if (fn) {
          const displays = await fn();
          const d = Array.isArray(displays) ? displays[idx] : null;
          if (!d) {
            return res.status(400).json({ ok: false, error: `invalid_screen_index:${idx}` });
          }
          screenIdUsed = d?.id;
          screenParam = d?.id ?? idx;
        } else {
          screenParam = idx;
        }
      } else {
        // Treat as display id.
        screenParam = String(rawScreen);
        screenIdUsed = String(rawScreen);
      }
    }

    const imgBuffer = await screenshot({ format: 'png', screen: screenParam });

    // Note: width/height are not provided by screenshot-desktop. Consumers can decode the image.
    res.json({
      ok: true,
      mime: 'image/png',
      pngBase64: imgBuffer.toString('base64'),
      screenUsed,
      screenIdUsed,
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'capture_failed';
    res.status(500).json({ ok: false, error: msg });
  }
});

// OCR extraction for two fields.
// Body:
// {
//   pngBase64: string,
//   regions: {
//     sgss: { x,y,w,h },
//     tipoEmpresa: { x,y,w,h }
//   }
// }
app.post('/extract', async (req, res) => {
  try {
    const pngBase64 = String(req.body?.pngBase64 || '').trim();
    if (!pngBase64) return res.status(400).json({ ok: false, error: 'missing_pngBase64' });

    const regions = req.body?.regions || {};
    const sgssRegion = regions.sgss;
    const tipoRegion = regions.tipoEmpresa;
    if (!sgssRegion || !tipoRegion) {
      return res.status(400).json({ ok: false, error: 'missing_regions' });
    }

    const pngBuffer = Buffer.from(pngBase64, 'base64');

    let w;
    try {
      w = await getOcrWorker('por');
    } catch {
      // Fallback in case Portuguese tessdata cannot be downloaded.
      w = await getOcrWorker('eng');
    }

    const [sgssImg, tipoImg] = await Promise.all([
      cropForOcr(pngBuffer, sgssRegion),
      cropForOcr(pngBuffer, tipoRegion),
    ]);

    const [sgssOcr, tipoOcr] = await Promise.all([
      w.recognize(sgssImg),
      w.recognize(tipoImg),
    ]);

    const sgssText = String(sgssOcr?.data?.text || '');
    const tipoText = String(tipoOcr?.data?.text || '');

    res.json({
      ok: true,
      sgss: pickSgss(sgssText),
      tipoEmpresa: pickTipoEmpresa(tipoText),
      raw: {
        sgssText,
        tipoText,
        lang: workerLang,
      },
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'extract_failed';
    res.status(500).json({ ok: false, error: msg });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[citrix-capture-helper] listening on http://127.0.0.1:${PORT}`);
  // eslint-disable-next-line no-console
  console.log('[citrix-capture-helper] POST /capture -> { pngBase64 }');
});
