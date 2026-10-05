/* =========================================================================
   game-core.js
   캠페인관 미니게임 공용 오버레이 / 저장 / 사운드 / 유틸

   - 일반 <script src="..."> 로 불러온다 (type="module" 금지).
   - window.GameCore 전역 하나만 노출한다.
   - 각 게임 모듈은 window.CampaignGames.<id> = { id, title, icon, mount(root, api) }
     형태로 자기 자신을 등록하고, GameCore.openGame(id, onExit) 으로 실행한다.
========================================================================= */
(function () {
  "use strict";

  const CFG = window.ConfigData || {};
  const THEME = CFG.theme || {};
  const COLORS = THEME.colors || {};

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* -----------------------------------------------------------------------
     스타일 주입 (최초 1회)
  ----------------------------------------------------------------------- */
  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const css = `
    #gc-overlay{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;
      background:rgba(44,48,40,0.55);backdrop-filter:blur(6px);font-family:${THEME.font || '"Noto Sans KR",sans-serif'};}
    #gc-card{position:relative;width:min(1100px,94vw);height:min(680px,90vh);
      background:${COLORS.oliveDark || "#5C6353"};border-radius:${(THEME.radius && THEME.radius.lg) || 28}px;
      box-shadow:0 30px 80px rgba(20,24,18,0.45);display:flex;flex-direction:column;overflow:hidden;
      border:1px solid rgba(247,245,234,0.14);}
    #gc-header{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;
      background:${COLORS.cardDark || "rgba(63,69,58,0.88)"};border-bottom:1px solid rgba(247,245,234,0.12);flex-shrink:0;}
    #gc-title{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:800;color:${COLORS.paper || "#F7F5EA"};}
    #gc-icon{font-size:24px;}
    #gc-controls{display:flex;align-items:center;gap:10px;}
    #gc-best{font-size:12.5px;color:${COLORS.halo || "#CBEF7E"};font-weight:700;background:rgba(0,0,0,0.18);padding:6px 12px;border-radius:999px;}
    #gc-mute,#gc-close{border:none;background:rgba(247,245,234,0.12);color:${COLORS.paper || "#F7F5EA"};
      width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;
      transition:background .15s ease;}
    #gc-mute:hover,#gc-close:hover{background:rgba(247,245,234,0.25);}
    #gc-body{position:relative;flex:1;overflow:auto;color:${COLORS.paper || "#F7F5EA"};}
    #gc-pause{position:absolute;inset:0;z-index:10;display:none;align-items:center;justify-content:center;
      background:rgba(20,22,18,0.72);}
    #gc-pause .gc-pausecard{background:${COLORS.cardDarker || "#4A5145"};border-radius:${(THEME.radius && THEME.radius.md) || 18}px;
      padding:32px 36px;text-align:center;color:${COLORS.paper || "#F7F5EA"};box-shadow:0 20px 50px rgba(0,0,0,0.4);}
    #gc-pause h3{margin:0 0 18px;font-size:20px;}
    .gc-intro,.gc-result{max-width:720px;margin:0 auto;padding:34px 36px 40px;text-align:center;color:${COLORS.paper || "#F7F5EA"};}
    .gc-intro h2,.gc-result h2{font-size:24px;margin:0 0 14px;}
    .gc-rules{text-align:left;background:rgba(0,0,0,0.16);border-radius:${(THEME.radius && THEME.radius.sm) || 12}px;
      padding:16px 20px;margin:0 0 16px;}
    .gc-rules p{margin:6px 0;font-size:13.5px;line-height:1.6;}
    .gc-controlslist{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 22px;}
    .gc-kbd{background:rgba(247,245,234,0.12);border:1px solid rgba(247,245,234,0.3);border-radius:8px;
      padding:6px 12px;font-size:12px;}
    .gc-btn{border:1px solid rgba(247,245,234,0.3);background:rgba(247,245,234,0.1);color:${COLORS.paper || "#F7F5EA"};
      border-radius:14px;padding:11px 22px;font-size:14px;cursor:pointer;font-family:inherit;transition:background .15s ease;}
    .gc-btn:hover{background:rgba(247,245,234,0.2);}
    .gc-primary{background:${COLORS.gold || "#F3C64B"};color:#3a2e12;border-color:${COLORS.gold || "#F3C64B"};font-weight:800;}
    .gc-primary:hover{background:${COLORS.goldDeep || "#D9942B"};}
    .gc-score{font-size:40px;font-weight:900;margin:6px 0 18px;color:${COLORS.gold || "#F3C64B"};}
    .gc-newbest{display:inline-block;margin-left:10px;font-size:13px;background:${COLORS.halo || "#CBEF7E"};
      color:#1f3310;padding:4px 10px;border-radius:999px;font-weight:800;vertical-align:middle;}
    .gc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0 0 20px;}
    .gc-stat{background:rgba(0,0,0,0.16);border-radius:12px;padding:12px;font-size:12.5px;}
    .gc-stat span{display:block;color:${COLORS.halo || "#CBEF7E"};font-size:11px;margin-bottom:4px;}
    .gc-stat b{font-size:16px;}
    .gc-fact{background:rgba(243,198,75,0.12);border:1px solid rgba(243,198,75,0.35);border-radius:14px;
      padding:14px 18px;text-align:left;margin:0 0 14px;}
    .gc-fact-title{font-size:11px;letter-spacing:2px;font-weight:800;color:${COLORS.gold || "#F3C64B"};margin-bottom:6px;}
    .gc-fact p{margin:0;font-size:13px;line-height:1.7;}
    .gc-disclaimer{font-size:10.5px;color:rgba(247,245,234,0.55);margin:0 0 20px;}
    .gc-actions{display:flex;gap:10px;justify-content:center;}
    @media (max-width:700px){ #gc-card{width:96vw;height:92vh;} .gc-intro,.gc-result{padding:22px 18px 28px;} }
    `;
    const styleEl = document.createElement("style");
    styleEl.id = "gc-styles";
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  /* -----------------------------------------------------------------------
     DOM 오버레이 구성 (최초 1회)
  ----------------------------------------------------------------------- */
  let overlayEl, bodyEl, pauseEl;
  function ensureOverlay() {
    if (overlayEl) return;
    injectStyles();
    overlayEl = document.createElement("div");
    overlayEl.id = "gc-overlay";
    overlayEl.innerHTML =
      '<div id="gc-card">' +
      '<div id="gc-header">' +
      '<div id="gc-title"><span id="gc-icon"></span><span id="gc-titletext"></span></div>' +
      '<div id="gc-controls">' +
      '<span id="gc-best"></span>' +
      '<button id="gc-mute" type="button" aria-label="소리 켬/끔"></button>' +
      '<button id="gc-close" type="button" aria-label="닫기">✕</button>' +
      "</div>" +
      "</div>" +
      '<div id="gc-body">' +
      '<div id="gc-pause"><div class="gc-pausecard"><h3>⏸ 일시정지</h3>' +
      '<div class="gc-actions"><button class="gc-btn" id="gc-pause-exit">나가기</button>' +
      '<button class="gc-btn gc-primary" id="gc-pause-resume">계속하기</button></div></div></div>' +
      '<div id="gc-content"></div>' +
      "</div>" +
      "</div>";
    document.body.appendChild(overlayEl);
    bodyEl = overlayEl.querySelector("#gc-content");
    pauseEl = overlayEl.querySelector("#gc-pause");
    overlayEl.querySelector("#gc-close").onclick = () => closeCurrent();
    overlayEl.querySelector("#gc-mute").onclick = toggleMute;
    overlayEl.querySelector("#gc-pause-resume").onclick = () => setPaused(false);
    overlayEl.querySelector("#gc-pause-exit").onclick = () => closeCurrent();
  }

  /* -----------------------------------------------------------------------
     음소거 저장
  ----------------------------------------------------------------------- */
  const MUTE_KEY = (CFG.common && CFG.common.muteKey) || "capybara.mute";
  function loadMute() {
    try { return localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { return false; }
  }
  function saveMute(v) {
    try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch (e) {}
  }
  let muted = loadMute();
  function toggleMute() {
    muted = !muted;
    saveMute(muted);
    updateMuteLabel();
  }
  function updateMuteLabel() {
    if (!overlayEl) return;
    overlayEl.querySelector("#gc-mute").textContent = muted ? "🔇" : "🔊";
  }

  /* -----------------------------------------------------------------------
     WebAudio 합성 효과음
  ----------------------------------------------------------------------- */
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }
  const SFX_DEFS = {
    click: { freq: 620, dur: 0.05, type: "square", gain: 0.05 },
    good: { freq: 880, dur: 0.12, type: "sine", gain: 0.07 },
    bad: { freq: 150, dur: 0.22, type: "sawtooth", gain: 0.07 },
    merge: { freq: 520, dur: 0.1, type: "triangle", gain: 0.06 },
    levelup: { freq: 1046, dur: 0.28, type: "sine", gain: 0.08, slideTo: 1568 },
    win: { freq: 784, dur: 0.45, type: "sine", gain: 0.08, slideTo: 1046 },
    lose: { freq: 140, dur: 0.45, type: "sawtooth", gain: 0.08, slideTo: 60 },
    tick: { freq: 1200, dur: 0.03, type: "square", gain: 0.03 },
  };
  function sfx(name) {
    if (muted) return;
    const def = SFX_DEFS[name];
    if (!def) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = def.type;
      osc.frequency.setValueAtTime(def.freq, ctx.currentTime);
      if (def.slideTo) osc.frequency.exponentialRampToValueAtTime(def.slideTo, ctx.currentTime + def.dur);
      gain.gain.setValueAtTime(def.gain, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + def.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + def.dur);
    } catch (e) {}
  }

  /* -----------------------------------------------------------------------
     최고점 저장 (localStorage)
  ----------------------------------------------------------------------- */
  const BEST_PREFIX = (CFG.common && CFG.common.bestKeyPrefix) || "capybara.best.";
  function getBest(id) {
    try { return Number(localStorage.getItem(BEST_PREFIX + id) || 0); } catch (e) { return 0; }
  }
  function saveBest(id, score) {
    try {
      const cur = getBest(id);
      if (score > cur) {
        localStorage.setItem(BEST_PREFIX + id, String(Math.round(score)));
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
  function updateBestLabel() {
    if (!overlayEl || !current) return;
    overlayEl.querySelector("#gc-best").textContent = "최고점 " + getBest(current.def.id);
  }

  /* -----------------------------------------------------------------------
     intro / result 공통 화면
  ----------------------------------------------------------------------- */
  function showIntro(opts, onStart) {
    opts = opts || {};
    bodyEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "gc-intro";
    wrap.innerHTML =
      "<h2>" + esc(opts.title || "") + "</h2>" +
      '<div class="gc-rules">' + (opts.rules || []).map((r) => "<p>" + esc(r) + "</p>").join("") + "</div>" +
      (opts.controls && opts.controls.length
        ? '<div class="gc-controlslist">' + opts.controls.map((c) => '<span class="gc-kbd">' + esc(c) + "</span>").join("") + "</div>"
        : "") +
      '<button class="gc-btn gc-primary" id="gc-start-btn">시작하기</button>';
    bodyEl.appendChild(wrap);
    wrap.querySelector("#gc-start-btn").onclick = () => {
      sfx("click");
      onStart && onStart();
    };
  }

  function showResult(opts) {
    opts = opts || {};
    const isNew = current ? saveBest(current.def.id, opts.score || 0) : false;
    updateBestLabel();
    bodyEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "gc-result";
    wrap.innerHTML =
      "<h2>결과</h2>" +
      '<div class="gc-score">' + Math.round(opts.score || 0) + "점" + (isNew ? '<span class="gc-newbest">신기록!</span>' : "") + "</div>" +
      '<div class="gc-stats">' +
      (opts.stats || []).map((s) => '<div class="gc-stat"><span>' + esc(s.label) + "</span><b>" + esc(String(s.value)) + "</b></div>").join("") +
      "</div>" +
      (opts.fact
        ? '<div class="gc-fact"><div class="gc-fact-title">' + esc(opts.factTitle || "알아두기") + "</div><p>" + esc(opts.fact) + "</p></div>"
        : "") +
      '<p class="gc-disclaimer">' + esc((CFG && CFG.disclaimer) || "") + "</p>" +
      '<div class="gc-actions">' +
      '<button class="gc-btn" id="gc-retry-btn">다시하기</button>' +
      '<button class="gc-btn gc-primary" id="gc-lobby-btn">로비로</button>' +
      "</div>";
    bodyEl.appendChild(wrap);
    sfx(isNew ? "win" : (opts.score > 0 ? "good" : "lose"));
    // 주의: 일시정지 팝업도 .gc-actions 클래스를 쓰므로, 버튼은 항상 이 wrap 안에서만 찾는다.
    const actionsEl = wrap.querySelector(".gc-actions");
    (opts.extraActions || []).forEach((a) => {
      const b = document.createElement("button");
      b.className = "gc-btn";
      b.textContent = a.label;
      b.onclick = () => a.onClick && a.onClick(b);
      actionsEl.insertBefore(b, actionsEl.firstChild);
    });
    wrap.querySelector("#gc-retry-btn").onclick = () => {
      sfx("click");
      restartCurrent();
    };
    wrap.querySelector("#gc-lobby-btn").onclick = () => {
      sfx("click");
      closeCurrent();
    };
  }

  /* -----------------------------------------------------------------------
     일시정지 (ESC)
  ----------------------------------------------------------------------- */
  let paused = false;
  function isPaused() {
    return paused;
  }
  function setPaused(v) {
    paused = v;
    if (pauseEl) pauseEl.style.display = v ? "flex" : "none";
  }
  function escKeyHandler(e) {
    if (e.code !== "Escape" || !current) return;
    e.preventDefault();
    setPaused(!paused);
  }

  /* -----------------------------------------------------------------------
     게임 열기 / 닫기 / 재시작
  ----------------------------------------------------------------------- */
  let current = null; // { def, instance, api, onExit }

  function buildApi(def) {
    return {
      showIntro,
      showResult,
      getBest: () => getBest(def.id),
      saveBest: (score) => saveBest(def.id, score),
      sfx,
      isPaused,
      exit: () => closeCurrent(),
    };
  }

  function isOverlayOpen() {
    return !!current;
  }

  function openGame(id, onExit) {
    const def = (window.CampaignGames || {})[id];
    if (!def) {
      console.error("[GameCore] unknown game id:", id);
      return;
    }
    ensureOverlay();
    setPaused(false);
    current = { def, instance: null, onExit: onExit };
    overlayEl.querySelector("#gc-icon").textContent = def.icon || "";
    overlayEl.querySelector("#gc-titletext").textContent = def.title || "";
    updateBestLabel();
    updateMuteLabel();
    overlayEl.style.display = "flex";
    document.addEventListener("keydown", escKeyHandler);
    const api = buildApi(def);
    current.api = api;
    try {
      current.instance = def.mount(bodyEl, api) || null;
    } catch (err) {
      console.error("[GameCore] mount failed for", id, err);
    }
  }

  function restartCurrent() {
    if (!current) return;
    setPaused(false);
    try { current.instance && current.instance.destroy && current.instance.destroy(); } catch (e) {}
    try { current.instance = current.def.mount(bodyEl, current.api) || null; } catch (err) { console.error(err); }
  }

  function closeCurrent() {
    if (!current) return;
    setPaused(false);
    try { current.instance && current.instance.destroy && current.instance.destroy(); } catch (e) {}
    document.removeEventListener("keydown", escKeyHandler);
    overlayEl.style.display = "none";
    bodyEl.innerHTML = "";
    const onExit = current.onExit;
    current = null;
    try { onExit && onExit(); } catch (e) {}
  }

  window.GameCore = {
    openGame,
    closeCurrent,
    isOverlayOpen,
    getBest,
    saveBest,
    sfx,
  };

  /* -----------------------------------------------------------------------
     셀프테스트 (콘솔에서 확인)
  ----------------------------------------------------------------------- */
  console.assert(typeof window.GameCore.openGame === "function", "[game-core] openGame 함수가 있어야 함");
  console.assert(getBest("__selftest__") === 0, "[game-core] 저장된 적 없는 최고점은 0");
  console.assert(saveBest("__selftest__", 10) === true, "[game-core] 첫 저장은 신기록이어야 함");
  console.assert(saveBest("__selftest__", 5) === false, "[game-core] 더 낮은 점수는 신기록이 아니어야 함");
  console.assert(getBest("__selftest__") === 10, "[game-core] 최고점이 10으로 저장돼 있어야 함");
  try { localStorage.removeItem(BEST_PREFIX + "__selftest__"); } catch (e) {}
})();
