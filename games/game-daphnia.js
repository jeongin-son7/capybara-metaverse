/* =========================================================================
   game-daphnia.js — 물벼룩 서바이벌
   3분(=48시간 압축) 동안 미세플라스틱을 피해 조류를 먹고 성장하는 뱀서라이크.
========================================================================= */
(function () {
  "use strict";

  const CFG = window.ConfigData.daphnia;

  /* =========================================================================
     순수 로직
  ========================================================================= */
  function xpNeededForLevel(level, cfg) {
    const idx = level - 1;
    if (idx < cfg.xpToLevel.length) return cfg.xpToLevel[idx];
    const extra = idx - cfg.xpToLevel.length + 1;
    return cfg.xpToLevel[cfg.xpToLevel.length - 1] + extra * cfg.xpLevelIncrement;
  }

  function rosSpeedMultiplier(ros, thresholds) {
    let mult = 1;
    thresholds.forEach((t) => { if (ros >= t.min) mult = t.speedMultiplier; });
    return mult;
  }

  function rosHasDrift(ros, thresholds) {
    return thresholds.some((t) => ros >= t.min && t.drift);
  }

  function currentSpawnInterval(tSec, durationSec, cfg) {
    const t = Math.max(0, Math.min(1, tSec / durationSec));
    return cfg.spawnInterval.startSec + (cfg.spawnInterval.endSec - cfg.spawnInterval.startSec) * t;
  }

  function computeFinalScore(timeAliveSec, algaeEaten, level, cleared, rosRemaining, cfg) {
    let score = timeAliveSec * cfg.scoring.perSecondAlive + algaeEaten * cfg.scoring.perAlgaeEaten + level * cfg.scoring.perLevel;
    if (cleared) score += cfg.scoring.clearBonus + rosRemaining * cfg.scoring.clearRosBonusFactor;
    return Math.round(score);
  }

  /* ---------------------------- self-test ------------------------------- */
  (function selfTest() {
    console.assert(xpNeededForLevel(1, CFG) === CFG.xpToLevel[0], "[daphnia] 1레벨 필요 경험치");
    console.assert(xpNeededForLevel(6, CFG) === CFG.xpToLevel[5], "[daphnia] 배열 마지막 레벨");
    console.assert(xpNeededForLevel(7, CFG) === CFG.xpToLevel[5] + CFG.xpLevelIncrement, "[daphnia] 배열 이후 증가폭 적용");
    console.assert(xpNeededForLevel(8, CFG) === CFG.xpToLevel[5] + CFG.xpLevelIncrement * 2, "[daphnia] 배열 이후 증가폭 2회 적용");

    console.assert(rosSpeedMultiplier(0, CFG.ros.thresholds) === 1, "[daphnia] ROS 낮으면 감속 없음");
    console.assert(rosSpeedMultiplier(40, CFG.ros.thresholds) === 0.9, "[daphnia] 40 이상 첫 감속 구간");
    console.assert(rosSpeedMultiplier(60, CFG.ros.thresholds) === 0.75, "[daphnia] 60 이상 두번째 감속 구간");
    console.assert(rosSpeedMultiplier(99, CFG.ros.thresholds) === 0.75, "[daphnia] 80 이상도 속도배율 동일(0.75)");
    console.assert(!rosHasDrift(50, CFG.ros.thresholds), "[daphnia] 50에서는 흔들림 없음");
    console.assert(rosHasDrift(85, CFG.ros.thresholds), "[daphnia] 80 이상에서는 흔들림 있음");

    console.assert(currentSpawnInterval(0, CFG.durationSec, CFG) === CFG.spawnInterval.startSec, "[daphnia] 시작 시 스폰 간격");
    console.assert(Math.abs(currentSpawnInterval(CFG.durationSec, CFG.durationSec, CFG) - CFG.spawnInterval.endSec) < 1e-9, "[daphnia] 종료 시 스폰 간격");

    const s1 = computeFinalScore(60, 10, 2, false, 0, CFG);
    console.assert(s1 === 60 * CFG.scoring.perSecondAlive + 10 * CFG.scoring.perAlgaeEaten + 2 * CFG.scoring.perLevel, "[daphnia] 생존 중 점수 계산");
    const s2 = computeFinalScore(180, 20, 5, true, 10, CFG);
    console.assert(s2 === s1 - s1 + Math.round(180 * CFG.scoring.perSecondAlive + 20 * CFG.scoring.perAlgaeEaten + 5 * CFG.scoring.perLevel + CFG.scoring.clearBonus + 10 * CFG.scoring.clearRosBonusFactor), "[daphnia] 클리어 보너스 포함 점수 계산");
  })();

  /* =========================================================================
     UI / 게임 모듈
  ========================================================================= */
  function mount(root, api) {
    let destroyed = false;
    const timers = [];
    function later(fn, ms) { const id = setTimeout(() => { if (!destroyed) fn(); }, ms); timers.push(id); return id; }

    const W = CFG.arena.width, H = CFG.arena.height;
    let canvas = null, rafId = null;
    let onKeydown = null, onKeyup = null, onMouseDown = null, onMouseUp = null, onMouseMove = null;

    function buildUI() {
      root.innerHTML =
        '<div class="dp-wrap">' +
        "<style>" +
        ".dp-wrap{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;height:100%;box-sizing:border-box;}" +
        ".dp-top{width:" + W + "px;max-width:100%;display:flex;flex-direction:column;gap:4px;}" +
        ".dp-row{display:flex;justify-content:space-between;font-size:12px;color:#F7F5EA;}" +
        ".dp-bar-bg{width:100%;height:8px;border-radius:4px;background:rgba(0,0,0,.25);overflow:hidden;}" +
        ".dp-bar-fill{height:100%;background:#CBEF7E;transition:width .2s;}" +
        ".dp-ros-fill{height:100%;transition:width .2s,background .2s;}" +
        "#dp-canvas{background:radial-gradient(circle at 50% 30%,#2c4a4a,#152626);border:2px solid rgba(247,245,234,.3);border-radius:14px;max-width:100%;}" +
        ".dp-levelup{position:absolute;inset:0;background:rgba(10,15,12,.82);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;border-radius:14px;}" +
        ".dp-levelup h3{margin:0;color:#F3C64B;font-size:18px;}" +
        ".dp-cards{display:flex;gap:14px;}" +
        ".dp-card{width:150px;background:rgba(74,81,69,.95);border:1px solid rgba(243,198,75,.4);border-radius:14px;padding:16px 12px;text-align:center;cursor:pointer;color:#F7F5EA;}" +
        ".dp-card:hover{background:rgba(90,98,82,.95);}" +
        ".dp-card .ic{font-size:30px;}" +
        ".dp-card .nm{font-weight:800;margin:6px 0 4px;font-size:13px;}" +
        ".dp-card .ef{font-size:11px;color:rgba(247,245,234,.75);}" +
        ".dp-stage{position:relative;}" +
        "</style>" +
        '<div class="dp-top">' +
        '<div class="dp-row"><span id="dp-time">0h / 48h</span><span id="dp-level">Lv.1</span></div>' +
        '<div class="dp-bar-bg"><div class="dp-bar-fill" id="dp-timebar" style="width:0%"></div></div>' +
        '<div class="dp-row"><span>ROS</span><span id="dp-ros-text">0</span></div>' +
        '<div class="dp-bar-bg"><div class="dp-ros-fill" id="dp-rosbar" style="width:0%;background:#7FA855;"></div></div>' +
        '<div class="dp-row"><span id="dp-score">점수 0</span><span id="dp-dash">대시 준비</span></div>' +
        "</div>" +
        '<div class="dp-stage"><canvas id="dp-canvas" width="' + W + '" height="' + H + '"></canvas><div class="dp-levelup" id="dp-levelup" style="display:none;"></div></div>' +
        "</div>";

      canvas = root.querySelector("#dp-canvas");
      const ctx = canvas.getContext("2d");
      const timeEl = root.querySelector("#dp-time");
      const levelEl = root.querySelector("#dp-level");
      const timeBarEl = root.querySelector("#dp-timebar");
      const rosTextEl = root.querySelector("#dp-ros-text");
      const rosBarEl = root.querySelector("#dp-rosbar");
      const scoreEl = root.querySelector("#dp-score");
      const dashEl = root.querySelector("#dp-dash");
      const levelUpEl = root.querySelector("#dp-levelup");

      /* ---------------------- 상태 ---------------------- */
      const keys = new Set();
      let mouseDown = false, mouseX = W / 2, mouseY = H / 2;

      const player = {
        x: W / 2, y: H / 2, radius: CFG.player.radius,
        ros: 0, xp: 0, level: 1, algaeEaten: 0,
        dashCooldownLeft: 0, dashActiveLeft: 0,
        poisonLeft: 0,
        angle: 0,
      };
      const upgradeStacks = {};
      CFG.upgrades.forEach((u) => { upgradeStacks[u.id] = 0; });
      let shieldReady = false, shieldRechargeLeft = 0;
      let pups = []; // 단위생식 새끼들

      let elapsed = 0;
      let score = 0;
      let gameOver = false;
      let cleared = false;
      let levelUpPending = false;
      let spawnTimer = 0;
      let algaeSpawnAccum = 0;
      const algaeList = [];
      const enemies = [];
      const particles = [];
      let nextWaveIdx = 0;
      let waveWarning = null; // { atSec, gapY, gapWidth, shown }

      function rand(min, max) { return min + Math.random() * (max - min); }

      /* ---------------------- 업그레이드 효과 계산 ---------------------- */
      function effSpeed() {
        let s = CFG.player.baseSpeed * (1 + upgradeStacks.fastSwim * CFG.upgrades.find((u) => u.id === "fastSwim").perStack);
        s *= rosSpeedMultiplier(player.ros, CFG.ros.thresholds);
        return s;
      }
      function effRosDecay() {
        return CFG.ros.naturalDecayPerSec + upgradeStacks.detoxEnzyme * CFG.upgrades.find((u) => u.id === "detoxEnzyme").perStack;
      }
      function effIncomingRosFactor() {
        return 1 - upgradeStacks.exoskeleton * CFG.upgrades.find((u) => u.id === "exoskeleton").perStack;
      }
      function effHitRadius() {
        return player.radius * (1 - upgradeStacks.transparency * CFG.upgrades.find((u) => u.id === "transparency").perStack);
      }
      function effMagnetRadius() {
        const def = CFG.upgrades.find((u) => u.id === "foodMagnet");
        return upgradeStacks.foodMagnet > 0 ? def.radii[upgradeStacks.foodMagnet - 1] : 0;
      }
      function effDashCooldown() {
        return Math.max(0.6, CFG.player.dashCooldownSec - upgradeStacks.jumpDash * CFG.upgrades.find((u) => u.id === "jumpDash").cooldownReduction);
      }

      /* ---------------------- 스폰 ---------------------- */
      function spawnAlgae() {
        if (algaeList.length >= CFG.algae.maxOnScreen) return;
        algaeList.push({ x: rand(20, W - 20), y: rand(20, H - 20) });
      }

      function eligibleEnemyTypes() {
        return Object.keys(CFG.enemies).filter((k) => elapsed >= CFG.enemies[k].spawnAtSec);
      }

      function spawnEnemy() {
        const types = eligibleEnemyTypes();
        if (!types.length) return;
        const type = types[Math.floor(Math.random() * types.length)];
        const edge = Math.floor(Math.random() * 4);
        let x, y;
        if (edge === 0) { x = -20; y = rand(0, H); }
        else if (edge === 1) { x = W + 20; y = rand(0, H); }
        else if (edge === 2) { x = rand(0, W); y = -20; }
        else { x = rand(0, W); y = H + 20; }

        if (type === "bead") {
          const def = CFG.enemies.bead;
          const speed = rand(def.speedRange[0], def.speedRange[1]);
          const ang = Math.atan2(player.y - y, player.x - x) + rand(-0.4, 0.4);
          enemies.push({ type, x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, radius: def.radius });
        } else if (type === "fiber") {
          const def = CFG.enemies.fiber;
          const speed = rand(def.speedRange[0], def.speedRange[1]);
          const dir = x < W / 2 ? 1 : -1;
          enemies.push({ type, x, y, vx: dir * speed, vy: 0, baseY: y, t: 0, w: def.width, h: def.height });
        } else if (type === "fragment") {
          const def = CFG.enemies.fragment;
          for (let i = 0; i < def.volleyCount; i++) {
            const spread = (i - (def.volleyCount - 1) / 2) * 0.18;
            const ang = Math.atan2(player.y - y, player.x - x) + spread;
            enemies.push({ type, x, y, vx: Math.cos(ang) * def.speed, vy: Math.sin(ang) * def.speed, radius: def.radius, rot: 0 });
          }
        } else if (type === "carrier") {
          const def = CFG.enemies.carrier;
          const speed = rand(def.speedRange[0], def.speedRange[1]);
          const ang = Math.atan2(player.y - y, player.x - x) + rand(-0.3, 0.3);
          enemies.push({ type, x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, radius: def.radius, glow: 0 });
        }
      }

      function maybeTriggerWave(dt) {
        if (nextWaveIdx >= CFG.waveEvents.length) return;
        const w = CFG.waveEvents[nextWaveIdx];
        if (!waveWarning && elapsed >= w.atSec - CFG.waveWarningLeadSec) {
          waveWarning = { gapY: rand(80, H - 80), gapWidth: w.gapWidthPx, fromLeft: Math.random() < 0.5 };
        }
        if (waveWarning && elapsed >= w.atSec) {
          const fromLeft = waveWarning.fromLeft;
          const x = fromLeft ? -20 : W + 20;
          const vx = fromLeft ? CFG.waveSpeed : -CFG.waveSpeed;
          const step = CFG.enemies.bead.radius * 2.2;
          for (let y = step / 2; y < H; y += step) {
            if (Math.abs(y - waveWarning.gapY) < waveWarning.gapWidth / 2) continue;
            enemies.push({ type: "bead", x, y, vx, vy: 0, radius: CFG.enemies.bead.radius });
          }
          waveWarning = null;
          nextWaveIdx++;
        }
      }

      /* ---------------------- 업그레이드 선택 ---------------------- */
      function pickUpgradeChoices() {
        const avail = CFG.upgrades.filter((u) => upgradeStacks[u.id] < u.maxStack);
        const pool = avail.length ? avail : CFG.upgrades;
        const picks = [];
        const used = new Set();
        while (picks.length < 3 && picks.length < pool.length) {
          const u = pool[Math.floor(Math.random() * pool.length)];
          if (used.has(u.id)) continue;
          used.add(u.id);
          picks.push(u);
        }
        return picks;
      }

      function showLevelUp() {
        levelUpPending = true;
        const choices = pickUpgradeChoices();
        levelUpEl.innerHTML = '<h3>🎉 레벨 업! 진화를 선택하세요</h3><div class="dp-cards"></div>';
        const cardsEl = levelUpEl.querySelector(".dp-cards");
        choices.forEach((u) => {
          const card = document.createElement("div");
          card.className = "dp-card";
          card.innerHTML = '<div class="ic">' + u.icon + '</div><div class="nm">' + u.name + " (" + (upgradeStacks[u.id] + 1) + "/" + u.maxStack + ')</div><div class="ef">' + u.effect + "</div>";
          card.onclick = () => { api.sfx("levelup"); applyUpgrade(u.id); levelUpEl.style.display = "none"; levelUpPending = false; };
          cardsEl.appendChild(card);
        });
        levelUpEl.style.display = "flex";
      }

      function applyUpgrade(id) {
        upgradeStacks[id] = Math.min(CFG.upgrades.find((u) => u.id === id).maxStack, upgradeStacks[id] + 1);
        if (id === "parthenogenesis") {
          pups.push({ angle: Math.random() * Math.PI * 2, dist: 40 });
        }
      }

      /* ---------------------- 입력 ---------------------- */
      onKeydown = (e) => {
        keys.add(e.code);
        if ((e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") && !levelUpPending) {
          e.preventDefault();
          tryDash();
        }
      };
      onKeyup = (e) => keys.delete(e.code);
      onMouseDown = (e) => { mouseDown = true; updateMouse(e); };
      onMouseUp = () => { mouseDown = false; };
      onMouseMove = (e) => updateMouse(e);
      function updateMouse(e) {
        const rect = canvas.getBoundingClientRect();
        mouseX = (e.clientX - rect.left) * (W / rect.width);
        mouseY = (e.clientY - rect.top) * (H / rect.height);
      }
      window.addEventListener("keydown", onKeydown);
      window.addEventListener("keyup", onKeyup);
      canvas.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mouseup", onMouseUp);
      canvas.addEventListener("mousemove", onMouseMove);

      function tryDash() {
        if (player.dashCooldownLeft > 0 || player.dashActiveLeft > 0) return;
        player.dashActiveLeft = CFG.player.dashDurationSec;
        player.dashCooldownLeft = effDashCooldown();
        api.sfx("good");
        if (upgradeStacks.jumpDash >= 3) {
          enemies.forEach((en) => {
            const dx = en.x - player.x, dy = en.y - player.y, d = Math.hypot(dx, dy) || 1;
            if (d < 90) { en.vx += (dx / d) * 120; en.vy += (dy / d) * 120; }
          });
        }
      }

      /* ---------------------- 업데이트 ---------------------- */
      function update(dt) {
        if (gameOver || levelUpPending) return;
        elapsed += dt;

        // 이동
        let mx = 0, my = 0;
        if (keys.has("KeyW") || keys.has("ArrowUp")) my -= 1;
        if (keys.has("KeyS") || keys.has("ArrowDown")) my += 1;
        if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
        if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
        if (mx === 0 && my === 0 && mouseDown) {
          const dx = mouseX - player.x, dy = mouseY - player.y, d = Math.hypot(dx, dy);
          if (d > 4) { mx = dx / d; my = dy / d; }
        }
        const mlen = Math.hypot(mx, my);
        if (mlen > 0) { mx /= mlen; my /= mlen; player.angle = Math.atan2(my, mx); }

        let speed = effSpeed();
        if (player.dashActiveLeft > 0) {
          speed *= CFG.player.dashMultiplier;
          player.dashActiveLeft -= dt;
        }
        if (player.dashCooldownLeft > 0) player.dashCooldownLeft -= dt;

        if (rosHasDrift(player.ros, CFG.ros.thresholds)) {
          mx += rand(-0.6, 0.6); my += rand(-0.6, 0.6);
        }

        player.x = Math.max(player.radius, Math.min(W - player.radius, player.x + mx * speed * dt));
        player.y = Math.max(player.radius, Math.min(H - player.radius, player.y + my * speed * dt));

        // ROS 자연 감소/중독
        player.ros = Math.max(0, player.ros - effRosDecay() * dt);
        if (player.poisonLeft > 0) {
          player.poisonLeft -= dt;
          player.ros = Math.min(CFG.ros.max, player.ros + CFG.enemies.carrier.poison.rosPerSec * dt);
        }

        // 보호막 재충전
        if (!shieldReady && upgradeStacks.bubbleShield > 0) {
          shieldRechargeLeft -= dt;
          if (shieldRechargeLeft <= 0) shieldReady = true;
        }

        // 조류 스폰/섭취
        algaeSpawnAccum += dt * CFG.algae.spawnPerSec;
        while (algaeSpawnAccum >= 1) { spawnAlgae(); algaeSpawnAccum -= 1; }
        const magnet = effMagnetRadius();
        for (let i = algaeList.length - 1; i >= 0; i--) {
          const a = algaeList[i];
          const d = Math.hypot(a.x - player.x, a.y - player.y);
          const eatRadius = player.radius + 6;
          if (magnet > 0 && d < magnet && d > eatRadius) {
            a.x += ((player.x - a.x) / d) * 140 * dt;
            a.y += ((player.y - a.y) / d) * 140 * dt;
          }
          if (d < eatRadius) {
            algaeList.splice(i, 1);
            player.xp += CFG.algae.xpPerAlgae;
            player.algaeEaten++;
            player.ros = Math.max(0, player.ros - CFG.algae.rosReductionPerAlgae);
            spawnParticles(a.x, a.y, "#9ED18A");
          }
        }

        // 새끼(단위생식): 플레이어 주위를 돌며 근처 조류 섭취
        pups.forEach((p) => {
          p.angle += dt * 1.6;
          const px = player.x + Math.cos(p.angle) * p.dist;
          const py = player.y + Math.sin(p.angle) * p.dist;
          for (let i = algaeList.length - 1; i >= 0; i--) {
            const a = algaeList[i];
            if (Math.hypot(a.x - px, a.y - py) < 16) {
              algaeList.splice(i, 1);
              player.xp += CFG.algae.xpPerAlgae;
              player.algaeEaten++;
              spawnParticles(a.x, a.y, "#9ED18A");
            }
          }
          p._x = px; p._y = py;
        });

        // 레벨업 체크
        const need = xpNeededForLevel(player.level, CFG);
        if (player.xp >= need) {
          player.xp -= need;
          player.level++;
          showLevelUp();
        }

        // 적 스폰
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnEnemy();
          spawnTimer = currentSpawnInterval(elapsed, CFG.durationSec, CFG);
        }
        maybeTriggerWave(dt);

        // 적 이동 & 충돌
        for (let i = enemies.length - 1; i >= 0; i--) {
          const en = enemies[i];
          if (en.type === "fiber") {
            en.t += dt;
            en.x += en.vx * dt;
            en.y = en.baseY + Math.sin(en.t * 4) * 26;
          } else {
            en.x += en.vx * dt;
            en.y += en.vy * dt;
          }
          if (en.x < -60 || en.x > W + 60 || en.y < -60 || en.y > H + 60) { enemies.splice(i, 1); continue; }

          const r = en.radius || Math.max(en.w, en.h) / 2;
          const dist = Math.hypot(en.x - player.x, en.y - player.y);
          if (dist < r + effHitRadius() && player.dashActiveLeft <= 0) {
            enemies.splice(i, 1);
            onHit(en);
          }
        }

        // 점수 (생존 시간 기준으로 매 프레임 누적은 결과화면에서 일괄 계산)
        scoreEl.textContent = "점수 " + Math.round(elapsed * CFG.scoring.perSecondAlive + player.algaeEaten * CFG.scoring.perAlgaeEaten + (player.level - 1) * CFG.scoring.perLevel);

        if (player.ros >= CFG.ros.immobilizeAt) {
          endGame(false);
          return;
        }
        if (elapsed >= CFG.durationSec) {
          endGame(true);
          return;
        }
      }

      function onHit(en) {
        if (shieldReady) {
          shieldReady = false;
          shieldRechargeLeft = CFG.upgrades.find((u) => u.id === "bubbleShield").rechargeSec[Math.max(0, upgradeStacks.bubbleShield - 1)];
          api.sfx("tick");
          spawnParticles(player.x, player.y, "#CBEF7E");
          return;
        }
        const defMap = CFG.enemies;
        const rosGain = (defMap[en.type] ? defMap[en.type].rosOnHit : 8) * effIncomingRosFactor();
        player.ros = Math.min(CFG.ros.max, player.ros + rosGain);
        if (en.type === "carrier") player.poisonLeft = CFG.enemies.carrier.poison.durationSec;
        api.sfx("bad");
        spawnParticles(player.x, player.y, "#E0604A");
      }

      function spawnParticles(x, y, color) {
        for (let i = 0; i < 8; i++) particles.push({ x, y, vx: rand(-2, 2), vy: rand(-2, 2), r: rand(2, 4), alpha: 1, color });
      }

      function endGame(didClear) {
        if (gameOver) return;
        gameOver = true;
        cleared = didClear;
        api.sfx(didClear ? "win" : "lose");
        const finalScore = computeFinalScore(elapsed, player.algaeEaten, player.level, didClear, CFG.ros.max - player.ros, CFG);
        score = finalScore;
        const upgradeList = CFG.upgrades.filter((u) => upgradeStacks[u.id] > 0).map((u) => u.icon + " " + u.name + " x" + upgradeStacks[u.id]).join(", ") || "없음";
        later(() => {
          api.showResult({
            score: finalScore,
            stats: [
              { label: "생존 시간", value: "48시간 중 " + Math.round((elapsed / CFG.durationSec) * CFG.hoursPerGame) + "시간" },
              { label: "도달 레벨", value: "Lv." + player.level },
              { label: "먹은 조류", value: String(player.algaeEaten) },
              { label: "ROS 최고치", value: Math.round(Math.max(player.ros, 0)) + " / " + CFG.ros.max },
              { label: "선택한 진화", value: upgradeList },
            ],
            factTitle: "알아두기",
            fact: CFG.facts.assay,
          });
        }, 500);
      }

      /* ---------------------- 렌더 ---------------------- */
      function rosColor(ros) {
        if (ros < 40) return "#7FA855";
        if (ros < 60) return "#F3C64B";
        if (ros < 80) return "#E09A4A";
        return "#E0604A";
      }

      function draw() {
        ctx.clearRect(0, 0, W, H);

        // 기포 배경
        const t = performance.now() / 1000;
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        for (let i = 0; i < 12; i++) {
          const bx = (i * 83 + Math.sin(t + i) * 10) % W;
          const by = (H - ((t * 20 + i * 60) % (H + 40)));
          ctx.beginPath(); ctx.arc(bx, by, 3 + (i % 3), 0, Math.PI * 2); ctx.fill();
        }

        // 파도 경고
        if (waveWarning) {
          ctx.fillStyle = "rgba(224,96,74,0.18)";
          ctx.fillRect(0, waveWarning.gapY - waveWarning.gapWidth / 2, W, waveWarning.gapWidth);
          ctx.strokeStyle = "rgba(224,96,74,0.6)";
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(0, waveWarning.gapY - waveWarning.gapWidth / 2, W, waveWarning.gapWidth);
          ctx.setLineDash([]);
        }

        // 조류
        ctx.fillStyle = "#9ED18A";
        algaeList.forEach((a) => { ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI * 2); ctx.fill(); });

        // 적
        enemies.forEach((en) => {
          if (en.type === "fiber") {
            ctx.save();
            ctx.translate(en.x, en.y);
            ctx.fillStyle = "#BFE3F2";
            ctx.fillRect(-en.w / 2, -en.h / 2, en.w, en.h);
            ctx.restore();
          } else if (en.type === "carrier") {
            en.glow = (en.glow || 0) + 0.1;
            ctx.fillStyle = "rgba(203,239,126," + (0.5 + 0.3 * Math.sin(en.glow)) + ")";
            ctx.beginPath(); ctx.arc(en.x, en.y, en.radius + 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#8a8f82";
            ctx.beginPath(); ctx.arc(en.x, en.y, en.radius, 0, Math.PI * 2); ctx.fill();
          } else if (en.type === "fragment") {
            ctx.fillStyle = "#E0A46A";
            ctx.beginPath();
            ctx.moveTo(en.x + en.radius, en.y);
            ctx.lineTo(en.x - en.radius * 0.7, en.y - en.radius * 0.7);
            ctx.lineTo(en.x - en.radius * 0.7, en.y + en.radius * 0.7);
            ctx.closePath(); ctx.fill();
          } else {
            ctx.fillStyle = "#BFE3F2";
            ctx.beginPath(); ctx.arc(en.x, en.y, en.radius, 0, Math.PI * 2); ctx.fill();
          }
        });

        // 새끼
        pups.forEach((p) => {
          ctx.fillStyle = "rgba(203,239,126,0.8)";
          ctx.beginPath(); ctx.arc(p._x || player.x, p._y || player.y, 5, 0, Math.PI * 2); ctx.fill();
        });

        // 플레이어
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.rotate(player.angle);
        if (shieldReady) {
          ctx.strokeStyle = "rgba(203,239,126,0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, player.radius + 6, 0, Math.PI * 2); ctx.stroke();
        }
        if (player.dashActiveLeft > 0) { ctx.globalAlpha = 0.6; }
        ctx.fillStyle = "#CBEF7E";
        ctx.beginPath(); ctx.ellipse(0, 0, player.radius, player.radius * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#2c4a4a";
        ctx.beginPath(); ctx.arc(player.radius * 0.5, -3, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#CBEF7E";
        ctx.lineWidth = 1.5;
        const ant = Math.sin(t * 6) * 0.3;
        ctx.beginPath(); ctx.moveTo(player.radius * 0.6, -player.radius * 0.5); ctx.lineTo(player.radius * 1.3, -player.radius * 1.1 + ant * 10); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();

        // 파티클
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx; p.y += p.vy; p.alpha -= 0.04;
          if (p.alpha <= 0) { particles.splice(i, 1); continue; }
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }

        // ROS 가장자리 비네팅
        if (player.ros > 40) {
          const a = Math.min(0.5, (player.ros - 40) / 100);
          const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.7);
          grad.addColorStop(0, "rgba(224,96,74,0)");
          grad.addColorStop(1, "rgba(224,96,74," + a + ")");
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
        }
      }

      function renderHud() {
        const hours = Math.min(CFG.hoursPerGame, Math.round((elapsed / CFG.durationSec) * CFG.hoursPerGame));
        timeEl.textContent = hours + "h / " + CFG.hoursPerGame + "h";
        timeBarEl.style.width = Math.min(100, (elapsed / CFG.durationSec) * 100) + "%";
        levelEl.textContent = "Lv." + player.level;
        rosTextEl.textContent = Math.round(player.ros) + " / " + CFG.ros.max;
        rosBarEl.style.width = (player.ros / CFG.ros.max) * 100 + "%";
        rosBarEl.style.background = rosColor(player.ros);
        dashEl.textContent = player.dashCooldownLeft > 0 ? "대시 " + player.dashCooldownLeft.toFixed(1) + "s" : "대시 준비";
      }

      /* ---------------------- 메인 루프 ---------------------- */
      let lastTime = performance.now();
      function loop() {
        if (destroyed) return;
        rafId = requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;
        if (api.isPaused()) return;
        update(dt);
        draw();
        renderHud();
      }
      rafId = requestAnimationFrame(loop);
      spawnTimer = currentSpawnInterval(0, CFG.durationSec, CFG);
    }

    /* ---------------------- 인트로 ---------------------- */
    api.showIntro(
      {
        title: "물벼룩 서바이벌",
        rules: [
          "48시간(3분)을 압축한 시간 동안 미세플라스틱을 피해 조류를 먹고 성장하세요.",
          "맞을 때마다 ROS(활성산소) 게이지가 쌓입니다. 가득 차면 '유영 정지'로 게임이 끝나요.",
          "레벨업하면 8가지 진화 중 하나를 선택해 능력을 강화할 수 있습니다.",
        ],
        controls: ["WASD/방향키 이동", "마우스 누르고 이동(선택)", "Shift/Space 대시(무적)"],
      },
      () => buildUI()
    );

    return {
      destroy() {
        destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        timers.forEach(clearTimeout);
        window.removeEventListener("keydown", onKeydown);
        window.removeEventListener("keyup", onKeyup);
        window.removeEventListener("mouseup", onMouseUp);
        if (canvas) {
          canvas.removeEventListener("mousedown", onMouseDown);
          canvas.removeEventListener("mousemove", onMouseMove);
        }
      },
    };
  }

  window.CampaignGames = window.CampaignGames || {};
  window.CampaignGames.daphnia = {
    id: "daphnia",
    title: "물벼룩 서바이벌",
    icon: "🦐",
    mount,
  };
})();
