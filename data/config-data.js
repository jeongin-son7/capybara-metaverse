/* =========================================================================
   config-data.js
   카피바라 환경동아리 메타버스 · 캠페인관 미니게임 전체 설정값

   - 모든 수치/확률/텍스트는 이 파일에만 모아둔다. 게임 코드에는
     매직넘버를 넣지 않는다.
   - 일반 <script src="..."> 로 불러온다 (type="module" 금지, file://
     환경에서 로컬 ES module import가 막히기 때문).
   - 이 파일은 window.ConfigData 전역 하나만 노출한다.
========================================================================= */
(function () {
  "use strict";

  const DISCLAIMER =
    "이 게임 속 수치는 전부 가상 데이터입니다. 실제 실험 결과는 동아리 부스에서 확인하세요.";

  /* -----------------------------------------------------------------------
     공통 디자인 토큰 / 텍스트
  ----------------------------------------------------------------------- */
  const theme = {
    colors: {
      oliveDark: "#5C6353",
      olive: "#6E7365",
      cardDark: "rgba(63,69,58,0.88)",
      cardDarker: "#4A5145",
      gold: "#F3C64B",
      goldDeep: "#D9942B",
      halo: "#CBEF7E",
      paper: "#F7F5EA",
      danger: "#E0604A",
      info: "#7FB8D9",
    },
    font: '"Noto Sans KR", "Malgun Gothic", sans-serif',
    radius: { lg: 28, md: 18, sm: 12 },
  };

  const common = {
    disclaimer: DISCLAIMER,
    storagePrefix: "capybara.",
    muteKey: "capybara.mute",
    bestKeyPrefix: "capybara.best.",
  };

  /* -----------------------------------------------------------------------
     로비 (campaign-hall.html) 부스 정의
  ----------------------------------------------------------------------- */
  const hall = {
    introHint: "부스에 다가가 Enter 키로 미니게임에 도전하세요",
    boothRadius: 6.5,
    booths: [
      { id: "lc50", icon: "🧪", title: "LC50 푸시 유어 럭" },
      { id: "mastermind", icon: "🔬", title: "오염 마스터마인드" },
      { id: "suika", icon: "♻️", title: "재활용 수박게임" },
      { id: "daphnia", icon: "🦐", title: "물벼룩 서바이벌" },
      { id: "defense", icon: "🏰", title: "트로이 목마 디펜스" },
    ],
    returnPortal: { name: "시작맵으로", href: "start-map.html" },
  };

  /* -----------------------------------------------------------------------
     ① LC50 푸시 유어 럭
  ----------------------------------------------------------------------- */
  const lc50 = {
    concentrations: [0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256], // mg/L, 가상
    daphniaCount: 10,
    rounds: [
      { sample: "갑천 상류 · 미세플라스틱 단독", baseLC50: 40, slope: 2.2 },
      { sample: "갑천 중류 · 미세플라스틱 + 세제", baseLC50: 14, slope: 2.6 },
      { sample: "갑천 하류 · 미세플라스틱 + 세제 + 중금속", baseLC50: 5, slope: 3.0 },
    ],
    lc50RandomRange: [0.8, 1.25], // 로그균등 난수 범위 (기준값에 곱함)
    observationWindows: { h24Multiplier: 1.5, h48Multiplier: 1.0 }, // LC50 × 배수
    scoring: {
      perStepBase: 100, // i단계 통과 시 i × 100
      meaningfulDataBonus: 150, // 48h 정지 3~7마리일 때
      meaningfulDataRange: [3, 7],
      bustThreshold: 8, // 48h 정지 개체 수가 이 값 이상이면 BUST
    },
    estimation: {
      // 오차 e = |log10(추정) - log10(실제)|, 배율 = max(1.0, 2.0 - 4e)
      maxMultiplier: 2.0,
      minMultiplier: 1.0,
      errorPenaltyFactor: 4,
    },
    grades: [
      { minScore: 0, label: "수질 견습생" },
      { minScore: 800, label: "물벼룩 지킴이" },
      { minScore: 1600, label: "독성 분석가" },
      { minScore: 2400, label: "갑천 수호자" },
    ],
    useRealData: false,
    realDoseResponse: [], // 나중에 실제 실험값으로 교체: [{round, concentration, mortalityPct}, ...]
    facts: {
      lc50:
        "LC50: 실험 생물의 절반에게 영향을 주는 농도. 이 게임은 유영저해 기준(실제 OECD TG 202 정식 용어는 EC50)을 쉽게 LC50로 부릅니다.",
      trojan:
        "라운드가 갈수록 LC50이 낮아진 이유: 오염물질이 함께 있을 때 독성이 더 커질 수 있음 — 미세플라스틱이 다른 오염물질을 실어 나르는 '트로이 목마 효과'.",
    },
  };

  /* -----------------------------------------------------------------------
     ② 오염 마스터마인드
  ----------------------------------------------------------------------- */
  const mastermind = {
    slotCount: 4,
    slotLabels: ["갑천 지점 ①", "갑천 지점 ②", "갑천 지점 ③", "갑천 지점 ④"],
    substances: [
      { id: "microplastic", name: "미세플라스틱", icon: "⚪", color: "#BFE3F2" },
      { id: "detergent", name: "세제(계면활성제)", icon: "🫧", color: "#F3B8CE" },
      { id: "heavyMetal", name: "중금속", icon: "⛓️", color: "#A79482" },
      { id: "hormone", name: "합성호르몬", icon: "💊", color: "#C7A8E8" },
      { id: "nutrient", name: "질소·인", icon: "🌱", color: "#9ED18A" },
      { id: "organic", name: "유기물(BOD)", icon: "🍂", color: "#B48A5A" },
    ],
    difficulties: {
      easy: { label: "쉬움", substanceCount: 5, allowDuplicates: false, maxTurns: 10 },
      normal: { label: "보통", substanceCount: 6, allowDuplicates: true, maxTurns: 8 },
      hard: { label: "어려움", substanceCount: 6, allowDuplicates: true, maxTurns: 6 },
    },
    pins: {
      exact: { icon: "🟢", label: "정확 검출" },
      wrongSpot: { icon: "🟡", label: "지점 오류" },
      none: { icon: "⚪", label: "없음" },
    },
    tools: {
      nileRed: { label: "나일레드 검사", icon: "🔦", maxUses: 2, scorePenalty: 150 },
      rosAssay: { label: "ROS assay", icon: "🧬", maxUses: 1, scorePenalty: 150 },
    },
    scoring: {
      base: 1000,
      perExtraAttempt: 100, // (시도 - 1) × 100 차감
      timeBonusMax: 200, // max(0, 200 - 경과초)
    },
    facts: {
      microplastic:
        "미세플라스틱: 크기 5mm 이하의 작은 플라스틱 조각, 표면에 다른 오염물질이 달라붙어 운반될 수 있음(트로이 목마 효과).",
      detergent: "세제(계면활성제): 물에 풀려 수생생물에 영향을 줄 수 있어, 천연세제 전환이 대안.",
      heavyMetal: "중금속: 쉽게 분해되지 않고 생물체에 쌓일 수 있음.",
      hormone: "합성호르몬: 아주 적은 양도 생물의 호르몬 작용을 교란할 수 있음.",
      nutrient: "질소·인: 과하면 녹조(과영양화)의 원인.",
      organic: "유기물(BOD): 분해되면서 물속 산소를 소비.",
    },
  };

  /* -----------------------------------------------------------------------
     ③ 재활용 수박게임
  ----------------------------------------------------------------------- */
  const suika = {
    physics: { fixedStepMs: 1000 / 60, gravity: 1.0, restitution: 0.1, friction: 0.3 },
    container: { width: 480, height: 680, dangerLineY: 110 },
    drop: { cooldownSec: 0.6, spawnWeights: [40, 30, 20, 10] }, // 1~4단계 가중치
    items: [
      { level: 1, name: "병뚜껑", icon: "🔘", radius: 16, score: 1, color: "#9AA08E" },
      { level: 2, name: "빨대", icon: "🥤", radius: 22, score: 3, color: "#A7AE98" },
      { level: 3, name: "일회용컵", icon: "🥤", radius: 29, score: 6, color: "#A9C08E" },
      { level: 4, name: "페트병", icon: "🧴", radius: 37, score: 10, color: "#92C48B" },
      { level: 5, name: "분쇄 플레이크", icon: "✨", radius: 46, score: 15, color: "#86C487" },
      { level: 6, name: "펠릿", icon: "⚫", radius: 56, score: 21, color: "#79C086" },
      { level: 7, name: "재생섬유 실타래", icon: "🧵", radius: 67, score: 28, color: "#66B87E" },
      { level: 8, name: "원단", icon: "🧶", radius: 79, score: 36, color: "#55AE78" },
      { level: 9, name: "에코백", icon: "👜", radius: 92, score: 45, color: "#3FA06E" },
      { level: 10, name: "지구", icon: "🌍", radius: 106, score: 55, color: "#2E8F63", finalBonus: 500 },
    ],
    combo: { windowSec: 0.8, perComboStep: 0.25, maxMultiplier: 3 },
    gameOver: { settleDelaySec: 1.5, overLineHoldSec: 2.0 },
    microfiber: {
      intervalSec: 25,
      radius: 30,
      netRewardEveryMerges: 6,
      netMaxStock: 2,
      netClearScorePerItem: 100,
    },
    facts: {
      recycling:
        "재활용은 선별 → 분쇄(플레이크) → 펠릿 → 섬유 → 제품 순서로 이어집니다.",
      net:
        "세탁망은 합성섬유에서 떨어져 나오는 미세섬유가 하천으로 흘러가는 걸 줄여줍니다(동아리 계획서 기준: 세탁 1회당 미세섬유 약 70% 저감).",
    },
  };

  /* -----------------------------------------------------------------------
     ④ 물벼룩 서바이벌
  ----------------------------------------------------------------------- */
  const daphnia = {
    arena: { width: 960, height: 600 },
    durationSec: 180, // 180초 = 48시간 (1초 = 16분)
    hoursPerGame: 48,
    player: {
      radius: 14,
      baseSpeed: 220,
      dashMultiplier: 3,
      dashDurationSec: 0.25,
      dashCooldownSec: 3,
    },
    algae: { spawnPerSec: 1.2, maxOnScreen: 40, xpPerAlgae: 1, rosReductionPerAlgae: 3 },
    xpToLevel: [5, 8, 12, 17, 23, 30], // 이후 +7씩 증가
    xpLevelIncrement: 7,
    enemies: {
      bead: { spawnAtSec: 0, radius: 8, speedRange: [60, 90], rosOnHit: 8 },
      fiber: { spawnAtSec: 20, width: 22, height: 3, speedRange: [110, 140], rosOnHit: 6 },
      fragment: { spawnAtSec: 60, radius: 12, volleyCount: 3, rosOnHit: 12, speed: 150 },
      carrier: {
        spawnAtSec: 100,
        radius: 14,
        rosOnHit: 10,
        speedRange: [40, 70],
        poison: { durationSec: 8, rosPerSec: 1 },
      },
    },
    waveSpeed: 130, // 파도 이벤트 구슬 속도
    waveWarningLeadSec: 2, // 틈 경고를 몇 초 전에 띄울지
    waveEvents: [
      { atSec: 90, gapWidthPx: 160 },
      { atSec: 150, gapWidthPx: 160 },
    ],
    spawnInterval: { startSec: 1.4, endSec: 0.35 }, // 0초→180초 동안 선형 감소
    ros: {
      max: 100,
      naturalDecayPerSec: 1.5,
      thresholds: [
        { min: 40, speedMultiplier: 0.9 },
        { min: 60, speedMultiplier: 0.75 },
        { min: 80, speedMultiplier: 0.75, drift: true },
      ],
      immobilizeAt: 100,
    },
    upgrades: [
      { id: "bubbleShield", name: "산소 버블", icon: "🫧", effect: "피격 무효 보호막", rechargeSec: [20, 15, 10], maxStack: 3 },
      { id: "detoxEnzyme", name: "해독 효소", icon: "🧪", effect: "ROS 자연 감소 +1/s", perStack: 1, maxStack: 3 },
      { id: "fastSwim", name: "빠른 헤엄", icon: "💨", effect: "이동속도 +12%", perStack: 0.12, maxStack: 3 },
      { id: "foodMagnet", name: "먹이 자석", icon: "🧲", effect: "조류 흡인 반경", radii: [60, 110, 160], maxStack: 3 },
      { id: "exoskeleton", name: "두꺼운 외골격", icon: "🛡️", effect: "받는 ROS -15%", perStack: 0.15, maxStack: 3 },
      { id: "jumpDash", name: "점프 대시", icon: "⚡", effect: "대시 쿨다운 -0.7초, 3스택에서 밀어내기", cooldownReduction: 0.7, maxStack: 3 },
      { id: "parthenogenesis", name: "단위생식", icon: "🥚", effect: "새끼가 주변 조류를 먹어 XP 제공", maxStack: 3 },
      { id: "transparency", name: "투명한 몸", icon: "👻", effect: "피격 판정 -20%", perStack: 0.2, maxStack: 2 },
    ],
    scoring: {
      perSecondAlive: 10,
      perAlgaeEaten: 5,
      perLevel: 50,
      clearBonus: 500,
      clearRosBonusFactor: 5, // 남은 ROS 여유 × 5
    },
    facts: {
      assay:
        "실제 실험(OECD TG 202)에서는 물벼룩이 24시간·48시간 뒤에 얼마나 헤엄을 멈췄는지로 독성을 평가해요. 활성산소(ROS)는 미세플라스틱을 먹은 물벼룩의 산화 스트레스를 보여주는 지표입니다.",
    },
  };

  /* -----------------------------------------------------------------------
     ⑤ 트로이 목마 디펜스
  ----------------------------------------------------------------------- */
  const defense = {
    grid: { cols: 16, rows: 10, tile: 60 },
    startWater: 100,
    startCurrency: 150,
    stageHpMultiplier: [1.0, 1.5, 2.0],
    autoStartSec: 15,
    paths: [
      // 상류
      [
        [0, 2], [5, 2], [5, 6], [10, 6], [10, 3], [15, 3],
      ],
      // 중류
      [
        [0, 7], [3, 7], [3, 2], [8, 2], [8, 7], [12, 7], [12, 4], [15, 4],
      ],
      // 하류
      [
        [0, 5], [4, 5], [4, 1], [7, 1], [7, 8], [11, 8], [11, 2], [15, 2],
      ],
    ],
    stageNames: ["상류", "중류", "하류"],
    stageWaterColor: ["#CBEF7E", "#9ED1C8", "#6E8C7F"],
    cargoTypes: {
      detergent: { name: "세제", icon: "🫧", color: "#F3B8CE" },
      heavyMetal: { name: "중금속", icon: "⛓️", color: "#A79482" },
      hormone: { name: "합성호르몬", icon: "💊", color: "#C7A8E8" },
    },
    enemies: {
      bead: { name: "구슬", shellHp: 30, cargo: null, speed: 55, damage: 2, killReward: 4 },
      fiber: { name: "섬유", shellHp: 18, cargo: null, speed: 95, damage: 1, killReward: 3 },
      trojan: { name: "트로이 목마", shellHp: 60, cargoHp: 40, speed: 50, damage: 8, shellReward: 15, cargoReward: 10 },
      bossTrojan: {
        name: "거대 트로이 목마",
        shellHp: 600,
        cargoLayers: ["detergent", "heavyMetal", "hormone"],
        cargoHpPerLayer: 150,
        speed: 35,
        damage: 40,
        killReward: 150,
      },
      exposedSpeedMultiplier: 1.6, // 껍질 파괴 후 속도 배율
    },
    towers: {
      net: {
        name: "세탁망", icon: "🕸", unlockStage: 1, cost: 50, range: 120, rate: 1.0,
        targets: "shell", damage: 14, slowPct: 0.15,
        upgrades: [
          { cost: 40, damageMult: 1.5 },
          { cost: 70, rangeAdd: 20, slowPct: 0.3 },
        ],
      },
      reed: {
        name: "정수식물(갈대)", icon: "🌿", unlockStage: 1, cost: 70, range: 110, rate: 1.2,
        targets: "cargo", primaryCargo: "heavyMetal", primaryDamage: 9, otherCargoFactor: 0.25,
        upgrades: [
          { cost: 40, damageMult: 1.5 },
          { cost: 70, rangeAdd: 20 },
        ],
      },
      naturalDetergentBooth: {
        name: "천연세제 부스", icon: "🧼", unlockStage: 2, cost: 80, range: 110, rate: 1.2,
        targets: "cargo", primaryCargo: "detergent", primaryDamage: 9, otherCargoFactor: 0.25,
        upgrades: [
          { cost: 40, damageMult: 1.5 },
          { cost: 70, rangeAdd: 20 },
        ],
      },
      carbonFilter: {
        name: "활성탄 필터", icon: "⚫", unlockStage: 3, cost: 90, range: 110, rate: 1.2,
        targets: "cargo", primaryCargo: "hormone", primaryDamage: 9, otherCargoFactor: 0.25,
        upgrades: [
          { cost: 40, damageMult: 1.5 },
          { cost: 70, rangeAdd: 20 },
        ],
      },
      sellRefundPct: 0.7,
    },
    economy: {
      waveClearBonusBase: 20,
      waveClearBonusPerWave: 5,
    },
    // 웨이브 구성: 각 항목 { type, count, intervalSec, cargo? }
    waves: [
      // --- 스테이지 1 (상류) ---
      [
        [{ type: "bead", count: 6, interval: 1.2 }],
        [{ type: "bead", count: 8, interval: 1.0 }, { type: "fiber", count: 4, interval: 0.8 }],
        [{ type: "fiber", count: 10, interval: 0.7 }],
        [{ type: "bead", count: 6, interval: 1.0 }, { type: "trojan", count: 2, interval: 2.0, cargo: "heavyMetal" }],
        [{ type: "fiber", count: 8, interval: 0.7 }, { type: "trojan", count: 3, interval: 1.8, cargo: "heavyMetal" }],
        [{ type: "bead", count: 12, interval: 0.6 }, { type: "fiber", count: 6, interval: 0.7 }],
        [{ type: "trojan", count: 5, interval: 1.5, cargo: "heavyMetal" }, { type: "fiber", count: 10, interval: 0.6 }],
        [{ type: "bead", count: 14, interval: 0.5 }, { type: "fiber", count: 14, interval: 0.5 }, { type: "trojan", count: 5, interval: 1.5, cargo: "heavyMetal" }],
      ],
      // --- 스테이지 2 (중류) ---
      [
        [{ type: "trojan", count: 3, interval: 2.0, cargo: "detergent" }],
        [{ type: "bead", count: 8, interval: 0.9 }, { type: "trojan", count: 2, interval: 2.0, cargo: "detergent" }],
        [{ type: "fiber", count: 12, interval: 0.6 }, { type: "trojan", count: 2, interval: 2.0, cargo: "heavyMetal" }],
        [{ type: "trojan", count: 3, interval: 1.6, cargo: "detergent" }, { type: "trojan", count: 3, interval: 1.6, cargo: "heavyMetal" }],
        [{ type: "bead", count: 14, interval: 0.5 }, { type: "fiber", count: 8, interval: 0.6 }],
        [{ type: "trojan", count: 5, interval: 1.4, cargo: "detergent" }],
        [{ type: "trojan", count: 4, interval: 1.2, cargo: "detergent" }, { type: "trojan", count: 3, interval: 1.2, cargo: "heavyMetal" }, { type: "fiber", count: 10, interval: 0.5 }],
        [{ type: "bead", count: 16, interval: 0.5 }, { type: "fiber", count: 16, interval: 0.5 }, { type: "trojan", count: 4, interval: 1.2, cargo: "detergent" }, { type: "trojan", count: 4, interval: 1.2, cargo: "heavyMetal" }],
      ],
      // --- 스테이지 3 (하류) ---
      [
        [{ type: "trojan", count: 3, interval: 2.0, cargo: "hormone" }],
        [{ type: "bead", count: 10, interval: 0.6 }, { type: "trojan", count: 3, interval: 1.8, cargo: "detergent" }],
        [{ type: "fiber", count: 14, interval: 0.5 }, { type: "trojan", count: 3, interval: 1.8, cargo: "hormone" }],
        [{ type: "trojan", count: 2, interval: 1.4, cargo: "detergent" }, { type: "trojan", count: 2, interval: 1.4, cargo: "heavyMetal" }, { type: "trojan", count: 2, interval: 1.4, cargo: "hormone" }],
        [{ type: "bead", count: 16, interval: 0.5 }, { type: "fiber", count: 10, interval: 0.5 }],
        [{ type: "trojan", count: 6, interval: 1.2, cargo: "hormone" }, { type: "trojan", count: 4, interval: 1.2, cargo: "heavyMetal" }],
        [
          { type: "trojan", count: 4, interval: 1.1, cargo: "detergent" },
          { type: "trojan", count: 3, interval: 1.1, cargo: "heavyMetal" },
          { type: "trojan", count: 3, interval: 1.1, cargo: "hormone" },
          { type: "fiber", count: 14, interval: 0.5 },
        ],
        [{ type: "bossTrojan", count: 1, interval: 0 }, { type: "bead", count: 20, interval: 0.4 }, { type: "fiber", count: 20, interval: 0.4 }],
      ],
    ],
    scoring: {
      waterPercentFactor: 10,
      currencyFactor: 1,
      starThresholds: [{ water: 80, stars: 3 }, { water: 50, stars: 2 }, { water: 0, stars: 1 }],
    },
    facts: {
      stage1: "하천의 미세섬유는 세탁 과정에서 많이 나와요. 세탁망으로 줄일 수 있습니다.",
      stage2: "세제의 계면활성제는 하천에 그대로 흘러들 수 있어요. 천연세제 전환이 도움이 됩니다.",
      stage3:
        "트로이 목마 효과: 미세플라스틱은 그 자체만이 아니라 다른 오염물질을 싣고 이동하며 위험을 키울 수 있어서, 껍질(플라스틱)과 화물(오염물질)을 함께 줄여야 합니다.",
    },
  };

  window.ConfigData = {
    disclaimer: DISCLAIMER,
    theme,
    common,
    hall,
    lc50,
    mastermind,
    suika,
    daphnia,
    defense,
  };
})();
