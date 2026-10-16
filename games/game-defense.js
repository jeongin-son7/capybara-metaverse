/* =========================================================================
   game-defense.js — 트로이 목마 디펜스
   하천을 따라 흘러오는 미세플라스틱(껍질)과 그 속에 실린 오염물질(화물)을
   함께 막아내는 타워 디펜스. 3개 스테이지(상류/중류/하류) × 8웨이브,
   스테이지3 마지막엔 보스(거대 트로이 목마)가 등장한다.
========================================================================= */
(function () {
  "use strict";

  const CFG = window.ConfigData.defense;
  const NET_SLOW_DURATION_MS = 900; // 세탁망에 맞은 뒤 둔화가 유지되는 시간(표현 디테일, 밸런스 수치 아님)
  const TOWER_KEYS = ["net", "reed", "naturalDetergentBooth", "carbonFilter"];

  /* =========================================================================
     순수 로직 (self-test 대상)
  ========================================================================= */
  function scaledHp(baseHp, stageIndex, cfg) {
    return Math.round(baseHp * cfg.stageHpMultiplier[stageIndex]);
  }

  function getTowerLevelStats(towerDef, level) {
    let damage = towerDef.damage != null ? towerDef.damage : towerDef.primaryDamage;
    let range = towerDef.range;
    let slowPct = towerDef.slowPct || 0;
    for (let i = 0; i < level; i++) {
      const up = towerDef.upgrades[i];
      if (!up) continue;
      if (up.damageMult) damage *= up.damageMult;
      if (up.rangeAdd) range += up.rangeAdd;
      if (up.slowPct != null) slowPct = up.slowPct;
    }
    return { damage, range, rate: towerDef.rate, slowPct };
  }

  function cargoDamageAmount(towerDef, level, cargoType) {
    const stats = getTowerLevelStats(towerDef, level);
    if (cargoType === towerDef.primaryCargo) return stats.damage;
    return stats.damage * towerDef.otherCargoFactor;
  }

  function waveClearBonus(overallWaveNumber1based, cfg) {
    return cfg.economy.waveClearBonusBase + overallWaveNumber1based * cfg.economy.waveClearBonusPerWave;
  }

  function starsForWaterPercent(pct, thresholds) {
    const sorted = thresholds.slice().sort((a, b) => b.water - a.water);
    for (const t of sorted) if (pct >= t.water) return t.stars;
    return sorted[sorted.length - 1].stars;
  }

  function sellRefund(totalSpent, pct) {
    return Math.round(totalSpent * pct);
  }

  function buildSpawnSchedule(waveDef) {
    const events = [];
    waveDef.forEach((group) => {
      for (let i = 0; i < group.count; i++) {
        events.push({ t: i * group.interval, type: group.type, cargo: group.cargo || null });
      }
    });
    events.sort((a, b) => a.t - b.t);
    return events;
  }

  function totalEnemiesInWave(waveDef) {
    return waveDef.reduce((s, g) => s + g.count, 0);
  }

  function buildPathPixels(waypointsGridCoords, tile) {
    return waypointsGridCoords.map(([c, r]) => ({ x: c * tile + tile / 2, y: r * tile + tile / 2 }));
  }

  function pathSegmentLengths(points) {
    const lens = [];
    for (let i = 0; i < points.length - 1; i++) {
      lens.push(Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y));
    }
    return lens;
  }

  function pointAtDistance(points, lens, dist) {
    const total = lens.reduce((a, b) => a + b, 0);
    if (dist >= total) {
      const last = points[points.length - 1];
      return { x: last.x, y: last.y, done: true };
    }
    let remaining = dist;
    for (let i = 0; i < lens.length; i++) {
      if (remaining <= lens[i]) {
        const t = lens[i] === 0 ? 0 : remaining / lens[i];
        const p0 = points[i], p1 = points[i + 1];
        return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, done: false };
      }
      remaining -= lens[i];
    }
    const last = points[points.length - 1];
    return { x: last.x, y: last.y, done: true };
  }

  function blockedCellsForPath(waypointsGridCoords) {
    const set = new Set();
    const key = (c, r) => c + "," + r;
    for (let i = 0; i < waypointsGridCoords.length - 1; i++) {
      const [c0, r0] = waypointsGridCoords[i], [c1, r1] = waypointsGridCoords[i + 1];
      if (c0 === c1) {
        const lo = Math.min(r0, r1), hi = Math.max(r0, r1);
        for (let r = lo; r <= hi; r++) set.add(key(c0, r));
      } else {
        const lo = Math.min(c0, c1), hi = Math.max(c0, c1);
        for (let c = lo; c <= hi; c++) set.add(key(c, r0));
      }
    }
    return set;
  }

  /* ---------------------------- self-test ------------------------------- */
  (function selfTest() {
    console.assert(scaledHp(100, 0, CFG) === 100, "[defense] 스테이지1은 배율 1.0");
    console.assert(scaledHp(100, 2, CFG) === Math.round(100 * CFG.stageHpMultiplier[2]), "[defense] 스테이지3 체력 배율");

    const netStats0 = getTowerLevelStats(CFG.towers.net, 0);
    console.assert(netStats0.damage === CFG.towers.net.damage, "[defense] 세탁망 기본 데미지");
    const netStats2 = getTowerLevelStats(CFG.towers.net, 2);
    console.assert(Math.abs(netStats2.damage - CFG.towers.net.damage * CFG.towers.net.upgrades[0].damageMult) < 1e-9, "[defense] 세탁망 2레벨 데미지 배율 누적");
    console.assert(netStats2.range === CFG.towers.net.range + CFG.towers.net.upgrades[1].rangeAdd, "[defense] 세탁망 2레벨 사거리 증가");
    console.assert(netStats2.slowPct === CFG.towers.net.upgrades[1].slowPct, "[defense] 세탁망 2레벨 둔화율 교체");

    const reed = CFG.towers.reed;
    console.assert(cargoDamageAmount(reed, 0, reed.primaryCargo) === reed.primaryDamage, "[defense] 주력 화물 피해는 그대로");
    console.assert(Math.abs(cargoDamageAmount(reed, 0, "detergent") - reed.primaryDamage * reed.otherCargoFactor) < 1e-9, "[defense] 비주력 화물은 감소 피해");

    console.assert(waveClearBonus(1, CFG) === CFG.economy.waveClearBonusBase + CFG.economy.waveClearBonusPerWave, "[defense] 1번째 웨이브 보너스");
    console.assert(waveClearBonus(3, CFG) === CFG.economy.waveClearBonusBase + 3 * CFG.economy.waveClearBonusPerWave, "[defense] 3번째 웨이브 보너스");

    console.assert(starsForWaterPercent(90, CFG.scoring.starThresholds) === 3, "[defense] 수질 90%는 별 3개");
    console.assert(starsForWaterPercent(60, CFG.scoring.starThresholds) === 2, "[defense] 수질 60%는 별 2개");
    console.assert(starsForWaterPercent(10, CFG.scoring.starThresholds) === 1, "[defense] 수질 10%는 별 1개");

    console.assert(sellRefund(100, 0.7) === 70, "[defense] 판매 환급 계산");

    const sched = buildSpawnSchedule([{ type: "bead", count: 3, interval: 1 }, { type: "fiber", count: 2, interval: 0.5 }]);
    console.assert(sched.length === 5, "[defense] 스폰 일정 개수 = 전체 적 수");
    console.assert(sched[0].t <= sched[sched.length - 1].t, "[defense] 스폰 일정은 시간순 정렬");
    console.assert(totalEnemiesInWave([{ type: "bead", count: 3, interval: 1 }, { type: "fiber", count: 2, interval: 0.5 }]) === 5, "[defense] 웨이브 총 적 수 계산");

    const pts = buildPathPixels([[0, 0], [1, 0]], 60);
    const lens = pathSegmentLengths(pts);
    console.assert(lens[0] === 60, "[defense] 경로 1칸 길이 = 타일 크기");
    const mid = pointAtDistance(pts, lens, 30);
    console.assert(Math.abs(mid.x - 60) < 1e-6 && mid.done === false, "[defense] 경로 중간 지점 좌표");
    const end = pointAtDistance(pts, lens, 1000);
    console.assert(end.done === true, "[defense] 거리 초과 시 도착 처리");

    const blocked = blockedCellsForPath([[0, 0], [2, 0], [2, 1]]);
    console.assert(blocked.has("0,0") && blocked.has("1,0") && blocked.has("2,0") && blocked.has("2,1"), "[defense] 직선 경로 칸이 모두 차단됨");
  })();

  /* =========================================================================
     UI / 게임 모듈
  ========================================================================= */
  function mount(root, api) {
    let destroyed = false;
    const timers = [];
    function later(fn, ms) { const id = setTimeout(() => { if (!destroyed) fn(); }, ms); timers.push(id); return id; }

    const GRID = CFG.grid;
    const CANVAS_W = GRID.cols * GRID.tile;
    const CANVAS_H = GRID.rows * GRID.tile;

    let canvas, ctx, topEl, panelEl, interludeEl;
    let onClick, onContextMenu, onMouseMove, onKeydown;
    let rafId = null;

    /* ------------------------------ 상태 ------------------------------ */
    let stageIndex = 0;
    let waveIndex = 0;
    let water = CFG.startWater;
    let currency = CFG.startCurrency;
    let towers = []; // { id, col, row, type, level, spentTotal, lastFireAt }
    let enemies = []; // 살아있는 적
    let fx = []; // 포탈/타격 이펙트
    let pathPoints = [], pathLens = [], blockedCells = new Set();
    let phase = "interlude"; // interlude | prep | wave | ended
    let prepTimeLeft = 0;
    let spawnSchedule = [], spawnElapsed = 0, spawnedCount = 0;
    let selectedBuildType = null;
    let selectedTowerId = null;
    let hoverCol = -1, hoverRow = -1;
    let nextTowerId = 1;
    let gameEnded = false;

    function stageNumber() { return stageIndex + 1; }
    function totalStages() { return CFG.waves.length; }
    function totalWavesInStage() { return CFG.waves[stageIndex].length; }

    function setupStagePath() {
      pathPoints = buildPathPixels(CFG.paths[stageIndex], GRID.tile);
      pathLens = pathSegmentLengths(pathPoints);
      blockedCells = blockedCellsForPath(CFG.paths[stageIndex]);
    }

    function cellBlocked(col, row) {
      if (blockedCells.has(col + "," + row)) return true;
      return towers.some((t) => t.col === col && t.row === row);
    }

    function towerAt(col, row) {
      return towers.find((t) => t.col === col && t.row === row) || null;
    }

    /* ------------------------------ 적 ------------------------------ */
    function spawnEnemy(spec) {
      const def = CFG.enemies[spec.type];
      const e = {
        id: nextTowerId++,
        kind: spec.type,
        shellHp: scaledHp(def.shellHp, stageIndex, CFG),
        shellMax: scaledHp(def.shellHp, stageIndex, CFG),
        exposed: false,
        dead: false,
        dist: 0,
        baseSpeed: def.speed,
        slowUntil: 0,
        slowPct: 0,
        x: pathPoints[0].x,
        y: pathPoints[0].y,
      };
      if (spec.type === "bossTrojan") {
        e.cargoLayers = def.cargoLayers.slice();
        e.cargoLayerIndex = 0;
        e.cargoHpPerLayer = scaledHp(def.cargoHpPerLayer, stageIndex, CFG);
        e.cargoHp = e.cargoHpPerLayer;
        e.cargoMax = e.cargoHpPerLayer;
        e.cargoType = e.cargoLayers[0];
      } else if (spec.type === "trojan") {
        e.cargoType = spec.cargo;
        e.cargoHp = scaledHp(def.cargoHp, stageIndex, CFG);
        e.cargoMax = e.cargoHp;
      } else {
        e.cargoHp = 0; e.cargoMax = 0; e.cargoType = null;
      }
      enemies.push(e);
    }

    function enemyDies(e, reward) {
      e.dead = true;
      currency += reward;
      api.sfx("good");
      fx.push({ t: 0, life: 320, kind: "burst", x: e.x, y: e.y, color: "#CBEF7E" });
    }

    function applyShellDamage(e, dmg) {
      if (e.dead || e.shellHp <= 0) return;
      e.shellHp = Math.max(0, e.shellHp - dmg);
      if (e.shellHp <= 0 && !e.exposed) {
        e.exposed = true;
        const def = CFG.enemies[e.kind];
        if (e.cargoMax > 0) {
          currency += def.shellReward || 0;
          api.sfx("merge");
        } else {
          enemyDies(e, def.killReward || 0);
        }
      }
    }

    function applyCargoDamage(e, dmg) {
      if (e.dead || !e.exposed || e.cargoHp <= 0) return;
      e.cargoHp = Math.max(0, e.cargoHp - dmg);
      if (e.cargoHp <= 0) {
        if (e.kind === "bossTrojan") {
          e.cargoLayerIndex++;
          if (e.cargoLayerIndex < e.cargoLayers.length) {
            e.cargoHp = e.cargoHpPerLayer;
            e.cargoMax = e.cargoHpPerLayer;
            e.cargoType = e.cargoLayers[e.cargoLayerIndex];
            api.sfx("merge");
          } else {
            enemyDies(e, CFG.enemies.bossTrojan.killReward || 0);
            api.sfx("win");
          }
        } else {
          const def = CFG.enemies[e.kind];
          enemyDies(e, def.cargoReward || 0);
        }
      }
    }

    function effSpeed(e, now) {
      let mult = 1;
      if (e.exposed) mult *= CFG.enemies.exposedSpeedMultiplier;
      if (e.slowUntil && now < e.slowUntil) mult *= 1 - (e.slowPct || 0);
      return e.baseSpeed * mult;
    }

    function checkWaterGameOver() {
      if (water <= 0 && !gameEnded) {
        water = 0;
        endGame(false);
      }
    }

    /* ------------------------------ 타워 ------------------------------ */
    function placeTower(col, row, typeKey) {
      const def = CFG.towers[typeKey];
      if (!def) return;
      if (stageNumber() < def.unlockStage) return;
      if (cellBlocked(col, row)) return;
      if (currency < def.cost) return;
      currency -= def.cost;
      towers.push({ id: nextTowerId++, col, row, type: typeKey, level: 0, spentTotal: def.cost, lastFireAt: -99999 });
      api.sfx("click");
    }

    function upgradeTower(tower) {
      const def = CFG.towers[tower.type];
      const up = def.upgrades[tower.level];
      if (!up) return;
      if (currency < up.cost) return;
      currency -= up.cost;
      tower.spentTotal += up.cost;
      tower.level++;
      api.sfx("levelup");
    }

    function sellTower(tower) {
      const refund = sellRefund(tower.spentTotal, CFG.towers.sellRefundPct);
      currency += refund;
      towers = towers.filter((t) => t.id !== tower.id);
      if (selectedTowerId === tower.id) selectedTowerId = null;
      api.sfx("click");
    }

    function isValidTarget(def, e) {
      if (def.targets === "shell") return e.shellHp > 0;
      if (def.targets === "cargo") return e.exposed && e.cargoMax > 0 && e.cargoHp > 0;
      return false;
    }

    function fireTower(tower, now) {
      const def = CFG.towers[tower.type];
      const stats = getTowerLevelStats(def, tower.level);
      const cooldownMs = 1000 / def.rate;
      if (now - tower.lastFireAt < cooldownMs) return;
      const cx = tower.col * GRID.tile + GRID.tile / 2, cy = tower.row * GRID.tile + GRID.tile / 2;
      let best = null, bestDist = -1;
      for (const e of enemies) {
        if (e.dead || !isValidTarget(def, e)) continue;
        const d = Math.hypot(e.x - cx, e.y - cy);
        if (d > stats.range) continue;
        if (e.dist > bestDist) { bestDist = e.dist; best = e; }
      }
      if (!best) return;
      tower.lastFireAt = now;
      fx.push({ t: 0, life: 150, kind: "beam", x1: cx, y1: cy, x2: best.x, y2: best.y, color: def.targets === "shell" ? "#8fd3ff" : "#F3C64B" });
      api.sfx("tick");
      if (def.targets === "shell") {
        applyShellDamage(best, stats.damage);
        if (stats.slowPct) { best.slowUntil = now + NET_SLOW_DURATION_MS; best.slowPct = stats.slowPct; }
      } else {
        applyCargoDamage(best, cargoDamageAmount(def, tower.level, best.cargoType));
      }
    }

    /* ------------------------------ 웨이브 흐름 ------------------------------ */
    function enterStage(idx) {
      stageIndex = idx;
      waveIndex = 0;
      setupStagePath();
      showInterlude();
    }

    function showInterlude() {
      phase = "interlude";
      selectedBuildType = null;
      selectedTowerId = null;
      const factKey = "stage" + stageNumber();
      interludeEl.innerHTML =
        '<div class="def-interludecard">' +
        "<h3>" + CFG.stageNames[stageIndex] + " 구역</h3>" +
        '<p class="def-fact">' + (CFG.facts[factKey] || "") + "</p>" +
        '<button class="def-btn def-btn-primary" id="def-interlude-go">탐사 시작</button>' +
        "</div>";
      interludeEl.style.display = "flex";
      interludeEl.querySelector("#def-interlude-go").onclick = () => {
        interludeEl.style.display = "none";
        startPrep();
      };
    }

    function startPrep() {
      phase = "prep";
      prepTimeLeft = CFG.autoStartSec;
      enemies = [];
      spawnSchedule = buildSpawnSchedule(CFG.waves[stageIndex][waveIndex]);
      spawnElapsed = 0;
      spawnedCount = 0;
      renderPanel();
    }

    function startWave() {
      phase = "wave";
      spawnElapsed = 0;
      spawnedCount = 0;
      renderPanel();
    }

    function onWaveCleared() {
      const overall = stageIndex * CFG.waves[stageIndex].length + waveIndex + 1;
      currency += waveClearBonus(overall, CFG);
      api.sfx("win");
      waveIndex++;
      if (waveIndex >= totalWavesInStage()) {
        if (stageIndex + 1 >= totalStages()) {
          endGame(true);
        } else {
          enterStage(stageIndex + 1);
        }
      } else {
        startPrep();
      }
    }

    function endGame(victory) {
      if (gameEnded) return;
      gameEnded = true;
      phase = "ended";
      const pct = Math.max(0, Math.min(100, (water / CFG.startWater) * 100));
      const stars = starsForWaterPercent(pct, CFG.scoring.starThresholds);
      const score = Math.round(pct * CFG.scoring.waterPercentFactor) + Math.round(currency * CFG.scoring.currencyFactor);
      api.sfx(victory ? "win" : "lose");
      later(() => {
        api.showResult({
          score,
          stats: [
            { label: "남은 수질", value: Math.round(pct) + "%" },
            { label: "별점", value: "⭐".repeat(stars) + "☆".repeat(3 - stars) },
            { label: "도달 구역", value: CFG.stageNames[stageIndex] + " · 웨이브 " + (waveIndex + 1) },
            { label: "보유 자원", value: currency },
          ],
          factTitle: "알아두기",
          fact: CFG.facts.stage3,
        });
      }, 600);
    }

    /* ------------------------------ 입력 ------------------------------ */
    function canvasCellFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (CANVAS_W / rect.width);
      const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
      return { col: Math.floor(x / GRID.tile), row: Math.floor(y / GRID.tile) };
    }

    function handleCanvasClick(e) {
      if (phase === "interlude" || phase === "ended") return;
      const { col, row } = canvasCellFromEvent(e);
      if (col < 0 || col >= GRID.cols || row < 0 || row >= GRID.rows) return;
      const existing = towerAt(col, row);
      if (existing) {
        selectedTowerId = existing.id;
        selectedBuildType = null;
      } else if (selectedBuildType) {
        placeTower(col, row, selectedBuildType);
      }
      renderPanel();
    }

    function handleContextMenu(e) {
      e.preventDefault();
      selectedBuildType = null;
      selectedTowerId = null;
      renderPanel();
    }

    function handleMouseMove(e) {
      const { col, row } = canvasCellFromEvent(e);
      hoverCol = col; hoverRow = row;
    }

    function handleKeydown(e) {
      if (e.code === "Space" && phase === "prep") { e.preventDefault(); startWave(); }
    }

    /* ------------------------------ 렌더 ------------------------------ */
    function waterBarColor(pct) {
      if (pct > 60) return "#CBEF7E";
      if (pct > 30) return "#F3C64B";
      return "#E0604A";
    }

    function renderTop() {
      const pct = Math.max(0, Math.min(100, (water / CFG.startWater) * 100));
      topEl.innerHTML =
        "스테이지 <b>" + stageNumber() + "/" + totalStages() + "</b> (" + CFG.stageNames[stageIndex] + ") · 웨이브 <b>" + (waveIndex + 1) + "/" + totalWavesInStage() + "</b>" +
        '<div class="def-waterbar"><div class="def-waterfill" style="width:' + pct + '%;background:' + waterBarColor(pct) + '"></div>' +
        '<span class="def-waterlabel">수질 ' + Math.round(pct) + "%</span></div>" +
        '<div class="def-currency">💰 ' + currency + "</div>";
    }

    function renderPanel() {
      const parts = [];
      parts.push('<div class="def-shop">');
      TOWER_KEYS.forEach((key) => {
        const def = CFG.towers[key];
        const locked = stageNumber() < def.unlockStage;
        const affordable = currency >= def.cost;
        const sel = selectedBuildType === key;
        parts.push(
          '<button class="def-towerbtn' + (sel ? " sel" : "") + (locked || !affordable ? " locked" : "") + '" data-tower="' + key + '" ' + (locked || !affordable ? "disabled" : "") + ">" +
          '<span class="def-towericon">' + def.icon + "</span><span>" + def.name + "</span>" +
          '<span class="def-towercost">' + (locked ? "스테이지 " + def.unlockStage + " 해금" : "💰" + def.cost) + "</span>" +
          "</button>"
        );
      });
      parts.push("</div>");

      const selTower = selectedTowerId ? towers.find((t) => t.id === selectedTowerId) : null;
      if (selTower) {
        const def = CFG.towers[selTower.type];
        const stats = getTowerLevelStats(def, selTower.level);
        const up = def.upgrades[selTower.level];
        parts.push(
          '<div class="def-selected">' +
          "<b>" + def.icon + " " + def.name + "</b> · 레벨 " + (selTower.level + 1) + "/" + (def.upgrades.length + 1) +
          '<div class="def-stats">사거리 ' + Math.round(stats.range) + " · 피해 " + Math.round(stats.damage) + (stats.slowPct ? " · 둔화 " + Math.round(stats.slowPct * 100) + "%" : "") + "</div>" +
          '<div class="def-actions">' +
          (up ? '<button class="def-btn" id="def-upgrade">강화 (💰' + up.cost + ")</button>" : '<span class="def-maxed">최대 강화</span>') +
          '<button class="def-btn def-btn-danger" id="def-sell">판매 (+💰' + sellRefund(selTower.spentTotal, CFG.towers.sellRefundPct) + ")</button>" +
          "</div></div>"
        );
      }

      if (phase === "prep") {
        parts.push(
          '<div class="def-prep">다음 웨이브까지 <b>' + Math.ceil(prepTimeLeft) + "초</b> · 타워를 배치/강화하세요" +
          '<button class="def-btn def-btn-primary" id="def-startwave">지금 시작 (Space)</button></div>'
        );
      } else if (phase === "wave") {
        const remaining = enemies.length + (spawnSchedule.length - spawnedCount);
        parts.push('<div class="def-prep">웨이브 진행 중 · 남은 적 ' + remaining + "마리</div>");
      }

      panelEl.innerHTML = parts.join("");

      panelEl.querySelectorAll(".def-towerbtn:not([disabled])").forEach((b) => {
        b.onclick = () => {
          selectedBuildType = selectedBuildType === b.dataset.tower ? null : b.dataset.tower;
          selectedTowerId = null;
          renderPanel();
        };
      });
      const upgradeBtn = panelEl.querySelector("#def-upgrade");
      if (upgradeBtn) upgradeBtn.onclick = () => { upgradeTower(selTower); renderPanel(); };
      const sellBtn = panelEl.querySelector("#def-sell");
      if (sellBtn) sellBtn.onclick = () => { sellTower(selTower); renderPanel(); };
      const startBtn = panelEl.querySelector("#def-startwave");
      if (startBtn) startBtn.onclick = () => startWave();
    }

    function drawGrid() {
      ctx.fillStyle = "#3f4538";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      const waterColor = CFG.stageWaterColor[stageIndex];
      for (let r = 0; r < GRID.rows; r++) {
        for (let c = 0; c < GRID.cols; c++) {
          if (blockedCells.has(c + "," + r)) {
            ctx.fillStyle = waterColor + "cc";
            ctx.fillRect(c * GRID.tile, r * GRID.tile, GRID.tile, GRID.tile);
          }
        }
      }
      ctx.strokeStyle = "rgba(247,245,234,0.08)";
      for (let c = 0; c <= GRID.cols; c++) { ctx.beginPath(); ctx.moveTo(c * GRID.tile, 0); ctx.lineTo(c * GRID.tile, CANVAS_H); ctx.stroke(); }
      for (let r = 0; r <= GRID.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * GRID.tile); ctx.lineTo(CANVAS_W, r * GRID.tile); ctx.stroke(); }

      if (hoverCol >= 0 && hoverRow >= 0 && hoverCol < GRID.cols && hoverRow < GRID.rows && selectedBuildType) {
        const ok = !cellBlocked(hoverCol, hoverRow) && stageNumber() >= CFG.towers[selectedBuildType].unlockStage && currency >= CFG.towers[selectedBuildType].cost;
        ctx.fillStyle = ok ? "rgba(203,239,126,0.35)" : "rgba(224,96,74,0.35)";
        ctx.fillRect(hoverCol * GRID.tile, hoverRow * GRID.tile, GRID.tile, GRID.tile);
        ctx.strokeStyle = "rgba(247,245,234,0.5)";
        ctx.beginPath(); ctx.arc(hoverCol * GRID.tile + GRID.tile / 2, hoverRow * GRID.tile + GRID.tile / 2, CFG.towers[selectedBuildType].range, 0, Math.PI * 2); ctx.stroke();
      }
    }

    function drawTowers() {
      towers.forEach((t) => {
        const def = CFG.towers[t.type];
        const cx = t.col * GRID.tile + GRID.tile / 2, cy = t.row * GRID.tile + GRID.tile / 2;
        if (t.id === selectedTowerId) {
          ctx.strokeStyle = "rgba(247,245,234,0.5)";
          ctx.beginPath(); ctx.arc(cx, cy, getTowerLevelStats(def, t.level).range, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = "rgba(74,81,69,0.95)";
        ctx.beginPath(); ctx.arc(cx, cy, GRID.tile * 0.36, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = t.id === selectedTowerId ? "#F3C64B" : "rgba(247,245,234,0.4)";
        ctx.lineWidth = 2; ctx.stroke();
        ctx.font = "22px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(def.icon, cx, cy);
        for (let i = 0; i < t.level; i++) {
          ctx.fillStyle = "#F3C64B";
          ctx.beginPath(); ctx.arc(cx - 10 + i * 10, cy + GRID.tile * 0.36 + 6, 3, 0, Math.PI * 2); ctx.fill();
        }
      });
    }

    const ENEMY_ICON = { bead: "⚪", fiber: "🧵", trojan: "🐴", bossTrojan: "👑" };

    function drawEnemies() {
      enemies.forEach((e) => {
        ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(ENEMY_ICON[e.kind] || "⚪", e.x, e.y);
        const barW = e.kind === "bossTrojan" ? 44 : 26;
        const barX = e.x - barW / 2, barY = e.y - 20;
        if (e.shellHp > 0) {
          ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(barX, barY, barW, 4);
          ctx.fillStyle = "#8fd3ff"; ctx.fillRect(barX, barY, barW * (e.shellHp / e.shellMax), 4);
        } else if (e.cargoMax > 0) {
          const cargoDef = CFG.cargoTypes[e.cargoType];
          ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(barX, barY, barW, 4);
          ctx.fillStyle = cargoDef ? cargoDef.color : "#F3C64B";
          ctx.fillRect(barX, barY, barW * (e.cargoHp / e.cargoMax), 4);
        }
      });
    }

    function drawFx(dt) {
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        f.t += dt;
        if (f.t >= f.life) { fx.splice(i, 1); continue; }
        const alpha = 1 - f.t / f.life;
        ctx.globalAlpha = Math.max(0, alpha);
        if (f.kind === "beam") {
          ctx.strokeStyle = f.color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
        } else if (f.kind === "burst") {
          ctx.fillStyle = f.color;
          ctx.beginPath(); ctx.arc(f.x, f.y, 14 * (f.t / f.life), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    function draw(dt) {
      drawGrid();
      drawTowers();
      drawEnemies();
      drawFx(dt);
    }

    /* ------------------------------ 메인 루프 ------------------------------ */
    let lastTime = performance.now();
    function loop() {
      if (destroyed) return;
      rafId = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      if (api.isPaused()) return;

      if (phase === "prep") {
        prepTimeLeft -= dt;
        if (prepTimeLeft <= 0) startWave();
        if (Math.floor(prepTimeLeft * 2) !== Math.floor((prepTimeLeft + dt) * 2)) renderPanel();
      } else if (phase === "wave") {
        spawnElapsed += dt;
        while (spawnedCount < spawnSchedule.length && spawnSchedule[spawnedCount].t <= spawnElapsed) {
          spawnEnemy(spawnSchedule[spawnedCount]);
          spawnedCount++;
        }
        towers.forEach((t) => fireTower(t, now));
        for (let i = enemies.length - 1; i >= 0; i--) {
          const e = enemies[i];
          if (e.dead) { enemies.splice(i, 1); continue; }
          e.dist += effSpeed(e, now) * dt;
          const p = pointAtDistance(pathPoints, pathLens, e.dist);
          e.x = p.x; e.y = p.y;
          if (p.done) {
            const def = CFG.enemies[e.kind];
            water = Math.max(0, water - def.damage);
            api.sfx("bad");
            enemies.splice(i, 1);
            checkWaterGameOver();
          }
        }
        if (!gameEnded && spawnedCount >= spawnSchedule.length && enemies.length === 0) {
          onWaveCleared();
        }
      }
      renderTop();
      draw(dt * 1000);
    }

    /* ------------------------------ 빌드 ------------------------------ */
    function buildUI() {
      root.innerHTML =
        '<div class="def-wrap">' +
        "<style>" +
        ".def-wrap{display:flex;flex-direction:column;gap:10px;padding:14px;height:100%;box-sizing:border-box;color:#F7F5EA;position:relative;}" +
        ".def-top{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:13px;}" +
        ".def-top b{color:#F3C64B;}" +
        ".def-waterbar{position:relative;width:180px;height:16px;background:rgba(0,0,0,0.3);border-radius:8px;overflow:hidden;}" +
        ".def-waterfill{height:100%;transition:width .2s ease;}" +
        ".def-waterlabel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;}" +
        ".def-currency{font-weight:800;color:#F3C64B;}" +
        ".def-main{display:flex;gap:14px;flex:1;min-height:0;}" +
        ".def-canvaswrap{flex-shrink:0;}" +
        "#def-canvas{background:#000;border:2px solid rgba(247,245,234,0.3);border-radius:10px;width:min(620px,58vw);height:auto;aspect-ratio:" + CANVAS_W + "/" + CANVAS_H + ";cursor:crosshair;}" +
        ".def-panel{flex:1;min-width:220px;display:flex;flex-direction:column;gap:12px;overflow:auto;}" +
        ".def-shop{display:grid;grid-template-columns:1fr 1fr;gap:8px;}" +
        ".def-towerbtn{display:flex;flex-direction:column;align-items:center;gap:3px;border:1px solid rgba(247,245,234,0.3);background:rgba(247,245,234,0.08);color:#F7F5EA;border-radius:12px;padding:8px 6px;font-size:11.5px;cursor:pointer;font-family:inherit;}" +
        ".def-towerbtn.sel{border-color:#F3C64B;background:rgba(243,198,75,0.2);}" +
        ".def-towerbtn.locked,.def-towerbtn[disabled]{opacity:0.4;cursor:not-allowed;}" +
        ".def-towericon{font-size:20px;}" +
        ".def-towercost{color:#CBEF7E;font-size:10.5px;}" +
        ".def-selected{background:rgba(0,0,0,0.2);border-radius:12px;padding:10px 12px;font-size:12.5px;}" +
        ".def-stats{color:rgba(247,245,234,0.75);margin:6px 0;}" +
        ".def-actions{display:flex;gap:8px;flex-wrap:wrap;}" +
        ".def-maxed{color:#CBEF7E;font-size:12px;}" +
        ".def-btn{border:1px solid rgba(247,245,234,0.3);background:rgba(247,245,234,0.1);color:#F7F5EA;border-radius:10px;padding:7px 12px;font-size:12px;cursor:pointer;font-family:inherit;}" +
        ".def-btn-primary{background:#F3C64B;color:#3a2e12;border-color:#F3C64B;font-weight:800;}" +
        ".def-btn-danger{border-color:rgba(224,96,74,0.5);color:#ffb3a3;}" +
        ".def-prep{background:rgba(0,0,0,0.2);border-radius:12px;padding:10px 12px;font-size:12.5px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}" +
        "#def-interlude{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(20,22,18,0.82);border-radius:14px;z-index:5;}" +
        ".def-interludecard{max-width:420px;text-align:center;padding:24px;}" +
        ".def-interludecard h3{margin:0 0 12px;font-size:20px;color:#F3C64B;}" +
        ".def-fact{font-size:13px;line-height:1.7;background:rgba(0,0,0,0.25);border-radius:12px;padding:14px 16px;margin:0 0 18px;}" +
        ".def-hint{font-size:11px;color:rgba(247,245,234,0.6);}" +
        "</style>" +
        '<div class="def-top" id="def-top"></div>' +
        '<div class="def-main">' +
        '<div class="def-canvaswrap"><canvas id="def-canvas" width="' + CANVAS_W + '" height="' + CANVAS_H + '"></canvas></div>' +
        '<div class="def-panel" id="def-panel"></div>' +
        "</div>" +
        '<div class="def-hint">클릭: 타워 선택/배치 · 우클릭: 선택 취소 · Space: 대기시간 즉시 종료</div>' +
        '<div id="def-interlude"></div>' +
        "</div>";

      canvas = root.querySelector("#def-canvas");
      ctx = canvas.getContext("2d");
      topEl = root.querySelector("#def-top");
      panelEl = root.querySelector("#def-panel");
      interludeEl = root.querySelector("#def-interlude");

      onClick = (e) => handleCanvasClick(e);
      onContextMenu = (e) => handleContextMenu(e);
      onMouseMove = (e) => handleMouseMove(e);
      onKeydown = (e) => handleKeydown(e);
      canvas.addEventListener("click", onClick);
      canvas.addEventListener("contextmenu", onContextMenu);
      canvas.addEventListener("mousemove", onMouseMove);
      window.addEventListener("keydown", onKeydown);

      enterStage(0);
      renderTop();
      renderPanel();
      rafId = requestAnimationFrame(loop);
    }

    /* ------------------------------ 인트로 ------------------------------ */
    api.showIntro(
      {
        title: "트로이 목마 디펜스",
        rules: [
          "하천을 따라 미세플라스틱이 떠내려옵니다. 겉껍질(플라스틱)을 먼저 부수면, 그 속에 실려있던 오염물질(화물)이 드러납니다.",
          "세탁망은 겉껍질만, 나머지 타워는 드러난 화물만 공격할 수 있습니다 — 자기 전문 화물에는 피해가 크고, 다른 화물에는 피해가 작습니다.",
          "껍질과 화물을 모두 없애지 못한 채 하류 끝까지 도달하면 그만큼 수질(물)이 나빠집니다. 수질이 0이 되면 게임이 끝납니다.",
          "3개 구역(상류→중류→하류) × 8웨이브. 하류의 마지막 웨이브엔 거대 트로이 목마(보스)가 등장합니다.",
          "웨이브 사이 대기시간 동안 타워를 배치·강화하세요. 자원이 모자라면 기존 타워를 팔아 되돌릴 수 있습니다.",
        ],
        controls: ["클릭: 배치/선택", "우클릭: 선택 취소", "Space: 대기시간 즉시 종료"],
      },
      () => buildUI()
    );

    return {
      destroy() {
        destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        timers.forEach(clearTimeout);
        if (canvas) {
          canvas.removeEventListener("click", onClick);
          canvas.removeEventListener("contextmenu", onContextMenu);
          canvas.removeEventListener("mousemove", onMouseMove);
        }
        window.removeEventListener("keydown", onKeydown);
      },
    };
  }

  window.CampaignGames = window.CampaignGames || {};
  window.CampaignGames.defense = {
    id: "defense",
    title: "트로이 목마 디펜스",
    icon: "🏰",
    mount,
  };
})();
