/**
 * Cell inspection tooltip panel.
 * Shows detailed information about the clicked cell.
 */
const InspectPanel = (function () {
  class Panel {
    constructor() {
      this.el = document.createElement("div");
      this.el.className = "inspect-panel";
      this.el.style.display = "none";
      document.body.appendChild(this.el);
      this.visible = false;
    }

    show(x, y, data) {
      const biomeNames = ["Tundra", "Desert", "Grassland", "Forest", "Jungle"];
      const tileNames = ["Normal", "Shelter", "Farm"];
      const biome = biomeNames[data.biome] || "Unknown";
      const tile = tileNames[data.tileType] || "Unknown";

      this.el.innerHTML = `
        <div class="inspect-header">
          <span class="inspect-coords">${data.x}, ${data.y}</span>
          <span class="inspect-close">&times;</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Biome</span>
          <span class="inspect-value">${biome}</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Temperature</span>
          <span class="inspect-value">${(data.temperature * 100).toFixed(0)}%</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Moisture</span>
          <span class="inspect-value">${(data.moisture * 100).toFixed(0)}%</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Plants</span>
          <span class="inspect-value">${data.plantBiomass}</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Nutrients</span>
          <span class="inspect-value">${data.nutrients}</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Tile</span>
          <span class="inspect-value">${tile}</span>
        </div>
        <div class="inspect-divider"></div>
        <div class="inspect-row">
          <span class="inspect-label">Ants</span>
          <span class="inspect-value">${data.antCount}</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Herbivores</span>
          <span class="inspect-value">${data.herbivoreCount}</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Predators</span>
          <span class="inspect-value">${data.predatorCount}</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Advanced</span>
          <span class="inspect-value">${data.advancedCount}</span>
        </div>
        ${this._organismSection(data)}
      `;

      this.el.querySelector(".inspect-close").addEventListener("click", () => this.hide());

      // Position near the click but keep within viewport.
      const rect = this.el.getBoundingClientRect();
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      let left = x + 12;
      let top = y + 12;
      if (left + 220 > vpW) left = x - 232;
      if (top + 300 > vpH) top = y - 312;
      this.el.style.left = `${Math.max(8, left)}px`;
      this.el.style.top = `${Math.max(8, top)}px`;
      this.el.style.display = "block";
      this.visible = true;
    }

    /**
     * Build the per-organism cellular readout, if the clicked cell holds an
     * organism. Surfaces the live telomere / cell-mass / damage state plus the
     * cancer flag for the first entity found at the cell.
     */
    _organismSection(data) {
      const o = data.organism;
      if (!o) return "";
      const telomerePct = o.telomereCap > 0
        ? Math.round((o.telomere / o.telomereCap) * 100)
        : 0;
      const massPct = o.cellMassCap > 0
        ? Math.round((o.cellMass / o.cellMassCap) * 100)
        : 0;
      const cancerRow = o.cancerous
        ? `<div class="inspect-row"><span class="inspect-label">Cancer</span><span class="inspect-value" style="color:#e55">YES</span></div>`
        : "";
      return `
        <div class="inspect-divider"></div>
        <div class="inspect-row inspect-subheading">Sample organism</div>
        <div class="inspect-row">
          <span class="inspect-label">Species</span>
          <span class="inspect-value">${o.speciesName}</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Age</span>
          <span class="inspect-value">${o.age}</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Energy</span>
          <span class="inspect-value">${o.energy.toFixed(0)}</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Telomere</span>
          <span class="inspect-value">${o.telomere.toFixed(1)} (${telomerePct}%)</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Cell mass</span>
          <span class="inspect-value">${o.cellMass.toFixed(1)} (${massPct}%)</span>
        </div>
        <div class="inspect-row">
          <span class="inspect-label">Damage</span>
          <span class="inspect-value">${o.cellDamage.toFixed(2)}</span>
        </div>
        ${cancerRow}
      `;
    }

    hide() {
      this.el.style.display = "none";
      this.visible = false;
    }
  }

  return { Panel };
})();