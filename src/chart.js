/**
 * Population history chart renderer.
 * Draws a stacked area chart of species populations over time.
 */
const Chart = (function () {
  const COLORS = {
    ants: "#1a1a1a",
    herbivores: "#3b82f6",
    predators: "#ef4444",
    advanced: "#eab308",
    plants: "#22c55e",
  };

  class PopulationChart {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext("2d");
      this.resize();
    }

    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvas.style.width = rect.width + "px";
      this.canvas.style.height = rect.height + "px";
      this.ctx.scale(dpr, dpr);
      this.width = rect.width;
      this.height = rect.height;
    }

    render(history) {
      if (!this.canvas || !history.ticks.length) return;

      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const padding = { top: 10, right: 10, bottom: 20, left: 40 };
      const chartW = w - padding.left - padding.right;
      const chartH = h - padding.top - padding.bottom;

      ctx.clearRect(0, 0, w, h);

      // Compute max population for scaling.
      let maxPop = 0;
      for (let i = 0; i < history.ticks.length; i++) {
        const total =
          history.ants[i] +
          history.herbivores[i] +
          history.predators[i] +
          history.advanced[i];
        if (total > maxPop) maxPop = total;
      }
      maxPop = Math.max(maxPop, 100);

      // Helper to map tick index to x coordinate.
      const xAt = (i) =>
        padding.left + (i / (history.ticks.length - 1)) * chartW;

      // Helper to map population to y coordinate.
      const yAt = (pop) =>
        padding.top + chartH - (pop / maxPop) * chartH;

      // Draw grid lines.
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();

        // Y-axis labels.
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const label = Math.round(maxPop * (1 - i / 4)).toLocaleString();
        ctx.fillText(label, padding.left - 6, y);
      }

      // Draw stacked area chart.
      const layers = [
        { key: "ants", color: COLORS.ants },
        { key: "herbivores", color: COLORS.herbivores },
        { key: "predators", color: COLORS.predators },
        { key: "advanced", color: COLORS.advanced },
      ];

      // Compute cumulative values for stacking.
      const cumulative = new Array(history.ticks.length).fill(0);

      for (const layer of layers) {
        const data = history[layer.key];
        ctx.fillStyle = layer.color;
        ctx.beginPath();
        ctx.moveTo(xAt(0), yAt(cumulative[0]));

        for (let i = 0; i < history.ticks.length; i++) {
          const y = yAt(cumulative[i] + data[i]);
          ctx.lineTo(xAt(i), y);
        }

        for (let i = history.ticks.length - 1; i >= 0; i--) {
          const prevY = yAt(cumulative[i]);
          ctx.lineTo(xAt(i), prevY);
        }

        ctx.closePath();
        ctx.fill();

        // Update cumulative for next layer.
        for (let i = 0; i < history.ticks.length; i++) {
          cumulative[i] += data[i];
        }
      }

      // Draw plant population as a faint line on top.
      ctx.strokeStyle = COLORS.plants;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      const plantMax = Math.max(...history.plants, 100);
      for (let i = 0; i < history.ticks.length; i++) {
        const x = xAt(i);
        const y = padding.top + chartH - (history.plants[i] / plantMax) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Draw X-axis labels (first and last tick).
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(
        history.ticks[0].toLocaleString(),
        padding.left,
        padding.top + chartH + 4
      );
      ctx.textAlign = "right";
      ctx.fillText(
        history.ticks[history.ticks.length - 1].toLocaleString(),
        w - padding.right,
        padding.top + chartH + 4
      );
    }
  }

  return { PopulationChart };
})();
