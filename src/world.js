/**
 * World state: 1000x1000 grid, plant biomass, nutrients, biome layers,
 * and player-modified tiles (shelter, farms).
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
    ADVANCED: 4,
  };

  const BIOME = {
    TUNDRA: 0,
    DESERT: 1,
    GRASSLAND: 2,
    FOREST: 3,
    JUNGLE: 4,
  };

  const TILE = {
    NORMAL: 0,
    SHELTER: 1,
    FARM: 2,
    NEST: 3,
  };

  // ACO pheromone trail capacity per cell.
  const PHEROMONE_MAX = 100;

  class WorldGrid {
    constructor() {
      this.width = WIDTH;
      this.height = HEIGHT;
      this.area = WIDTH * HEIGHT;

      // Edible plant biomass (0..PLANT_CAPACITY).
      this.plantBiomass = new Uint16Array(this.area);
      // Baseline soil fertility that drives plant regrowth (0..255).
      this.nutrients = new Uint8Array(this.area);
      // Biome classification per cell.
      this.biome = new Uint8Array(this.area);
      // Temperature and moisture in [0, 1].
      this.temperature = new Float32Array(this.area);
      this.moisture = new Float32Array(this.area);
      // Plant growth multiplier derived from biome.
      this.growthMultiplier = new Float32Array(this.area);
      // Modified tiles (shelter, farm).
      this.tileType = new Uint8Array(this.area);
      // Shelter durability / farm quality.
      this.tileIntegrity = new Uint8Array(this.area);

      // ACO pheromone trail field. Ants deposit it while homing after a meal;
      // it evaporates every tick. Not persisted in saves (ephemeral).
      this.pheromone = new Float32Array(this.area);
      // Ant colony nest sites: [{x, y}, ...]. Set by spawnNests().
      this.nests = [];

      // Per-species occupancy counts (still used for rendering and movement caps).
      this.antCount = new Uint8Array(this.area);
      this.herbivoreCount = new Uint8Array(this.area);
      this.predatorCount = new Uint8Array(this.area);
      this.advancedCount = new Uint8Array(this.area);
    }

    idx(x, y) {
      x = ((x | 0) + this.width) % this.width;
      y = ((y | 0) + this.height) % this.height;
      return y * this.width + x;
    }

    // --- Biomes ----------------------------------------------------------------

    /**
     * Generate temperature, moisture, biome, and growth maps from noise.
     */
    generateBiomes(noiseSeed) {
      const tempMap = Noise.generateMap(this.width, this.height, noiseSeed, 180, 5, 0.5, 2.0);
      const moistMap = Noise.generateMap(this.width, this.height, noiseSeed + 137, 140, 5, 0.5, 2.0);

      for (let i = 0; i < this.area; i++) {
        // Bias temperature away from extremes so most of the world is habitable.
        let t = tempMap[i];
        t = 0.15 + 0.7 * t;
        this.temperature[i] = t;

        let m = moistMap[i];
        m = 0.1 + 0.8 * m;
        this.moisture[i] = m;

        // Biome thresholds based on temperature × moisture.
        let biome;
        if (t < 0.25) {
          biome = BIOME.TUNDRA;
        } else if (m < 0.25) {
          biome = BIOME.DESERT;
        } else if (t < 0.45) {
          biome = BIOME.GRASSLAND;
        } else if (t > 0.7 && m > 0.65) {
          biome = BIOME.JUNGLE;
        } else {
          biome = BIOME.FOREST;
        }
        this.biome[i] = biome;

        // Growth multipliers: lush biomes grow fast, deserts/tundras slow.
        let mult;
        switch (biome) {
          case BIOME.JUNGLE:
            mult = 1.8;
            break;
          case BIOME.FOREST:
            mult = 1.2;
            break;
          case BIOME.GRASSLAND:
            mult = 1.0;
            break;
          case BIOME.TUNDRA:
            mult = 0.5;
            break;
          case BIOME.DESERT:
            mult = 0.25;
            break;
          default:
            mult = 1.0;
        }
        this.growthMultiplier[i] = mult;
      }
    }

    getBiome(x, y) {
      return this.biome[this.idx(x, y)];
    }

    getTemperature(x, y) {
      return this.temperature[this.idx(x, y)];
    }

    getMoisture(x, y) {
      return this.moisture[this.idx(x, y)];
    }

    getGrowthMultiplier(x, y) {
      return this.growthMultiplier[this.idx(x, y)];
    }

    /**
     * Ambient thermodynamic cost at (x, y) for a given thermal efficiency.
     * Cold biomes require more energy unless the agent is thermally efficient.
     * Hot biomes add a smaller heat-stress cost.
     */
    getAmbientCost(x, y, thermalEff) {
      const i = this.idx(x, y);
      const t = this.temperature[i];
      const tt = this.tileType[i];
      let cost = 0;
      if (t < 0.35) {
        // Cold stress: higher metabolism needed to stay warm.
        cost = (0.35 - t) * 0.06 / Math.max(0.3, thermalEff);
      } else if (t > 0.75) {
        // Heat stress.
        cost = (t - 0.75) * 0.08;
      }
      // Shelter reduces ambient cost.
      if (tt === TILE.SHELTER) {
        cost *= 0.3;
      }
      return cost;
    }

    // --- Plants ----------------------------------------------------------------

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
     * Regrow plants everywhere based on local nutrient level and biome.
     */
    growPlants() {
      const biomass = this.plantBiomass;
      const nutrients = this.nutrients;
      const growthMult = this.growthMultiplier;
      const tileType = this.tileType;
      const area = this.area;

      for (let i = 0; i < area; i++) {
        const room = PLANT_CAPACITY - biomass[i];
        if (room <= 0) continue;

        let growth = Math.max(0.1, nutrients[i] * 0.012) * growthMult[i];

        // Farm tiles are cultivated and regrow faster if nutrients are present.
        if (tileType[i] === TILE.FARM) {
          growth *= 1.5;
        }

        // Nutrients slowly deplete as plants grow.
        if (nutrients[i] > 0 && growth > 0.5) {
          nutrients[i] = Math.max(0, nutrients[i] - 1);
        }

        const next = biomass[i] + growth;
        biomass[i] = next > PLANT_CAPACITY ? PLANT_CAPACITY : next;
      }
    }

    // --- Organisms -------------------------------------------------------------

    _countArray(species) {
      switch (species) {
        case SPECIES.ANT:
          return this.antCount;
        case SPECIES.HERBIVORE:
          return this.herbivoreCount;
        case SPECIES.PREDATOR:
          return this.predatorCount;
        case SPECIES.ADVANCED:
          return this.advancedCount;
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
      return this.antCount[i] + this.herbivoreCount[i] + this.predatorCount[i] + this.advancedCount[i];
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
      return this.antCount[i] + this.herbivoreCount[i] + this.predatorCount[i] + this.advancedCount[i];
    }

    // --- Tile modification -----------------------------------------------------

    getTileType(x, y) {
      return this.tileType[this.idx(x, y)];
    }

    setTileType(x, y, type) {
      this.tileType[this.idx(x, y)] = type;
    }

    getTileIntegrity(x, y) {
      return this.tileIntegrity[this.idx(x, y)];
    }

    setTileIntegrity(x, y, value) {
      this.tileIntegrity[this.idx(x, y)] = Math.max(0, Math.min(255, value | 0));
    }

    /**
     * Attempt to build a shelter tile. Returns true if successful.
     */
    buildShelter(x, y) {
      const i = this.idx(x, y);
      if (this.tileType[i] !== TILE.NORMAL) return false;
      this.tileType[i] = TILE.SHELTER;
      this.tileIntegrity[i] = 200;
      return true;
    }

    /**
     * Attempt to convert a tile into a farm. Returns true if successful.
     */
    buildFarm(x, y) {
      const i = this.idx(x, y);
      const b = this.biome[i];
      // Farms can only be built on fertile ground.
      if (this.tileType[i] !== TILE.NORMAL) return false;
      if (b !== BIOME.GRASSLAND && b !== BIOME.FOREST && b !== BIOME.JUNGLE) return false;
      this.tileType[i] = TILE.FARM;
      this.tileIntegrity[i] = 150;
      return true;
    }

    /**
     * Decay modified tiles over time. Nests are permanent colony sites.
     */
    decayTiles() {
      const tileType = this.tileType;
      const integrity = this.tileIntegrity;
      const area = this.area;
      for (let i = 0; i < area; i++) {
        if (tileType[i] === TILE.NORMAL || tileType[i] === TILE.NEST) continue;
        if (integrity[i] > 0) {
          integrity[i]--;
        } else {
          tileType[i] = TILE.NORMAL;
          integrity[i] = 0;
        }
      }
    }

    // --- Pheromones & nests --------------------------------------------------

    getPheromone(x, y) {
      return this.pheromone[this.idx(x, y)];
    }

    depositPheromone(x, y, amount) {
      const i = this.idx(x, y);
      const v = this.pheromone[i] + amount;
      this.pheromone[i] = v > PHEROMONE_MAX ? PHEROMONE_MAX : v;
    }

    /**
     * ACO evaporation: every cell loses a fixed fraction of pheromone per tick,
     * so trails to depleted food sources fade away. Tiny residues snap to zero
     * to keep the field sparse (sensing ignores trace amounts).
     */
    evaporatePheromone(rho) {
      const p = this.pheromone;
      const keep = 1 - rho;
      for (let i = 0; i < p.length; i++) {
        let v = p[i] * keep;
        if (v < 0.05) v = 0;
        p[i] = v;
      }
    }

    /**
     * Place ant colony nests as permanent tiles near existing food. A colony
     * founded in barren land starves before trails can form, so candidates are
     * scored by the plant biomass within foraging range. Call after plants are
     * seeded so biomass data exists.
     */
    spawnNests(count) {
      this.nests = [];
      for (let n = 0; n < count; n++) {
        let bestX = -1;
        let bestY = -1;
        let bestScore = -1;
        for (let c = 0; c < 60; c++) {
          const cx = Math.floor(Math.random() * this.width);
          const cy = Math.floor(Math.random() * this.height);
          const t = this.temperature[this.idx(cx, cy)];
          if (t < 0.2 || t > 0.8) continue;
          // Score by total plant biomass within the colony's spawn/forage ring
          // (radius 12 — seedSpecies scatters founders out to that range).
          let score = 0;
          for (let dy = -12; dy <= 12; dy++) {
            for (let dx = -12; dx <= 12; dx++) {
              score += this.plantBiomass[this.idx(cx + dx, cy + dy)];
            }
          }
          if (score > bestScore) {
            bestScore = score;
            bestX = cx;
            bestY = cy;
          }
        }
        if (bestX < 0) {
          // No habitable candidate found; fall back to any spot.
          bestX = Math.floor(Math.random() * this.width);
          bestY = Math.floor(Math.random() * this.height);
        }
        const i = this.idx(bestX, bestY);
        this.tileType[i] = TILE.NEST;
        this.tileIntegrity[i] = 255;
        this.nests.push({ x: bestX, y: bestY });
      }
    }

    // --- Spawning helpers ------------------------------------------------------

    spawnPlantPatch(cx, cy, radius, density) {
      const r2 = radius * radius;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= r2 && Math.random() < density) {
            const x = cx + dx;
            const y = cy + dy;
            this.addPlantBiomass(x, y, PLANT_CAPACITY);
            this.setNutrients(x, y, Math.max(this.getNutrients(x, y), 120 + Math.random() * 80));
          }
        }
      }
    }

    seedNutrients(density, minLevel, maxLevel) {
      for (let i = 0; i < this.area; i++) {
        if (Math.random() < density) {
          this.nutrients[i] = minLevel + Math.floor(Math.random() * (maxLevel - minLevel + 1));
        }
      }
    }

    plantCellCount() {
      let count = 0;
      for (let i = 0; i < this.area; i++) {
        if (this.plantBiomass[i] > 0) count++;
      }
      return count;
    }

    totalPlantBiomass() {
      let sum = 0;
      for (let i = 0; i < this.area; i++) sum += this.plantBiomass[i];
      return sum;
    }

    /// Export the grid state as a compact JSON-serializable object.
    exportGrid() {
      return {
        width: this.width,
        height: this.height,
        plantBiomass: Array.from(this.plantBiomass),
        nutrients: Array.from(this.nutrients),
        biome: Array.from(this.biome),
        temperature: Array.from(this.temperature),
        moisture: Array.from(this.moisture),
        tileType: Array.from(this.tileType),
        tileIntegrity: Array.from(this.tileIntegrity),
      };
    }

    /// Import grid state from a JSON-serializable object.
    importGrid(data) {
      if (!data) return;
      const area = Math.min(this.area, data.plantBiomass?.length || 0);
      for (let i = 0; i < area; i++) {
        this.plantBiomass[i] = data.plantBiomass[i] || 0;
        this.nutrients[i] = data.nutrients[i] || 0;
        this.biome[i] = data.biome[i] || BIOME.GRASSLAND;
        this.temperature[i] = data.temperature[i] || 0.5;
        this.moisture[i] = data.moisture[i] || 0.5;
        this.tileType[i] = data.tileType[i] || TILE.NORMAL;
        this.tileIntegrity[i] = data.tileIntegrity[i] || 0;
      }
      // Recompute growth multipliers after importing biome data.
      this.growthMultiplier.fill(1);
      for (let i = 0; i < area; i++) {
        const b = this.biome[i];
        if (b === BIOME.DESERT) this.growthMultiplier[i] = 0.4;
        else if (b === BIOME.TUNDRA) this.growthMultiplier[i] = 0.6;
        else if (b === BIOME.GRASSLAND) this.growthMultiplier[i] = 1.0;
        else if (b === BIOME.FOREST) this.growthMultiplier[i] = 1.2;
        else if (b === BIOME.JUNGLE) this.growthMultiplier[i] = 1.5;
      }
    }

    reset() {
      this.plantBiomass.fill(0);
      this.nutrients.fill(0);
      this.biome.fill(BIOME.GRASSLAND);
      this.temperature.fill(0.5);
      this.moisture.fill(0.5);
      this.growthMultiplier.fill(1);
      this.tileType.fill(TILE.NORMAL);
      this.tileIntegrity.fill(0);
      this.pheromone.fill(0);
      this.nests = [];
      this.antCount.fill(0);
      this.herbivoreCount.fill(0);
      this.predatorCount.fill(0);
      this.advancedCount.fill(0);
    }
  }

  return {
    WIDTH,
    HEIGHT,
    MAX_ORGANISMS_PER_CELL,
    PLANT_CAPACITY,
    NUTRIENT_CAPACITY,
    PHEROMONE_MAX,
    SPECIES,
    BIOME,
    TILE,
    WorldGrid,
  };
})();
