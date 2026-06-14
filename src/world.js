/**
 * World state: 1000x1000 grid, plant biomass, nutrients, and per-species
 * organism density tracking.
 */

const World = (function () {
  const WIDTH = 1000;
  const HEIGHT = 1000;
  const MAX_ORGANISMS_PER_CELL = 5;
  const PLANT_CAPACITY = 1000;
  const NUTRIENT_CAPACITY = 255;

  const SPECIES = {
    NONE: 0,
    ANT: 1,
    HERBIVORE: 2,
    PREDATOR: 3,
  };

  const SPECIES_DOMINANCE = [SPECIES.PREDATOR, SPECIES.HERBIVORE, SPECIES.ANT];

  class WorldGrid {
    constructor() {
      this.width = WIDTH;
      this.height = HEIGHT;
      this.area = WIDTH * HEIGHT;

      // Edible plant biomass (0..PLANT_CAPACITY).
      this.plantBiomass = new Uint16Array(this.area);
      // Baseline soil fertility that drives plant regrowth (0..255).
      this.nutrients = new Uint8Array(this.area);

      // Per-species occupancy counts.
      this.antCount = new Uint8Array(this.area);
      this.herbivoreCount = new Uint8Array(this.area);
      this.predatorCount = new Uint8Array(this.area);
    }

    idx(x, y) {
      // Wrap edges for a toroidal world.
      x = ((x | 0) + this.width) % this.width;
      y = ((y | 0) + this.height) % this.height;
      return y * this.width + x;
    }

    // --- Plants -----------------------------------------------------------

    getPlantBiomass(x, y) {
      return this.plantBiomass[this.idx(x, y)];
    }

    setPlantBiomass(x, y, value) {
      this.plantBiomass[this.idx(x, y)] = Math.max(0, Math.min(PLANT_CAPACITY, value | 0));
    }

    addPlantBiomass(x, y, amount) {
      const i = this.idx(x, y);
      const v = this.plantBiomass[i] + (amount | 0);
      this.plantBiomass[i] = v > PLANT_CAPACITY ? PLANT_CAPACITY : v;
    }

    takePlantBiomass(x, y, amount) {
      const i = this.idx(x, y);
      const take = Math.min(this.plantBiomass[i], amount);
      this.plantBiomass[i] -= take;
      return take;
    }

    getNutrients(x, y) {
      return this.nutrients[this.idx(x, y)];
    }

    setNutrients(x, y, value) {
      this.nutrients[this.idx(x, y)] = Math.max(0, Math.min(NUTRIENT_CAPACITY, value | 0));
    }

    /**
     * Regrow plants everywhere based on local nutrient level.
     * Called once per simulation tick.
     */
    growPlants(growthMultiplier = 1.0) {
      const biomass = this.plantBiomass;
      const nutrients = this.nutrients;
      const area = this.area;
      for (let i = 0; i < area; i++) {
        const room = PLANT_CAPACITY - biomass[i];
        if (room <= 0) continue;
        // Nutrient-rich cells regrow faster; base growth keeps grazed patches recoverable.
        const growth = Math.max(0.1, nutrients[i] * 0.012) * growthMultiplier;
        const next = biomass[i] + growth;
        biomass[i] = next > PLANT_CAPACITY ? PLANT_CAPACITY : next;
      }
    }

    // --- Organisms --------------------------------------------------------

    _countArray(species) {
      switch (species) {
        case SPECIES.ANT:
          return this.antCount;
        case SPECIES.HERBIVORE:
          return this.herbivoreCount;
        case SPECIES.PREDATOR:
          return this.predatorCount;
        default:
          return null;
      }
    }

    getOrganismCount(x, y, species) {
      const arr = this._countArray(species);
      return arr ? arr[this.idx(x, y)] : 0;
    }

    getTotalOrganisms(x, y) {
      const i = this.idx(x, y);
      return this.antCount[i] + this.herbivoreCount[i] + this.predatorCount[i];
    }

    getDominantSpecies(x, y) {
      const i = this.idx(x, y);
      for (let s = 0; s < SPECIES_DOMINANCE.length; s++) {
        const sp = SPECIES_DOMINANCE[s];
        if (this._countArray(sp)[i] > 0) return sp;
      }
      return SPECIES.NONE;
    }

    addOrganism(x, y, species) {
      const arr = this._countArray(species);
      if (!arr) return false;
      const i = this.idx(x, y);
      if (this.getTotalOrganismsAtIndex(i) < MAX_ORGANISMS_PER_CELL) {
        arr[i]++;
        return true;
      }
      return false;
    }

    removeOrganism(x, y, species) {
      const arr = this._countArray(species);
      if (!arr) return;
      const i = this.idx(x, y);
      if (arr[i] > 0) arr[i]--;
    }

    getTotalOrganismsAtIndex(i) {
      return this.antCount[i] + this.herbivoreCount[i] + this.predatorCount[i];
    }

    // --- Spawning helpers -------------------------------------------------

    /**
     * Spawn a roughly circular plant patch centered at (cx, cy).
     */
    spawnPlantPatch(cx, cy, radius, density) {
      const r2 = radius * radius;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= r2 && Math.random() < density) {
            const x = cx + dx;
            const y = cy + dy;
            this.addPlantBiomass(x, y, PLANT_CAPACITY);
            // Patches are also fertile ground for regrowth.
            this.setNutrients(x, y, Math.max(this.getNutrients(x, y), 120 + Math.random() * 80));
          }
        }
      }
    }

    /**
     * Scatter baseline nutrients across the world so plants can persist.
     */
    seedNutrients(density, minLevel, maxLevel) {
      for (let i = 0; i < this.area; i++) {
        if (Math.random() < density) {
          this.nutrients[i] = minLevel + Math.floor(Math.random() * (maxLevel - minLevel + 1));
        }
      }
    }

    /**
     * Count cells that contain any plant biomass.
     */
    plantCellCount() {
      let count = 0;
      for (let i = 0; i < this.area; i++) {
        if (this.plantBiomass[i] > 0) count++;
      }
      return count;
    }

    /**
     * Total edible plant biomass in the world.
     */
    totalPlantBiomass() {
      let sum = 0;
      for (let i = 0; i < this.area; i++) sum += this.plantBiomass[i];
      return sum;
    }

    /**
     * Find the strongest nearby plant food within a square sense radius.
     * Returns {x, y, biomass} or null.
     */
    findBestPlants(x, y, radius) {
      let bestX = 0,
        bestY = 0,
        bestB = -1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const b = this.getPlantBiomass(x + dx, y + dy);
          if (b > bestB) {
            bestB = b;
            bestX = x + dx;
            bestY = y + dy;
          }
        }
      }
      return bestB > 0 ? { x: bestX, y: bestY, biomass: bestB } : null;
    }

    /**
     * Find nearby prey (ants or herbivores) within a square sense radius.
     * Returns {x, y, preySpecies, count} or null.
     */
    findBestPrey(x, y, radius) {
      let bestX = 0,
        bestY = 0,
        bestSpecies = SPECIES.NONE,
        bestCount = -1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const px = x + dx;
          const py = y + dy;
          const antCount = this.getOrganismCount(px, py, SPECIES.ANT);
          const herbCount = this.getOrganismCount(px, py, SPECIES.HERBIVORE);
          // Prefer the tastier/more abundant local prey.
          const count = antCount + herbCount;
          if (count > bestCount) {
            bestCount = count;
            bestX = px;
            bestY = py;
            bestSpecies = antCount >= herbCount ? SPECIES.ANT : SPECIES.HERBIVORE;
          }
        }
      }
      return bestCount > 0 ? { x: bestX, y: bestY, preySpecies: bestSpecies, count: bestCount } : null;
    }

    reset() {
      this.plantBiomass.fill(0);
      this.nutrients.fill(0);
      this.antCount.fill(0);
      this.herbivoreCount.fill(0);
      this.predatorCount.fill(0);
    }
  }

  return {
    WIDTH,
    HEIGHT,
    MAX_ORGANISMS_PER_CELL,
    PLANT_CAPACITY,
    NUTRIENT_CAPACITY,
    SPECIES,
    WorldGrid,
  };
})();
