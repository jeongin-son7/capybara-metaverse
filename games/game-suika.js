/* =========================================================================
   game-suika.js — 재활용 수박게임
   같은 쓰레기를 합쳐 업사이클링 진화 (병뚜껑 → ... → 지구).
   Matter.js 물리 엔진 사용 (전역 Matter, cdnjs UMD 빌드).
========================================================================= */
(function () {
  "use strict";

  const CFG = window.ConfigData.suika;

  /* =========================================================================
     순수 로직
  ========================================================================= */
  function pickWeightedLevel(weights, rng) {
    rng = rng || Math.random;
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) {
      if (r < weights[i]) return i + 1; // 1-based level
      r -= weights[i];
    }
    return weights.length;
  }

  function comboMultiplier(comboCount, cfg) {
    return Math.min(cfg.combo.maxMultiplier, 1 + cfg.combo.perComboStep * (comboCount - 1));
  }

  function mergeScore(level, comboCount, cfg) {
    const item = cfg.items[level - 1];
    return Math.round(item.score * comboMultiplier(comboCount, cfg));
  }

  /* ---------------------------- self-test ------------------------------- */
  (function selfTest() {
    let seed = 12345;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const counts = [0, 0, 0, 0];
    const N = 20000;
    for (let i = 0; i < N; i++) counts[pickWeightedLevel(CFG.drop.spawnWeights, rng) - 1]++;
    const total = CFG.drop.spawnWeights.reduce((a, b) => a + b, 0);
    CFG.drop.spawnWeights.forEach((w, i) => {
      const expected = (w / total) * N;
      console.assert(Math.abs(counts[i] - expected) / N < 0.05, "[suika] 가중치 분포가 기대값과 크게 벗어남: level" + (i + 1));
    });

    console.assert(comboMultiplier(1, CFG) === 1, "[suika] 콤보 1단계는 배율 1배");
    console.assert(Math.abs(comboMultiplier(2, CFG) - (1 + CFG.combo.perComboStep)) < 1e-9, "[suika] 콤보 2단계 배율 계산");
    console.assert(comboMultiplier(100, CFG) === CFG.combo.maxMultiplier, "[suika] 콤보 배율은 최대치에서 clamp");

    console.assert(mergeScore(1, 1, CFG) === CFG.items[0].score, "[suika] 콤보 없을 때 기본 점수");
    console.assert(mergeScore(10, 1, CFG) === CFG.items[9].score, "[suika] 10단계 기본 점수");
  })();

  /* =========================================================================
     UI / 게임 모듈
  ========================================================================= */
  function mount(root, api) {
    if (typeof Matter === "undefined") {
      root.innerHTML = '<div style="padding:40px;text-align:center;">Matter.js를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.</div>';
      return { destroy() {} };
    }
    let destroyed = false;
    const timers = [];
    const intervalsList = [];
    function later(fn, ms) { const id = setTimeout(() => { if (!destroyed) fn(); }, ms); timers.push(id); return id; }
    function everyMs(fn, ms) { const id = setInterval(() => { if (!destroyed) fn(); }, ms); intervalsList.push(id); return id; }

    const { Engine, Bodies, Composite, Events } = Matter;
    const W = CFG.container.width, H = CFG.container.height;

    // destroy()가 참조해야 하는 것들 (buildUI 안에서 채워짐)
    let engine = null, world = null, canvas = null;
    let onMouseMove = null, onClick = null, onKeydown = null;
    let rafId = null;

    function buildUI() {
      root.innerHTML =
        '<div class="suika-wrap">' +
        "<style>" +
        ".suika-wrap{display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;height:100%;box-sizing:border-box;}" +
        ".suika-top{display:flex;gap:18px;font-size:13px;color:#F7F5EA;flex-wrap:wrap;justify-content:center;}" +
        ".suika-top b{color:#F3C64B;}" +
        "#suika-canvas{background:rgba(123,189,185,0.18);border:2px solid rgba(247,245,234,0.35);border-radius:14px;cursor:none;}" +
        ".suika-hint{font-size:11.5px;color:rgba(247,245,234,.7);text-align:center;}" +
        ".suika-hint kbd{background:rgba(247,245,234,.14);border:1px solid rgba(247,245,234,.3);border-radius:5px;padding:1px 5px;}" +
        "</style>" +
        '<div class="suika-top" id="suika-top"></div>' +
        '<canvas id="suika-canvas" width="' + W + '" height="' + H + '"></canvas>' +
        '<div class="suika-hint">마우스로 조준 · 클릭 또는 Space로 투하 · <kbd>N</kbd> 세탁망 사용 (<span id="suika-netcount">0</span>개 보유, 화면 속 미세섬유 <span id="suika-fibercount">0</span>개)</div>' +
        "</div>";

      const topEl = root.querySelector("#suika-top");
      const netCountEl = root.querySelector("#suika-netcount");
      const fiberCountEl = root.querySelector("#suika-fibercount");
      canvas = root.querySelector("#suika-canvas");
      const ctx = canvas.getContext("2d");

      /* ---------------------- Matter 엔진 ---------------------- */
      engine = Engine.create();
      engine.gravity.y = CFG.physics.gravity;
      world = engine.world;

      const wallOpts = { isStatic: true, restitution: CFG.physics.restitution, friction: CFG.physics.friction };
      Composite.add(world, [
        Bodies.rectangle(W / 2, H + 20, W, 40, wallOpts),
        Bodies.rectangle(-20, H / 2, 40, H * 2, wallOpts),
        Bodies.rectangle(W + 20, H / 2, 40, H * 2, wallOpts),
      ]);

      /* ---------------------- 상태 ---------------------- */
      let score = 0;
      let bestLevelReached = 1;
      let comboCount = 0;
      let lastMergeTime = -999;
      let aimX = W / 2;
      let nextLevel = pickWeightedLevel(CFG.drop.spawnWeights, Math.random);
      let lastDropTime = -999;
      let gameOverTriggered = false;
      let dangerTimer = 0;
      let netStock = 0;
      let mergeSinceLastNet = 0;
      let fiberBodies = [];
      const particles = [];
      const mergingIds = new Set();

      function makeItemBody(level, x, y) {
        const def = CFG.items[level - 1];
        const body = Bodies.circle(x, y, def.radius, { restitution: CFG.physics.restitution, friction: CFG.physics.friction, label: "item" });
        body.gameLevel = level;
        body.spawnTime = performance.now();
        return body;
      }

      function dropCurrent() {
        const now = performance.now();
        if (now - lastDropTime < CFG.drop.cooldownSec * 1000) return;
        lastDropTime = now;
        const def = CFG.items[nextLevel - 1];
        const x = Math.max(def.radius + 4, Math.min(W - def.radius - 4, aimX));
        Composite.add(world, makeItemBody(nextLevel, x, def.radius + 6));
        api.sfx("click");
        nextLevel = pickWeightedLevel(CFG.drop.spawnWeights, Math.random);
      }

      function spawnMicrofiber() {
        const x = CFG.microfiber.radius + Math.random() * (W - CFG.microfiber.radius * 2);
        const body = Bodies.circle(x, CFG.microfiber.radius + 6, CFG.microfiber.radius, { restitution: 0.2, friction: 0.4, density: 0.0006, label: "microfiber" });
        Composite.add(world, body);
        fiberBodies.push(body);
      }

      function clearMicrofiber() {
        if (netStock <= 0 || !fiberBodies.length) return;
        netStock--;
        const count = fiberBodies.length;
        fiberBodies.forEach((b) => { Composite.remove(world, b); spawnParticles(b.position.x, b.position.y, "#9aa08e"); });
        score += count * CFG.microfiber.netClearScorePerItem;
        fiberBodies = [];
        api.sfx("good");
        renderTop();
      }

      function spawnParticles(x, y, color) {
        for (let i = 0; i < 10; i++) {
          particles.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 - 1, r: 3 + Math.random() * 3, alpha: 1, color });
        }
      }

      Events.on(engine, "collisionStart", (evt) => {
        evt.pairs.forEach((pair) => {
          const a = pair.bodyA, b = pair.bodyB;
          if (a.label !== "item" || b.label !== "item") return;
          if (a.gameLevel !== b.gameLevel) return;
          if (mergingIds.has(a.id) || mergingIds.has(b.id)) return;
          const mx = (a.position.x + b.position.x) / 2, my = (a.position.y + b.position.y) / 2;
          if (a.gameLevel >= CFG.items.length) {
            mergingIds.add(a.id); mergingIds.add(b.id);
            later(() => { Composite.remove(world, [a, b]); mergingIds.delete(a.id); mergingIds.delete(b.id); }, 0);
            score += CFG.items[CFG.items.length - 1].finalBonus;
            spawnParticles(mx, my, "#F3C64B");
            api.sfx("win");
            renderTop();
            return;
          }
          mergingIds.add(a.id); mergingIds.add(b.id);
          const level = a.gameLevel;
          const now = performance.now() / 1000;
          if (now - lastMergeTime < CFG.combo.windowSec) comboCount++; else comboCount = 1;
          lastMergeTime = now;
          score += mergeScore(level, comboCount, CFG);
          bestLevelReached = Math.max(bestLevelReached, level + 1);
          mergeSinceLastNet++;
          if (mergeSinceLastNet >= CFG.microfiber.netRewardEveryMerges && netStock < CFG.microfiber.netMaxStock) {
            mergeSinceLastNet = 0;
            netStock++;
          }
          spawnParticles(mx, my, CFG.items[level - 1].color);
          api.sfx("merge");
          later(() => {
            Composite.remove(world, [a, b]);
            Composite.add(world, makeItemBody(level + 1, mx, my));
            mergingIds.delete(a.id); mergingIds.delete(b.id);
          }, 0);
          renderTop();
        });
      });

      /* ---------------------- 입력 ---------------------- */
      onMouseMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        aimX = (e.clientX - rect.left) * (W / rect.width);
      };
      onClick = () => dropCurrent();
      onKeydown = (e) => {
        if (e.code === "Space") { e.preventDefault(); dropCurrent(); }
        if (e.code === "KeyN") clearMicrofiber();
      };
      canvas.addEventListener("mousemove", onMouseMove);
      canvas.addEventListener("click", onClick);
      window.addEventListener("keydown", onKeydown);

      /* ---------------------- 렌더 ---------------------- */
      function renderTop() {
        topEl.innerHTML =
          "점수 <b>" + score + "</b> · 콤보 <b>" + (comboCount > 1 ? "×" + comboMultiplier(comboCount, CFG).toFixed(2) : "-") + "</b> · 최고 단계 <b>" +
          CFG.items[bestLevelReached - 1].name + "</b>";
        netCountEl.textContent = String(netStock);
        fiberCountEl.textContent = String(fiberBodies.length);
      }

      function draw() {
        ctx.clearRect(0, 0, W, H);
        const dangerActive = dangerTimer > 0;
        ctx.strokeStyle = dangerActive ? "rgba(224,96,74," + (0.5 + 0.5 * Math.sin(performance.now() / 100)) + ")" : "rgba(247,245,234,0.3)";
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(0, CFG.container.dangerLineY); ctx.lineTo(W, CFG.container.dangerLineY); ctx.stroke();
        ctx.setLineDash([]);

        Composite.allBodies(world).forEach((b) => {
          if (b.isStatic) return;
          const { x, y } = b.position;
          if (b.label === "microfiber") {
            ctx.fillStyle = "rgba(154,160,142,0.85)";
            ctx.beginPath(); ctx.arc(x, y, CFG.microfiber.radius, 0, Math.PI * 2); ctx.fill();
            ctx.font = "16px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("🧶", x, y);
            return;
          }
          const def = CFG.items[b.gameLevel - 1];
          ctx.fillStyle = def.color;
          ctx.beginPath(); ctx.arc(x, y, def.radius, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 2; ctx.stroke();
          ctx.font = Math.max(12, def.radius * 0.8) + "px sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(def.icon, x, y);
        });

        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.alpha -= 0.035;
          if (p.alpha <= 0) { particles.splice(i, 1); continue; }
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }

        if (!gameOverTriggered) {
          const def = CFG.items[nextLevel - 1];
          const x = Math.max(def.radius + 4, Math.min(W - def.radius - 4, aimX));
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = def.color;
          ctx.beginPath(); ctx.arc(x, def.radius + 6, def.radius, 0, Math.PI * 2); ctx.fill();
          ctx.font = Math.max(12, def.radius * 0.8) + "px sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(def.icon, x, def.radius + 6);
          ctx.globalAlpha = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = "rgba(247,245,234,0.4)";
          ctx.beginPath(); ctx.moveTo(x, def.radius * 2 + 10); ctx.lineTo(x, H); ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      function checkGameOver(dtSec) {
        const now = performance.now();
        const settleMs = CFG.gameOver.settleDelaySec * 1000;
        const overLine = Composite.allBodies(world).some(
          (b) => !b.isStatic && b.label === "item" && now - b.spawnTime > settleMs && b.position.y - CFG.items[b.gameLevel - 1].radius < CFG.container.dangerLineY
        );
        if (overLine) {
          dangerTimer += dtSec;
          if (dangerTimer >= CFG.gameOver.overLineHoldSec && !gameOverTriggered) {
            gameOverTriggered = true;
            triggerGameOver();
          }
        } else {
          dangerTimer = 0;
        }
      }

      function triggerGameOver() {
        api.sfx("lose");
        later(() => {
          api.showResult({
            score,
            stats: [
              { label: "최고 단계", value: CFG.items[bestLevelReached - 1].icon + " " + CFG.items[bestLevelReached - 1].name },
              { label: "세탁망 보유", value: netStock + "개" },
            ],
            factTitle: "알아두기",
            fact: CFG.facts.recycling + " " + CFG.facts.net,
          });
        }, 500);
      }

      let lastTime = performance.now();
      function loop() {
        if (destroyed) return;
        rafId = requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min(50, now - lastTime);
        lastTime = now;
        if (api.isPaused()) return;
        Engine.update(engine, CFG.physics.fixedStepMs);
        if (!gameOverTriggered) checkGameOver(dt / 1000);
        draw();
      }
      rafId = requestAnimationFrame(loop);
      everyMs(spawnMicrofiber, CFG.microfiber.intervalSec * 1000);
      renderTop();
    }

    /* ---------------------- 인트로 ---------------------- */
    api.showIntro(
      {
        title: "재활용 수박게임",
        rules: [
          "같은 쓰레기 두 개가 닿으면 합쳐져 다음 단계로 업사이클링됩니다: 병뚜껑 → … → 에코백 → 지구.",
          "용기 위쪽 위험선을 넘는 상태가 오래 지속되면 게임이 끝납니다.",
          "25초마다 나타나는 회색 미세섬유 뭉치는 합쳐지지 않고 공간만 차지해요. 합치기를 반복하면 세탁망을 얻어 한 번에 치울 수 있습니다.",
        ],
        controls: ["마우스 이동으로 조준", "클릭 / Space 로 투하", "N 세탁망 사용"],
      },
      () => buildUI()
    );

    return {
      destroy() {
        destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        timers.forEach(clearTimeout);
        intervalsList.forEach(clearInterval);
        if (canvas) {
          canvas.removeEventListener("mousemove", onMouseMove);
          canvas.removeEventListener("click", onClick);
        }
        window.removeEventListener("keydown", onKeydown);
        if (engine) {
          Events.off(engine);
          Composite.clear(world, false);
          Engine.clear(engine);
        }
      },
    };
  }

  window.CampaignGames = window.CampaignGames || {};
  window.CampaignGames.suika = {
    id: "suika",
    title: "재활용 수박게임",
    icon: "♻️",
    mount,
  };
})();
