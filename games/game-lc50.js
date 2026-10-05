/* =========================================================================
   game-lc50.js — LC50 푸시 유어 럭
   농도를 올릴수록 점수가 커지지만 물벼룩이 전멸하면 그 판 점수가 날아가는
   치킨 게임 + 모은 데이터로 LC50를 직접 추정하는 보너스 단계.
========================================================================= */
(function () {
  "use strict";

  const CFG = window.ConfigData.lc50;

  /* =========================================================================
     순수 로직 (UI와 분리) — 콘솔에서 self-test 결과를 확인할 수 있다.
  ========================================================================= */

  // 로그균등 난수: min~max 사이를 곱셈적으로 고르게 뽑는다.
  function logUniform(min, max, rng) {
    rng = rng || Math.random;
    const lo = Math.log(min), hi = Math.log(max);
    return Math.exp(lo + rng() * (hi - lo));
  }

  // 로지스틱 용량-반응 곡선: concentration === lc50 이면 정확히 0.5
  function mortalityProbability(concentration, lc50, slope) {
    if (concentration <= 0) return 0;
    return 1 / (1 + Math.pow(lc50 / concentration, slope));
  }

  function sampleBinomial(n, p, rng) {
    rng = rng || Math.random;
    let count = 0;
    for (let i = 0; i < n; i++) if (rng() < p) count++;
    return count;
  }

  // 한 농도 단계의 24h/48h 관찰값. 이전 단계보다 줄어들지 않도록 보정.
  function computeStepObservation(p) {
    const p24 = mortalityProbability(p.concentration, p.lc50 * p.h24Multiplier, p.slope);
    const p48 = mortalityProbability(p.concentration, p.lc50 * p.h48Multiplier, p.slope);
    let n24 = sampleBinomial(p.count, p24, p.rng);
    let n48 = sampleBinomial(p.count, p48, p.rng);
    if (p.prevN24 != null) n24 = Math.max(n24, p.prevN24);
    if (p.prevN48 != null) n48 = Math.max(n48, p.prevN48);
    n48 = Math.max(n48, n24); // 48h는 24h보다 적게 정지할 수 없다
    return { p24, p48, n24, n48 };
  }

  function computeStepScore(stepNumber1based, n48, cfg) {
    if (n48 >= cfg.scoring.bustThreshold) return { bust: true, points: 0, meaningfulBonus: false };
    const [lo, hi] = cfg.scoring.meaningfulDataRange;
    const meaningfulBonus = n48 >= lo && n48 <= hi;
    const points = stepNumber1based * cfg.scoring.perStepBase + (meaningfulBonus ? cfg.scoring.meaningfulDataBonus : 0);
    return { bust: false, points, meaningfulBonus };
  }

  function estimateMultiplier(guessConcentration, actualLC50, cfg) {
    const e = Math.abs(Math.log10(guessConcentration) - Math.log10(actualLC50));
    return Math.max(cfg.estimation.minMultiplier, cfg.estimation.maxMultiplier - cfg.estimation.errorPenaltyFactor * e);
  }

  function gradeForScore(score, grades) {
    let label = grades[0].label;
    for (const g of grades) if (score >= g.minScore) label = g.label;
    return label;
  }

  /* ---------------------------- self-test ------------------------------- */
  (function selfTest() {
    const approx = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);
    console.assert(approx(mortalityProbability(40, 40, 2.2), 0.5), "[lc50] c===lc50 이면 사망확률 0.5");
    console.assert(mortalityProbability(0.001, 40, 2.2) < 0.01, "[lc50] 농도가 아주 낮으면 사망확률도 낮아야 함");
    console.assert(mortalityProbability(10000, 40, 2.2) > 0.99, "[lc50] 농도가 아주 높으면 사망확률도 높아야 함");

    console.assert(sampleBinomial(10, 0, () => 0.5) === 0, "[lc50] p=0 이면 항상 0");
    console.assert(sampleBinomial(10, 1, () => 0.5) === 10, "[lc50] p=1 이면 항상 n");

    const obsLow = computeStepObservation({
      concentration: 0.5, lc50: 40, slope: 2.2, h24Multiplier: 1.5, h48Multiplier: 1.0,
      count: 10, prevN24: 4, prevN48: 6, rng: () => 0.999,
    });
    console.assert(obsLow.n24 >= 4 && obsLow.n48 >= 6, "[lc50] 이전 단계보다 낮은 값으로 내려가면 안 됨(단조 보정)");
    console.assert(obsLow.n48 >= obsLow.n24, "[lc50] 48h 정지 수는 24h보다 적을 수 없음");

    const normalScore = computeStepScore(3, 5, CFG);
    console.assert(!normalScore.bust && normalScore.meaningfulBonus && normalScore.points === 3 * CFG.scoring.perStepBase + CFG.scoring.meaningfulDataBonus, "[lc50] 3단계·5마리 정지 점수 계산");
    const bustScore = computeStepScore(5, CFG.scoring.bustThreshold, CFG);
    console.assert(bustScore.bust, "[lc50] 임계값 이상이면 BUST");
    const noBonusScore = computeStepScore(2, 0, CFG);
    console.assert(!noBonusScore.bust && !noBonusScore.meaningfulBonus && noBonusScore.points === 2 * CFG.scoring.perStepBase, "[lc50] 보너스 범위 밖이면 보너스 없음");

    console.assert(approx(estimateMultiplier(40, 40, CFG), CFG.estimation.maxMultiplier), "[lc50] 정확히 맞히면 최대 배율");
    console.assert(estimateMultiplier(4000, 40, CFG) === CFG.estimation.minMultiplier, "[lc50] 크게 틀리면 최소 배율로 clamp");

    console.assert(gradeForScore(0, CFG.grades) === "수질 견습생", "[lc50] 0점 등급");
    console.assert(gradeForScore(2400, CFG.grades) === "갑천 수호자", "[lc50] 최고 등급 경계값");
    console.assert(gradeForScore(2399, CFG.grades) === "독성 분석가", "[lc50] 최고 등급 바로 아래");
  })();

  /* =========================================================================
     UI / 게임 모듈
  ========================================================================= */
  function mount(root, api) {
    let destroyed = false;
    const timers = [];
    let rafId = null;
    function later(fn, ms) {
      const id = setTimeout(() => { if (!destroyed) fn(); }, ms);
      timers.push(id);
      return id;
    }

    let el = {};
    let bctx, gctx;

    function buildUI() {
      root.innerHTML =
      '<div class="lc50-wrap">' +
      '<style>' +
      ".lc50-wrap{display:flex;flex-direction:column;height:100%;padding:18px 24px;box-sizing:border-box;}" +
      ".lc50-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:13px;}" +
      ".lc50-top .sample{color:#F3C64B;font-weight:700;}" +
      ".lc50-scores b{color:#CBEF7E;}" +
      ".lc50-main{display:flex;gap:18px;flex:1;min-height:0;}" +
      ".lc50-beaker,.lc50-graph{background:rgba(0,0,0,0.18);border-radius:16px;padding:12px;display:flex;flex-direction:column;align-items:center;}" +
      ".lc50-beaker{width:300px;flex-shrink:0;}" +
      ".lc50-graph{flex:1;min-width:0;}" +
      "#lc50-beaker-status{font-size:12.5px;margin-top:8px;min-height:36px;text-align:center;line-height:1.5;}" +
      ".lc50-actions{display:flex;gap:10px;justify-content:center;margin-top:14px;}" +
      ".lc50-actions button{border:1px solid rgba(247,245,234,.3);background:rgba(247,245,234,.1);color:#F7F5EA;border-radius:14px;padding:11px 20px;font-size:13.5px;cursor:pointer;font-family:inherit;}" +
      ".lc50-actions button:disabled{opacity:.35;cursor:not-allowed;}" +
      ".lc50-actions button.primary{background:#F3C64B;color:#3a2e12;font-weight:800;border-color:#F3C64B;}" +
      ".lc50-estimate-note{font-size:12.5px;color:rgba(247,245,234,.8);text-align:center;margin-top:8px;}" +
      "</style>" +
      '<div class="lc50-top">' +
      '<div>라운드 <b id="lc50-roundnum">1</b>/' + CFG.rounds.length + " · <span class=\"sample\" id=\"lc50-sample\"></span></div>" +
      '<div class="lc50-scores">임시 점수 <b id="lc50-temp">0</b> · 저장된 점수 <b id="lc50-saved">0</b></div>' +
      "</div>" +
      '<div class="lc50-main">' +
      '<div class="lc50-beaker"><canvas id="lc50-beaker-canvas" width="260" height="360"></canvas><div id="lc50-beaker-status">아래 버튼으로 첫 농도를 측정해보세요.</div></div>' +
      '<div class="lc50-graph"><canvas id="lc50-graph-canvas" width="640" height="360"></canvas><div id="lc50-estimate-note" class="lc50-estimate-note"></div></div>' +
      "</div>" +
      '<div class="lc50-actions" id="lc50-actions">' +
      '<button id="lc50-next-btn">⬆ 다음 농도로 올리기</button>' +
      '<button id="lc50-save-btn">💾 여기서 저장하기</button>' +
      "</div>" +
      "</div>";

      el = {
        roundnum: root.querySelector("#lc50-roundnum"),
        sample: root.querySelector("#lc50-sample"),
        temp: root.querySelector("#lc50-temp"),
        saved: root.querySelector("#lc50-saved"),
        beakerCanvas: root.querySelector("#lc50-beaker-canvas"),
        beakerStatus: root.querySelector("#lc50-beaker-status"),
        graphCanvas: root.querySelector("#lc50-graph-canvas"),
        estimateNote: root.querySelector("#lc50-estimate-note"),
        actions: root.querySelector("#lc50-actions"),
        nextBtn: root.querySelector("#lc50-next-btn"),
        saveBtn: root.querySelector("#lc50-save-btn"),
      };
      bctx = el.beakerCanvas.getContext("2d");
      gctx = el.graphCanvas.getContext("2d");

      el.graphCanvas.addEventListener("pointerdown", onPointerDown);
      el.nextBtn.addEventListener("click", () => { api.sfx("click"); doRaise(); });
      el.saveBtn.addEventListener("click", () => { api.sfx("click"); doSave(); });
    }

    /* ---------------------- 게임 상태 ---------------------- */
    let roundIndex = 0;
    let stepIndex = -1;
    let tempScore = 0;
    let savedScoreTotal = 0;
    let savedScoreThisRound = 0;
    let roundHistory = [];
    let actualLC50 = 0, slope = 0, sampleName = "";
    let dataPoints = []; // { concentration, n24, n48 }
    let prevN24 = null, prevN48 = null;
    let phase = "collecting"; // collecting | animating | estimating | roundEnd
    let revealCurve = false;
    let estimateGuessIndex = null; // 추정 단계에서 드래그 중인 x(log) 위치의 농도
    let flashT = 0;

    // 비커 안 물벼룩 10마리 표시 상태
    let fleas = makeFleas(CFG.daphniaCount);
    function makeFleas(n) {
      const arr = [];
      for (let i = 0; i < n; i++) {
        arr.push({ alive: true, x: 30 + Math.random() * 200, y: 40 + Math.random() * 220, phase: Math.random() * Math.PI * 2, sunkY: null });
      }
      return arr;
    }

    function xScale(concentration) {
      const minC = CFG.concentrations[0] * 0.9, maxC = CFG.concentrations[CFG.concentrations.length - 1] * 1.4;
      const t = (Math.log10(concentration) - Math.log10(minC)) / (Math.log10(maxC) - Math.log10(minC));
      return 40 + t * (el.graphCanvas.width - 70);
    }
    function xUnscale(px) {
      const minC = CFG.concentrations[0] * 0.9, maxC = CFG.concentrations[CFG.concentrations.length - 1] * 1.4;
      const t = (px - 40) / (el.graphCanvas.width - 70);
      return Math.pow(10, Math.log10(minC) + t * (Math.log10(maxC) - Math.log10(minC)));
    }
    function yScale(pct) {
      return el.graphCanvas.height - 34 - (pct / 100) * (el.graphCanvas.height - 60);
    }

    function startRound() {
      const def = CFG.rounds[roundIndex];
      sampleName = def.sample;
      slope = def.slope;
      actualLC50 = def.baseLC50 * logUniform(CFG.lc50RandomRange[0], CFG.lc50RandomRange[1]);
      stepIndex = -1;
      tempScore = 0;
      savedScoreThisRound = 0;
      prevN24 = null; prevN48 = null;
      dataPoints = [];
      phase = "collecting";
      revealCurve = false;
      fleas = makeFleas(CFG.daphniaCount);
      el.roundnum.textContent = String(roundIndex + 1);
      el.sample.textContent = sampleName;
      el.beakerStatus.textContent = "아래 버튼으로 첫 농도를 측정해보세요.";
      el.estimateNote.textContent = "";
      setActionsForCollecting();
      updateHUD();
      drawGraph();
    }

    function updateHUD() {
      el.temp.textContent = String(tempScore);
      el.saved.textContent = String(savedScoreTotal + savedScoreThisRound);
    }

    function setActionsForCollecting() {
      el.actions.innerHTML = "";
      el.actions.appendChild(el.nextBtn);
      el.actions.appendChild(el.saveBtn);
      el.nextBtn.disabled = stepIndex >= CFG.concentrations.length - 1;
      el.saveBtn.disabled = stepIndex < 0;
    }

    function doRaise() {
      if (phase !== "collecting" || stepIndex >= CFG.concentrations.length - 1) return;
      phase = "animating";
      el.nextBtn.disabled = true;
      el.saveBtn.disabled = true;
      stepIndex++;
      const concentration = CFG.concentrations[stepIndex];
      const obs = computeStepObservation({
        concentration, lc50: actualLC50, slope,
        h24Multiplier: CFG.observationWindows.h24Multiplier,
        h48Multiplier: CFG.observationWindows.h48Multiplier,
        count: CFG.daphniaCount, prevN24, prevN48, rng: Math.random,
      });
      prevN24 = obs.n24; prevN48 = obs.n48;
      api.sfx("tick");
      fleas = makeFleas(CFG.daphniaCount);
      el.beakerStatus.textContent = concentration + " mg/L · 24h 관찰 중…";

      later(() => {
        sinkFleas(obs.n24);
        el.beakerStatus.textContent = concentration + " mg/L · 24h 관찰… " + obs.n24 + "마리 정지";
        api.sfx(obs.n24 > 0 ? "tick" : "click");
        later(() => {
          sinkFleas(obs.n48);
          el.beakerStatus.textContent = concentration + " mg/L · 48h 관찰… " + obs.n48 + "마리 정지";
          dataPoints.push({ concentration, n24: obs.n24, n48: obs.n48 });
          drawGraph();
          finishStep(obs.n48);
        }, 850);
      }, 650);
    }

    function sinkFleas(n) {
      let count = 0;
      for (const f of fleas) {
        if (count >= n) break;
        if (!f.alive) { count++; continue; }
        f.alive = false;
        f.sunkY = 300 + Math.random() * 20;
        count++;
      }
    }

    function finishStep(n48) {
      const result = computeStepScore(stepIndex + 1, n48, CFG);
      if (result.bust) {
        tempScore = 0;
        api.sfx("bad");
        el.beakerStatus.textContent += " → 😱 BUST! 이 라운드 점수가 모두 사라졌어요.";
        revealCurve = true;
        drawGraph();
        flashRed();
        phase = "roundEnd";
        el.nextBtn.disabled = true;
        el.saveBtn.disabled = true;
        later(() => endRound(0), 1600);
        return;
      }
      tempScore += result.points;
      api.sfx(result.meaningfulBonus ? "good" : "click");
      if (result.meaningfulBonus) el.beakerStatus.textContent += " → ✨ 의미 있는 데이터!";
      updateHUD();
      phase = "collecting";
      setActionsForCollecting();
    }

    function flashRed() {
      flashT = 1;
      const step = () => {
        if (destroyed) return;
        flashT -= 0.04;
        drawGraph();
        if (flashT > 0) rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    }

    function doSave() {
      if (phase !== "collecting" || stepIndex < 0) return;
      savedScoreThisRound = tempScore;
      updateHUD();
      phase = "estimating";
      enterEstimationMode();
    }

    function enterEstimationMode() {
      el.actions.innerHTML = '<button id="lc50-submit-btn" class="primary">제출하기</button>';
      el.beakerStatus.textContent = "그래프에서 세로선을 드래그해 LC50 위치를 추정해보세요.";
      estimateGuessIndex = Math.log10(CFG.concentrations[Math.max(0, stepIndex)]);
      root.querySelector("#lc50-submit-btn").onclick = () => {
        api.sfx("click");
        submitEstimate(Math.pow(10, estimateGuessIndex));
      };
      drawGraph();
    }

    function submitEstimate(guess) {
      const mult = estimateMultiplier(guess, actualLC50, CFG);
      const roundScore = Math.round(savedScoreThisRound * mult);
      el.estimateNote.textContent =
        "추정 " + guess.toFixed(1) + " mg/L · 실제 LC50 " + actualLC50.toFixed(1) + " mg/L · 배율 ×" + mult.toFixed(2) +
        " → 이 라운드 " + roundScore + "점";
      revealCurve = true;
      drawGraph();
      api.sfx(mult >= 1.5 ? "good" : "click");
      el.actions.innerHTML = "";
      phase = "roundEnd";
      later(() => endRound(roundScore), 2200);
    }

    function endRound(roundScore) {
      roundHistory.push({ sample: sampleName, score: roundScore, actualLC50 });
      savedScoreTotal += roundScore;
      roundIndex++;
      if (roundIndex < CFG.rounds.length) {
        later(startRound, 300);
      } else {
        later(finish, 300);
      }
    }

    function finish() {
      const grade = gradeForScore(savedScoreTotal, CFG.grades);
      api.showResult({
        score: savedScoreTotal,
        stats: [{ label: "등급", value: grade }].concat(
          roundHistory.map((r, i) => ({ label: (i + 1) + "라운드", value: r.score + "점 (LC50 " + r.actualLC50.toFixed(1) + ")" }))
        ),
        factTitle: "알아두기",
        fact: CFG.facts.lc50 + " " + CFG.facts.trojan,
      });
    }

    /* ---------------------- 드로잉 ---------------------- */
    function drawBeaker() {
      const ctx = bctx, w = el.beakerCanvas.width, h = el.beakerCanvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(123,189,185,0.35)";
      ctx.fillRect(10, 10, w - 20, h - 20);
      ctx.strokeStyle = "rgba(247,245,234,0.5)";
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      const time = performance.now() / 600;
      fleas.forEach((f, i) => {
        if (f.alive) {
          const x = f.x + Math.sin(time + f.phase) * 10;
          const y = f.y + Math.cos(time * 1.3 + f.phase) * 8;
          ctx.fillStyle = "#CBEF7E";
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = "#8a8f82";
          ctx.beginPath();
          ctx.arc(f.x, f.sunkY, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    function theoreticalCurvePoints(lc50, sl, h48Multiplier) {
      const pts = [];
      const minC = CFG.concentrations[0] * 0.9, maxC = CFG.concentrations[CFG.concentrations.length - 1] * 1.4;
      for (let i = 0; i <= 60; i++) {
        const logC = Math.log10(minC) + (i / 60) * (Math.log10(maxC) - Math.log10(minC));
        const c = Math.pow(10, logC);
        const p = mortalityProbability(c, lc50 * h48Multiplier, sl);
        pts.push([c, p * 100]);
      }
      return pts;
    }

    function drawGraph() {
      const ctx = gctx, w = el.graphCanvas.width, h = el.graphCanvas.height;
      ctx.clearRect(0, 0, w, h);
      if (flashT > 0) {
        ctx.fillStyle = "rgba(224,96,74," + (flashT * 0.4) + ")";
        ctx.fillRect(0, 0, w, h);
      }
      // 축
      ctx.strokeStyle = "rgba(247,245,234,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(40, 10); ctx.lineTo(40, h - 34); ctx.lineTo(w - 10, h - 34);
      ctx.stroke();
      ctx.fillStyle = "rgba(247,245,234,0.65)";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      CFG.concentrations.forEach((c) => {
        const x = xScale(c);
        ctx.fillText(c >= 1 ? String(c) : c.toFixed(1), x, h - 18);
      });
      ctx.textAlign = "right";
      [0, 25, 50, 75, 100].forEach((p) => {
        ctx.fillText(p + "%", 34, yScale(p) + 4);
      });

      // 이론 곡선 (공개된 경우만)
      if (revealCurve) {
        ctx.strokeStyle = "rgba(224,96,74,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        theoreticalCurvePoints(actualLC50, slope, CFG.observationWindows.h48Multiplier).forEach(([c, pct], i) => {
          const x = xScale(c), y = yScale(pct);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        // 실제 LC50 세로선
        ctx.strokeStyle = "rgba(224,96,74,0.6)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(xScale(actualLC50), 10); ctx.lineTo(xScale(actualLC50), h - 34);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 측정 데이터 (48h 실선, 24h 점선)
      if (dataPoints.length) {
        ctx.strokeStyle = "rgba(243,198,75,0.5)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        dataPoints.forEach((d, i) => {
          const x = xScale(d.concentration), y = yScale((d.n24 / CFG.daphniaCount) * 100);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = "#F3C64B";
        ctx.lineWidth = 2;
        ctx.beginPath();
        dataPoints.forEach((d, i) => {
          const x = xScale(d.concentration), y = yScale((d.n48 / CFG.daphniaCount) * 100);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        dataPoints.forEach((d) => {
          const x = xScale(d.concentration), y = yScale((d.n48 / CFG.daphniaCount) * 100);
          ctx.fillStyle = "#F3C64B";
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        });
      }

      // 추정 단계: 드래그 가능한 세로선
      if (phase === "estimating" && estimateGuessIndex != null) {
        const c = Math.pow(10, estimateGuessIndex);
        const x = xScale(c);
        ctx.strokeStyle = "#CBEF7E";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 10); ctx.lineTo(x, h - 34);
        ctx.stroke();
        ctx.fillStyle = "#CBEF7E";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("추정 " + c.toFixed(1) + " mg/L", x, 24);
      }
    }

    /* ---------------------- 추정 드래그 입력 ---------------------- */
    let dragging = false;
    function pointerToLogX(evt) {
      const rect = el.graphCanvas.getBoundingClientRect();
      const scaleX = el.graphCanvas.width / rect.width;
      const px = (evt.clientX - rect.left) * scaleX;
      const minC = CFG.concentrations[0] * 0.9, maxC = CFG.concentrations[CFG.concentrations.length - 1] * 1.4;
      return Math.log10(Math.max(minC, Math.min(maxC, xUnscale(px))));
    }
    function onPointerDown(e) {
      if (phase !== "estimating") return;
      dragging = true;
      estimateGuessIndex = pointerToLogX(e);
      drawGraph();
    }
    function onPointerMove(e) {
      if (!dragging || phase !== "estimating") return;
      estimateGuessIndex = pointerToLogX(e);
      drawGraph();
    }
    function onPointerUp() { dragging = false; }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    /* ---------------------- 배경 애니메이션 루프 (비커 흔들림) ---------------------- */
    function loop() {
      if (destroyed) return;
      if (!api.isPaused() && el.beakerCanvas) drawBeaker();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);

    /* ---------------------- 인트로 ---------------------- */
    api.showIntro(
      {
        title: "LC50 푸시 유어 럭",
        rules: [
          "농도를 한 단계씩 올릴 때마다 점수가 커지지만, 물벼룩이 너무 많이 정지하면(" + CFG.scoring.bustThreshold + "마리 이상) 이번 라운드 점수가 전부 사라집니다.",
          "적당한 선에서 '저장하기'를 누르면 점수가 확정되고, 그래프에서 LC50 위치를 직접 추정하는 보너스 단계로 넘어갑니다.",
          "총 " + CFG.rounds.length + "라운드 — 뒤로 갈수록 오염물질이 섞여 물벼룩이 더 예민해집니다 (트로이 목마 효과).",
        ],
        controls: ["버튼 클릭으로 농도 조절", "그래프 드래그로 LC50 추정"],
      },
      () => {
        buildUI();
        startRound();
      }
    );

    return {
      destroy() {
        destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        timers.forEach(clearTimeout);
        if (el.graphCanvas) el.graphCanvas.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      },
    };
  }

  window.CampaignGames = window.CampaignGames || {};
  window.CampaignGames.lc50 = {
    id: "lc50",
    title: "LC50 푸시 유어 럭",
    icon: "🧪",
    mount,
  };
})();
