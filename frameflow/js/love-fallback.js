/* 爱心模块适配：线上由站点运行层挂载；本地预览没有挂载时提供同款降级模块。 */
(() => {
  const format = value => new Intl.NumberFormat("zh-CN").format(value);
  const heartAssets = [
    "assets/love-hearts/rose-mist.png",
    "assets/love-hearts/pearl-blush.png",
    "assets/love-hearts/rose-glow.png"
  ];
  let localCount = 270;
  let originStreak = 0;
  let originLastTapAt = 0;
  let hintTimer = 0;
  let fadeTimer = 0;
  let comboTimer = 0;
  let milestoneTimer = 0;
  let edgeMilestoneTimer = 0;
  let heartbeatTimer = 0;

  function ensureAtmosphere(){
    let atmosphere = document.querySelector(".love-atmosphere");
    if (!atmosphere) {
      atmosphere = document.createElement("div");
      atmosphere.className = "love-atmosphere";
      atmosphere.setAttribute("aria-hidden", "true");
      document.body.prepend(atmosphere);
    }
    return atmosphere;
  }

  function updateAtmosphere(atmosphere, streak){
    if (!atmosphere) return;
    if (streak < 2) {
      atmosphere.classList.remove("active");
      atmosphere.style.boxShadow = "inset 0 0 0 0 rgba(232,64,119,0)";
      return;
    }
    const intensity = 1 - Math.exp(-(streak - 1) / 82);
    const blur = Math.round(26 + intensity * 112);
    const spread = Math.round(1 + intensity * 21);
    const alpha = (0.035 + intensity * 0.34).toFixed(2);
    atmosphere.style.setProperty("--love-atmo-opacity", (0.09 + intensity * 0.78).toFixed(2));
    atmosphere.style.boxShadow = `inset 0 0 ${blur}px ${spread}px rgba(232,64,119,${alpha}), inset 0 0 ${Math.round(blur * 1.7)}px ${Math.round(spread * 1.8)}px rgba(246,127,159,${(alpha * 0.38).toFixed(2)})`;
    atmosphere.classList.add("active");
  }

  function spawnFloatHearts(effects, streak){
    if (!effects || streak < 2) return;
    /* 生成量随连击持续增长，不设数量上限；缓增曲线保护高连击时的渲染性能。 */
    const count = 1 + Math.floor(Math.log2(Math.max(1, streak / 4)));
    for (let index = 0; index < count; index += 1) {
      const heart = document.createElement("img");
      const delay = Math.random() * 0.24;
      const duration = 9 + Math.random() * 2.5;
      heart.className = "love-heart-float";
      heart.src = heartAssets[Math.floor(Math.random() * heartAssets.length)];
      heart.alt = "";
      heart.draggable = false;
      heart.style.setProperty("--heart-x", `${Math.random() * 100}%`);
      heart.style.setProperty("--heart-size", `${36 + Math.random() * 30}px`);
      heart.style.setProperty("--heart-drift", `${Math.round((Math.random() - 0.5) * 110)}px`);
      heart.style.setProperty("--heart-duration", `${duration.toFixed(2)}s`);
      heart.style.setProperty("--heart-delay", `${delay.toFixed(2)}s`);
      heart.style.setProperty("--heart-rotation", `${Math.round((Math.random() - 0.5) * 36)}deg`);
      heart.style.setProperty("--heart-opacity", `${(0.72 + Math.random() * 0.22).toFixed(2)}`);
      effects.append(heart);
      window.setTimeout(() => heart.remove(), (duration + delay + 0.5) * 1000);
    }
  }

  function showCombo(effects, streak){
    if (!effects) return;
    let combo = effects.querySelector(".love-combo-count");
    if (!combo) {
      combo = document.createElement("div");
      combo.className = "love-combo-count";
      combo.setAttribute("aria-hidden", "true");
      effects.append(combo);
    }
    window.clearTimeout(comboTimer);
    if (streak < 6) {
      combo.classList.remove("show", "bump", "milestone");
      return null;
    }
    combo.textContent = `x${streak}`;
    combo.classList.add("show");
    combo.classList.remove("bump", "milestone");
    void combo.offsetWidth;
    combo.classList.add("bump");
    comboTimer = window.setTimeout(() => combo.classList.remove("show"), 1150);
    return combo;
  }

  function pulseAtmosphere(atmosphere){
    if (!atmosphere) return;
    atmosphere.classList.remove("heartbeat");
    void atmosphere.offsetWidth;
    atmosphere.classList.add("heartbeat");
    window.clearTimeout(heartbeatTimer);
    heartbeatTimer = window.setTimeout(() => atmosphere.classList.remove("heartbeat"), 1200);
  }

  function playMilestone(atmosphere, combo){
    if (!atmosphere || !combo) return;
    combo.classList.remove("milestone");
    atmosphere.classList.remove("milestone");
    void combo.offsetWidth;
    void atmosphere.offsetWidth;
    combo.classList.add("milestone");
    atmosphere.classList.add("milestone");
    window.clearTimeout(milestoneTimer);
    window.clearTimeout(edgeMilestoneTimer);
    milestoneTimer = window.setTimeout(() => combo.classList.remove("milestone"), 1300);
    edgeMilestoneTimer = window.setTimeout(() => atmosphere.classList.remove("milestone"), 1500);
  }

  function bindOrigin(widget){
    if (!widget || widget.dataset.effectOriginBound === "true") return;
    const button = widget.querySelector(".love-button");
    if (!button) return;
    const effects = widget.querySelector(".love-effects");
    const hint = widget.querySelector(".love-hint");
    const atmosphere = ensureAtmosphere();
    /* 顶栏有 backdrop-filter，会为 fixed 子元素建立局部坐标系；提升到 body 才能真正相对视口定位。 */
    if (effects && effects.parentElement !== document.body) document.body.append(effects);
    if (hint && hint.parentElement !== document.body) document.body.append(hint);
    widget.dataset.effectOriginBound = "true";
    button.addEventListener("click", () => {
      const now = Date.now();
      originStreak = now - originLastTapAt <= 1150 ? originStreak + 1 : 1;
      originLastTapAt = now;
      const rect = button.getBoundingClientRect();
      updateAtmosphere(atmosphere, originStreak);
      spawnFloatHearts(effects, originStreak);
      const combo = showCombo(effects, originStreak);
      if (originStreak >= 2) pulseAtmosphere(atmosphere);
      if (originStreak >= 10 && originStreak % 10 === 0) playMilestone(atmosphere, combo);
      window.clearTimeout(fadeTimer);
      fadeTimer = window.setTimeout(() => {
        originStreak = 0;
        updateAtmosphere(atmosphere, 0);
        if (hint) hint.classList.remove("show");
      }, 1150);
      if (hint) {
        window.clearTimeout(hintTimer);
        hint.textContent = "暴力疯狂点击有惊喜";
        hint.style.setProperty("--love-hint-x", `${rect.left + rect.width / 2}px`);
        hint.style.setProperty("--love-hint-y", `${rect.bottom + 8}px`);
        hint.classList.add("show");
        hintTimer = window.setTimeout(() => hint.classList.remove("show"), 1500);
      }
      window.requestAnimationFrame(() => {
        const bursts = effects ? effects.querySelectorAll(".love-burst") : [];
        const node = bursts[bursts.length - 1];
        if (!node || !node.classList.contains("tap")) return;
        node.style.setProperty("--love-x", `${rect.left + rect.width / 2}px`);
        node.style.setProperty("--love-y", `${rect.top + rect.height / 2}px`);
      });
    });
  }

  function mountLocalFallback(){
    let widget = document.querySelector(".love-widget");
    if (!widget) {
      widget = document.createElement("aside");
      widget.className = "love-widget";
      widget.setAttribute("aria-label", "FrameFlow 爱心累计");
      const button = document.createElement("button");
      button.className = "love-button";
      button.type = "button";
      button.setAttribute("aria-label", "为 FrameFlow 点一个爱心");
      const glyph = document.createElement("span");
      glyph.className = "love-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = "♥";
      const copy = document.createElement("span");
      copy.className = "love-copy";
      const label = document.createElement("span");
      label.className = "love-label";
      label.textContent = "爱心";
      const count = document.createElement("strong");
      count.className = "love-count";
      count.setAttribute("aria-live", "polite");
      count.textContent = format(localCount);
      copy.append(label, count);
      button.append(glyph, copy);
      const hint = document.createElement("p");
      hint.className = "love-hint";
      hint.setAttribute("aria-live", "polite");
      hint.textContent = "暴力疯狂点击有惊喜";
      const effects = document.createElement("div");
      effects.className = "love-effects";
      effects.setAttribute("aria-hidden", "true");
      widget.append(button, hint, effects);
      (document.querySelector(".topbar-inner") || document.body).append(widget);
      button.addEventListener("click", () => {
        localCount += 1;
        count.textContent = format(localCount);
      });
    }
    bindOrigin(widget);
  }

  const startLoveModule = () => mountLocalFallback();
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", startLoveModule, {once:true}) : startLoveModule();
})();
