(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const priceCanvas = $("#price-chart"), pctCanvas = $("#percentile-chart");
  const priceCtx = priceCanvas.getContext("2d"), pctCtx = pctCanvas.getContext("2d");
  const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
  const fmtPrice = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signalKey = { 1: "p1y", 3: "p3y", 5: "p5y" };
  const signalNames = { 1: "近 1 年", 3: "近 3 年", 5: "近 5 年" };
  let bars = [], meta = {}, rangeChoice = 3, windowYears = 3, startIndex = 0, endIndex = 0;
  let lockedIndex = -1, hoverIndex = -1, drag = null, width = 0, heightPrice = 0, heightPct = 0;

  function resizeCanvas(canvas, ctx) {
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return [rect.width, rect.height];
  }
  const chartPad = { left: 58, right: 16, top: 17, bottom: 25 };
  function visibleCount() { return endIndex - startIndex + 1; }
  function xAt(i) { return chartPad.left + (i - startIndex + .5) / visibleCount() * (width - chartPad.left - chartPad.right); }
  function nearestAt(x) {
    const t = (x - chartPad.left) / (width - chartPad.left - chartPad.right);
    return Math.max(startIndex, Math.min(endIndex, startIndex + Math.floor(t * visibleCount())));
  }
  function niceBounds(min, max) {
    const pad = (max - min || Math.abs(max) * .04 || 1) * .08;
    return [min - pad, max + pad];
  }
  function axes(ctx, w, h, ticks, valueAt, formatter) {
    ctx.save(); ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif"; ctx.textBaseline = "middle";
    ctx.strokeStyle = "#edf0f4"; ctx.fillStyle = "#97a2b2"; ctx.lineWidth = 1;
    const top = chartPad.top, bottom = h - chartPad.bottom, plotW = w - chartPad.left - chartPad.right;
    ticks.forEach((value, n) => {
      const y = top + (bottom - top) * n / (ticks.length - 1);
      ctx.beginPath(); ctx.moveTo(chartPad.left, y + .5); ctx.lineTo(w - chartPad.right, y + .5); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(formatter(value), chartPad.left - 9, y);
    });
    const points = [startIndex, Math.round((startIndex + endIndex) / 2), endIndex];
    ctx.textAlign = "center";
    points.forEach((idx) => {
      const x = chartPad.left + (idx - startIndex + .5) / visibleCount() * plotW;
      ctx.fillText(bars[idx].date.slice(0, 7), x, h - 9);
    });
    ctx.restore();
  }
  function renderPrice() {
    const [w, h] = resizeCanvas(priceCanvas, priceCtx); width = w; heightPrice = h;
    priceCtx.clearRect(0, 0, w, h);
    if (!bars.length) return;
    const visible = bars.slice(startIndex, endIndex + 1);
    const low = Math.min(...visible.map((b) => b.low)), high = Math.max(...visible.map((b) => b.high));
    const [min, max] = niceBounds(low, high), y = (v) => chartPad.top + (max - v) / (max - min) * (h - chartPad.top - chartPad.bottom);
    const ticks = Array.from({ length: 5 }, (_, i) => max - i * (max - min) / 4);
    axes(priceCtx, w, h, ticks, y, (v) => fmt.format(v));
    const plotW = w - chartPad.left - chartPad.right, step = plotW / visibleCount(), candleW = Math.max(1, Math.min(8, step * .68));
    visible.forEach((bar, offset) => {
      const i = startIndex + offset, x = xAt(i), rising = bar.close >= bar.open, color = rising ? "#e35f69" : "#1aa67b";
      priceCtx.strokeStyle = color; priceCtx.fillStyle = color; priceCtx.lineWidth = Math.max(1, Math.min(1.3, step * .12));
      priceCtx.beginPath(); priceCtx.moveTo(x, y(bar.high)); priceCtx.lineTo(x, y(bar.low)); priceCtx.stroke();
      const top = y(Math.max(bar.open, bar.close)), bottom = y(Math.min(bar.open, bar.close)), bodyH = Math.max(1, bottom - top);
      if (step < 2.2) { priceCtx.beginPath(); priceCtx.moveTo(x, top); priceCtx.lineTo(x, bottom); priceCtx.stroke(); }
      else priceCtx.fillRect(x - candleW / 2, top, candleW, bodyH);
    });
    drawCrosshair(priceCtx, hoverIndex >= 0 ? hoverIndex : lockedIndex, h, y, (bar) => fmtPrice.format(bar.close));
  }
  function renderPercentile() {
    const [w, h] = resizeCanvas(pctCanvas, pctCtx); heightPct = h;
    pctCtx.clearRect(0, 0, w, h);
    if (!bars.length) return;
    const top = chartPad.top, bottom = h - chartPad.bottom, y = (v) => top + (100 - v) / 100 * (bottom - top);
    axes(pctCtx, w, h, [100, 50, 0], y, (v) => `${v}%`);
    const key = signalKey[windowYears]; pctCtx.beginPath(); let drawing = false;
    for (let i = startIndex; i <= endIndex; i++) {
      const value = bars[i][key], x = xAt(i);
      if (value == null) { drawing = false; continue; }
      if (!drawing) { pctCtx.moveTo(x, y(value)); drawing = true; } else pctCtx.lineTo(x, y(value));
    }
    pctCtx.strokeStyle = "#496de2"; pctCtx.lineWidth = 1.8; pctCtx.lineJoin = "round"; pctCtx.stroke();
    drawCrosshair(pctCtx, hoverIndex >= 0 ? hoverIndex : lockedIndex, h, y, (bar) => bar[key] == null ? "历史不足" : `${fmt.format(bar[key])}%`);
  }
  function drawCrosshair(ctx, idx, h, y, label) {
    if (idx < startIndex || idx > endIndex || idx < 0) return;
    const x = xAt(idx), bar = bars[idx];
    ctx.save(); ctx.strokeStyle = "#7486bb"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, chartPad.top); ctx.lineTo(x, h - chartPad.bottom); ctx.stroke(); ctx.setLineDash([]);
    const text = `${bar.date}  ${label(bar)}`; ctx.font = "10px sans-serif";
    const boxW = ctx.measureText(text).width + 14, bx = Math.max(chartPad.left, Math.min(ctx.canvas.clientWidth - boxW - 4, x - boxW / 2));
    ctx.fillStyle = "#34425e"; ctx.beginPath(); ctx.roundRect(bx, chartPad.top, boxW, 20, 4); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, bx + boxW / 2, chartPad.top + 10); ctx.restore();
  }
  function render() { renderPrice(); renderPercentile(); updateReadouts(); }
  function setSignal(idx) {
    if (idx < 0 || idx >= bars.length) return;
    if (idx < startIndex || idx > endIndex) {
      if (rangeChoice === "all") { startIndex = 0; endIndex = bars.length - 1; }
      else {
        endIndex = idx;
        startIndex = Math.max(0, indexOnOrBefore(subtractYears(bars[idx].date, Number(rangeChoice))));
      }
    }
    lockedIndex = idx; hoverIndex = -1; $("#date-picker").value = bars[idx].date;
    $("#quick-prev").disabled = idx === 0;
    $("#quick-week").disabled = priorWeekLast(idx) < 0;
    render();
  }
  function updateReadouts() {
    const idx = hoverIndex >= 0 ? hoverIndex : lockedIndex;
    if (idx < 0) return;
    const b = bars[idx], prior = bars[Math.max(0, idx - 1)];
    $("#ohlc-readout").textContent = `${b.date}　开 ${fmtPrice.format(b.open)}　高 ${fmtPrice.format(b.high)}　低 ${fmtPrice.format(b.low)}　收 ${fmtPrice.format(b.close)}`;
    const key = signalKey[windowYears], pct = b[key];
    $("#signal-window-label").textContent = signalNames[windowYears];
    $("#signal-date").textContent = `${b.date} · 收盘 ${fmtPrice.format(b.close)}`;
    $("#signal-value").textContent = pct == null ? "—" : `${fmt.format(pct)}%`;
    $("#gauge").style.setProperty("--angle", pct == null ? "0deg" : `${pct * 2.7}deg`);
    $("#signal-message").textContent = pct == null ? `过去 ${windowYears} 年历史不足，暂不计算` : "该收盘价在窗口历史分布中的位置";
    const count = countWindow(idx, windowYears);
    $("#sample-count").textContent = pct == null ? "" : `${count} 个交易日收盘样本 · 相邻交易日 ${prior.date}`;
    $("#chart-date-range").textContent = `${bars[startIndex].date} — ${bars[endIndex].date}`;
  }
  function countWindow(idx, years) {
    const boundary = subtractYears(bars[idx].date, years);
    const day = boundary;
    let lo = 0, hi = idx;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].date <= day) lo = mid + 1; else hi = mid; }
    return idx + 1 - lo;
  }
  function subtractYears(day, years) {
    const [year, month, date] = day.split("-").map(Number), targetYear = year - years;
    const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
    return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(date, lastDay)).padStart(2, "0")}`;
  }
  function indexOnOrBefore(day) {
    let lo = 0, hi = bars.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].date <= day) lo = mid + 1; else hi = mid; }
    return lo - 1;
  }
  function priorWeekLast(idx) {
    const day = new Date(`${bars[idx].date}T00:00:00Z`), weekday = (day.getUTCDay() + 6) % 7;
    const monday = new Date(day); monday.setUTCDate(day.getUTCDate() - weekday - 7);
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    const candidate = indexOnOrBefore(sunday.toISOString().slice(0, 10));
    return candidate >= 0 && bars[candidate].date >= monday.toISOString().slice(0, 10) ? candidate : -1;
  }
  function setRange(choice) {
    rangeChoice = choice;
    document.querySelectorAll("#range-controls button").forEach((b) => b.classList.toggle("active", String(choice) === b.dataset.range));
    if (choice === "all") startIndex = 0;
    else { const minDate = subtractYears(bars[endIndex].date, Number(choice)); startIndex = Math.max(0, indexOnOrBefore(minDate)); }
    render();
  }
  function attachCanvas(canvas) {
    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left;
      if (drag) {
        const delta = event.clientX - drag.x;
        if (Math.abs(delta) > 3) drag.moved = true;
        const shift = Math.round(-delta / Math.max(1, width - chartPad.left - chartPad.right) * visibleCount());
        const span = drag.end - drag.start, nextStart = Math.max(0, Math.min(bars.length - span - 1, drag.start + shift));
        startIndex = nextStart; endIndex = nextStart + span; hoverIndex = nearestAt(x); render(); return;
      }
      hoverIndex = nearestAt(x); render();
    });
    canvas.addEventListener("pointerdown", (event) => { canvas.setPointerCapture(event.pointerId); drag = { x: event.clientX, start: startIndex, end: endIndex, moved: false }; });
    canvas.addEventListener("pointerup", () => { if (drag && !drag.moved && hoverIndex >= 0) setSignal(hoverIndex); drag = null; });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    canvas.addEventListener("pointerleave", () => { if (!drag) { hoverIndex = -1; render(); } });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault(); const rect = canvas.getBoundingClientRect(), anchor = nearestAt(event.clientX - rect.left);
      const oldCount = visibleCount(), nextCount = Math.max(30, Math.min(bars.length, Math.round(oldCount * (event.deltaY > 0 ? 1.15 : .87))));
      const ratio = (anchor - startIndex) / oldCount, nextStart = Math.max(0, Math.min(bars.length - nextCount, Math.round(anchor - ratio * nextCount)));
      startIndex = nextStart; endIndex = Math.min(bars.length - 1, nextStart + nextCount - 1); render();
    }, { passive: false });
  }
  async function init() {
    try {
      const response = await fetch("data/csi500.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`数据加载失败 (${response.status})`);
      const data = await response.json(); bars = data.bars; meta = data.meta;
      if (!Array.isArray(bars) || !bars.length) throw new Error("数据文件没有有效日线");
      endIndex = bars.length - 1; lockedIndex = endIndex;
      $("#latest-close").textContent = fmtPrice.format(bars[endIndex].close);
      const prev = bars[endIndex - 1], change = (bars[endIndex].close / prev.close - 1) * 100;
      $("#latest-change").textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}% · ${bars[endIndex].date}`;
      $("#latest-change").classList.toggle("negative", change < 0);
      $("#data-status").textContent = `行情更新至 ${meta.last_date}`; $(".status-dot").classList.add("ready");
      $("#data-asof").textContent = `数据截止日 ${meta.last_date}`;
      $("#build-time").textContent = `构建于 ${meta.built_at.replace("T", " ").replace("+00:00", " UTC")}`;
      $("#date-picker").min = bars[0].date; $("#date-picker").max = bars[endIndex].date;
      setRange(3); setSignal(endIndex);
    } catch (error) {
      $("#data-status").textContent = "行情数据无法读取";
      $("#data-status").title = error.message;
      $("#signal-message").textContent = `${error.message}。请先运行数据构建命令。`;
      console.error("Signal monitor data load failed:", error);
    }
  }
  $("#range-controls").addEventListener("click", (event) => { const btn = event.target.closest("button[data-range]"); if (btn) setRange(btn.dataset.range === "all" ? "all" : Number(btn.dataset.range)); });
  $("#window-controls").addEventListener("click", (event) => { const btn = event.target.closest("button[data-window]"); if (!btn) return; windowYears = Number(btn.dataset.window); document.querySelectorAll("#window-controls button").forEach((b) => b.classList.toggle("active", b === btn)); render(); });
  $("#date-picker").addEventListener("change", (event) => { const idx = indexOnOrBefore(event.target.value); if (idx < 0) return; if (bars[idx].date !== event.target.value) toast(`非交易日，已定位至 ${bars[idx].date}`); setSignal(idx); });
  $("#latest-button").addEventListener("click", () => { endIndex = bars.length - 1; setRange(rangeChoice); setSignal(endIndex); });
  $("#quick-latest").addEventListener("click", () => { endIndex = bars.length - 1; setRange(rangeChoice); setSignal(endIndex); });
  $("#quick-prev").addEventListener("click", () => setSignal(Math.max(0, lockedIndex - 1)));
  $("#quick-week").addEventListener("click", () => { const idx = priorWeekLast(lockedIndex); if (idx >= 0) setSignal(idx); else toast("没有可用的上周交易日数据"); });
  function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("visible"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("visible"), 2200); }
  attachCanvas(priceCanvas); attachCanvas(pctCanvas);
  let resizeTimer; window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 80); });
  init();
})();
