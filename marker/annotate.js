// Comment overlay for the public Firebird Hub review copy (adapted from the website marker
// in ~/Desktop/Claude/Markers/website-marker). marker/build.mjs injects it into the review
// copy only; the real app never loads it.
//
//   Comment button or ` (backtick)   tap/click something to comment on it, or drag a box
//                                     around an area. Esc leaves comment mode.
//   ⌥ + click                         comment on one element without entering comment mode.
//
// Comments are saved by /api/marker as GitHub issues (label "marker") on the App repo.
// A comment can be edited or deleted only from the browser that wrote it (edit key in
// localStorage fh_marker_keys).
(() => {
  if (window.__astroMark) return;
  window.__astroMark = true;

  const API = "/api/marker";
  const KEYS_LS = "fh_marker_keys", NAME_LS = "fh_marker_name", INTRO_LS = "fh_marker_intro";
  const keys = (() => { try { return JSON.parse(localStorage.getItem(KEYS_LS) || "{}"); } catch { return {}; } })();
  const mine = (n) => !!(n && keys[n.n]);
  const pinClass = (n) => "pin" + (n.status === "done" ? " done" : n.kind === "keep" ? " keep" : n.kind === "bug" ? " bug" : "");
  const S = { on: false, notes: [], hoverEl: null, drag: null, swallow: false, pop: null, listOpen: false, listAll: false };

  // ---------- DOM ----------
  const host = document.createElement("astro-mark");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  *{box-sizing:border-box;margin:0;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
  [hidden]{display:none!important}
  .hl,.sel,.flash{position:fixed;pointer-events:none;border:1.5px solid #ff5a36;background:rgba(255,90,54,.07);border-radius:2px}
  .sel{background:rgba(255,90,54,.13)}
  .flash{border-width:2px;animation:fl 1.3s ease-out forwards}
  @keyframes fl{0%,40%{opacity:1}100%{opacity:0}}
  .tag{position:absolute;left:-1.5px;bottom:100%;margin-bottom:4px;background:#ff5a36;color:#fff;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}
  .hl.below .tag{bottom:auto;top:100%;margin:4px 0 0}
  .box{position:fixed;pointer-events:none;border:1.5px dashed #ff5a36;background:rgba(255,90,54,.08)}
  .hint{position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#16171a;color:#f3f3f3;font-size:12.5px;padding:8px 12px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.4);white-space:nowrap}
  .hint b{color:#ff8a6b;font-weight:600}
  .bar{position:fixed;left:14px;bottom:14px;display:flex;gap:6px;pointer-events:auto}
  .bar button{all:unset;cursor:pointer;background:#16171a;color:#e9e9ea;font-size:12.5px;font-weight:500;padding:8px 11px;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.08);display:flex;align-items:center;gap:7px}
  .bar button:hover{background:#222327}
  .bar .mark.on{background:#ff5a36;color:#fff}
  .bar kbd{font:11px ui-monospace,Menlo,monospace;opacity:.6}
  .dot{width:8px;height:8px;border-radius:50%;background:#ff5a36}
  .mark.on .dot{background:#fff}
  .pins{position:fixed;inset:0;pointer-events:none}
  .pin{position:fixed;pointer-events:auto;cursor:pointer;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#ff5a36;color:#fff;font:700 11.5px/22px -apple-system,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.5),0 0 0 2px rgba(0,0,0,.35)}
  .pin.keep{background:#2fb36d}
  .pin.bug{background:#b3261e}
  .pin.done{background:#6b7079}
  .pin.done::after{content:" ✓"}
  .tip,.pop,.list{pointer-events:auto;background:#fff;color:#16171a;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.08)}
  .tip{position:fixed;width:300px;padding:11px 12px;font-size:12.5px;line-height:1.45;pointer-events:none}
  .tip p+p{margin-top:5px}
  .tip .k{display:block;font-size:10.5px;font-weight:600;letter-spacing:.02em;color:#7a7d85;text-transform:uppercase;margin-bottom:1px}
  .tip .reply{margin-top:8px;padding-top:8px;border-top:1px solid #eee;color:#2a5}
  .pop{position:fixed;width:350px;padding:12px;display:flex;flex-direction:column;gap:9px}
  .crumbs{display:flex;flex-wrap:wrap;gap:4px}
  .crumbs button{all:unset;cursor:pointer;font:11px/1 ui-monospace,Menlo,monospace;padding:4px 6px;border-radius:4px;background:#f1f1f3;color:#55575e;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crumbs button.on{background:#ff5a36;color:#fff}
  .crumbs .lbl{font-size:11px;color:#8a8c93;padding:4px 2px 4px 0}
  .seg{display:flex;background:#f1f1f3;border-radius:7px;padding:2px;align-self:flex-start}
  .seg button{all:unset;cursor:pointer;font-size:12px;font-weight:600;padding:5px 12px;border-radius:5px;color:#666}
  .seg button.on[data-kind=edit]{background:#ff5a36;color:#fff}
  .seg button.on[data-kind=bug]{background:#b3261e;color:#fff}
  .seg button.on[data-kind=keep]{background:#2fb36d;color:#fff}
  label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:#33353a}
  label i{font-style:normal;font-weight:400;color:#9a9ca3}
  textarea,input.nm{all:unset;box-sizing:border-box;width:100%;font-size:13px;line-height:1.4;padding:7px 8px;border-radius:6px;background:#f6f6f7;box-shadow:inset 0 0 0 1px #e3e3e6;resize:vertical;min-height:38px;white-space:pre-wrap;color:#16171a}
  textarea:focus,input.nm:focus{box-shadow:inset 0 0 0 1.5px #ff5a36;background:#fff}
  .row{display:flex;gap:6px;align-items:center}
  .sp{flex:1}
  .row button{all:unset;cursor:pointer;font-size:12.5px;font-weight:500;padding:6px 10px;border-radius:6px;color:#444}
  .row button:hover{background:#f1f1f3}
  .row .save{background:#16171a;color:#fff}
  .row .save:hover{background:#2b2c30}
  .row .del{color:#c33}
  .row kbd{font:10.5px ui-monospace,Menlo,monospace;opacity:.55;margin-left:4px}
  .list{position:fixed;top:12px;right:12px;bottom:12px;width:370px;display:flex;flex-direction:column;overflow:hidden}
  .lh{display:flex;align-items:center;gap:8px;padding:12px 12px 10px;border-bottom:1px solid #eee}
  .lh h3{font-size:14px;font-weight:650;flex:1}
  .lh button{all:unset;cursor:pointer;font-size:12px;padding:5px 8px;border-radius:5px;color:#555}
  .lh button:hover,.lh button.on{background:#f1f1f3;color:#111}
  .items{overflow:auto;flex:1;padding:6px}
  .item{display:flex;gap:9px;padding:9px 8px;border-radius:7px;cursor:pointer;font-size:12.5px;line-height:1.4}
  .item:hover{background:#f6f6f7}
  .item .pin{position:static;flex:none;box-shadow:none}
  .item .meta{font:11px ui-monospace,Menlo,monospace;color:#8a8c93;margin-top:2px;word-break:break-all}
  .item .reply{color:#2a5;margin-top:3px}
  .empty{padding:24px 14px;color:#888;font-size:13px;line-height:1.5}
  .intro{position:fixed;left:14px;bottom:60px;width:min(330px,calc(100vw - 28px));pointer-events:auto;background:#16171a;color:#f3f3f3;font-size:13px;line-height:1.45;padding:12px 13px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
  .intro b{color:#ff8a6b}
  .intro button{all:unset;cursor:pointer;display:inline-block;margin-top:8px;font-weight:600;padding:6px 10px;border-radius:6px;background:#ff5a36;color:#fff}
  .tip .who{color:#7a7d85;font-size:11.5px}
  @media (max-width:760px){.bar{bottom:calc(86px + env(safe-area-inset-bottom))}.toast,.intro{bottom:calc(132px + env(safe-area-inset-bottom))}.hint{white-space:normal;width:calc(100vw - 24px);text-align:center}.list{left:8px;right:8px;width:auto;top:8px;bottom:8px}.pop{width:calc(100vw - 16px)}}
  .toast{position:fixed;left:14px;bottom:56px;background:#16171a;color:#fff;font-size:12.5px;padding:8px 11px;border-radius:8px}
</style>
<div class="hl" hidden><span class="tag"></span></div>
<div class="sel" hidden></div>
<div class="box" hidden></div>
<div class="pins"></div>
<div class="hint" hidden><b>Comment mode</b> &nbsp;tap or click anything to comment on it · drag a box around an area · <b>Esc</b> to stop</div>
<div class="intro" hidden>This is a <b>review copy</b> of Firebird Hub. Tap <b>Comment</b>, then tap anything you want changed and say how. Every comment goes to the team that builds the app.<br><button type="button" class="intro-ok">Got it</button></div>
<div class="bar">
  <button class="mark" title="Comment mode (\` key). ⌥-click also works."><span class="dot"></span>Comment</button>
  <button class="open-list">Comments <span class="count">0</span></button>
</div>
<div class="tip" hidden></div>
<form class="pop" hidden>
  <div class="crumbs"></div>
  <div class="seg"><button type="button" data-kind="edit" class="on">Edit</button><button type="button" data-kind="bug">Bug</button><button type="button" data-kind="keep">Keep</button></div>
  <label><span class="l-what">What should change</span><textarea name="what" rows="2"></textarea></label>
  <label><span class="l-why">Details <i>optional</i></span><textarea name="why" rows="2"></textarea></label>
  <label><span class="l-fix">How it should be <i>optional</i></span><textarea name="fix" rows="2"></textarea></label>
  <label><span>Your name <i>optional</i></span><input class="nm" name="name" maxlength="60" autocomplete="name"></label>
  <div class="row"><button type="button" class="del">Delete</button><span class="sp"></span><button type="button" class="cancel">Cancel</button><button type="submit" class="save">Save<kbd>⌘↵</kbd></button></div>
</form>
<aside class="list" hidden>
  <div class="lh"><h3>Comments</h3><button class="f-page on">This page</button><button class="f-all">All</button><button class="copy" title="Copy open comments as text">Copy</button><button class="close">✕</button></div>
  <div class="items"></div>
</aside>`;
  document.documentElement.appendChild(host);
  const $ = (s) => root.querySelector(s);
  const hl = $(".hl"), sel = $(".sel"), box = $(".box"), pinsEl = $(".pins"), hint = $(".hint"),
    tip = $(".tip"), pop = $(".pop"), list = $(".list"), markBtn = $(".mark");

  const pageStyle = document.createElement("style");
  pageStyle.textContent = "html.astro-marking,html.astro-marking *{cursor:crosshair!important;user-select:none!important;-webkit-user-drag:none!important}";
  document.head.appendChild(pageStyle);

  // ---------- helpers ----------
  const inOurs = (e) => e.composedPath().includes(host);
  const route = () => { const h = location.hash.split("?")[0]; return !h || h === "#" ? "#/" : h; };
  const isEditable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const STATE_CLASS = /^(is-|has-|active$|open$|visible$|show$|shown$|in$|in-view|revealed|reveal--in|hover|focus|current|selected|loaded)/;

  function label(el) {
    if (!el || el.nodeType !== 1) return "";
    let s = el.tagName.toLowerCase();
    if (el.id) return s + "#" + el.id;
    const c = [...el.classList].filter((x) => !STATE_CLASS.test(x)).slice(0, 2);
    if (c.length) return s + "." + c.join(".");
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t ? `${s} "${t.length > 18 ? t.slice(0, 18) + "…" : t}"` : s;
  }

  function cssPath(el) {
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) return "#" + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id) { parts.unshift("#" + CSS.escape(cur.id)); break; }
      let part = cur.tagName.toLowerCase();
      const cls = [...cur.classList].filter((c) => !STATE_CLASS.test(c)).slice(0, 2);
      if (cls.length) part += "." + cls.map((c) => CSS.escape(c)).join(".");
      if (cur.hasAttribute("data-route") && cur.tagName === "SECTION") part += `[data-route="${cur.getAttribute("data-route")}"]`;
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((s) => { try { return s.matches(part); } catch { return false; } });
        if (same.length > 1) {
          const ofType = [...parent.children].filter((s) => s.tagName === cur.tagName);
          part += `:nth-of-type(${ofType.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(part);
      const s = parts.join(" > ");
      try { if (document.querySelectorAll(s).length === 1) return s; } catch {}
      cur = parent;
    }
    return parts.join(" > ");
  }

  const STYLE_KEYS = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "text-align",
    "color", "background-color", "background-image", "border", "border-radius", "box-shadow", "backdrop-filter", "filter",
    "padding", "margin", "gap", "display", "width", "max-width", "opacity", "mix-blend-mode", "animation-name", "transition"];
  const DEFAULTS = new Set(["none", "normal", "0px", "auto", "rgba(0, 0, 0, 0)", "0px none rgb(0, 0, 0)", "all", "visible", "1", "start", "all 0s ease 0s"]);
  function styles(el) {
    const cs = getComputedStyle(el), out = {};
    for (const k of STYLE_KEYS) {
      let v = cs.getPropertyValue(k);
      if (!v || DEFAULTS.has(v) || v.startsWith("0px none")) continue;
      if (v.length > 160) v = v.slice(0, 160) + "…";
      out[k] = v;
    }
    return out;
  }

  // Which stylesheet rules apply to this element (later rules win), so the fix
  // lands on the right selector instead of a new override.
  function rules(el) {
    const out = [];
    const walk = (list, file, media) => {
      for (const r of list) {
        if (r.selectorText) {
          if (/^(\*|html|body|:root)([\s,:]|$)/.test(r.selectorText) && !r.selectorText.includes(".")) continue;
          try { if (el.matches(r.selectorText)) out.push(media ? { file, selector: r.selectorText, media } : { file, selector: r.selectorText }); } catch {}
        } else if (r.cssRules) {
          if (r.media && !matchMedia(r.media.mediaText).matches) continue;
          walk(r.cssRules, file, r.media ? r.media.mediaText : media);
        }
      }
    };
    for (const sh of document.styleSheets) {
      if (sh.ownerNode && (sh.ownerNode === pageStyle || host.contains(sh.ownerNode))) continue;
      let list; try { list = sh.cssRules; } catch { continue; }
      const file = sh.href ? sh.href.split("/").pop().split("?")[0] : "inline <style>";
      walk(list, file, "");
    }
    const seen = new Set();
    return out.filter((r) => { const k = r.file + r.selector + (r.media || ""); if (seen.has(k)) return false; seen.add(k); return true; }).slice(-14);
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    const html = el.outerHTML.replace(/\s+/g, " ");
    return {
      selector: cssPath(el),
      label: label(el),
      text: (el.innerText || el.getAttribute("alt") || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 160),
      html: html.length > 900 ? html.slice(0, 900) + "…" : html,
      rect: { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      styles: styles(el),
      rules: rules(el),
    };
  }

  // Animated headings are split into one <span> per letter/word; a click on
  // "A" should mark the heading, not the letter.
  const FRAGMENT = /(^|[-_])(split|char|chars|letter|letters|word|words)([-_]|$)/i;
  function promote(el) {
    while (el && el.parentElement && el.parentElement !== document.body) {
      const d = getComputedStyle(el).display;
      if (!d.startsWith("inline")) break;
      const frag = [...el.classList].some((c) => FRAGMENT.test(c)) || (el.tagName === "SPAN" && el.textContent.trim().length <= 1);
      if (!frag) break;
      el = el.parentElement;
    }
    return el;
  }

  function place(elBox, r) {
    Object.assign(elBox.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  }

  // ---------- pins ----------
  function anchorRect(n) {
    const t = n.target || {};
    let el = null;
    try { el = t.selector ? document.querySelector(t.selector) : null; } catch {}
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    if (t.region) return { left: r.left + t.region.x, top: r.top + t.region.y, width: t.region.w, height: t.region.h, el };
    return { left: r.left, top: r.top, width: r.width, height: r.height, el };
  }

  function pageNotes() { return S.notes.filter((n) => (n.page && n.page.route) === route()); }

  function renderPins() {
    pinsEl.textContent = "";
    for (const n of pageNotes()) {
      const p = document.createElement("div");
      p.className = pinClass(n);
      p.textContent = n.n;
      p.dataset.n = n.n;
      pinsEl.appendChild(p);
    }
    positionPins();
    $(".count").textContent = S.notes.filter((n) => n.status !== "done").length;
    if (S.listOpen) renderList();
  }

  function positionPins() {
    for (const p of pinsEl.children) {
      const n = S.notes.find((x) => x.n == p.dataset.n);
      const r = n && anchorRect(n);
      if (!r) { p.hidden = true; continue; }
      p.hidden = false;
      p.style.left = Math.min(Math.max(r.left - 9, 4), innerWidth - 30) + "px";
      p.style.top = Math.min(Math.max(r.top - 9, 4), innerHeight - 26) + "px";
    }
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; positionPins(); if (S.pop) positionPop(); }); };
  addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", schedule);
  setInterval(() => { if (pinsEl.children.length) positionPins(); }, 400); // reveal/animation drift
  addEventListener("hashchange", () => { closePop(); setTimeout(renderPins, 60); setTimeout(renderPins, 900); });

  pinsEl.addEventListener("mouseover", (e) => {
    const p = e.target.closest(".pin"); if (!p) return;
    const n = S.notes.find((x) => x.n == p.dataset.n); if (!n) return;
    tip.innerHTML = "";
    const L = LABELS[n.kind] || LABELS.edit;
    const add = (k, v, cls) => { if (!v) return; const el = document.createElement("p"); if (cls) el.className = cls; const s = document.createElement("span"); s.className = "k"; s.textContent = k; el.append(s, v); tip.appendChild(el); };
    add(L[0], n.what);
    add(L[1], n.why);
    add(L[2], n.fix);
    add(n.status === "done" ? "Done" : "Reply", n.reply, "reply");
    if (n.name) { const w = document.createElement("p"); w.className = "who"; w.textContent = "From " + n.name; tip.appendChild(w); }
    tip.hidden = false;
    const r = p.getBoundingClientRect();
    tip.style.left = Math.min(r.left, innerWidth - 312) + "px";
    tip.style.top = (r.bottom + 6 + 200 > innerHeight ? Math.max(8, r.top - tip.offsetHeight - 6) : r.bottom + 6) + "px";
  });
  pinsEl.addEventListener("mouseout", (e) => { if (e.target.closest(".pin")) tip.hidden = true; });
  pinsEl.addEventListener("click", (e) => {
    const p = e.target.closest(".pin"); if (!p) return;
    const n = S.notes.find((x) => x.n == p.dataset.n);
    if (n && !mine(n)) { p.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return; }
    const r = n && anchorRect(n);
    if (n && r) { tip.hidden = true; openPop({ note: n, el: r.el, region: n.target.region || null }); }
  });

  // ---------- popover ----------
  const f = { what: pop.elements.what, why: pop.elements.why, fix: pop.elements.fix };
  const nameIn = pop.elements.name;
  try { nameIn.value = localStorage.getItem(NAME_LS) || ""; } catch {}
  const LABELS = {
    edit: ["What should change", "Details", "How it should be"],
    bug: ["What's broken", "What you did", "What should happen"],
    keep: ["What's good here", "Why it works", "Anything to watch"],
  };
  function setKind(k) {
    pop.dataset.kind = k;
    for (const b of pop.querySelectorAll(".seg button")) b.classList.toggle("on", b.dataset.kind === k);
    const L = LABELS[k] || LABELS.edit;
    $(".l-what").textContent = L[0];
    $(".l-why").innerHTML = L[1] + " <i>optional</i>";
    $(".l-fix").innerHTML = L[2] + " <i>optional</i>";
  }
  pop.querySelector(".seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setKind(b.dataset.kind); });

  function openPop({ el, region = null, note = null }) {
    S.pop = { el, region, note };
    hl.hidden = true;
    f.what.value = note ? note.what || "" : "";
    f.why.value = note ? note.why || "" : "";
    f.fix.value = note ? note.fix || "" : "";
    setKind(note ? note.kind || "edit" : "edit");
    pop.querySelector(".del").hidden = !mine(note);
    nameIn.closest("label").hidden = !!note;
    renderCrumbs();
    pop.hidden = false;
    positionPop();
    f.what.focus();
    setTimeout(() => { if (S.pop && !root.activeElement) f.what.focus(); }, 30);
  }
  function renderCrumbs() {
    const c = pop.querySelector(".crumbs");
    c.textContent = "";
    const { el, note, region } = S.pop;
    const head = document.createElement("span");
    head.className = "lbl";
    head.textContent = (note ? "#" + note.n + " · " : "") + (region ? "Area in" : "Element");
    c.appendChild(head);
    if (region) { const b = document.createElement("button"); b.className = "on"; b.textContent = label(el); c.appendChild(b); return; }
    // the clicked element plus its ancestors, so a click that landed on a <span> can widen to the card
    const chain = [];
    for (let cur = el; cur && cur !== document.body && chain.length < 6; cur = cur.parentElement) chain.push(cur);
    chain.reverse().forEach((a) => {
      const b = document.createElement("button");
      b.textContent = label(a);
      b.title = "Mark this instead";
      b.classList.toggle("on", a === el);
      b.onclick = () => { S.pop.el = a; renderCrumbs(); positionPop(); };
      c.appendChild(b);
    });
  }
  function positionPop() {
    const { el, region } = S.pop;
    let r = el.getBoundingClientRect();
    if (region) r = { left: r.left + region.x, top: r.top + region.y, width: region.w, height: region.h, right: r.left + region.x + region.w, bottom: r.top + region.y + region.h };
    sel.hidden = false;
    place(sel, r);
    const w = 350, h = pop.offsetHeight || 330;
    let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    let top = r.bottom + 10;
    if (top + h > innerHeight - 8) top = r.top - h - 10;
    if (top < 8) top = Math.min(innerHeight - h - 8, Math.max(8, r.top + 10));
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }
  function closePop() {
    S.pop = null; pop.hidden = true; sel.hidden = true;
    if (root.activeElement) root.activeElement.blur(); // so the next Esc reaches mark mode
  }

  pop.querySelector(".cancel").onclick = closePop;
  pop.querySelector(".del").onclick = async () => {
    const n = S.pop && S.pop.note; if (!n) return;
    const r = await fetch(API + "?n=" + n.n, { method: "DELETE", headers: { "x-edit-key": keys[n.n] || "" } }).catch(() => null);
    closePop();
    if (!r || !r.ok) { toast("Couldn't delete. Try again in a minute."); return; }
    delete keys[n.n]; saveKeys(); await load(true);
  };
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); pop.requestSubmit(); }
    if (e.key === "Escape") { e.preventDefault(); closePop(); }
    e.stopPropagation();
  });
  pop.addEventListener("submit", async (e) => {
    e.preventDefault();
    const what = f.what.value.trim(), why = f.why.value.trim(), fix = f.fix.value.trim();
    if (!what && !why && !fix) { f.what.focus(); return; }
    const { el, region, note } = S.pop;
    const body = { kind: pop.dataset.kind, what, why, fix };
    const name = nameIn.value.trim();
    if (!note) { body.name = name; try { localStorage.setItem(NAME_LS, name); } catch {} }
    if (!note || note.target.selector !== cssPath(el) || region) {
      body.target = Object.assign(describe(el), region ? { region } : {});
    }
    if (!note) {
      body.page = { route: route(), url: location.href, viewport: { w: innerWidth, h: innerHeight }, scrollY: Math.round(scrollY), dpr: devicePixelRatio, ua: navigator.userAgent };
    }
    const kind = pop.dataset.kind;
    closePop(); // close right away so the next key (Esc, another click) acts on the page
    let res;
    try {
      res = await fetch(note ? API + "?n=" + note.n : API, {
        method: note ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "x-edit-key": note ? keys[note.n] || "" : "" }, body: JSON.stringify(body),
      });
    } catch {}
    if (!res || !res.ok) {
      toast(res && res.status === 429 ? "That's a lot of comments at once. Try again in a few minutes." : "Couldn't save. Try again in a minute.");
      openPop({ el, region, note });
      f.what.value = what; f.why.value = why; f.fix.value = fix; setKind(kind);
      return;
    }
    const out = await res.json();
    const saved = out.note;
    if (out.key) { keys[saved.n] = out.key; saveKeys(); }
    await load(true);
    // GitHub's issue list can lag a second behind; show the saved comment right away.
    const i = S.notes.findIndex((x) => x.n === saved.n);
    if (i < 0) S.notes.push(saved); else S.notes[i] = saved;
    renderPins();
    toast(note ? `Updated #${saved.n}` : `Thanks! Comment #${saved.n} is saved.`);
  });

  // ---------- list ----------
  function renderList() {
    const items = list.querySelector(".items");
    items.textContent = "";
    const notes = S.listAll ? S.notes : pageNotes();
    const open = S.notes.filter((n) => n.status !== "done").length;
    list.querySelector("h3").textContent = `Comments · ${open} open`;
    list.querySelector(".f-page").classList.toggle("on", !S.listAll);
    list.querySelector(".f-all").classList.toggle("on", S.listAll);
    if (!notes.length) {
      items.innerHTML = `<div class="empty">${S.listAll ? "No comments yet." : "No comments on this page yet."}<br>Tap <b>Comment</b>, then tap anything you want changed.</div>`;
      return;
    }
    for (const n of notes) {
      const row = document.createElement("div");
      row.className = "item";
      const pin = document.createElement("span");
      pin.className = pinClass(n);
      pin.textContent = n.n;
      const body = document.createElement("div");
      const t = document.createElement("div"); t.textContent = n.what || n.why || n.fix;
      const m = document.createElement("div"); m.className = "meta"; m.textContent = (S.listAll ? n.page.route + "  " : "") + (n.target.label || n.target.selector) + (n.name ? "  · " + n.name : "");
      body.append(t, m);
      if (n.reply) { const r = document.createElement("div"); r.className = "reply"; r.textContent = "↳ " + n.reply; body.appendChild(r); }
      row.append(pin, body);
      row.onclick = () => jump(n);
      items.appendChild(row);
    }
  }
  function jump(n) {
    const go = () => {
      const r = anchorRect(n);
      if (!r) { toast(`#${n.n}: that part of the page has changed since.`); return; }
      r.el.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => {
        const a = anchorRect(n); if (!a) return;
        const fl = document.createElement("div"); fl.className = "flash"; place(fl, a); root.appendChild(fl);
        setTimeout(() => fl.remove(), 1400);
      }, 450);
    };
    if (n.page.route !== route()) { location.hash = n.page.route; setTimeout(go, 1100); } else go();
  }
  $(".open-list").onclick = () => { S.listOpen = !S.listOpen; list.hidden = !S.listOpen; if (S.listOpen) renderList(); };
  list.querySelector(".close").onclick = () => { S.listOpen = false; list.hidden = true; };
  list.querySelector(".f-page").onclick = () => { S.listAll = false; renderList(); };
  list.querySelector(".f-all").onclick = () => { S.listAll = true; renderList(); };
  list.querySelector(".copy").onclick = async () => {
    const txt = S.notes.filter((n) => n.status !== "done").map((n) =>
      [`#${n.n} [${n.kind}] ${n.page.route} — ${n.target.selector}`, n.what && `What: ${n.what}`, n.why && `Why: ${n.why}`, n.fix && `Instead: ${n.fix}`].filter(Boolean).join("\n")).join("\n\n");
    try { await navigator.clipboard.writeText(txt); toast("Copied open comments"); } catch { toast("Clipboard blocked"); }
  };

  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; root.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  // ---------- mark mode ----------
  function setOn(v) {
    S.on = v;
    markBtn.classList.toggle("on", v);
    hint.hidden = !v;
    document.documentElement.classList.toggle("astro-marking", v);
    if (!v) { hl.hidden = true; box.hidden = true; S.drag = null; }
  }
  markBtn.onclick = () => setOn(!S.on);

  function showHover(el) {
    if (!el || el === document.documentElement || el === document.body) { hl.hidden = true; return; }
    S.hoverEl = el;
    const r = el.getBoundingClientRect();
    hl.hidden = false;
    place(hl, r);
    hl.classList.toggle("below", r.top < 26);
    hl.querySelector(".tag").textContent = `${label(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  const BLOCK = ["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart"];
  for (const type of BLOCK) {
    addEventListener(type, (e) => {
      if (inOurs(e)) return;
      if (S.on || e.altKey || S.swallow) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (type === "click") S.swallow = false;
      }
    }, true);
  }

  addEventListener("pointermove", (e) => {
    if (inOurs(e)) { if (!S.drag) hl.hidden = true; return; }
    if (S.drag) {
      const d = S.drag;
      d.x = e.clientX; d.y = e.clientY;
      if (!d.active && Math.hypot(d.x - d.x0, d.y - d.y0) > 6) { d.active = true; hl.hidden = true; }
      if (d.active) { box.hidden = false; place(box, { left: Math.min(d.x0, d.x), top: Math.min(d.y0, d.y), width: Math.abs(d.x - d.x0), height: Math.abs(d.y - d.y0) }); }
      return;
    }
    if ((S.on || e.altKey) && !S.pop) showHover(promote(e.target));
    else if (!S.pop) hl.hidden = true;
  }, true);

  addEventListener("pointerdown", (e) => {
    if (inOurs(e) || e.button !== 0) return;
    if (!(S.on || e.altKey)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    S.swallow = true;
    if (S.pop) {
      if (f.what.value || f.why.value || f.fix.value) { pop.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], 180); return; }
      closePop();
    }
    S.drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, el: promote(e.target) };
  }, true);

  // Links and images start a native drag, which cancels the pointer stream mid-box.
  addEventListener("dragstart", (e) => { if (S.on || S.drag || e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  addEventListener("pointercancel", () => { if (S.drag) { S.drag = null; box.hidden = true; } }, true);

  addEventListener("pointerup", (e) => {
    const d = S.drag; if (!d) return;
    e.preventDefault(); e.stopImmediatePropagation();
    S.drag = null; box.hidden = true;
    if (!d.active) { openPop({ el: d.el }); return; }
    // Area: pin it to the smallest element that contains the whole box.
    const L = Math.min(d.x0, d.x), T = Math.min(d.y0, d.y), W = Math.abs(d.x - d.x0), H = Math.abs(d.y - d.y0);
    let c = document.elementFromPoint(L + W / 2, T + H / 2);
    while (c && c !== document.body) {
      const r = c.getBoundingClientRect();
      if (r.left <= L + 4 && r.top <= T + 4 && r.right >= L + W - 4 && r.bottom >= T + H - 4) break;
      c = c.parentElement;
    }
    c = c || document.body;
    const cr = c.getBoundingClientRect();
    openPop({ el: c, region: { x: Math.round(L - cr.left), y: Math.round(T - cr.top), w: Math.round(W), h: Math.round(H) } });
  }, true);

  addEventListener("keydown", (e) => {
    if (inOurs(e)) return;
    if (e.key === "`" && !e.metaKey && !e.ctrlKey && !isEditable(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); setOn(!S.on); return; }
    if (e.key === "Escape" && (S.on || S.pop)) { e.stopImmediatePropagation(); if (S.pop) closePop(); else setOn(false); }
  }, true);
  addEventListener("keyup", (e) => { if (e.key === "Alt" && !S.on && !S.pop) hl.hidden = true; }, true);
  addEventListener("blur", () => { if (!S.on && !S.pop) hl.hidden = true; });

  // ---------- data ----------
  function saveKeys() { try { localStorage.setItem(KEYS_LS, JSON.stringify(keys)); } catch {} }
  // Keeps the last good list if a load fails, so pins never vanish on a bad connection.
  async function load(fresh) {
    try {
      const r = await fetch(API + (fresh ? "?fresh=1" : ""), { cache: "no-store" });
      if (r.ok) S.notes = (await r.json()).notes || S.notes;
    } catch {}
    renderPins();
  }
  // Replies and fixes show up without a reload.
  setInterval(() => { if (!document.hidden && !S.pop) load(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  const intro = $(".intro");
  try { if (!localStorage.getItem(INTRO_LS)) intro.hidden = false; } catch {}
  $(".intro-ok").onclick = () => { intro.hidden = true; try { localStorage.setItem(INTRO_LS, "1"); } catch {} };
  markBtn.addEventListener("click", () => { if (!intro.hidden) $(".intro-ok").click(); });
  load();
  setTimeout(renderPins, 1200); // routes and reveals settle after first paint
})();
