/* game-defense.js — 임시 플레이스홀더 (1단계). 해당 단계에서 실제 게임으로 교체 예정. */
(function () {
  "use strict";
  window.CampaignGames = window.CampaignGames || {};
  window.CampaignGames.defense = {
    id: "defense",
    title: "트로이 목마 디펜스",
    icon: "🏰",
    mount(root, api) {
      api.showIntro(
        { title: "트로이 목마 디펜스", rules: ["이 게임은 곧 구현됩니다. 조금만 기다려주세요!"], controls: [] },
        () => api.showResult({ score: 0, stats: [], fact: "준비 중인 미니게임입니다.", factTitle: "안내" })
      );
      return { destroy() {} };
    },
  };
})();
