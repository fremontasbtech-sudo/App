// Comment overlay for the public Firebird Hub review copy (grew out of the website marker in
// ~/Desktop/Claude/Markers/website-marker). marker/build.mjs injects it into the review copy only;
// the real app never loads it. Comments are saved by /api/marker as GitHub issues (label "marker").
//
// How people use it
//   Comment button (or the ` key)  arms comment mode. Tap or click one thing to comment on it; on a
//                                  mouse you can also drag a box around an area. After a comment is
//                                  saved, comment mode turns off so the page works normally again.
//   ⌥ + click                      comment on one thing without turning comment mode on (handy for
//                                  menus that close when the mouse leaves them).
//   Open a menu, fold, tab or dialog first, then press Comment: the overlay follows the page into
//   open dialogs and popovers, and pressing Comment never closes the page's own menus.
//   Your own comments: tap the pin, or Edit in the Comments list. Other people's: tap to read.
//   A comment can be edited or deleted only from the browser that wrote it (edit key in
//   localStorage fh_marker_keys; only its hash is stored in the issue).
(() => {
  if (window.__fhMark) return;
  window.__fhMark = true;

  const API = "/api/marker";
  const KEYS_LS = "fh_marker_keys", NAME_LS = "fh_marker_name", INTRO_LS = "fh_marker_intro";
  const POLL_MS = 30000;
  const keys = (() => { try { return JSON.parse(localStorage.getItem(KEYS_LS) || "{}"); } catch { return {}; } })();
  const saveKeys = () => { try { localStorage.setItem(KEYS_LS, JSON.stringify(keys)); } catch {} };
  const mine = (n) => !!(n && keys[n.n]);
  const S = {
    on: false, notes: [], loaded: false, hoverEl: null, drag: null, swallowUntil: 0,
    pop: null, card: null, listOpen: false, listAll: false, hideDone: false,
  };
  const touchy = () => matchMedia("(pointer: coarse)").matches;
  const narrow = () => (visualViewport ? visualViewport.width : innerWidth) < 640;

  const LABELS = {
    edit: ["What should change", "Details", "How it should be"],
    bug: ["What's broken", "What you did", "What should happen"],
    keep: ["What's good here", "Why it works", "Anything to watch"],
  };
  const KIND_NAME = { edit: "Edit", bug: "Bug", keep: "Keep" };

  // ---------- DOM ----------
  const host = document.createElement("fh-mark");
  host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;display:block;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  *{box-sizing:border-box;margin:0;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;-webkit-tap-highlight-color:transparent}
  [hidden]{display:none!important}
  button{font:inherit}
  .hl,.sel,.flash{position:fixed;pointer-events:none;border:2px solid #ff5a36;background:rgba(255,90,54,.08);border-radius:2px}
  .sel{background:rgba(255,90,54,.14)}
  .flash{border-width:3px;animation:fl 1.4s ease-out forwards}
  @keyframes fl{0%,40%{opacity:1}100%{opacity:0}}
  @media (prefers-reduced-motion:reduce){.flash{animation:none}}
  .tag{position:absolute;left:-2px;bottom:100%;margin-bottom:4px;background:#ff5a36;color:#fff;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}
  .hl.below .tag{bottom:auto;top:100%;margin:4px 0 0}
  .box{position:fixed;pointer-events:none;border:2px dashed #ff5a36;background:rgba(255,90,54,.08)}
  .hint{position:fixed;top:max(10px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;background:#16171a;color:#f3f3f3;font-size:13px;line-height:1.35;padding:8px 8px 8px 13px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:auto;max-width:calc(100vw - 20px)}
  .hint b{color:#ff8a6b;font-weight:600}
  .hint button{all:unset;cursor:pointer;flex:none;font-weight:600;font-size:13px;padding:8px 12px;min-height:20px;border-radius:7px;background:#2b2c30;color:#fff}
  .hint button:focus-visible,.bar button:focus-visible,.row button:focus-visible,.lh button:focus-visible,.card button:focus-visible,.it-btn:focus-visible{outline:2px solid #ff8a6b;outline-offset:2px}
  .bar{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:calc(max(12px,env(safe-area-inset-bottom)) + var(--lift,0px));display:flex;gap:6px;pointer-events:auto}
  .bar button{all:unset;cursor:pointer;background:#16171a;color:#e9e9ea;font-size:13px;font-weight:500;padding:0 12px;min-height:38px;border-radius:9px;box-shadow:0 4px 18px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.08);display:flex;align-items:center;gap:7px}
  .bar button:hover{background:#222327}
  .bar .mark.on{background:#ff5a36;color:#fff}
  .dot{width:8px;height:8px;border-radius:50%;background:#ff5a36}
  .mark.on .dot{background:#fff}
  .pins{position:fixed;inset:0;pointer-events:none}
  .pin{position:fixed;pointer-events:auto;cursor:pointer;min-width:24px;height:24px;padding:0 7px;border-radius:12px;background:#ff5a36;color:#fff;font:700 12px/24px -apple-system,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.5),0 0 0 2px rgba(0,0,0,.35);border:0}
  .pin::before{content:"";position:absolute;inset:-10px}
  .pin.keep{background:#2fb36d}
  .pin.bug{background:#b3261e}
  .pin.done{background:#6b7079}
  .pin.done::after{content:" ✓"}
  .pin.mine{box-shadow:0 2px 8px rgba(0,0,0,.5),0 0 0 2px #fff}
  .tip,.pop,.list,.card{pointer-events:auto;background:#fff;color:#16171a;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.08)}
  .tip{position:fixed;width:300px;max-width:calc(100vw - 16px);padding:11px 12px;font-size:13px;line-height:1.45;pointer-events:none}
  .tip p+p,.card p+p{margin-top:6px}
  .k{display:block;font-size:10.5px;font-weight:600;letter-spacing:.02em;color:#7a7d85;text-transform:uppercase;margin-bottom:1px}
  .reply{margin-top:8px;padding-top:8px;border-top:1px solid #eee;color:#1d8a4a}
  .who{color:#7a7d85;font-size:12px}
  .card{position:fixed;width:320px;max-width:calc(100vw - 16px);padding:12px;font-size:13.5px;line-height:1.45;display:flex;flex-direction:column;gap:8px}
  .card .row{margin-top:2px}
  .pop{position:fixed;width:360px;max-width:calc(100vw - 16px);padding:12px;display:flex;flex-direction:column;gap:10px;overflow:auto;overscroll-behavior:contain}
  .pop.sheet,.card.sheet,.list.sheet{left:8px!important;right:8px;width:auto;max-width:none;border-radius:14px}
  .crumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .crumbs button{all:unset;cursor:pointer;font:11.5px/1 ui-monospace,Menlo,monospace;padding:6px 7px;border-radius:5px;background:#f1f1f3;color:#55575e;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crumbs button.on{background:#ff5a36;color:#fff}
  .crumbs .lbl{font-size:11.5px;color:#8a8c93;padding:4px 2px 4px 0}
  .seg{display:flex;background:#f1f1f3;border-radius:8px;padding:2px;align-self:flex-start}
  .seg button{all:unset;cursor:pointer;font-size:13px;font-weight:600;padding:7px 14px;border-radius:6px;color:#666}
  .seg button.on[data-kind=edit]{background:#ff5a36;color:#fff}
  .seg button.on[data-kind=bug]{background:#b3261e;color:#fff}
  .seg button.on[data-kind=keep]{background:#2fb36d;color:#fff}
  label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:600;color:#33353a}
  label i{font-style:normal;font-weight:400;color:#9a9ca3}
  textarea,input.nm{all:unset;box-sizing:border-box;width:100%;font-size:16px;line-height:1.4;padding:8px 9px;border-radius:7px;background:#f6f6f7;box-shadow:inset 0 0 0 1px #e3e3e6;white-space:pre-wrap;color:#16171a;-webkit-user-select:text;user-select:text}
  textarea{resize:vertical;min-height:44px}
  @media (pointer:fine){textarea,input.nm{font-size:13.5px}}
  textarea:focus,input.nm:focus{box-shadow:inset 0 0 0 1.5px #ff5a36;background:#fff}
  .more{all:unset;cursor:pointer;align-self:flex-start;font-size:12.5px;font-weight:600;color:#55575e;padding:4px 0}
  .more:hover{color:#111}
  .extra{display:flex;flex-direction:column;gap:10px}
  .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .sp{flex:1}
  .row button{all:unset;cursor:pointer;font-size:13px;font-weight:500;padding:0 12px;min-height:34px;display:inline-flex;align-items:center;border-radius:7px;color:#444}
  .row button:hover{background:#f1f1f3}
  .row .save{background:#16171a;color:#fff}
  .row .save:hover{background:#2b2c30}
  .row .save[disabled]{opacity:.5;cursor:default}
  .row .del{color:#c33}
  .row .del.sure{background:#c33;color:#fff}
  .row kbd{font:10.5px ui-monospace,Menlo,monospace;opacity:.55;margin-left:5px}
  .note{font-size:12px;color:#7a7d85}
  .list{position:fixed;top:12px;right:12px;bottom:12px;width:380px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;overflow:hidden}
  .list.sheet{top:auto;bottom:8px;max-height:75vh}
  .lh{display:flex;align-items:center;gap:4px;padding:10px 10px 8px 14px;border-bottom:1px solid #eee;flex-wrap:wrap}
  .lh h3{font-size:14.5px;font-weight:650;flex:1;min-width:120px}
  .lh button{all:unset;cursor:pointer;font-size:12.5px;padding:7px 9px;border-radius:6px;color:#555}
  .lh button:hover,.lh button.on{background:#f1f1f3;color:#111}
  .items{overflow:auto;flex:1;padding:6px;overscroll-behavior:contain}
  .item{display:flex;gap:10px;padding:10px 8px;border-radius:8px;font-size:13px;line-height:1.4}
  .item:hover{background:#f6f6f7}
  .item .pin{position:static;flex:none;box-shadow:none}
  .item .pin::before{display:none}
  .item .body{flex:1;min-width:0}
  .item .meta{font:11px ui-monospace,Menlo,monospace;color:#8a8c93;margin-top:2px;overflow-wrap:anywhere}
  .item .reply{margin-top:4px;padding-top:0;border:0}
  .item .acts{display:flex;gap:4px;margin-top:6px}
  .it-btn{all:unset;cursor:pointer;font-size:12.5px;font-weight:600;padding:5px 10px;border-radius:6px;background:#f1f1f3;color:#333}
  .it-btn:hover{background:#e7e7ea}
  .empty{padding:24px 14px;color:#888;font-size:13px;line-height:1.5}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(max(12px,env(safe-area-inset-bottom)) + 52px + var(--lift,0px));background:#16171a;color:#fff;font-size:13px;padding:9px 13px;border-radius:9px;max-width:calc(100vw - 24px);box-shadow:0 6px 20px rgba(0,0,0,.35)}
  .intro{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:calc(max(12px,env(safe-area-inset-bottom)) + 54px + var(--lift,0px));width:min(340px,calc(100vw - 24px));pointer-events:auto;background:#16171a;color:#f3f3f3;font-size:13.5px;line-height:1.5;padding:13px 14px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
  .intro b{color:#ff8a6b}
  .intro button{all:unset;cursor:pointer;display:inline-block;margin-top:10px;font-weight:600;padding:8px 14px;border-radius:7px;background:#ff5a36;color:#fff}
  @media (max-width:639px){
    .hint{left:10px;right:10px;transform:none;max-width:none}
    .toast{top:calc(max(10px,env(safe-area-inset-top)) + 54px);bottom:auto}
    .lh h3{flex-basis:100%;margin-bottom:2px}
    .lh .close{margin-left:auto}
  }
  @media (max-height:480px){.pop.sheet{max-height:calc(100vh - 16px)!important}.hint{top:6px;padding:5px 6px 5px 11px}}
  @media (pointer:coarse){.bar button{min-height:44px}.row button{min-height:44px}.lh button{padding:11px 10px}.it-btn{padding:9px 12px}.pin{min-width:28px;height:28px;line-height:28px;border-radius:14px}}
</style>
<div class="hl" hidden><span class="tag"></span></div>
<div class="sel" hidden></div>
<div class="box" hidden></div>
<div class="pins"></div>
<div class="hint" role="status" hidden><span class="hint-t"></span><button type="button" class="stop">Stop</button></div>
<div class="intro" role="dialog" aria-label="About this review copy" hidden>This is a <b>review copy</b> of Firebird Hub. Tap <b>Comment</b>, then tap anything you want changed and say how. To comment on something inside a menu or a pop-up, open it first, then tap Comment. Every comment goes to the team that builds the app.<br><button type="button" class="intro-ok">Got it</button></div>
<div class="bar">
  <button type="button" class="mark" aria-pressed="false" title="Comment on something (\` key). ⌥-click also works."><span class="dot"></span><span class="mark-t">Comment</span></button>
  <button type="button" class="open-list" aria-expanded="false">Comments <span class="count">0</span></button>
</div>
<div class="tip" hidden></div>
<div class="card" role="dialog" aria-label="Comment" hidden></div>
<form class="pop" role="dialog" aria-label="Write a comment" hidden>
  <div class="crumbs"></div>
  <div class="seg" role="radiogroup" aria-label="Kind"><button type="button" role="radio" data-kind="edit" class="on">Edit</button><button type="button" role="radio" data-kind="bug">Bug</button><button type="button" role="radio" data-kind="keep">Keep</button></div>
  <label><span class="l-what">What should change</span><textarea name="what" rows="2"></textarea></label>
  <button type="button" class="more" aria-expanded="false">+ Add details</button>
  <div class="extra" hidden>
    <label><span class="l-why">Details <i>optional</i></span><textarea name="why" rows="2"></textarea></label>
    <label><span class="l-fix">How it should be <i>optional</i></span><textarea name="fix" rows="2"></textarea></label>
  </div>
  <label class="l-name"><span>Your name <i>optional</i></span><input class="nm" name="name" maxlength="60" autocomplete="name"></label>
  <div class="row"><button type="button" class="del">Delete</button><span class="sp"></span><button type="button" class="cancel">Cancel</button><button type="submit" class="save">Save<kbd class="kb">⌘↵</kbd></button></div>
</form>
<aside class="list" role="dialog" aria-label="Comments" hidden>
  <div class="lh"><h3>Comments</h3><button type="button" class="f-page on">This page</button><button type="button" class="f-all">All</button><button type="button" class="f-done">Hide done</button><button type="button" class="copy" title="Copy open comments as text">Copy</button><button type="button" class="close" aria-label="Close">✕</button></div>
  <div class="items"></div>
</aside>`;
  const $ = (s) => root.querySelector(s);
  const hl = $(".hl"), sel = $(".sel"), box = $(".box"), pinsEl = $(".pins"), hint = $(".hint"), tip = $(".tip"),
    card = $(".card"), pop = $(".pop"), list = $(".list"), markBtn = $(".mark"), intro = $(".intro");

  // Keep the page from reacting to anything done inside the overlay: its "click outside closes
  // the menu" handlers listen on document, and these events stop at the host.
  for (const t of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "touchstart", "touchend", "keydown", "keyup", "keypress", "input", "focusin", "focusout", "wheel", "contextmenu"]) {
    host.addEventListener(t, (e) => e.stopPropagation());
  }
  // Pressing an overlay button must not move focus out of the page (that also closes menus).
  root.addEventListener("mousedown", (e) => {
    if (e.target.closest("button") && !e.target.closest("form, .card")) e.preventDefault();
  });

  const pageStyle = document.createElement("style");
  pageStyle.textContent = "html.fh-marking,html.fh-marking *{cursor:crosshair!important;-webkit-user-select:none!important;user-select:none!important;-webkit-user-drag:none!important;-webkit-touch-callout:none!important}";
  document.head.appendChild(pageStyle);

  // ---------- follow the page into the top layer ----------
  // A modal <dialog> makes everything outside it inert and paints over it, so the overlay moves
  // inside the topmost open modal dialog (or open popover) and comes back when it closes.
  function topLayerParent() {
    let pick = null;
    for (const d of document.querySelectorAll("dialog[open]")) { try { if (d.matches(":modal")) pick = d; } catch {} }
    if (pick) return pick;
    try { const p = document.querySelectorAll(":popover-open"); if (p.length) return p[p.length - 1]; } catch {}
    return document.documentElement;
  }
  function mount() {
    const want = topLayerParent();
    if (host.parentNode !== want) {
      const active = root.activeElement;
      host.style.left = "0px"; host.style.top = "0px";
      want.appendChild(host);
      if (active && active.focus) active.focus({ preventScroll: true });
    }
  }
  // Inside a dialog that has a transform, "fixed" is measured from the dialog, not the screen;
  // shift the overlay back so its corner sits at the screen's corner.
  function fixOrigin() {
    const r = host.getBoundingClientRect();
    if (Math.abs(r.left) > 0.5 || Math.abs(r.top) > 0.5) {
      host.style.left = (parseFloat(host.style.left) || 0) - r.left + "px";
      host.style.top = (parseFloat(host.style.top) || 0) - r.top + "px";
    }
  }
  // Sit above the page's own bottom bar (tab bars on phones), whatever site or screen size.
  function lift() {
    let inset = 0;
    const y = innerHeight - 3;
    for (const x of [24, 90, innerWidth / 2]) {
      let stack = [];
      try { stack = document.elementsFromPoint(x, y); } catch {}
      for (const el of stack) {
        if (el === host || host.contains(el) || el === document.documentElement || el === document.body) continue;
        for (let a = el; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.position === "fixed" || cs.position === "sticky") {
            const r = a.getBoundingClientRect();
            if (r.height < innerHeight * 0.35 && r.bottom >= innerHeight - 4) inset = Math.max(inset, innerHeight - r.top);
            break;
          }
        }
        break; // only the topmost thing at that point
      }
    }
    host.style.setProperty("--lift", Math.round(inset) + "px");
  }
  mount();
  new MutationObserver(() => mount()).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open", "popover"], childList: true });
  document.addEventListener("toggle", () => setTimeout(mount, 0), true);
  setInterval(() => { mount(); fixOrigin(); lift(); }, 400);
  addEventListener("resize", lift);
  lift(); // showModal() doesn't always change an attribute we see in time

  // ---------- helpers ----------
  const inOurs = (e) => e.composedPath().includes(host);
  const route = () => { const h = location.hash.split("?")[0]; return !h || h === "#" ? "#/" : h; };
  const isEditable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const STATE_CLASS = /^(is-|has-|active$|open$|visible$|show$|shown$|in$|in-view|revealed|reveal--in|hover|focus|current|selected|loaded|on$)/;
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const vv = () => {
    const v = window.visualViewport;
    return v ? { x: v.offsetLeft, y: v.offsetTop, w: v.width, h: v.height } : { x: 0, y: 0, w: innerWidth, h: innerHeight };
  };

  function label(el) {
    if (!el || el.nodeType !== 1) return "";
    let s = el.tagName.toLowerCase();
    if (el.id) return s + "#" + el.id;
    const c = [...el.classList].filter((x) => !STATE_CLASS.test(x)).slice(0, 2);
    if (c.length) return s + "." + c.join(".");
    const t = clean(el.textContent);
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
    "color", "background-color", "background-image", "border", "border-radius", "box-shadow", "filter",
    "padding", "margin", "gap", "display", "width", "max-width", "opacity", "animation-name", "transition"];
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

  // Which stylesheet rules apply to this element (later rules win), so the fix lands on the right selector.
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
      if (sh.ownerNode === pageStyle) continue;
      let list; try { list = sh.cssRules; } catch { continue; }
      walk(list, sh.href ? sh.href.split("/").pop().split("?")[0] : "inline <style>", "");
    }
    const seen = new Set();
    return out.filter((r) => { const k = r.file + r.selector + (r.media || ""); if (seen.has(k)) return false; seen.add(k); return true; }).slice(-14);
  }

  const textOf = (el) => clean(el.innerText || el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") || "").slice(0, 160);
  function describe(el) {
    const r = el.getBoundingClientRect();
    const html = el.outerHTML.replace(/\s+/g, " ");
    const d = {
      selector: cssPath(el), label: label(el), text: textOf(el),
      html: html.length > 900 ? html.slice(0, 900) + "…" : html,
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      styles: styles(el), rules: rules(el),
    };
    const dlg = el.closest("dialog");
    if (dlg) d.dialog = dlg.id ? "#" + dlg.id : label(dlg);
    return d;
  }

  // Animated headings are split into one <span> per letter/word; a tap on "A" should mark the heading.
  const FRAGMENT = /(^|[-_])(split|char|chars|letter|letters|word|words)([-_]|$)/i;
  function promote(el) {
    if (el && el.nodeType !== 1) el = el.parentElement;
    if (el && /^(svg|path|use|g|circle|rect|line|polyline|polygon)$/i.test(el.tagName)) el = el.closest("svg") || el;
    if (el && el.tagName && el.tagName.toLowerCase() === "svg" && el.parentElement && el.parentElement.matches("button,a,[role=button]")) el = el.parentElement;
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
  const visible = (r) => r && (r.width > 0 || r.height > 0);
  // Really on screen: rendered, not visibility:hidden, and not cut off by a collapsed parent
  // (folds and menus often hide content with height:0 and overflow:hidden instead of display:none).
  function shownRect(el) {
    if (!el || !el.isConnected) return null;
    try { if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return null; } catch {}
    const r = el.getBoundingClientRect();
    if (!visible(r)) return null;
    let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.position === "fixed") break;
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const ar = a.getBoundingClientRect();
        if (cs.overflowY !== "visible") { top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom); }
        if (cs.overflowX !== "visible") { left = Math.max(left, ar.left); right = Math.min(right, ar.right); }
        if (bottom - top < 2 || right - left < 2) return null;
      }
    }
    return r;
  }

  // ---------- find a comment's element again ----------
  // The selector can drift when the app redraws a list, so the stored text is checked too, and a
  // same-tag element with that text wins over a selector match with different text.
  const cache = new Map();
  function resolve(n) {
    const t = n.target || {};
    const c = cache.get(n.n);
    if (c && shownRect(c)) return c;
    let el = null;
    try { el = t.selector ? document.querySelector(t.selector) : null; } catch {}
    const want = (t.text || "").slice(0, 40);
    if (want && (!el || !textOf(el).startsWith(want))) {
      const tag = ((t.selector || "").split(">").pop().trim().match(/^[a-z0-9-]+/i) || [""])[0] || "*";
      let alt = null;
      try { alt = [...document.querySelectorAll(tag)].find((x) => textOf(x).startsWith(want) && shownRect(x)); } catch {}
      if (alt) el = alt;
    }
    if (el) cache.set(n.n, el);
    return el;
  }
  function anchorRect(n) {
    const el = resolve(n);
    if (!el || !host.parentNode) return null;
    // An element under an open modal dialog can't be seen, so its pin waits.
    if (host.parentNode.tagName === "DIALOG" && !host.parentNode.contains(el)) return null;
    const r = shownRect(el);
    if (!r) return null;
    const g = (n.target || {}).region;
    if (g) {
      const rel = g.rel;
      if (rel && r.width && r.height) return { left: r.left + rel.fx * r.width, top: r.top + rel.fy * r.height, width: rel.fw * r.width, height: rel.fh * r.height, el };
      return { left: r.left + g.x, top: r.top + g.y, width: g.w, height: g.h, el };
    }
    return { left: r.left, top: r.top, width: r.width, height: r.height, el };
  }
  // A comment belongs on this page when it was left on this route, or when its element (with
  // the same text) is on screen now; a hash-routed app shows "#home" and "" as the same view.
  function onThisPage(n) {
    if ((n.page && n.page.route) === route()) return true;
    const t = n.target || {};
    const r = anchorRect(n);
    return !!(r && t.text && textOf(r.el).startsWith(t.text.slice(0, 40)));
  }
  const pageNotes = () => S.notes.filter(onThisPage);
  const shown = (arr) => S.hideDone ? arr.filter((n) => n.status !== "done") : arr;

  // ---------- pins ----------
  const pinClass = (n) => "pin" + (n.status === "done" ? " done" : n.kind === "keep" ? " keep" : n.kind === "bug" ? " bug" : "") + (mine(n) ? " mine" : "");
  function renderPins() {
    pinsEl.textContent = "";
    for (const n of shown(S.notes)) {
      const p = document.createElement("button");
      p.type = "button";
      p.className = pinClass(n);
      p.textContent = n.n;
      p.dataset.n = n.n;
      p.hidden = true;
      p.setAttribute("aria-label", `Comment ${n.n}: ${n.what || n.why || n.fix}`);
      pinsEl.appendChild(p);
    }
    positionPins();
    $(".count").textContent = S.notes.filter((n) => n.status !== "done").length;
    if (S.listOpen) renderList();
  }
  function positionPins() {
    const v = vv(), taken = [];
    for (const p of pinsEl.children) {
      const n = S.notes.find((x) => x.n == p.dataset.n);
      const r = n && onThisPage(n) && anchorRect(n);
      if (!r || r.top > v.y + v.h || r.top + r.height < v.y) { p.hidden = true; continue; }
      p.hidden = false;
      let left = Math.min(Math.max(r.left - 10, 4), innerWidth - 34), top = Math.min(Math.max(r.top - 10, 4), innerHeight - 30);
      while (taken.some(([l, t]) => Math.abs(l - left) < 26 && Math.abs(t - top) < 20)) left += 28; // several comments on one element
      taken.push([left, top]);
      p.style.left = left + "px";
      p.style.top = top + "px";
    }
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; positionPins(); if (S.pop) positionPop(); if (S.card) positionCard(); }); };
  addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", schedule);
  if (window.visualViewport) { visualViewport.addEventListener("resize", schedule); visualViewport.addEventListener("scroll", schedule); }
  setInterval(() => { if (pinsEl.children.length) positionPins(); }, 400); // views, folds and animations move things
  addEventListener("hashchange", () => { closeAll(); cache.clear(); setTimeout(renderPins, 80); setTimeout(renderPins, 900); });

  function fillNote(elm, n, withActions) {
    elm.textContent = "";
    const L = LABELS[n.kind] || LABELS.edit;
    const add = (k, v, cls) => {
      if (!v) return;
      const p = document.createElement("p"); if (cls) p.className = cls;
      const s = document.createElement("span"); s.className = "k"; s.textContent = k;
      p.append(s, v); elm.appendChild(p);
    };
    add(`#${n.n} · ${KIND_NAME[n.kind] || "Edit"} · ${L[0]}`, n.what);
    add(L[1], n.why);
    add(L[2], n.fix);
    add(n.status === "done" ? "Done" : "Reply", n.reply, "reply");
    if (n.name) { const w = document.createElement("p"); w.className = "who"; w.textContent = "From " + n.name; elm.appendChild(w); }
    if (!withActions) return;
    const row = document.createElement("div"); row.className = "row";
    if (mine(n)) {
      const ed = document.createElement("button"); ed.type = "button"; ed.className = "save"; ed.textContent = "Edit";
      ed.onclick = () => editNote(n);
      row.append(ed);
    } else {
      const t = document.createElement("span"); t.className = "note"; t.textContent = "Only the person who wrote this can change it.";
      row.append(t);
    }
    const sp = document.createElement("span"); sp.className = "sp";
    const cl = document.createElement("button"); cl.type = "button"; cl.textContent = "Close"; cl.onclick = closeCard;
    row.append(sp, cl);
    elm.appendChild(row);
  }

  // Desktop: hover a pin to read it. Everyone: tap a pin to open it (yours open straight to edit).
  pinsEl.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || S.card) return;
    const p = e.target.closest(".pin"); if (!p) return;
    const n = S.notes.find((x) => x.n == p.dataset.n); if (!n) return;
    fillNote(tip, n, false);
    tip.hidden = false;
    const r = p.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8)) + "px";
    tip.style.top = (r.bottom + 6 + tip.offsetHeight > innerHeight ? Math.max(8, r.top - tip.offsetHeight - 6) : r.bottom + 6) + "px";
  });
  pinsEl.addEventListener("pointerout", (e) => { if (e.target.closest(".pin")) tip.hidden = true; });
  pinsEl.addEventListener("click", (e) => {
    const p = e.target.closest(".pin"); if (!p) return;
    const n = S.notes.find((x) => x.n == p.dataset.n); if (!n) return;
    tip.hidden = true;
    if (mine(n)) editNote(n); else openCard(n);
  });

  function openCard(n) {
    closePop(); closeCard();
    S.card = { n };
    fillNote(card, n, true);
    card.hidden = false;
    positionCard();
    const r = anchorRect(n); if (r) { sel.hidden = false; place(sel, r); }
    const b = card.querySelector("button"); if (b) b.focus({ preventScroll: true });
  }
  function positionCard() {
    if (!S.card) return;
    const v = vv();
    card.classList.toggle("sheet", narrow());
    if (narrow()) { card.style.left = ""; card.style.top = ""; card.style.bottom = (innerHeight - (v.y + v.h) + 8) + "px"; return; }
    card.style.bottom = "";
    const r = anchorRect(S.card.n);
    if (r) { sel.hidden = false; place(sel, r); }
    const w = card.offsetWidth, h = card.offsetHeight;
    const base = r || { left: v.w / 2 - w / 2, top: v.h / 3, width: 0, height: 0 };
    let top = base.top + base.height + 10;
    if (top + h > v.y + v.h - 8) top = base.top - h - 10;
    if (top < 8) top = Math.max(8, v.y + v.h - h - 8);
    card.style.left = Math.min(Math.max(8, base.left), v.w - w - 8) + "px";
    card.style.top = top + "px";
  }
  function closeCard() { if (!S.card) return; S.card = null; card.hidden = true; if (!S.pop) sel.hidden = true; }

  // ---------- comment form ----------
  const f = { what: pop.elements.what, why: pop.elements.why, fix: pop.elements.fix, name: pop.elements.name };
  try { f.name.value = localStorage.getItem(NAME_LS) || ""; } catch {}
  const extra = $(".extra"), moreBtn = $(".more"), delBtn = $(".del"), saveBtn = $(".save");
  const showExtra = (v) => { extra.hidden = !v; moreBtn.hidden = v; moreBtn.setAttribute("aria-expanded", String(v)); };
  moreBtn.onclick = () => { showExtra(true); f.why.focus(); };
  function setKind(k) {
    pop.dataset.kind = k;
    for (const b of pop.querySelectorAll(".seg button")) { b.classList.toggle("on", b.dataset.kind === k); b.setAttribute("aria-checked", String(b.dataset.kind === k)); }
    const L = LABELS[k] || LABELS.edit;
    $(".l-what").textContent = L[0];
    $(".l-why").innerHTML = L[1] + " <i>optional</i>";
    $(".l-fix").innerHTML = L[2] + " <i>optional</i>";
  }
  pop.querySelector(".seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setKind(b.dataset.kind); });

  function editNote(n) {
    closeCard();
    const r = anchorRect(n);
    openPop({ note: n, el: r ? r.el : null, region: (n.target || {}).region || null });
  }

  function openPop({ el, region = null, note = null }) {
    closeCard();
    tip.hidden = true; hl.hidden = true;
    // Describe the element now: the app may redraw it (and drop this node) while the form is open.
    const desc = el ? Object.assign(describe(el), region ? { region } : {}) : null;
    S.pop = { el, region, note, desc };
    f.what.value = note ? note.what || "" : "";
    f.why.value = note ? note.why || "" : "";
    f.fix.value = note ? note.fix || "" : "";
    showExtra(!!(note && (note.why || note.fix)));
    setKind(note ? note.kind || "edit" : "edit");
    delBtn.hidden = !mine(note);
    delBtn.classList.remove("sure"); delBtn.textContent = "Delete";
    $(".l-name").hidden = !!note;
    $(".kb").hidden = touchy();
    renderCrumbs();
    pop.hidden = false;
    positionPop();
    revealTarget();
    f.what.focus({ preventScroll: true });
  }
  // On a phone the form is a bottom sheet; scroll the page so the chosen thing stays visible above it.
  function revealTarget() {
    if (!narrow() || !S.pop) return;
    const r = currentRect(); if (!r) return;
    const v = vv(), sheetTop = pop.getBoundingClientRect().top;
    if (r.top < v.y + 60 || r.top + Math.min(r.height, 120) > sheetTop - 12) {
      const dy = r.top - (v.y + Math.max(70, (sheetTop - v.y) * 0.3));
      scrollBy({ top: dy, behavior: "smooth" });
    }
  }
  function currentRect() {
    const P = S.pop; if (!P) return null;
    let el = P.el;
    if (el && !el.isConnected && P.desc) {
      try { const again = document.querySelector(P.desc.selector); if (again && textOf(again).startsWith((P.desc.text || "").slice(0, 40))) el = P.el = again; } catch {}
    }
    if (!el || !el.isConnected) return null;
    let r = el.getBoundingClientRect();
    if (!visible(r)) return null;
    if (P.region) {
      const rel = P.region.rel;
      r = rel ? { left: r.left + rel.fx * r.width, top: r.top + rel.fy * r.height, width: rel.fw * r.width, height: rel.fh * r.height }
        : { left: r.left + P.region.x, top: r.top + P.region.y, width: P.region.w, height: P.region.h };
    }
    return r;
  }
  function renderCrumbs() {
    const c = pop.querySelector(".crumbs");
    c.textContent = "";
    const { el, note, region } = S.pop;
    const head = document.createElement("span");
    head.className = "lbl";
    head.textContent = (note ? `Editing #${note.n} · ` : "") + (region ? "Area in" : "On");
    c.appendChild(head);
    if (!el) { const b = document.createElement("button"); b.type = "button"; b.className = "on"; b.textContent = (note.target || {}).label || "element"; c.appendChild(b); return; }
    if (region) { const b = document.createElement("button"); b.type = "button"; b.className = "on"; b.textContent = label(el); c.appendChild(b); return; }
    // the tapped element plus its parents, so a tap that landed on a small part can widen to the card
    const chain = [];
    for (let cur = el; cur && cur !== document.body && cur !== document.documentElement && chain.length < 5; cur = cur.parentElement) chain.push(cur);
    chain.reverse().forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label(a);
      b.title = "Comment on this instead";
      b.classList.toggle("on", a === el);
      b.onclick = () => { S.pop.el = a; S.pop.desc = describe(a); renderCrumbs(); positionPop(); };
      c.appendChild(b);
    });
  }
  function positionPop() {
    if (!S.pop) return;
    const r = currentRect();
    if (r) { sel.hidden = false; place(sel, r); } else sel.hidden = true;
    const v = vv();
    pop.classList.toggle("sheet", narrow());
    if (narrow()) {
      // Above the on-screen keyboard: the visual viewport shrinks when it opens.
      pop.style.left = ""; pop.style.top = "";
      pop.style.bottom = (innerHeight - (v.y + v.h) + 8) + "px";
      pop.style.maxHeight = Math.max(220, v.h * 0.62) + "px";
      return;
    }
    pop.style.bottom = ""; pop.style.maxHeight = (v.h - 16) + "px";
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const b = r || { left: v.w / 2 - w / 2, top: v.h / 3, width: 0, height: 0 };
    let left = Math.min(Math.max(8, b.left), v.w - w - 8);
    let top = b.top + b.height + 10;
    if (top + h > v.y + v.h - 8) top = b.top - h - 10;
    if (top < v.y + 8) {
      // No room above or below: sit beside it, or at the bottom of the screen.
      const right = b.left + b.width + 10;
      if (right + w < v.w - 8) { left = right; top = Math.min(Math.max(v.y + 8, b.top), v.y + v.h - h - 8); }
      else top = Math.max(v.y + 8, v.y + v.h - h - 8);
    }
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }
  function closePop() {
    if (!S.pop) return;
    S.pop = null; pop.hidden = true; sel.hidden = true;
    if (root.activeElement) root.activeElement.blur();
  }
  function closeAll() { closePop(); closeCard(); }

  pop.querySelector(".cancel").onclick = () => closePop();
  delBtn.onclick = async () => {
    const n = S.pop && S.pop.note; if (!n) return;
    if (!delBtn.classList.contains("sure")) { delBtn.classList.add("sure"); delBtn.textContent = "Tap again to delete"; return; }
    const r = await fetch(API + "?n=" + n.n, { method: "DELETE", headers: { "x-edit-key": keys[n.n] || "" } }).catch(() => null);
    if (!r || !r.ok) { toast("Couldn't delete. Try again in a minute."); return; }
    closePop();
    delete keys[n.n]; saveKeys();
    S.notes = S.notes.filter((x) => x.n !== n.n);
    renderPins();
    toast(`Deleted #${n.n}`);
  };
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); pop.requestSubmit(); }
    if (e.key === "Escape") { e.preventDefault(); closePop(); }
  });
  // Esc typed inside the overlay closes only the overlay's own pop-up, never the page's dialog.
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") e.preventDefault(); });
  card.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeCard(); } });

  let saving = false;
  pop.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (saving) return;
    const what = f.what.value.trim(), why = f.why.value.trim(), fix = f.fix.value.trim();
    if (!what && !why && !fix) { f.what.focus(); toast("Write what should change first."); return; }
    const P = S.pop;
    const body = { kind: pop.dataset.kind, what, why, fix };
    if (P.desc && (!P.note || P.desc.selector !== (P.note.target || {}).selector || P.region)) body.target = P.desc;
    if (!P.note) {
      const name = f.name.value.trim();
      body.name = name;
      try { localStorage.setItem(NAME_LS, name); } catch {}
      body.page = { route: route(), url: location.href, viewport: { w: innerWidth, h: innerHeight }, scrollY: Math.round(scrollY), dpr: devicePixelRatio, ua: navigator.userAgent };
    }
    saving = true; saveBtn.disabled = true;
    let res;
    try {
      res = await fetch(P.note ? API + "?n=" + P.note.n : API, {
        method: P.note ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-edit-key": P.note ? keys[P.note.n] || "" : "" },
        body: JSON.stringify(body),
      });
    } catch {}
    saving = false; saveBtn.disabled = false;
    if (!res || !res.ok) {
      // Keep the form open with what they wrote.
      toast(res && res.status === 429 ? "That's a lot of comments at once. Try again in a few minutes."
        : res && res.status === 403 ? "Only the browser that wrote this comment can change it."
        : "Couldn't save. Check your connection and try again.");
      return;
    }
    const out = await res.json();
    const saved = out.note;
    if (out.key) { keys[saved.n] = out.key; saveKeys(); }
    const i = S.notes.findIndex((x) => x.n === saved.n);
    if (i < 0) S.notes.push(saved); else S.notes[i] = saved;
    if (P.el) cache.set(saved.n, P.el);
    closePop();
    setOn(false); // back to the normal page, so menus and links work again
    renderPins();
    toast(P.note ? `Updated #${saved.n}` : `Thanks! Comment #${saved.n} is saved.`);
    load(true);
  });

  // ---------- list ----------
  function renderList() {
    const items = list.querySelector(".items");
    items.textContent = "";
    const notes = shown(S.listAll ? S.notes : pageNotes());
    const open = S.notes.filter((n) => n.status !== "done").length;
    list.querySelector("h3").textContent = `Comments · ${open} open`;
    list.querySelector(".f-page").classList.toggle("on", !S.listAll);
    list.querySelector(".f-all").classList.toggle("on", S.listAll);
    list.querySelector(".f-done").classList.toggle("on", S.hideDone);
    if (!S.loaded) { items.innerHTML = `<div class="empty">Loading comments…</div>`; return; }
    if (!notes.length) {
      items.innerHTML = `<div class="empty">${S.listAll ? "No comments yet." : "No comments on this page yet."}<br>Tap <b>Comment</b>, then tap anything you want changed.</div>`;
      return;
    }
    for (const n of [...notes].reverse()) {
      const row = document.createElement("div");
      row.className = "item";
      const pin = document.createElement("span");
      pin.className = pinClass(n);
      pin.textContent = n.n;
      const body = document.createElement("div"); body.className = "body";
      const t = document.createElement("div"); t.textContent = n.what || n.why || n.fix;
      const m = document.createElement("div"); m.className = "meta";
      m.textContent = [KIND_NAME[n.kind], S.listAll && n.page && n.page.route, (n.target || {}).label, n.name && "from " + n.name, mine(n) && "yours"].filter(Boolean).join(" · ");
      body.append(t, m);
      if (n.reply) { const r = document.createElement("div"); r.className = "reply"; r.textContent = (n.status === "done" ? "Done: " : "Reply: ") + n.reply; body.appendChild(r); }
      const acts = document.createElement("div"); acts.className = "acts";
      const show = document.createElement("button"); show.type = "button"; show.className = "it-btn"; show.textContent = "Show";
      show.onclick = () => jump(n);
      acts.appendChild(show);
      if (mine(n)) {
        const ed = document.createElement("button"); ed.type = "button"; ed.className = "it-btn"; ed.textContent = "Edit";
        ed.onclick = () => { if (narrow()) toggleList(false); editNote(n); };
        acts.appendChild(ed);
      }
      body.appendChild(acts);
      row.append(pin, body);
      items.appendChild(row);
    }
  }
  function jump(n) {
    const go = () => {
      const r = anchorRect(n);
      if (!r) { toast(`#${n.n}: that part isn't on screen. It may be inside a menu or pop-up, or it has changed.`); return; }
      if (narrow()) toggleList(false);
      r.el.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => {
        const a = anchorRect(n); if (!a) return;
        const fl = document.createElement("div"); fl.className = "flash"; place(fl, a); root.appendChild(fl);
        setTimeout(() => fl.remove(), 1500);
      }, 500);
    };
    if (n.page && n.page.route && n.page.route !== route() && !anchorRect(n)) { location.hash = n.page.route; setTimeout(go, 1000); } else go();
  }
  function toggleList(v) {
    S.listOpen = v === undefined ? !S.listOpen : v;
    list.hidden = !S.listOpen;
    list.classList.toggle("sheet", narrow());
    $(".open-list").setAttribute("aria-expanded", String(S.listOpen));
    if (S.listOpen) { closeAll(); renderList(); }
  }
  $(".open-list").onclick = () => toggleList();
  list.querySelector(".close").onclick = () => toggleList(false);
  list.querySelector(".f-page").onclick = () => { S.listAll = false; renderList(); };
  list.querySelector(".f-all").onclick = () => { S.listAll = true; renderList(); };
  list.querySelector(".f-done").onclick = () => { S.hideDone = !S.hideDone; renderPins(); renderList(); };
  list.querySelector(".copy").onclick = async () => {
    const txt = S.notes.filter((n) => n.status !== "done").map((n) =>
      [`#${n.n} [${n.kind}] ${(n.page || {}).route} ${(n.target || {}).selector}`, n.what && `What: ${n.what}`, n.why && `Details: ${n.why}`, n.fix && `Should be: ${n.fix}`].filter(Boolean).join("\n")).join("\n\n");
    try { await navigator.clipboard.writeText(txt); toast("Copied open comments"); } catch { toast("Your browser blocked copying."); }
  };
  list.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleList(false); });

  let toastTimer = 0;
  function toast(msg) {
    root.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; root.appendChild(t);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2600);
  }

  // ---------- comment mode ----------
  function hintText() {
    $(".hint-t").innerHTML = touchy()
      ? "<b>Tap</b> the thing you want to comment on"
      : "<b>Click</b> anything to comment on it, or drag a box around an area. <b>Esc</b> stops.";
  }
  function setOn(v) {
    S.on = v;
    markBtn.classList.toggle("on", v);
    markBtn.setAttribute("aria-pressed", String(v));
    $(".mark-t").textContent = v ? "Commenting…" : "Comment";
    hintText();
    hint.hidden = !v;
    document.documentElement.classList.toggle("fh-marking", v);
    if (v) { closeAll(); if (S.listOpen && narrow()) toggleList(false); }
    if (!v) { hl.hidden = true; box.hidden = true; S.drag = null; }
  }
  markBtn.onclick = () => { if (!intro.hidden) dismissIntro(); setOn(!S.on); };
  $(".stop").onclick = () => setOn(false);

  function showHover(el) {
    if (!el || el === document.documentElement || el === document.body) { hl.hidden = true; return; }
    S.hoverEl = el;
    const r = el.getBoundingClientRect();
    hl.hidden = false;
    place(hl, r);
    hl.classList.toggle("below", r.top < 26);
    hl.querySelector(".tag").textContent = `${label(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  // While picking, the page must not react: no links, buttons, menus or focus changes. Only the
  // events of the pick itself are blocked, and only for a moment afterwards, so normal clicks
  // never get eaten once comment mode is off.
  const picking = (e) => S.on || (e.altKey && !touchy()) || Date.now() < S.swallowUntil;
  for (const type of ["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"]) {
    addEventListener(type, (e) => {
      if (inOurs(e)) return;
      if (picking(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }
  addEventListener("pointermove", (e) => {
    if (inOurs(e)) { if (!S.drag) hl.hidden = true; return; }
    if (S.drag) {
      const d = S.drag;
      d.x = e.clientX; d.y = e.clientY;
      if (!d.active && Math.hypot(d.x - d.x0, d.y - d.y0) > 8) {
        if (d.touch) { S.drag = null; return; } // a finger moving is a scroll, not a box
        d.active = true; hl.hidden = true;
      }
      if (d.active) { box.hidden = false; place(box, { left: Math.min(d.x0, d.x), top: Math.min(d.y0, d.y), width: Math.abs(d.x - d.x0), height: Math.abs(d.y - d.y0) }); }
      return;
    }
    if (e.pointerType === "mouse" && (S.on || e.altKey) && !S.pop) showHover(promote(e.target));
    else if (!S.pop) hl.hidden = true;
  }, true);
  addEventListener("pointerdown", (e) => {
    if (inOurs(e) || e.button !== 0) return;
    if (!(S.on || (e.altKey && e.pointerType === "mouse"))) {
      // A tap on the page closes a reading card, like any pop-up.
      if (S.card) closeCard();
      return;
    }
    if (e.pointerType === "mouse") e.preventDefault(); // keeps focus (and open menus) where they are
    e.stopImmediatePropagation();
    if (S.pop) {
      if (f.what.value.trim() || f.why.value.trim() || f.fix.value.trim()) { pop.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], 180); return; }
      closePop();
    }
    S.drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, touch: e.pointerType !== "mouse", el: promote(e.target) };
  }, true);
  addEventListener("dragstart", (e) => { if (S.on || S.drag || e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  addEventListener("pointercancel", () => { if (S.drag) { S.drag = null; box.hidden = true; } }, true);
  addEventListener("pointerup", (e) => {
    const d = S.drag; if (!d) return;
    e.preventDefault(); e.stopImmediatePropagation();
    S.drag = null; box.hidden = true;
    S.swallowUntil = Date.now() + 500; // the click that follows this pointerup
    if (!d.active) { if (d.el) openPop({ el: d.el }); return; }
    // Area: pin it to the smallest element that holds the whole box; keep it as fractions too, so
    // it lands in the same place on another screen size.
    const L = Math.min(d.x0, d.x), T = Math.min(d.y0, d.y), W = Math.abs(d.x - d.x0), H = Math.abs(d.y - d.y0);
    let c = document.elementFromPoint(L + W / 2, T + H / 2);
    while (c && c !== document.body) {
      const r = c.getBoundingClientRect();
      if (r.left <= L + 4 && r.top <= T + 4 && r.right >= L + W - 4 && r.bottom >= T + H - 4) break;
      c = c.parentElement;
    }
    c = c && !host.contains(c) ? c : document.body;
    const cr = c.getBoundingClientRect();
    const region = { x: Math.round(L - cr.left), y: Math.round(T - cr.top), w: Math.round(W), h: Math.round(H) };
    if (cr.width && cr.height) region.rel = { fx: +((L - cr.left) / cr.width).toFixed(4), fy: +((T - cr.top) / cr.height).toFixed(4), fw: +(W / cr.width).toFixed(4), fh: +(H / cr.height).toFixed(4) };
    openPop({ el: c, region });
  }, true);

  addEventListener("keydown", (e) => {
    if (inOurs(e)) return;
    if (e.key === "`" && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); setOn(!S.on); return; }
    if (e.key === "Escape" && (S.on || S.pop || S.card)) { e.preventDefault(); e.stopImmediatePropagation(); if (S.pop) closePop(); else if (S.card) closeCard(); else setOn(false); }
  }, true);
  addEventListener("keyup", (e) => { if (e.key === "Alt" && !S.on && !S.pop) hl.hidden = true; }, true);
  addEventListener("blur", () => { if (!S.on && !S.pop) hl.hidden = true; });
  addEventListener("resize", () => { if (S.listOpen) list.classList.toggle("sheet", narrow()); hintText(); });

  // ---------- intro ----------
  function dismissIntro() { intro.hidden = true; try { localStorage.setItem(INTRO_LS, "1"); } catch {} }
  try { if (!localStorage.getItem(INTRO_LS)) intro.hidden = false; } catch {}
  $(".intro-ok").onclick = dismissIntro;

  // ---------- data ----------
  // Keeps the last good list if a load fails, so pins never vanish on a bad connection, and keeps
  // a comment just saved here even if the server's list hasn't caught up yet.
  async function load(fresh) {
    try {
      const r = await fetch(API + (fresh ? "?fresh=1" : ""), { cache: "no-store" });
      if (r.ok) {
        const got = (await r.json()).notes || [];
        const recent = S.notes.filter((n) => mine(n) && !got.some((g) => g.n === n.n) && Date.now() - Date.parse(n.created || 0) < 60000);
        S.notes = got.concat(recent).sort((a, b) => a.n - b.n);
        S.loaded = true;
      }
    } catch {}
    if (!S.pop) renderPins(); else positionPins();
  }
  setInterval(() => { if (!document.hidden && !S.pop) load(); }, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  load();
  setTimeout(renderPins, 1200); // views and reveals settle after the first paint
})();
