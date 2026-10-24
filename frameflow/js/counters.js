/* 公开数字墙只显示总量；上报来源格式、导出格式、帧数与时间，不接触文件名或图像内容。 */
(() => {
  const CACHE_KEY = "ff.stats.v1";
  const CACHE_TTL = 10 * 60 * 1000;
  const wall = document.getElementById("statWall");
  if (!wall) return;

  const exportsEl = document.getElementById("statExports");
  const framesEl = document.getElementById("statFrames");
  const numberFormat = new Intl.NumberFormat("zh-CN");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const showStatsHint = () => toast("统计的不完全啦，好多都没计算上！哼");
  wall.addEventListener("click", showStatsHint);
  wall.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showStatsHint();
    }
  });

  function validCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function render(el, value) {
    if (reduceMotion || value <= 0) {
      el.textContent = numberFormat.format(value);
      return;
    }
    const start = performance.now();
    const duration = 1100;
    const tick = now => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(2, -10 * progress);
      el.textContent = numberFormat.format(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = numberFormat.format(value);
    };
    requestAnimationFrame(tick);
  }

  function apply(data) {
    if (!data || !validCount(data.exports) || !validCount(data.frames)) {
      wall.hidden = true;
      return false;
    }
    render(exportsEl, data.exports);
    render(framesEl, data.frames);
    wall.hidden = false;
    return true;
  }

  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && Date.now() - cached.t >= 0 && Date.now() - cached.t < CACHE_TTL) apply(cached.d);
    }
  } catch (_) {}

  function refreshStats() {
    return fetch("/api/stats", { cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject(response.status))
      .then(data => {
        if (apply(data)) {
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: data })); }
          catch (_) {}
        }
      })
      .catch(() => { wall.hidden = true; });
  }
  window.ffRefreshStats = refreshStats;
  refreshStats();

  window.ffCountExport = function (frameCount, kind, sourceFormat) {
    if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 5000) return;
    const validKinds = ["gif", "webp", "apng", "zip", "mp4"];
    const validSourceFormats = ["png-sequence", "gif", "webp", "apng", "svga", "yyeva-mp4"];
    const exportKind = validKinds.includes(kind) ? kind : "other";
    const sourceKind = validSourceFormats.includes(sourceFormat) ? sourceFormat : null;
    try {
      void fetch("/api/stats/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ f: frameCount, k: exportKind, s: sourceKind }),
        keepalive: true
      }).catch(() => {});
    } catch (_) {}
  };
})();
