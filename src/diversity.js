/**
 * Genetic-diversity readout.
 *
 * Evolution is a change in the *distribution* of traits, not just their mean.
 * This panel renders live histograms (speed, metabolism) and the coefficient
 * of variation (CV = std / mean) for each tracked trait. A collapsing CV is
 * the visible signature of a bottleneck or hard selection sweep.
 */
const Diversity = (function () {
  // Palette per trait, kept consistent with the histograms below.
  const COLORS = {
    speed: "#38bdf8",
    metabolism: "#f97316",
    sense: "#a78bfa",
    aggression: "#ef4444",
    telomere: "#34d399",
    repairRate: "#facc15",
  };
  const LABELS = {
    speed: "Speed",
    metabolism: "Metabolism",
    sense: "Sense",
    aggression: "Aggression",
    telomere: "Telomere",
    repairRate: "Repair",
  };

  class Panel {
    constructor(containerId) {
      this.container = document.getElementById(containerId);
      if (!this.container) return;
      this.container.innerHTML = `
        <div class="diversity-title">Genetic diversity</div>
        <div class="diversity-section">
          <div class="diversity-sublabel">Speed distribution</div>
          <canvas class="diversity-hist" data-trait="speed"></canvas>
        </div>
        <div class="diversity-section">
          <div class="diversity-sublabel">Metabolism distribution</div>
          <canvas class="diversity-hist" data-trait="metabolism"></canvas>
        </div>
        <div class="diversity-grid" id="diversity-cv"></div>
      `;
      this.canvases = {};
      const elems = this.container.querySelectorAll(".diversity-hist");
      for (const c of elems) {
        this.canvases[c.dataset.trait] = c;
      }
      this.cvContainer = this.container.querySelector("#diversity-cv");
      this.resize();
    }

    resize() {
      if (!this.container) return;
      const rect = this.container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const histW = Math.max(40, Math.floor(rect.width - 4));
      const histH = 30;
      for (const key in this.canvases) {
        const c = this.canvases[key];
        c.width = histW * dpr;
        c.height = histH * dpr;
        c.style.width = histW + "px";
        c.style.height = histH + "px";
        const ctx = c.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
    }

    /**
     * Render the full diversity readout from a stats snapshot.
     */
    render(stats) {
      if (!this.container) return;
      const div = stats.diversity;
      if (!div) return;
      this._drawHist("speed", stats.speedHist, div.speed);
      this._drawHist("metabolism", stats.metabHist, div.metabolism);
      this._renderCV(div);
    }

    _drawHist(trait, hist, summary) {
      const c = this.canvases[trait];
      if (!c || !hist) return;
      const ctx = c.getContext("2d");
      const w = c.style.width ? parseInt(c.style.width, 10) : c.width;
      const h = c.style.height ? parseInt(c.style.height, 10) : c.height;
      ctx.clearRect(0, 0, w, h);

      let max = 1;
      for (let i = 0; i < hist.length; i++) if (hist[i] > max) max = hist[i];

      const n = hist.length;
      const barW = w / n;
      const color = COLORS[trait];
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const bh = (hist[i] / max) * h;
        // Leave a hairline gap between bars.
        ctx.fillRect(i * barW, h - bh, Math.max(1, barW - 0.5), bh);
      }

      // Mark the mean as a tick so the center of mass is legible.
      if (summary) {
        const range = DiversityRanges[trait];
        const frac = (summary.mean - range.min) / (range.max - range.min);
        const mx = Math.max(0, Math.min(w, frac * w));
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx, 0);
        ctx.lineTo(mx, h);
        ctx.stroke();
      }
    }

    _renderCV(div) {
      if (!this.cvContainer) return;
      const traits = ["speed", "metabolism", "sense", "aggression", "telomere", "repairRate"];
      const parts = traits.map((t) => {
        const d = div[t];
        if (!d) return "";
        const cvPct = (d.cv * 100).toFixed(0);
        return `<div class="cv-row">
          <span class="cv-label">${LABELS[t]}</span>
          <span class="cv-bar"><span class="cv-bar-fill" style="width:${Math.min(100, d.cv * 200)}%;background:${COLORS[t]}"></span></span>
          <span class="cv-value">${cvPct}%</span>
        </div>`;
      });
      this.cvContainer.innerHTML = parts.join("");
    }
  }

  // Shared with the renderer; mirrored from the simulation's DIVERSITY.RANGES.
  const DiversityRanges = {
    speed: { min: 0.2, max: 2.8 },
    metabolism: { min: 0.2, max: 2.0 },
    sense: { min: 2, max: 10 },
    aggression: { min: 0, max: 3 },
    telomere: { min: 10, max: 120 },
    repairRate: { min: 0.02, max: 0.5 },
  };

  return { Panel, DiversityRanges };
})();
