/* =========================================================================
   game-mastermind.js — 오염 마스터마인드
   하천 4개 지점에 숨은 오염물질 조합을 물벼룩 반응(힌트)으로 추리한다.
========================================================================= */
(function () {
  "use strict";

  const CFG = window.ConfigData.mastermind;

  /* =========================================================================
     순수 로직
  ========================================================================= */
  function computeFeedback(secret, guess) {
    const n = secret.length;
    let exact = 0;
    const secretRemain = [];
    const guessRemain = [];
    for (let i = 0; i < n; i++) {
      if (guess[i] === secret[i]) exact++;
      else { secretRemain.push(secret[i]); guessRemain.push(guess[i]); }
    }
    const counts = {};
    secretRemain.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
    let wrongSpot = 0;
    guessRemain.forEach((g) => {
      if (counts[g] > 0) { wrongSpot++; counts[g]--; }
    });
    return { exact, wrongSpot, none: n - exact - wrongSpot };
  }

  function generateSecret(rng, substanceIds, slotCount, allowDuplicates) {
    const secret = [];
    if (allowDuplicates) {
      for (let i = 0; i < slotCount; i++) secret.push(substanceIds[Math.floor(rng() * substanceIds.length)]);
    } else {
      const pool = substanceIds.slice();
      for (let i = 0; i < slotCount; i++) {
        const idx = Math.floor(rng() * pool.length);
        secret.push(pool[idx]);
        pool.splice(idx, 1);
      }
    }
    return secret;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dailySeedNumber(date) {
    const str = "" + date.getFullYear() + String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return h;
  }

  function computeScore(attempts, toolUses, elapsedSec, cfg) {
    const timeBonus = Math.max(0, cfg.scoring.timeBonusMax - Math.floor(elapsedSec));
    const raw = cfg.scoring.base - (attempts - 1) * cfg.scoring.perExtraAttempt - toolUses * CFG.tools.nileRed.scorePenalty + timeBonus;
    return Math.max(0, Math.round(raw));
  }

  /* ---------------------------- self-test ------------------------------- */
  (function selfTest() {
    const f1 = computeFeedback(["A", "A", "B", "C"], ["A", "B", "B", "B"]);
    console.assert(f1.exact === 2 && f1.wrongSpot === 0 && f1.none === 2, "[mastermind] 중복 테스트 1 실패: " + JSON.stringify(f1));

    const f2 = computeFeedback(["A", "B", "A", "A"], ["A", "A", "A", "B"]);
    console.assert(f2.exact === 2 && f2.wrongSpot === 2 && f2.none === 0, "[mastermind] 중복 테스트 2 실패: " + JSON.stringify(f2));

    const f3 = computeFeedback(["A", "B", "C", "D"], ["A", "B", "C", "D"]);
    console.assert(f3.exact === 4 && f3.wrongSpot === 0, "[mastermind] 완전 일치 테스트 실패");

    const f4 = computeFeedback(["A", "B", "C", "D"], ["D", "C", "B", "A"]);
    console.assert(f4.exact === 0 && f4.wrongSpot === 4, "[mastermind] 전부 자리만 틀림 테스트 실패");

    const seedA = dailySeedNumber(new Date(2026, 0, 5));
    const seedB = dailySeedNumber(new Date(2026, 0, 5));
    const seedC = dailySeedNumber(new Date(2026, 0, 6));
    console.assert(seedA === seedB, "[mastermind] 같은 날짜는 같은 시드여야 함");
    console.assert(seedA !== seedC, "[mastermind] 다른 날짜는 다른 시드여야 함(통상)");

    const rngA = mulberry32(seedA);
    const rngB = mulberry32(seedB);
    const secretA = generateSecret(rngA, ["a", "b", "c", "d", "e", "f"], 4, true);
    const secretB = generateSecret(rngB, ["a", "b", "c", "d", "e", "f"], 4, true);
    console.assert(JSON.stringify(secretA) === JSON.stringify(secretB), "[mastermind] 오늘의 시료는 항상 같은 정답이어야 함");

    const noDupSecret = generateSecret(Math.random, ["a", "b", "c", "d", "e"], 4, false);
    console.assert(new Set(noDupSecret).size === 4, "[mastermind] 중복 불가 모드에서 중복이 없어야 함");

    console.assert(computeScore(1, 0, 0, CFG) === CFG.scoring.base + CFG.scoring.timeBonusMax, "[mastermind] 1시도·0초 최고 점수");
    console.assert(computeScore(1, 0, 999, CFG) === CFG.scoring.base, "[mastermind] 시간보너스는 0 밑으로 내려가지 않음");
    console.assert(computeScore(1, 10, 0, CFG) === 0, "[mastermind] 점수는 음수로 내려가지 않고 0에서 clamp");
  })();

  /* =========================================================================
     UI / 게임 모듈
  ========================================================================= */
  function mount(root, api) {
    let destroyed = false;
    const timers = [];
    function later(fn, ms) { const id = setTimeout(() => { if (!destroyed) fn(); }, ms); timers.push(id); return id; }

    let difficultyKey = "normal";
    let mode = "daily"; // daily | random
    let secret = [];
    let allowedSubstances = [];
    let attempts = [];
    let currentGuess = [];
    let nileRedUses = 0, rosUses = 0;
    let toolUsesTotal = 0;
    let rosPromptOpen = false;
    let solved = false;
    let gameOver = false;
    let startTime = 0;
    let timerInterval = null;
    let listening = false;

    function substanceById(id) { return CFG.substances.find((s) => s.id === id); }

    /* ---------------------- 설정 화면 ---------------------- */
    function showSetupScreen() {
      root.innerHTML =
        '<div class="mm-setup">' +
        "<style>" + sharedCss() + "</style>" +
        "<h2>시료 설정</h2>" +
        '<div class="mm-setup-group"><div class="mm-setup-label">난이도</div><div class="mm-setup-row" id="mm-diff-row"></div></div>' +
        '<div class="mm-setup-group"><div class="mm-setup-label">모드</div><div class="mm-setup-row" id="mm-mode-row"></div></div>' +
        '<button class="gc-btn gc-primary" id="mm-setup-start">분석 시작</button>' +
        "</div>";
      const diffRow = root.querySelector("#mm-diff-row");
      Object.keys(CFG.difficulties).forEach((key) => {
        const d = CFG.difficulties[key];
        const btn = document.createElement("button");
        btn.className = "mm-chip" + (key === difficultyKey ? " active" : "");
        btn.textContent = d.label + " (" + d.maxTurns + "회)";
        btn.onclick = () => { difficultyKey = key; showSetupScreen(); };
        diffRow.appendChild(btn);
      });
      const modeRow = root.querySelector("#mm-mode-row");
      [["daily", "오늘의 시료"], ["random", "랜덤 시료"]].forEach(([key, label]) => {
        const btn = document.createElement("button");
        btn.className = "mm-chip" + (key === mode ? " active" : "");
        btn.textContent = label;
        btn.onclick = () => { mode = key; showSetupScreen(); };
        modeRow.appendChild(btn);
      });
      root.querySelector("#mm-setup-start").onclick = () => { api.sfx("click"); startGame(); };
    }

    function sharedCss() {
      return (
        ".mm-setup{max-width:480px;margin:0 auto;padding:40px 30px;text-align:center;}" +
        ".mm-setup h2{margin:0 0 20px;font-size:22px;}" +
        ".mm-setup-group{margin-bottom:22px;}" +
        ".mm-setup-label{font-size:12px;color:#CBEF7E;margin-bottom:8px;letter-spacing:1px;}" +
        ".mm-setup-row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}" +
        ".mm-chip{border:1px solid rgba(247,245,234,.3);background:rgba(247,245,234,.08);color:#F7F5EA;border-radius:12px;padding:9px 16px;font-size:13px;cursor:pointer;font-family:inherit;}" +
        ".mm-chip.active{background:#F3C64B;color:#3a2e12;border-color:#F3C64B;font-weight:700;}" +
        ".mm-wrap{padding:16px 22px;display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box;min-height:0;}" +
        ".mm-top{text-align:center;font-size:12.5px;color:rgba(247,245,234,.8);}" +
        ".mm-top b{color:#F3C64B;}" +
        ".mm-river{display:flex;gap:8px;justify-content:center;}" +
        ".mm-river span{background:rgba(0,0,0,.18);border-radius:10px;padding:5px 10px;font-size:11.5px;}" +
        ".mm-board{flex:1;min-height:70px;overflow-y:auto;display:flex;flex-direction:column-reverse;gap:6px;padding:6px;background:rgba(0,0,0,.14);border-radius:12px;}" +
        ".mm-board-empty{margin:auto;font-size:12px;color:rgba(247,245,234,.5);}" +
        ".mm-row{display:flex;justify-content:space-between;align-items:center;background:rgba(247,245,234,.05);border-radius:8px;padding:6px 10px;font-size:18px;}" +
        ".mm-row .mm-slots{display:flex;gap:6px;}" +
        ".mm-row .mm-pins{font-size:13px;letter-spacing:2px;}" +
        ".mm-current{display:flex;gap:10px;justify-content:center;}" +
        ".mm-slot{width:46px;height:46px;border-radius:12px;background:rgba(0,0,0,.25);border:2px dashed rgba(247,245,234,.3);display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;}" +
        ".mm-slot.filled{border-style:solid;border-color:#F3C64B;background:rgba(243,198,75,.15);}" +
        ".mm-palette{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}" +
        ".mm-pal-btn{display:flex;flex-direction:column;align-items:center;gap:2px;border:1px solid rgba(247,245,234,.25);background:rgba(247,245,234,.08);border-radius:12px;padding:8px 10px;cursor:pointer;color:#F7F5EA;font-family:inherit;}" +
        ".mm-pal-btn .n{font-size:9px;color:rgba(247,245,234,.6);}" +
        ".mm-pal-btn .ic{font-size:20px;}" +
        ".mm-tools{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}" +
        ".mm-tools button{border:1px solid rgba(247,245,234,.3);background:rgba(247,245,234,.1);color:#F7F5EA;border-radius:12px;padding:9px 16px;font-size:12.5px;cursor:pointer;font-family:inherit;}" +
        ".mm-tools button:disabled{opacity:.35;cursor:not-allowed;}" +
        ".mm-tools button.primary{background:#F3C64B;color:#3a2e12;font-weight:800;border-color:#F3C64B;}" +
        ".mm-msg{text-align:center;font-size:12.5px;color:#CBEF7E;min-height:18px;}" +
        ".mm-ros-prompt{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;background:rgba(0,0,0,.2);border-radius:10px;padding:10px;}"
      );
    }

    /* ---------------------- 게임 시작 ---------------------- */
    function startGame() {
      const diff = CFG.difficulties[difficultyKey];
      allowedSubstances = CFG.substances.slice(0, diff.substanceCount);
      const ids = allowedSubstances.map((s) => s.id);
      const rng = mode === "daily" ? mulberry32(dailySeedNumber(new Date())) : Math.random;
      secret = generateSecret(rng, ids, CFG.slotCount, diff.allowDuplicates);
      attempts = [];
      currentGuess = [];
      nileRedUses = 0; rosUses = 0; toolUsesTotal = 0;
      solved = false; gameOver = false; rosPromptOpen = false;
      startTime = performance.now();
      listening = true;
      buildPlayUI();
      startTimer();
    }

    function startTimer() {
      stopTimer();
      timerInterval = setInterval(() => {
        if (destroyed || api.isPaused()) return;
        renderTop();
      }, 1000);
    }
    function stopTimer() {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }
    function elapsedSec() { return (performance.now() - startTime) / 1000; }

    /* ---------------------- 플레이 화면 ---------------------- */
    let elTop, elBoard, elCurrent, elPalette, elTools, elMsg;
    function buildPlayUI() {
      root.innerHTML =
        '<div class="mm-wrap">' +
        "<style>" + sharedCss() + "</style>" +
        '<div class="mm-top" id="mm-top"></div>' +
        '<div class="mm-river">' + CFG.slotLabels.map((l) => "<span>" + l + "</span>").join("") + "</div>" +
        '<div class="mm-board" id="mm-board"></div>' +
        '<div class="mm-msg" id="mm-msg"></div>' +
        '<div class="mm-current" id="mm-current"></div>' +
        '<div class="mm-palette" id="mm-palette"></div>' +
        '<div class="mm-tools" id="mm-tools"></div>' +
        "</div>";
      elTop = root.querySelector("#mm-top");
      elBoard = root.querySelector("#mm-board");
      elMsg = root.querySelector("#mm-msg");
      elCurrent = root.querySelector("#mm-current");
      elPalette = root.querySelector("#mm-palette");
      elTools = root.querySelector("#mm-tools");
      renderAll();
    }

    function renderTop() {
      const diff = CFG.difficulties[difficultyKey];
      elTop.innerHTML =
        diff.label + " · " + (mode === "daily" ? "오늘의 시료" : "랜덤 시료") +
        " · 시도 <b>" + attempts.length + "</b>/" + diff.maxTurns +
        " · ⏱ <b>" + Math.floor(elapsedSec()) + "초</b>";
    }

    function renderBoard() {
      elBoard.innerHTML = "";
      if (!attempts.length) {
        const empty = document.createElement("div");
        empty.className = "mm-board-empty";
        empty.textContent = "아직 시도한 기록이 없어요. 아래에서 물질을 골라 제출해보세요.";
        elBoard.appendChild(empty);
        return;
      }
      attempts.forEach((a) => {
        const row = document.createElement("div");
        row.className = "mm-row";
        const slots = a.guess.map((id) => substanceById(id).icon).join(" ");
        const pins =
          CFG.pins.exact.icon.repeat(a.feedback.exact) +
          CFG.pins.wrongSpot.icon.repeat(a.feedback.wrongSpot) +
          CFG.pins.none.icon.repeat(a.feedback.none);
        row.innerHTML = '<div class="mm-slots">' + slots + '</div><div class="mm-pins">' + pins + "</div>";
        elBoard.appendChild(row);
      });
    }

    function renderCurrent() {
      elCurrent.innerHTML = "";
      for (let i = 0; i < CFG.slotCount; i++) {
        const div = document.createElement("div");
        const id = currentGuess[i];
        div.className = "mm-slot" + (id ? " filled" : "");
        div.textContent = id ? substanceById(id).icon : "";
        div.onclick = () => { if (id) { currentGuess.splice(i, 1); renderCurrent(); } };
        elCurrent.appendChild(div);
      }
    }

    function renderPalette() {
      elPalette.innerHTML = "";
      if (rosPromptOpen) {
        const note = document.createElement("div");
        note.className = "mm-msg";
        note.style.width = "100%";
        note.textContent = "ROS assay — 어떤 물질을 검사할까요?";
        elPalette.appendChild(note);
        const wrap = document.createElement("div");
        wrap.className = "mm-ros-prompt";
        allowedSubstances.forEach((s) => {
          const b = document.createElement("button");
          b.className = "mm-pal-btn";
          b.innerHTML = '<span class="ic">' + s.icon + "</span><span>" + s.name + "</span>";
          b.onclick = () => { api.sfx("click"); runRosAssay(s.id); };
          wrap.appendChild(b);
        });
        elPalette.appendChild(wrap);
        return;
      }
      allowedSubstances.forEach((s, i) => {
        const b = document.createElement("button");
        b.className = "mm-pal-btn";
        b.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="ic">' + s.icon + '</span><span style="font-size:10px">' + s.name + "</span>";
        b.onclick = () => { api.sfx("click"); fillSlot(s.id); };
        elPalette.appendChild(b);
      });
    }

    function renderTools() {
      elTools.innerHTML = "";
      const nileBtn = document.createElement("button");
      nileBtn.textContent = CFG.tools.nileRed.icon + " " + CFG.tools.nileRed.label + " (" + (CFG.tools.nileRed.maxUses - nileRedUses) + ")";
      nileBtn.disabled = nileRedUses >= CFG.tools.nileRed.maxUses || gameOver;
      nileBtn.onclick = () => { api.sfx("click"); runNileRed(); };
      elTools.appendChild(nileBtn);

      const rosBtn = document.createElement("button");
      rosBtn.textContent = CFG.tools.rosAssay.icon + " " + CFG.tools.rosAssay.label + " (" + (CFG.tools.rosAssay.maxUses - rosUses) + ")";
      rosBtn.disabled = rosUses >= CFG.tools.rosAssay.maxUses || gameOver;
      rosBtn.onclick = () => { api.sfx("click"); rosPromptOpen = !rosPromptOpen; renderPalette(); };
      elTools.appendChild(rosBtn);

      const submitBtn = document.createElement("button");
      submitBtn.className = "primary";
      submitBtn.textContent = "제출 (Enter)";
      submitBtn.disabled = currentGuess.length < CFG.slotCount || gameOver;
      submitBtn.onclick = () => submitGuess();
      elTools.appendChild(submitBtn);
    }

    function renderAll() {
      renderTop(); renderBoard(); renderCurrent(); renderPalette(); renderTools();
    }

    function fillSlot(id) {
      if (gameOver || currentGuess.length >= CFG.slotCount) return;
      currentGuess.push(id);
      renderCurrent();
      renderTools();
    }

    function submitGuess() {
      if (currentGuess.length < CFG.slotCount || gameOver) return;
      const feedback = computeFeedback(secret, currentGuess);
      attempts.push({ guess: currentGuess.slice(), feedback });
      const guessed = currentGuess.slice();
      currentGuess = [];
      renderBoard(); renderCurrent(); renderTop(); renderTools();
      if (feedback.exact === CFG.slotCount) {
        solved = true;
        finishGame(true);
        return;
      }
      api.sfx(feedback.exact > 0 ? "good" : "click");
      const diff = CFG.difficulties[difficultyKey];
      if (attempts.length >= diff.maxTurns) {
        finishGame(false);
      }
    }

    function runNileRed() {
      if (nileRedUses >= CFG.tools.nileRed.maxUses || gameOver) return;
      nileRedUses++; toolUsesTotal++;
      const count = secret.filter((id) => id === "microplastic").length;
      elMsg.textContent = "🔦 나일레드 검사 결과: 이 시료에 미세플라스틱이 총 " + count + "곳에 있습니다.";
      renderTools();
    }

    function runRosAssay(substanceId) {
      if (rosUses >= CFG.tools.rosAssay.maxUses || gameOver) return;
      rosUses++; toolUsesTotal++;
      rosPromptOpen = false;
      const present = secret.includes(substanceId);
      elMsg.textContent = "🧬 ROS assay — " + substanceById(substanceId).name + ": " + (present ? "있음" : "없음");
      renderPalette();
      renderTools();
    }

    function finishGame(won) {
      gameOver = true;
      listening = false;
      stopTimer();
      const score = won ? computeScore(attempts.length, toolUsesTotal, elapsedSec(), CFG) : 0;
      const grid = attempts
        .map((a) => CFG.pins.exact.icon.repeat(a.feedback.exact) + CFG.pins.wrongSpot.icon.repeat(a.feedback.wrongSpot) + CFG.pins.none.icon.repeat(a.feedback.none))
        .join("\n");
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const shareText =
        "카피바라 오염 마스터마인드 " + dateStr + " (" + (mode === "daily" ? "오늘의 시료" : "랜덤 시료") + ") " +
        (won ? attempts.length : "X") + "/" + CFG.difficulties[difficultyKey].maxTurns + "\n" + grid;

      api.sfx(won ? "win" : "lose");

      const answerLine = secret.map((id) => substanceById(id).icon + " " + substanceById(id).name).join(", ");
      const factLines = Array.from(new Set(secret)).map((id) => CFG.facts[id]).filter(Boolean).join(" ");

      later(() => {
        api.showResult({
          score,
          stats: [
            { label: "결과", value: won ? "해결 성공" : "시도 소진" },
            { label: "시도 횟수", value: attempts.length + " / " + CFG.difficulties[difficultyKey].maxTurns },
            { label: "걸린 시간", value: Math.floor(elapsedSec()) + "초" },
            { label: "정답", value: answerLine },
          ],
          factTitle: "오염물질 알아보기",
          fact: factLines || "자연을 아끼는 작은 습관이 하천을 지킵니다.",
          extraActions: [{ label: "📋 결과 공유", onClick: (btn) => copyShareText(shareText, btn) }],
        });
      }, 400);
    }

    async function copyShareText(shareText, btn) {
      api.sfx("click");
      let ok = false;
      try {
        await navigator.clipboard.writeText(shareText);
        ok = true;
      } catch (e) {
        try {
          const ta = document.createElement("textarea");
          ta.value = shareText;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          ok = true;
        } catch (e2) { ok = false; }
      }
      btn.textContent = ok ? "✅ 복사됨!" : "복사 실패";
      later(() => { if (btn) btn.textContent = "📋 결과 공유"; }, 1500);
    }

    /* ---------------------- 키보드 입력 ---------------------- */
    function onKeydown(e) {
      if (!listening || gameOver || rosPromptOpen) return;
      if (e.code === "Backspace") { currentGuess.pop(); renderCurrent(); renderTools(); return; }
      if (e.code === "Enter") { submitGuess(); return; }
      const num = Number(e.key);
      if (num >= 1 && num <= allowedSubstances.length) {
        fillSlot(allowedSubstances[num - 1].id);
      }
    }
    window.addEventListener("keydown", onKeydown);

    /* ---------------------- 시작 ---------------------- */
    api.showIntro(
      {
        title: "오염 마스터마인드",
        rules: [
          "갑천 4개 지점에 숨겨진 오염물질 조합을 추리하세요. 제출하면 물벼룩 반응(힌트)이 돌아옵니다.",
          CFG.pins.exact.icon + " 종류·지점 모두 정확 / " + CFG.pins.wrongSpot.icon + " 종류는 있지만 지점이 틀림 / " + CFG.pins.none.icon + " 없음",
          "힌트는 어느 칸이 맞았는지는 알려주지 않습니다. 제한된 분석 도구(나일레드, ROS assay)를 활용해보세요.",
        ],
        controls: ["숫자키 1~6 물질 선택", "Backspace 지우기", "Enter 제출"],
      },
      () => showSetupScreen()
    );

    return {
      destroy() {
        destroyed = true;
        listening = false;
        stopTimer();
        timers.forEach(clearTimeout);
        window.removeEventListener("keydown", onKeydown);
      },
    };
  }

  window.CampaignGames = window.CampaignGames || {};
  window.CampaignGames.mastermind = {
    id: "mastermind",
    title: "오염 마스터마인드",
    icon: "🔬",
    mount,
  };
})();
