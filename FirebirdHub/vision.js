/* =====================================================
   Firebird Hub · Spirit Fit Check (on-device vision)
   -----------------------------------------------------
   Decides — pass / no-pass, no scary percentages — whether the
   uploaded outfit matches the spirit day. Runs in the student's
   browser, nothing leaves the device.

   Brain (best): CLIP zero-shot image understanding via Transformers.js.
   It compares the photo against plain-English descriptions of each
   day ("a person in a tropical beach outfit", "camouflage clothing",
   …) and picks the closest — way smarter than matching object labels.
   Loaded on first "Check my fit"; the model caches after that.

   Fallback (offline): a lenient color / camo-pattern check so the
   feature still gives an answer with no network. It says when it fell
   back. Either way this is an ASSIST and leans generous — Spirit still
   has the final say on every point.

   Pure decision helpers (decideFromClip, colorDecision, verdictBand,
   colorStats …) take plain data so they can be unit-tested in Node.
===================================================== */
(function (root) {
  "use strict";

  /* ---- Leniency knobs (bigger = stricter). Tuned generous. ---- */
  const CLIP_FLOOR = 0.10;   // day counts if it clears this absolute score
  const CLIP_REL   = 0.42;   // …or gets within this fraction of the top theme
  const CLIP_SURE  = 0.33;   // …or is simply strong on its own
  const CLASS_COLOR_MIN = 0.10; // Tribe day: this share of the photo in class colors

  /* Class colors for "Tribe / class colors" day.
     PLACEHOLDERS — ASB Tech: set to Fremont's real grade colors. */
  const CLASS_COLORS = {
    "9":  ["#1D4ED8", "#FFFFFF"],
    "10": ["#1E6B3C", "#FFFFFF"],
    "11": ["#8F1106", "#FFFFFF"],
    "12": ["#111111", "#FFC91F"]
  };

  /* Spirit days. dayId matches the <option value> in the form.
     `prompt` is the CLIP description; `name` is what we show people. */
  const THEMES = {
    island: { name: "Island / Beach",  prompt: "a person wearing a colorful tropical Hawaiian floral beach outfit with a sun hat" },
    nerd:   { name: "Outwit / Nerd",   prompt: "a person dressed as a nerd with glasses and a buttoned or plaid shirt and suspenders" },
    camo:   { name: "Outlast / Camo",  prompt: "a person wearing green and brown camouflage army camo print clothing" },
    jersey: { name: "Outplay / Jersey",prompt: "a person wearing a sports team athletic jersey" },
    colors: { name: "Tribe / Class colors", prompt: null } // judged by class-color match, not CLIP
  };
  const CLIP_THEMES = ["island", "nerd", "camo", "jersey"];
  const DISTRACTORS = [
    "a person in plain ordinary everyday clothes",
    "a photo with no clear outfit"
  ];

  /* ================= color math (fallback) ================= */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2; const d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function hexToRgb(hex) {
    const m = hex.replace("#", "");
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  }
  function camoTone(h, s, l) {
    if (l < 0.14) return "black";
    if (l > 0.85) return null;
    if (s > 0.75) return null;
    if (h >= 60 && h <= 160 && s >= 0.08 && l <= 0.6) return "green";
    if (h >= 25 && h < 60 && s >= 0.12 && l <= 0.72) return "tan";
    if (s < 0.12 && l >= 0.3 && l <= 0.7) return "gray";
    return null;
  }
  function colorStats(img) {
    const d = img.data, counted0 = img.width * img.height;
    let satSum = 0, litSum = 0, counted = 0, sand = 0;
    const hueBins = new Array(12).fill(0);
    const camoBuckets = {}; let camoCount = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      satSum += s; litSum += l; counted++;
      if (s > 0.12 && l > 0.08 && l < 0.95) hueBins[Math.min(11, Math.floor(h / 30))]++;
      if (h >= 25 && h <= 55 && s >= 0.08 && s <= 0.45 && l >= 0.5 && l <= 0.88) sand++; // beach sand
      const ct = camoTone(h, s, l);
      if (ct) { camoCount++; camoBuckets[ct] = (camoBuckets[ct] || 0) + 1; }
    }
    if (!counted) counted = 1;
    let camoTones = 0;
    for (const k in camoBuckets) if (camoBuckets[k] / counted >= 0.05) camoTones++;
    return {
      avgSat: satSum / counted, avgLight: litSum / counted,
      hueFrac: hueBins.map(v => v / counted),
      sandFrac: sand / counted,
      camoFrac: camoCount / counted, camoTones
    };
  }
  function hueCoverage(cs, lo, hi) {
    let sum = 0;
    for (let bin = 0; bin < 12; bin++) { const c = bin * 30 + 15; if (c >= lo && c <= hi) sum += cs.hueFrac[bin]; }
    return sum;
  }
  function classColorMatch(img, colors) {
    const d = img.data; let counted = 0, hit = 0;
    const targets = colors.map(hexToRgb).map(([r, g, b]) => {
      const [h, s, l] = rgbToHsl(r, g, b);
      return { h, s, l, black: l < 0.18, white: l > 0.82 && s < 0.2 };
    });
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]); counted++;
      for (const t of targets) {
        if (t.black) { if (l < 0.2) { hit++; break; } continue; }
        if (t.white) { if (l > 0.8 && s < 0.22) { hit++; break; } continue; }
        if (s > 0.18 && hueDist(h, t.h) < 26) { hit++; break; }
      }
    }
    return counted ? hit / counted : 0;
  }

  /* ================= decisions (binary, lenient) ================= */
  // clipScores: { promptString: probability }. Returns {pass, closest}.
  function decideFromClip(dayId, clipScores, promptToTheme) {
    const themeScore = {};
    for (const p in clipScores) {
      const t = promptToTheme[p];
      if (t) themeScore[t] = Math.max(themeScore[t] || 0, clipScores[p]);
    }
    let max = 0, arg = null;
    for (const t of CLIP_THEMES) { const v = themeScore[t] || 0; if (v > max) { max = v; arg = t; } }
    const day = themeScore[dayId] || 0;
    const pass = (arg === dayId) || (day >= CLIP_SURE) || (day >= CLIP_FLOOR && day >= CLIP_REL * max);
    return { pass, closest: arg, day: day };
  }

  function colorDecision(dayId, cs, img, grade) {
    switch (dayId) {
      case "island": {
        const blue = hueCoverage(cs, 150, 260);           // teal→blue
        const warm = hueCoverage(cs, 0, 60);              // coral/pink/orange/yellow
        const beachy = blue + warm + cs.sandFrac * 0.5 + Math.max(0, cs.avgSat - 0.2);
        return { pass: beachy >= 0.16, saw: ["bright tropical / beachy colors"] };
      }
      case "camo": {
        return { pass: cs.camoFrac >= 0.22 && cs.camoTones >= 2, saw: ["earthy camo tones"] };
      }
      case "jersey": {
        return { pass: cs.avgSat >= 0.32, saw: ["bold team colors"] };
      }
      case "nerd": {
        // Color can't really judge "nerd"; be generous when we're offline.
        return { pass: true, saw: ["couldn't run the smart check, so counting it"] };
      }
      case "colors": {
        const colors = CLASS_COLORS[String(grade)] || [];
        if (!colors.length) return { pass: false, saw: ["pick your grade to check class colors"] };
        const m = classColorMatch(img, colors);
        return { pass: m >= CLASS_COLOR_MIN, saw: ["your class colors in the photo"] };
      }
      default:
        return { pass: false, saw: [] };
    }
  }

  function verdictBand(pass, dayId) {
    const label = (THEMES[dayId] && THEMES[dayId].name) || "the theme";
    if (pass) return { level: "yes", title: "You got it!",
      sub: `Looks like ${label}. Send it in for your point.` };
    return { level: "no", title: "Not quite yet",
      sub: `This doesn't look like ${label}. Double-check the day or try another photo. You can still submit for Spirit to review.` };
  }

  /* ================= browser glue ================= */
  const TFJS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
  const CLIP_MODEL = "Xenova/clip-vit-base-patch32";
  let _clip = null;

  async function getClip() {
    if (_clip) return _clip;
    _clip = (async () => {
      const mod = await import(/* @vite-ignore */ TFJS_URL);
      if (mod.env) { mod.env.allowLocalModels = false; }
      return mod.pipeline("zero-shot-image-classification", CLIP_MODEL, { dtype: "q8" });
    })().catch(e => { _clip = null; throw e; });
    return _clip;
  }

  function drawSquare(imgEl, size) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const iw = imgEl.naturalWidth || imgEl.width, ih = imgEl.naturalHeight || imgEl.height;
    const side = Math.min(iw, ih), sx = (iw - side) / 2, sy = (ih - side) / 2;
    ctx.drawImage(imgEl, sx, sy, side, side, 0, 0, size, size);
    return { canvas: c, imageData: ctx.getImageData(0, 0, size, size) };
  }

  // opts: { dayId, grade, onStage(msg) }
  async function analyzeImage(imgEl, opts) {
    opts = opts || {};
    const stage = opts.onStage || function () {};
    const dayId = opts.dayId;
    const { canvas, imageData } = drawSquare(imgEl, 224);
    const cs = colorStats(imageData);

    let pass, saw = [], engine = "color", modelError = null;

    if (dayId && dayId !== "colors" && THEMES[dayId]) {
      try {
        stage("Warming up the vision model…");
        const clf = await getClip();
        stage("Looking at the outfit…");
        // Build label set: every CLIP theme's prompt + distractors.
        const promptToTheme = {};
        const labels = [];
        for (const t of CLIP_THEMES) { promptToTheme[THEMES[t].prompt] = t; labels.push(THEMES[t].prompt); }
        for (const d of DISTRACTORS) labels.push(d);
        const url = canvas.toDataURL("image/jpeg", 0.9);
        const out = await clf(url, labels);          // [{label, score}]
        const scores = {};
        (out || []).forEach(o => { scores[o.label] = o.score; });
        const d = decideFromClip(dayId, scores, promptToTheme);
        pass = d.pass; engine = "clip";
        saw = [ (d.closest && THEMES[d.closest] ? "closest match: " + THEMES[d.closest].name.toLowerCase() : "") ].filter(Boolean);
      } catch (e) {
        modelError = e && e.message ? e.message : String(e);
      }
    }

    if (engine !== "clip") {                          // colors day, or CLIP unavailable
      const cd = colorDecision(dayId, cs, imageData, opts.grade);
      pass = cd.pass; saw = cd.saw;
    }

    return {
      pass: !!pass,
      band: verdictBand(!!pass, dayId),
      saw: saw,
      engine: engine,           // "clip" | "color"
      modelError: modelError
    };
  }

  const API = {
    THEMES, CLASS_COLORS, CLIP_THEMES, DISTRACTORS,
    analyzeImage,
    // exported for tests:
    decideFromClip, colorDecision, verdictBand, colorStats, classColorMatch, rgbToHsl, camoTone
  };
  root.SpiritVision = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
