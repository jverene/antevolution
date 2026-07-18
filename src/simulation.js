/**
 * Simulation engine: ECS tick loop for movement, grazing, predation,
 * aggression, metabolism, reproduction, mutation, biome forcing,
 * culture, reputation, and environmental modification.
 */

const Simulation = (function () {
  const { WorldGrid, WIDTH, HEIGHT, MAX_ORGANISMS_PER_CELL, SPECIES, BIOME, TILE, PHEROMONE_MAX } = World;
  const { GENOME_LENGTH, BASE_GENOME_LENGTH, PH, NN, NN_OUT, NN_INPUT, createSpeciesGenome, cloneGenome, mutate, crossover, copyMemome, createMemome, computeNNOutputs } = Genetics;
  const { posX, posY, energy, age, species, alive, torpor, fedTrail, homeX, homeY, genome, phenome, memome, active, create, destroy, cleanup, refreshPhenome, setReputation, getReputation, generation, birthTick, lineageId, lineageOriginTick, parent, telomere, cellMass, cellDamage, cancerous } = ECS;

  // --- ACO pheromone-trail tuning -------------------------------------------
  // Ants (and any grazer that evolves the trait) lay pheromone while homing
  // after a meal; the field evaporates globally each tick; foragers climb the
  // local gradient. See README "Pheromone trails (ACO)".
  const PHEROMONE_EVAPORATION = 0.015; // fraction lost per tick (half-life ~45 ticks)
  const TRAIL_TICKS = 240; // max ticks spent homing and laying trail after feeding
  const PHEROMONE_DEPOSIT_RATE = 2.0; // units per tick, scaled by PHEROMONE_DEPOSIT trait
  const PHEROMONE_SENSE_MIN = 0.5; // trace amounts below this are ignored
  const HOME_RADIUS = 3; // distance from the nest that ends the homing state
  const HOMING_WEIGHT = 2.0; // drive strength pulling a fed ant back to its nest

  // Traits surfaced in the live diversity readout. Ranges bracket the realistic
  // post-selection phenotype band so histograms use their full width.
  const DIVERSITY = {
    TRAITS: ["speed", "metabolism", "sense", "aggression", "telomere", "repairRate"],
    // Explicit name -> PH constant index. Trait names don't all uppercase to a
    // matching PH key, so this is the single source of truth for the mapping.
    PH_INDEX: {
      speed: PH.SPEED,
      metabolism: PH.METABOLISM,
      sense: PH.SENSE_RANGE,
      aggression: PH.AGGRESSION,
      telomere: PH.TELOMERE_LENGTH,
      repairRate: PH.REPAIR_RATE,
    },
    RANGES: {
      speed: { min: 0.2, max: 2.8 },
      metabolism: { min: 0.2, max: 2.0 },
      sense: { min: 2, max: 10 },
      aggression: { min: 0, max: 3 },
      telomere: { min: 10, max: 120 },
      repairRate: { min: 0.02, max: 0.5 },
    },
    HIST_BUCKETS: 16,
  };

  const PARAM_RANGES = {
    initialAnts: { min: 400, max: 1600 },
    initialHerbivores: { min: 400, max: 1600 },
    initialPredators: { min: 100, max: 400 },
    initialAdvanced: { min: 50, max: 150 },
    initialPlantPatches: { min: 15, max: 50 },
    plantPatchRadius: { min: 4, max: 9 },
    plantPatchDensity: { min: 0.25, max: 0.6 },
    nutrientSeedDensity: { min: 0.012, max: 0.035 },
    nutrientSeedMin: { min: 30, max: 60 },
    nutrientSeedMax: { min: 90, max: 160 },
    scatteredNutrientCells: { min: 8, max: 20 },
    scatteredNutrientAmount: { min: 25, max: 60 },
  };

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randFloat(min, max) {
    return Math.random() * (max - min) + min;
  }

  class SimulationEngine {
    constructor() {
      this.world = new WorldGrid();
      this.spatial = SpatialHash.createSpatialHash(WIDTH, HEIGHT, ECS);
      this.ticks = 0;
      this.running = true;
      this.speed = 1;
      this.noiseSeed = Math.floor(Math.random() * 1000000);
      this.eventLog = [];
      this._senseScratch = [];
      this._interactScratch = [];
      this._nnInputs = new Float32Array(NN.INPUTS);
      this._nnOutputs = new Float32Array(NN.OUTPUTS);
      // Reusable histogram scratch for the diversity readout (avoids per-stats GC).
      this._speedBuckets = new Uint32Array(DIVERSITY.HIST_BUCKETS);
      this._metabBuckets = new Uint32Array(DIVERSITY.HIST_BUCKETS);
      this.randomizeParams();
      this.reset();
    }

    getHistory() {
      return this.history;
    }

    randomizeParams() {
      this.initialAnts = randInt(PARAM_RANGES.initialAnts.min, PARAM_RANGES.initialAnts.max);
      this.initialHerbivores = randInt(PARAM_RANGES.initialHerbivores.min, PARAM_RANGES.initialHerbivores.max);
      this.initialPredators = randInt(PARAM_RANGES.initialPredators.min, PARAM_RANGES.initialPredators.max);
      this.initialAdvanced = randInt(PARAM_RANGES.initialAdvanced.min, PARAM_RANGES.initialAdvanced.max);
      this.initialPlantPatches = randInt(PARAM_RANGES.initialPlantPatches.min, PARAM_RANGES.initialPlantPatches.max);
      this.plantPatchRadius = randInt(PARAM_RANGES.plantPatchRadius.min, PARAM_RANGES.plantPatchRadius.max);
      this.plantPatchDensity = randFloat(PARAM_RANGES.plantPatchDensity.min, PARAM_RANGES.plantPatchDensity.max);
      this.nutrientSeedDensity = randFloat(PARAM_RANGES.nutrientSeedDensity.min, PARAM_RANGES.nutrientSeedDensity.max);
      this.nutrientSeedMin = randInt(PARAM_RANGES.nutrientSeedMin.min, PARAM_RANGES.nutrientSeedMax.max);
      this.nutrientSeedMax = randInt(PARAM_RANGES.nutrientSeedMax.min, PARAM_RANGES.nutrientSeedMax.max);
      this.scatteredNutrientCells = randInt(PARAM_RANGES.scatteredNutrientCells.min, PARAM_RANGES.scatteredNutrientCells.max);
      this.scatteredNutrientAmount = randInt(PARAM_RANGES.scatteredNutrientAmount.min, PARAM_RANGES.scatteredNutrientAmount.max);
    }

    reset() {
      ECS.reset();
      this.world.reset();
      this.spatial.clear();
      this.ticks = 0;
      this.eventLog = [];
      this.noiseSeed = Math.floor(Math.random() * 1000000);
      this.randomizeParams();

      // Reset population history for the new world.
      this.history = {
        ticks: [],
        ants: [],
        herbivores: [],
        predators: [],
        advanced: [],
        plants: [],
        lineageCount: [],
        maxGeneration: [],
      };
      this.world.generateBiomes(this.noiseSeed);
      this.world.seedNutrients(this.nutrientSeedDensity, this.nutrientSeedMin, this.nutrientSeedMax);

      for (let i = 0; i < this.initialPlantPatches; i++) {
        this.spawnRandomPlantPatch();
      }
      this.seedScatteredNutrients();

      // Colonies are founded near existing food so the initial ants can forage.
      // Nest count scales with the ant population: a single mega-colony strips
      // its neighborhood bare and starves, while several smaller colonies
      // spread the foraging risk across the map.
      this.world.spawnNests(Math.max(3, Math.min(10, Math.round(this.initialAnts / 120))));

      this.seedSpecies(SPECIES.ANT, this.initialAnts);
      this.seedSpecies(SPECIES.HERBIVORE, this.initialHerbivores);
      this.seedSpecies(SPECIES.PREDATOR, this.initialPredators);
      this.seedSpecies(SPECIES.ADVANCED, this.initialAdvanced);

      this.spatial.rebuild();
    }

    seedSpecies(sp, count) {
      const nests = this.world.nests;
      for (let i = 0; i < count; i++) {
        let x;
        let y;
        let nest = null;
        // Most ants start in colonies: a tight ring around a nest, inside the
        // food-scored zone (see spawnNests) so founders can sense the plants.
        // The rest spawn scattered as before — a reserve that keeps the species
        // alive if a colony's neighborhood fails, and a source of new colonies.
        if (sp === SPECIES.ANT && nests.length > 0 && Math.random() < 0.6) {
          nest = nests[Math.floor(Math.random() * nests.length)];
          const angle = Math.random() * Math.PI * 2;
          const r = 2 + Math.random() * 10;
          x = nest.x + Math.floor(Math.cos(angle) * r);
          y = nest.y + Math.floor(Math.sin(angle) * r);
        } else {
          x = Math.floor(Math.random() * WIDTH);
          y = Math.floor(Math.random() * HEIGHT);
        }
        // Ring offsets around an edge nest can leave the map; wrap to torus.
        x = ((x % WIDTH) + WIDTH) % WIDTH;
        y = ((y % HEIGHT) + HEIGHT) % HEIGHT;
        if (this.world.addOrganism(x, y, sp)) {
          const g = createSpeciesGenome(sp);
          const startEnergy = sp === SPECIES.ADVANCED ? 60 + Math.random() * 40 : 40 + Math.random() * 40;
          const id = create(x, y, sp, startEnergy, g, { birthTick: 0 });
          if (id >= 0) {
            // Advanced agents start with no cultural knowledge; innovation must arise and spread.
            if (nest) {
              homeX[id] = nest.x;
              homeY[id] = nest.y;
            }
          } else {
            this.world.removeOrganism(x, y, sp);
          }
        }
      }
    }

    spawnRandomPlantPatch() {
      const cx = Math.floor(Math.random() * WIDTH);
      const cy = Math.floor(Math.random() * HEIGHT);
      this.world.spawnPlantPatch(cx, cy, this.plantPatchRadius, this.plantPatchDensity);
    }

    seedScatteredNutrients() {
      for (let i = 0; i < this.scatteredNutrientCells; i++) {
        const x = Math.floor(Math.random() * WIDTH);
        const y = Math.floor(Math.random() * HEIGHT);
        const current = this.world.getNutrients(x, y);
        this.world.setNutrients(x, y, Math.max(current, this.scatteredNutrientAmount));
      }
    }

    setSpeed(n) {
      this.speed = Math.max(1, Math.min(20, n | 0));
    }

    togglePause() {
      this.running = !this.running;
      return this.running;
    }

    logEvent(text) {
      this.eventLog.push({ tick: this.ticks, text });
      if (this.eventLog.length > 20) this.eventLog.shift();
    }

    /**
     * Run one simulation tick.
     */
    tick() {
      this.ticks++;

      this.world.growPlants();
      this.world.evaporatePheromone(PHEROMONE_EVAPORATION);
      if (this.ticks % 50 === 0) {
        this.world.decayTiles();
      }

      if (Math.random() < 0.02 || this.world.plantCellCount() < 200) {
        this.spawnRandomPlantPatch();
      }
      if (Math.random() < 0.03) {
        this.seedScatteredNutrients();
      }

      this.shuffleActive();

      const n = ECS.activeCount;
      for (let i = 0; i < n; i++) {
        const id = active[i];
        if (!alive[id]) continue;

        // Hibernating organisms skip activity and only pay reduced metabolism.
        if (torpor[id] > 0) {
          this.metabolize(id);
          if (alive[id]) {
            torpor[id]--;
          }
          continue;
        }

        this.decideAndMove(id);
        this.interact(id);
        this.metabolize(id);

        if (!alive[id]) continue;

        // ACO: a fed grazer on its way home lays pheromone trail.
        this.updateTrailLaying(id);

        // Reproduction fires on a cadence when the parent is fed. Cancerous
        // lineages ignore the cadence and energy gate — uncontrolled division
        // that drains the host and seeds a fast-spreading clone.
        const isCancer = cancerous[id] === 1;
        if (
          (isCancer && age[id] % 5 === 0) ||
          (age[id] % 20 === 0 && energy[id] > phenome[id * PH.COUNT + PH.REPRO_THRESHOLD] + 25)
        ) {
          this.tryReproduce(id);
        }
      }

      cleanup();
      this.spatial.rebuild();

      // Record population history every 10 ticks.
      if (this.ticks % 10 === 0) {
        const s = this.stats();
        this.history.ticks.push(this.ticks);
        this.history.ants.push(s.ants);
        this.history.herbivores.push(s.herbivores);
        this.history.predators.push(s.predators);
        this.history.advanced.push(s.advanced);
        this.history.plants.push(s.plantCells);
        this.history.lineageCount.push(s.lineageCount);
        this.history.maxGeneration.push(s.maxGeneration);
        // Keep last 300 data points (3000 ticks of history).
        if (this.history.ticks.length > 300) {
          this.history.ticks.shift();
          this.history.ants.shift();
          this.history.herbivores.shift();
          this.history.predators.shift();
          this.history.advanced.shift();
          this.history.plants.shift();
          this.history.lineageCount.shift();
          this.history.maxGeneration.shift();
        }
      }
    }

    shuffleActive() {
      const arr = active;
      for (let i = ECS.activeCount - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }

    /**
     * Weighted-utility movement: evaluate each of the 8 neighbor directions
     * plus staying still, pick the best one, and move up to speed steps.
     */
    decideAndMove(id) {
      const pOff = id * PH.COUNT;
      const ph = phenome;
      const sp = species[id];
      const sense = ph[pOff + PH.SENSE_RANGE];
      const x = posX[id];
      const y = posY[id];

      // Gather sensory summaries from the surrounding area.
      const senseData = this.summarizeSenses(id, x, y, sense);

      // Bicameral decision: hardwired drives are modulated by a small NN.
      this.computeNNInputs(id, senseData, x, y);
      computeNNOutputs(genome, id * GENOME_LENGTH + BASE_GENOME_LENGTH, this._nnInputs, this._nnOutputs);

      // Random turn bias: occasionally ignore sensory input and move randomly.
      if (Math.random() < ph[pOff + PH.TURN_BIAS]) {
        const alt = this.randomDirection();
        this.executeMove(id, alt.dx, alt.dy);
        return;
      }

      let bestDx = 0;
      let bestDy = 0;
      let bestScore = -Infinity;

      // Evaluate the 8 movement directions plus staying put.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const score = this.utilityScore(id, dx, dy, senseData, this._nnOutputs);
          if (score > bestScore) {
            bestScore = score;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      // If staying still won, nudge toward a random direction so agents don't starve in place.
      if (bestDx === 0 && bestDy === 0) {
        const alt = this.randomDirection();
        bestDx = alt.dx;
        bestDy = alt.dy;
      }

      this.executeMove(id, bestDx, bestDy);
    }

    executeMove(id, dx, dy) {
      const pOff = id * PH.COUNT;
      const sp = species[id];
      const speed = phenome[pOff + PH.SPEED];
      const x = posX[id];
      const y = posY[id];

      // Speed determines number of grid steps this tick (max 3).
      let steps = Math.floor(speed);
      if (Math.random() < speed - steps) steps++;
      steps = Math.max(1, Math.min(steps, 3));

      let cx = x;
      let cy = y;
      let moved = false;

      for (let s = 0; s < steps; s++) {
        const tx = ((cx + dx) + WIDTH) % WIDTH;
        const ty = ((cy + dy) + HEIGHT) % HEIGHT;

        if (this.world.getTotalOrganisms(tx, ty) < MAX_ORGANISMS_PER_CELL) {
          if (!moved) {
            this.world.removeOrganism(cx, cy, sp);
            this.spatial.move(id, cx, cy, tx, ty);
            moved = true;
          } else {
            this.spatial.move(id, cx, cy, tx, ty);
            this.world.removeOrganism(cx, cy, sp);
          }
          this.world.addOrganism(tx, ty, sp);
          cx = tx;
          cy = ty;
        } else {
          // Blocked: try a random alternative direction once.
          const alt = this.randomDirection();
          const ax = ((cx + alt.dx) + WIDTH) % WIDTH;
          const ay = ((cy + alt.dy) + HEIGHT) % HEIGHT;
          if (this.world.getTotalOrganisms(ax, ay) < MAX_ORGANISMS_PER_CELL) {
            if (!moved) {
              this.world.removeOrganism(cx, cy, sp);
              this.spatial.move(id, cx, cy, ax, ay);
              moved = true;
            } else {
              this.spatial.move(id, cx, cy, ax, ay);
              this.world.removeOrganism(cx, cy, sp);
            }
            this.world.addOrganism(ax, ay, sp);
            cx = ax;
            cy = ay;
          } else {
            break;
          }
        }
      }

      if (moved) {
        posX[id] = cx;
        posY[id] = cy;
      }
    }

    randomDirection() {
      const dir = Math.floor(Math.random() * 8);
      const dx = (dir % 3) - 1;
      const dy = Math.floor(dir / 3) - 1;
      if (dx === 0 && dy === 0) return { dx: 1, dy: 0 };
      return { dx, dy };
    }

    /**
     * Collect relevant sensory information around (x, y).
     * Returns unit direction vectors and counts for each stimulus.
     */
    summarizeSenses(id, x, y, radius) {
      const selfSpecies = species[id];
      const r = Math.max(1, Math.min(radius, 10));
      const r2 = r * r;

      const out = {
        foodDx: 0,
        foodDy: 0,
        foodStrength: 0,
        predatorDx: 0,
        predatorDy: 0,
        predatorCount: 0,
        sameDx: 0,
        sameDy: 0,
        sameCount: 0,
        otherDx: 0,
        otherDy: 0,
        otherCount: 0,
        shelterDx: 0,
        shelterDy: 0,
        shelterCount: 0,
        farmDx: 0,
        farmDy: 0,
        farmCount: 0,
        pheromoneDx: 0,
        pheromoneDy: 0,
        pheromoneStrength: 0,
      };

      // Find best food direction (plants for grazers, prey for predators).
      let bestFoodX = x;
      let bestFoodY = y;
      let bestFoodScore = -1;

      if (selfSpecies === SPECIES.PREDATOR) {
        const scratch = this._senseScratch;
        scratch.length = 0;
        this.spatial.queryRadius(x, y, r, scratch);
        for (let i = 0; i < scratch.length; i++) {
          const other = scratch[i];
          if (other === id || !alive[other]) continue;
          const osp = species[other];
          if (osp === SPECIES.PREDATOR || osp === SPECIES.NONE) continue;
          const dx = this.wrapDelta(posX[other] - x, WIDTH);
          const dy = this.wrapDelta(posY[other] - y, HEIGHT);
          const distSq = dx * dx + dy * dy;
          if (distSq > r2 || distSq === 0) continue;
          const score = 1 / Math.sqrt(distSq);
          if (score > bestFoodScore) {
            bestFoodScore = score;
            bestFoodX = x + dx;
            bestFoodY = y + dy;
          }
        }
      } else {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx === 0 && dy === 0) continue;
            const b = this.world.getPlantBiomass(x + dx, y + dy);
            if (b > bestFoodScore) {
              bestFoodScore = b;
              bestFoodX = x + dx;
              bestFoodY = y + dy;
            }
          }
        }
      }

      if (bestFoodScore > 0) {
        const fdx = this.wrapDelta(bestFoodX - x, WIDTH);
        const fdy = this.wrapDelta(bestFoodY - y, HEIGHT);
        const fdist = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
        out.foodDx = fdx / fdist;
        out.foodDy = fdy / fdist;
        out.foodStrength = bestFoodScore;
      }

      // Scan entities for predators, same species, and other species.
      const scratch = this._senseScratch;
      scratch.length = 0;
      this.spatial.queryRadius(x, y, r, scratch);

      let pdx = 0, pdy = 0;
      let sdx = 0, sdy = 0;
      let odx = 0, ody = 0;

      for (let i = 0; i < scratch.length; i++) {
        const other = scratch[i];
        if (other === id || !alive[other]) continue;
        const dx = this.wrapDelta(posX[other] - x, WIDTH);
        const dy = this.wrapDelta(posY[other] - y, HEIGHT);
        const distSq = dx * dx + dy * dy;
        if (distSq > r2 || distSq === 0) continue;
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;
        const osp = species[other];

        if (osp === SPECIES.PREDATOR) {
          pdx += nx;
          pdy += ny;
          out.predatorCount++;
        } else if (osp === selfSpecies) {
          sdx += nx;
          sdy += ny;
          out.sameCount++;
        } else {
          odx += nx;
          ody += ny;
          out.otherCount++;
        }
      }

      if (out.predatorCount > 0) {
        const plen = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
        out.predatorDx = pdx / plen;
        out.predatorDy = pdy / plen;
      }
      if (out.sameCount > 0) {
        const slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
        out.sameDx = sdx / slen;
        out.sameDy = sdy / slen;
      }
      if (out.otherCount > 0) {
        const olen = Math.sqrt(odx * odx + ody * ody) || 1;
        out.otherDx = odx / olen;
        out.otherDy = ody / olen;
      }

      // Scan modified tiles; in the same pass, find the strongest pheromone
      // cell (ACO recruitment gradient — foragers climb toward the peak, which
      // sits at the food end of a trail where deposits are renewed).
      let shx = 0, shy = 0, fmx = 0, fmy = 0;
      let bestPheromone = PHEROMONE_SENSE_MIN;
      let bestPherX = 0;
      let bestPherY = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          const tt = this.world.getTileType(x + dx, y + dy);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (tt === TILE.SHELTER) {
            shx += dx / dist;
            shy += dy / dist;
            out.shelterCount++;
          } else if (tt === TILE.FARM) {
            fmx += dx / dist;
            fmy += dy / dist;
            out.farmCount++;
          }
          const pv = this.world.getPheromone(x + dx, y + dy);
          if (pv > bestPheromone) {
            bestPheromone = pv;
            bestPherX = dx;
            bestPherY = dy;
          }
        }
      }
      if (bestPheromone > PHEROMONE_SENSE_MIN) {
        const plen = Math.sqrt(bestPherX * bestPherX + bestPherY * bestPherY) || 1;
        out.pheromoneDx = bestPherX / plen;
        out.pheromoneDy = bestPherY / plen;
        out.pheromoneStrength = bestPheromone;
      }
      if (out.shelterCount > 0) {
        const slen = Math.sqrt(shx * shx + shy * shy) || 1;
        out.shelterDx = shx / slen;
        out.shelterDy = shy / slen;
      }
      if (out.farmCount > 0) {
        const flen = Math.sqrt(fmx * fmx + fmy * fmy) || 1;
        out.farmDx = fmx / flen;
        out.farmDy = fmy / flen;
      }

      return out;
    }

    wrapDelta(delta, dim) {
      if (delta > dim / 2) return delta - dim;
      if (delta < -dim / 2) return delta + dim;
      return delta;
    }

    /**
     * Fill the NN input vector from sensory summary and internal state.
     */
    computeNNInputs(id, s, x, y) {
      const inp = this._nnInputs;
      inp[NN_INPUT.FOOD_STRENGTH] = Math.min(1, s.foodStrength / 200);
      inp[NN_INPUT.PREDATOR_COUNT] = Math.min(1, s.predatorCount / 3);
      inp[NN_INPUT.SAME_COUNT] = Math.min(1, s.sameCount / 5);
      inp[NN_INPUT.OTHER_COUNT] = Math.min(1, s.otherCount / 5);
      inp[NN_INPUT.SHELTER_COUNT] = Math.min(1, s.shelterCount / 3);
      inp[NN_INPUT.FARM_COUNT] = Math.min(1, s.farmCount / 3);
      inp[NN_INPUT.ENERGY] = Math.min(1, energy[id] / 150);
      const t = this.world.getTemperature(x, y);
      inp[NN_INPUT.TEMP_STRESS] = Math.abs(t - 0.5) * 2;
      inp[NN_INPUT.PHEROMONE_STRENGTH] = Math.min(1, s.pheromoneStrength / 50);
    }

    /**
     * Compute utility of moving in direction (dx, dy).
     */
    utilityScore(id, dx, dy, s, nn) {
      const pOff = id * PH.COUNT;
      const ph = phenome;

      // Normalize direction vector.
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;

      // Desired direction is a weighted sum of stimulus vectors.
      let desiredDx = 0;
      let desiredDy = 0;

      const no = NN_OUT;
      const sp = species[id];

      // Homing state: a fed trail-layer beelines back to its colony nest,
      // ignoring food, pheromone, and social drives. Predator fear still applies.
      if (fedTrail[id] > 0) {
        const hx = this.wrapDelta(homeX[id] - posX[id], WIDTH);
        const hy = this.wrapDelta(homeY[id] - posY[id], HEIGHT);
        const hlen = Math.sqrt(hx * hx + hy * hy) || 1;
        desiredDx += HOMING_WEIGHT * (hx / hlen);
        desiredDy += HOMING_WEIGHT * (hy / hlen);
        desiredDx -= ph[pOff + PH.W_FLEE_PREDATOR] * nn[no.FLEE_MULT] * s.predatorDx;
        desiredDy -= ph[pOff + PH.W_FLEE_PREDATOR] * nn[no.FLEE_MULT] * s.predatorDy;
        let score = desiredDx * ux + desiredDy * uy;
        score += ph[pOff + PH.W_EXPLORE] * nn[no.EXPLORE_BOOST] * (Math.random() - 0.5) * 0.25;
        if (dx === 0 && dy === 0) score -= 0.5;
        return score;
      }

      // For predators the "food" stimulus is prey, so they use W_PREY instead of W_FOOD.
      const foodWeight = sp === SPECIES.PREDATOR ? ph[pOff + PH.W_PREY] : ph[pOff + PH.W_FOOD];
      desiredDx += foodWeight * nn[no.FOOD_MULT] * s.foodDx;
      desiredDy += foodWeight * nn[no.FOOD_MULT] * s.foodDy;

      desiredDx -= ph[pOff + PH.W_FLEE_PREDATOR] * nn[no.FLEE_MULT] * s.predatorDx;
      desiredDy -= ph[pOff + PH.W_FLEE_PREDATOR] * nn[no.FLEE_MULT] * s.predatorDy;

      desiredDx += ph[pOff + PH.W_AGGRESSION_SAME] * nn[no.AGGR_SAME_MULT] * s.sameDx;
      desiredDy += ph[pOff + PH.W_AGGRESSION_SAME] * nn[no.AGGR_SAME_MULT] * s.sameDy;

      desiredDx += ph[pOff + PH.W_AGGRESSION_OTHER] * nn[no.AGGR_OTHER_MULT] * s.otherDx;
      desiredDy += ph[pOff + PH.W_AGGRESSION_OTHER] * nn[no.AGGR_OTHER_MULT] * s.otherDy;

      desiredDx += ph[pOff + PH.W_SHELTER] * nn[no.SHELTER_MULT] * s.shelterDx;
      desiredDy += ph[pOff + PH.W_SHELTER] * nn[no.SHELTER_MULT] * s.shelterDy;

      desiredDx += ph[pOff + PH.W_FARM] * nn[no.FARM_MULT] * s.farmDx;
      desiredDy += ph[pOff + PH.W_FARM] * nn[no.FARM_MULT] * s.farmDy;

      // ACO recruitment: climb the pheromone gradient toward the food end of a trail.
      desiredDx += ph[pOff + PH.W_PHEROMONE] * nn[no.PHER_MULT] * s.pheromoneDx;
      desiredDy += ph[pOff + PH.W_PHEROMONE] * nn[no.PHER_MULT] * s.pheromoneDy;

      // Score is alignment with desired direction plus exploration noise.
      let score = desiredDx * ux + desiredDy * uy;
      score += ph[pOff + PH.W_EXPLORE] * nn[no.EXPLORE_BOOST] * (Math.random() - 0.5) * 0.5;

      // Penalize staying still to keep agents moving.
      if (dx === 0 && dy === 0) score -= 0.5;

      return score;
    }

    /**
     * ACO trail laying: an organism in the homing state (fedTrail > 0) deposits
     * pheromone on its current cell each tick, building a scent corridor from
     * the food patch back toward its colony nest. Arriving home ends the state.
     */
    updateTrailLaying(id) {
      if (fedTrail[id] === 0) return;
      const hx = this.wrapDelta(homeX[id] - posX[id], WIDTH);
      const hy = this.wrapDelta(homeY[id] - posY[id], HEIGHT);
      if (hx * hx + hy * hy <= HOME_RADIUS * HOME_RADIUS) {
        fedTrail[id] = 0;
        // Home is played out: cut the anchor and roam free. The next rich
        // find re-anchors the ant (colony collapse and re-founding).
        if (this.localPlantSum(homeX[id], homeY[id], 8) < 1500) {
          homeX[id] = posX[id];
          homeY[id] = posY[id];
        }
        return;
      }
      const rate = phenome[id * PH.COUNT + PH.PHEROMONE_DEPOSIT];
      this.world.depositPheromone(posX[id], posY[id], PHEROMONE_DEPOSIT_RATE * rate);
      fedTrail[id]--;
    }

    /**
     * Total plant biomass in the (2r+1)² block around (x, y). Used by the ACO
     * relocation/adoption rules to judge how rich a neighborhood is.
     */
    localPlantSum(x, y, r) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          sum += this.world.getPlantBiomass(x + dx, y + dy);
        }
      }
      return sum;
    }

    /**
     * Interaction phase: feeding, aggression, teaching, tile modification.
     */
    interact(id) {
      const pOff = id * PH.COUNT;
      const ph = phenome;
      const sp = species[id];
      const x = posX[id];
      const y = posY[id];

      if (sp === SPECIES.PREDATOR) {
        energy[id] += this.attemptPredation(id);
      } else {
        // Graze on plants.
        const plantsHere = this.world.getPlantBiomass(x, y);
        if (plantsHere > 0) {
          const bite = 2 * ph[pOff + PH.FOOD_EFFICIENCY];
          const eaten = this.world.takePlantBiomass(x, y, bite);
          energy[id] += eaten;
          // ACO: report finds to the colony — but don't let a dead home become
          // a trap. Far from home, a rich patch is worth relocating to (adopt
          // it as the new anchor); a scrap is only worth reporting (home and
          // lay trail). Near home, home once full to scent the local ground.
          if (eaten > 0 && ph[pOff + PH.PHEROMONE_DEPOSIT] > 0) {
            const hx = this.wrapDelta(homeX[id] - x, WIDTH);
            const hy = this.wrapDelta(homeY[id] - y, HEIGHT);
            if (hx * hx + hy * hy > 225) {
              // 15+ cells from home.
              if (this.localPlantSum(x, y, 3) > 3000) {
                homeX[id] = x;
                homeY[id] = y;
              } else {
                fedTrail[id] = TRAIL_TICKS;
              }
            } else if (energy[id] > ph[pOff + PH.REPRO_THRESHOLD] + 40) {
              fedTrail[id] = TRAIL_TICKS;
            }
          }
        }
      }

      // Aggression: attack neighbors of same or other species.
      this.handleAggression(id);

      // Advanced / social agents teach and modify tiles.
      if (sp === SPECIES.ADVANCED || ph[pOff + PH.SOCIALITY] > 1.0) {
        this.handleTeaching(id);
      }
      if (sp === SPECIES.ADVANCED) {
        this.handleTileModification(id);
      }
    }

    handleAggression(id) {
      const pOff = id * PH.COUNT;
      const ph = phenome;
      const sp = species[id];
      const x = posX[id];
      const y = posY[id];
      const aggression = ph[pOff + PH.AGGRESSION];
      // Aggression is currently a minor scuffle; keep it rare to avoid destabilizing the ecosystem.
      if (aggression < 1.5 || Math.random() > 0.1) return;

      this._interactScratch = this._interactScratch || [];
      this._interactScratch.length = 0;
      this.spatial.queryCell(x, y, this._interactScratch);

      for (let i = 0; i < this._interactScratch.length; i++) {
        const other = this._interactScratch[i];
        if (other === id || !alive[other]) continue;
        const osp = species[other];
        const weight = osp === sp ? ph[pOff + PH.W_AGGRESSION_SAME] : ph[pOff + PH.W_AGGRESSION_OTHER];
        if (weight <= 0) continue;

        // Attack probability scales with aggression, target defense, and energy.
        const oOff = other * PH.COUNT;
        const targetDefense = phenome[oOff + PH.AGGRESSION] + phenome[oOff + PH.SOCIALITY] * 0.3;
        const chance = Math.min(0.6, 0.05 + (aggression - targetDefense) * 0.05 + ph[pOff + PH.SPEED] * 0.05);
        if (Math.random() < chance) {
          // Damage costs energy to both parties; may kill weaker target.
          const damage = 5 * aggression;
          energy[other] -= damage;
          energy[id] -= damage * 0.2;
          if (osp === sp) {
            setReputation(other, id, -0.5);
          }
          if (energy[other] <= 0 && alive[other]) {
            alive[other] = 0;
            this.world.removeOrganism(posX[other], posY[other], osp);
            energy[id] += 5;
          }
        }
      }
    }

    attemptPredation(predatorId) {
      const x = posX[predatorId];
      const y = posY[predatorId];

      this._interactScratch = this._interactScratch || [];
      this._interactScratch.length = 0;

      const pOff = predatorId * PH.COUNT;
      const strikeRange = Math.max(0, Math.floor(phenome[pOff + PH.STRIKE_RANGE]));
      const predatorSpeed = phenome[pOff + PH.SPEED];
      const predatorAggression = phenome[pOff + PH.AGGRESSION];
      const predationSkill = phenome[pOff + PH.PREDATION_SKILL];

      // Predators can strike prey within their evolvable strike radius.
      const queryRadius = Math.max(1, strikeRange);
      this.spatial.queryRadius(x, y, queryRadius, this._interactScratch);

      let preyId = -1;
      let bestScore = -Infinity;

      for (let i = 0; i < this._interactScratch.length; i++) {
        const other = this._interactScratch[i];
        if (!alive[other]) continue;
        const osp = species[other];
        if (osp === SPECIES.PREDATOR || osp === SPECIES.NONE) continue;
        const oOff = other * PH.COUNT;
        const dx = this.wrapDelta(posX[other] - x, WIDTH);
        const dy = this.wrapDelta(posY[other] - y, HEIGHT);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > strikeRange + 0.5) continue;
        const preySpeed = phenome[oOff + PH.SPEED];
        const preyDefense = phenome[oOff + PH.AGGRESSION] + phenome[oOff + PH.SOCIALITY] * 0.5;
        const speedAdvantage = predatorSpeed / Math.max(0.1, preySpeed);
        const energyValue = osp === SPECIES.HERBIVORE ? 1.5 : 1.0;
        // Prefer closer, slower, more valuable prey.
        const score = speedAdvantage * 2 - preyDefense + energyValue - dist * 0.5 + Math.random();
        if (score > bestScore) {
          bestScore = score;
          preyId = other;
        }
      }

      if (preyId < 0) return 0;

      const oOff = preyId * PH.COUNT;
      const preyX = posX[preyId];
      const preyY = posY[preyId];
      const nearbyAllies = this.world.getOrganismCount(preyX, preyY, species[preyId]) - 1;
      const preyDefense = phenome[oOff + PH.AGGRESSION] + phenome[oOff + PH.SOCIALITY] * 0.5 + nearbyAllies * 0.15;
      const speedAdvantage = phenome[pOff + PH.SPEED] / Math.max(0.1, phenome[oOff + PH.SPEED]);
      const aggressionAdvantage = predatorAggression / Math.max(0.1, preyDefense + 1);
      const catchChance = Math.min(0.9, 0.35 + speedAdvantage * 0.2 + aggressionAdvantage * 0.2 + predationSkill * 0.15);

      if (Math.random() < catchChance) {
        // Realistic trophic transfer: predator gains a fraction of prey's stored energy.
        // The classic ecological rule is ~10% net efficiency over whole trophic levels,
        // but assimilation of a single prey item is higher; we use 40-60% scaled by food efficiency.
        const preyEnergy = energy[preyId];
        const foodEff = phenome[pOff + PH.FOOD_EFFICIENCY];
        const transferFraction = Math.min(0.65, 0.4 + 0.05 * foodEff);
        const energyGain = preyEnergy * transferFraction;
        alive[preyId] = 0;
        this.world.removeOrganism(posX[preyId], posY[preyId], species[preyId]);
        return energyGain;
      }
      return 0;
    }

    handleTeaching(id) {
      const pOff = id * PH.COUNT;
      const ph = phenome;
      const sociality = ph[pOff + PH.SOCIALITY];
      const learning = ph[pOff + PH.LEARNING_RATE];
      if (sociality < 0.3 || learning < 0.05) return;

      const x = posX[id];
      const y = posY[id];
      this._interactScratch = this._interactScratch || [];
      this._interactScratch.length = 0;
      this.spatial.queryCell(x, y, this._interactScratch);

      for (let i = 0; i < this._interactScratch.length; i++) {
        const other = this._interactScratch[i];
        if (other === id || !alive[other]) continue;
        const oOff = other * PH.COUNT;
        if (phenome[oOff + PH.LEARNING_RATE] < 0.05) continue;
        // Successful agents teach; struggling agents learn.
        if (energy[id] > energy[other] && Math.random() < 0.05 * sociality) {
          this.teachMemome(id, other);
          setReputation(other, id, 0.3);
        }
      }
    }

    teachMemome(teacherId, studentId) {
      const tOff = teacherId * Genetics.MEMOME_LENGTH;
      const sOff = studentId * Genetics.MEMOME_LENGTH;
      const rate = phenome[studentId * PH.COUNT + PH.LEARNING_RATE] * 0.2;
      for (let i = 0; i < Genetics.MEMOME_LENGTH; i++) {
        memome[sOff + i] += (memome[tOff + i] - memome[sOff + i]) * rate;
      }
    }

    handleTileModification(id) {
      const pOff = id * PH.COUNT;
      const ph = phenome;
      const x = posX[id];
      const y = posY[id];
      const e = energy[id];

      // Memome-derived shelter/farm weights: memome[0] = shelter, memome[1] = farm.
      const mOff = id * Genetics.MEMOME_LENGTH;
      const shelterMeme = memome[mOff + 0];
      const farmMeme = memome[mOff + 1];

      const wShelter = ph[pOff + PH.W_SHELTER] + shelterMeme;
      const wFarm = ph[pOff + PH.W_FARM] + farmMeme;

      // Build shelter if cold and motivated.
      const temp = this.world.getTemperature(x, y);
      if (wShelter > 0.8 && temp < 0.35 && e > 90) {
        if (this.world.buildShelter(x, y)) {
          energy[id] -= 30;
          if (this.eventLog.filter((e) => e.text.includes("shelter")).length === 0) {
            this.logEvent("First shelter built");
          }
        }
      }

      // Build farm if on fertile land and motivated.
      if (wFarm > 0.8 && e > 120) {
        if (this.world.buildFarm(x, y)) {
          energy[id] -= 40;
          // Add some initial biomass to the farm.
          this.world.addPlantBiomass(x, y, 200);
          if (this.eventLog.filter((e) => e.text.includes("farm")).length === 0) {
            this.logEvent("First farm cultivated");
          }
        }
      }
    }

    metabolize(id) {
      const pOff = id * PH.COUNT;
      const ph = phenome;
      const x = posX[id];
      const y = posY[id];

      let cost = ph[pOff + PH.METABOLISM];
      cost += this.world.getAmbientCost(x, y, ph[pOff + PH.THERMAL_EFF]);

      // Soft density dependence: crowding raises metabolism through competition stress.
      const localDensity = this.world.getTotalOrganisms(x, y);
      const excess = Math.max(0, localDensity - 1);
      cost += excess * excess * 0.04;

      const inTorpor = torpor[id] > 0;
      const hibernationDrive = ph[pOff + PH.HIBERNATION_DRIVE];

      if (inTorpor) {
        // Torpor halves metabolism and pauses aging.
        cost *= 0.5;
      } else if (hibernationDrive > 0) {
        // Enter torpor when energy is low or environmental stress is high.
        const energyRatio = energy[id] / ph[pOff + PH.REPRO_THRESHOLD];
        const t = this.world.getTemperature(x, y);
        const tempStress = Math.abs(t - 0.5) * 2;
        const stress = (1 - energyRatio) * 0.5 + tempStress * 0.35;
        if (stress > 0.6 && Math.random() < hibernationDrive) {
          torpor[id] = 5 + Math.floor(Math.random() * 11);
          cost *= 0.5;
        }
      }

      energy[id] -= cost;
      if (!inTorpor) age[id]++;

      // --- Aggregate cellular biology --------------------------------------
      // Telomere erosion happens at division (in tryReproduce), not per tick.
      // Per-tick erosion was removed because it exhausted lineages too fast;
      // division-based erosion alone creates a realistic Hayflick limit where
      // each generation shortens the replicative budget. Cancerous lineages
      // skip the senescence machinery below.
      const tCap = ph[pOff + PH.TELOMERE_LENGTH];

      // Damage accumulation: metabolic work and environmental stress generate
      // oxidative damage. Heavier bodies accrue slightly more but also buffer it.
      const mass = Math.max(1, cellMass[id]);
      const t = this.world.getTemperature(x, y);
      const tempStress = Math.abs(t - 0.5) * 2;
      if (!inTorpor) {
        const damageRate = 0.02 + cost * 0.01 + tempStress * 0.03;
        cellDamage[id] += damageRate * Math.sqrt(mass / ph[pOff + PH.MAX_CELL_MASS]);
      }
      // Repair: an evolvable clearance rate scaled by current mass.
      cellDamage[id] -= ph[pOff + PH.REPAIR_RATE] * 0.5;
      if (cellDamage[id] < 0) cellDamage[id] = 0;

      // Cell mass grows from surplus energy (capped by the body plan maximum).
      const maxMass = ph[pOff + PH.MAX_CELL_MASS];
      if (cellMass[id] < maxMass && energy[id] > 10) {
        cellMass[id] += 0.15 * (1 - cellMass[id] / maxMass);
        if (cellMass[id] > maxMass) cellMass[id] = maxMass;
      }

      // --- Mortality -------------------------------------------------------
      // Energy starvation is immediate. Otherwise mortality is a smooth function
      // of three coupled factors: chronological age approaching longevity,
      // telomere depletion, and damage saturating the cell mass. This replaces
      // the old flat age cliff with a steepening Gompertz-like curve.
      if (energy[id] <= 0) {
        alive[id] = 0;
        this.world.removeOrganism(x, y, species[id]);
      } else if (!cancerous[id]) {
        const ageFactor = age[id] / ph[pOff + PH.LONGEVITY];
        const telomereFactor = tCap > 0 ? 1 - telomere[id] / tCap : 0;
        const damageFactor = cellDamage[id] / mass;
        const hazard =
          Math.max(0, ageFactor - 0.8) * 0.25 +
          telomereFactor * telomereFactor * 0.15 +
          damageFactor * damageFactor * 0.2;
        if (hazard > 0.05 && Math.random() < hazard) {
          alive[id] = 0;
          this.world.removeOrganism(x, y, species[id]);
        }
      }
    }

    /**
     * Find a nearby mature mate of the same species for sexual reproduction.
     * Returns the mate's entity id, or -1 if none is available.
     */
    findMate(parentId, x, y, sp) {
      this._interactScratch = this._interactScratch || [];
      this._interactScratch.length = 0;
      this.spatial.queryRadius(x, y, 2, this._interactScratch);

      let mateId = -1;
      let mateCount = 0;
      for (let i = 0; i < this._interactScratch.length; i++) {
        const other = this._interactScratch[i];
        if (other === parentId || !alive[other]) continue;
        if (species[other] !== sp) continue;
        // Mate must be mature and have enough energy to be considered fertile.
        const oOff = other * PH.COUNT;
        if (age[other] < 20 || energy[other] < phenome[oOff + PH.REPRO_THRESHOLD] * 0.4) continue;
        mateCount++;
        // Reservoir sampling so we don't need a second pass.
        if (Math.random() < 1 / mateCount) {
          mateId = other;
        }
      }
      return mateId;
    }

    tryReproduce(parentId) {
      const px = posX[parentId];
      const py = posY[parentId];
      const sp = species[parentId];

      const localDensity = this.world.getTotalOrganisms(px, py);

      const candidates = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = ((px + dx) + WIDTH) % WIDTH;
          const ty = ((py + dy) + HEIGHT) % HEIGHT;
          if (this.world.getTotalOrganisms(tx, ty) < MAX_ORGANISMS_PER_CELL) {
            candidates.push({ x: tx, y: ty });
          }
        }
      }
      if (candidates.length === 0) return;

      // Density-dependent reproduction: crowded cells strongly suppress breeding.
      if (localDensity > 2 && Math.random() < (localDensity - 2) * 0.35) return;

      const pParent = parentId * PH.COUNT;
      const isCancer = cancerous[parentId] === 1;

      // Cell-division gate: an organism must have grown enough cell mass to
      // divide. Cancerous lineages bypass this (dysregulated cell cycle).
      const divisionThreshold = phenome[pParent + PH.MAX_CELL_MASS] * 0.55;
      if (!isCancer && cellMass[parentId] < divisionThreshold) return;

      // Rare somatic catastrophe: a normal division produces a telomerase-locked
      // clone that escapes the replicative limit. Cancerous cells keep dividing
      // without erosion and drain their host. Tuned to be a genuinely rare event
      // (~1 in ~700k divisions) so it surfaces occasionally in long runs.
      let childIsCancer = isCancer;
      if (!isCancer && Math.random() < 0.0000015) {
        childIsCancer = true;
        if (!this.eventLog.some((e) => e.text.includes("cancer"))) {
          this.logEvent("First cancer event");
        }
      }

      const mateId = this.findMate(parentId, px, py, sp);

      const spot = candidates[Math.floor(Math.random() * candidates.length)];
      if (!this.world.addOrganism(spot.x, spot.y, sp)) return;

      const parentGenome = genome.subarray(parentId * GENOME_LENGTH, (parentId + 1) * GENOME_LENGTH);
      const childGenome = cloneGenome(parentGenome);
      const pMut = phenome[pParent + PH.MUTABILITY];

      if (mateId >= 0) {
        // Sexual reproduction: meiotic crossover with a nearby mate.
        const mateGenome = genome.subarray(mateId * GENOME_LENGTH, (mateId + 1) * GENOME_LENGTH);
        crossover(parentGenome, mateGenome, childGenome);
      }
      // If no mate is available, fall back to asexual cloning (apomixis).

      mutate(childGenome, pMut);
      mutate(parentGenome, pMut * 0.3);
      refreshPhenome(parentId);

      const childId = create(spot.x, spot.y, sp, 25, childGenome, {
        parentId: parentId,
        parentLineageId: lineageId[parentId],
        parentGen: generation[parentId],
        birthTick: this.ticks,
        parentOriginTick: lineageOriginTick[parentId],
      });
      if (childId < 0) {
        this.world.removeOrganism(spot.x, spot.y, sp);
        return;
      }

      // --- Cellular inheritance -------------------------------------------
      // Telomere: the end-replication problem shortens the child's telomere by a
      // fixed cost each generation (Hayflick limit). Cancerous clones inherit a
      // fully topped-up telomere and are flagged so they never erode.
      if (childIsCancer) {
        telomere[childId] = phenome[childId * PH.COUNT + PH.TELOMERE_LENGTH];
        cancerous[childId] = 1;
      } else {
        // Each division shortens the child's telomere (Hayflick limit).
        // Erosion of 1.5 per division gives ~25 generations before depletion
        // for a typical telomere capacity of ~38, which is long enough for
        // natural selection to act on telomere/repair variation.
        const erosion = 1.5;
        telomere[childId] = Math.max(0, telomere[parentId] - erosion);
      }

      // Cell mass: the parent bud a division-ratio fraction of its mass into the
      // child. Cancerous divisions also skim mass, accelerating the host drain.
      const divRatio = phenome[pParent + PH.DIVISION_RATIO];
      const donated = cellMass[parentId] * divRatio;
      cellMass[childId] = donated;
      cellMass[parentId] -= donated;
      cellDamage[childId] = cellDamage[parentId] * 0.3;

      // Inherit memome from parent with small innovation (vertical cultural transmission).
      const cOff = childId * Genetics.MEMOME_LENGTH;
      const pOff = parentId * Genetics.MEMOME_LENGTH;
      for (let i = 0; i < Genetics.MEMOME_LENGTH; i++) {
        memome[cOff + i] = memome[pOff + i] + (Math.random() - 0.5) * 0.02;
      }

      // Colony membership is hereditary: the child keeps the parent's nest as home.
      homeX[childId] = homeX[parentId];
      homeY[childId] = homeY[parentId];

      energy[parentId] -= isCancer ? 15 : 35;
    }

    // Aggregate statistics for the UI.
    stats() {
      let ants = 0, herbivores = 0, predators = 0, advanced = 0;
      let speed = 0, sense = 0, metabolism = 0, repro = 0, mutability = 0, aggression = 0;
      let thermal = 0, sociality = 0, wFood = 0, wFlee = 0, wShelter = 0, wFarm = 0, wPheromone = 0;
      let avgTelomere = 0, avgDamage = 0;
      let cancerCount = 0;
      const n = ECS.activeCount;

      // Per-species running sums for variance + histograms. We accumulate sums
      // of x and x^2 so std is a single sqrt at the end, with no second pass.
      // Sized generically to DIVERSITY.TRAITS so adding a trait needs no resize.
      const dt = DIVERSITY.TRAITS;
      const spCount = dt.length;
      const sumX = new Float64Array(spCount);
      const sumXX = new Float64Array(spCount);
      const counts = new Uint32Array(spCount);
      // Phenome offset for each tracked trait, precomputed once. Trait names in
      // DIVERSITY.TRAITS don't always map 1:1 to a PH constant by uppercasing
      // (e.g. "sense" -> PH.SENSE_RANGE, "telomere" -> PH.TELOMERE_LENGTH), so
      // we keep the mapping explicit.
      const traitPhOff = new Uint8Array(spCount);
      for (let t = 0; t < spCount; t++) traitPhOff[t] = DIVERSITY.PH_INDEX[dt[t]];
      const speedBuckets = this._speedBuckets;
      const metabBuckets = this._metabBuckets;
      speedBuckets.fill(0);
      metabBuckets.fill(0);
      const spRange = DIVERSITY.RANGES.speed;
      const mbRange = DIVERSITY.RANGES.metabolism;
      const nb = DIVERSITY.HIST_BUCKETS;

      // Lineage bookkeeping.
      const seenLineages = new Set();
      let maxGeneration = 0;

      for (let i = 0; i < n; i++) {
        const id = active[i];
        const sp = species[id];
        const pOff = id * PH.COUNT;
        if (sp === SPECIES.ANT) ants++;
        else if (sp === SPECIES.HERBIVORE) herbivores++;
        else if (sp === SPECIES.PREDATOR) predators++;
        else if (sp === SPECIES.ADVANCED) advanced++;

        speed += phenome[pOff + PH.SPEED];
        sense += phenome[pOff + PH.SENSE_RANGE];
        metabolism += phenome[pOff + PH.METABOLISM];
        repro += phenome[pOff + PH.REPRO_THRESHOLD];
        mutability += phenome[pOff + PH.MUTABILITY];
        aggression += phenome[pOff + PH.AGGRESSION];
        thermal += phenome[pOff + PH.THERMAL_EFF];
        sociality += phenome[pOff + PH.SOCIALITY];
        wFood += phenome[pOff + PH.W_FOOD];
        wFlee += phenome[pOff + PH.W_FLEE_PREDATOR];
        wShelter += phenome[pOff + PH.W_SHELTER];
        wFarm += phenome[pOff + PH.W_FARM];
        wPheromone += phenome[pOff + PH.W_PHEROMONE];

        // Aggregate cellular-biology sums.
        avgTelomere += telomere[id];
        avgDamage += cellDamage[id];
        if (cancerous[id]) cancerCount++;

        // Diversity accumulation over the tracked traits (generic per-trait).
        const vSpeed = phenome[pOff + PH.SPEED];
        const vMetab = phenome[pOff + PH.METABOLISM];
        for (let t = 0; t < spCount; t++) {
          const v = phenome[pOff + traitPhOff[t]];
          sumX[t] += v; sumXX[t] += v * v; counts[t]++;
        }

        // Histograms (only speed + metabolism are charted; others still get variance).
        let b = ((vSpeed - spRange.min) / (spRange.max - spRange.min) * nb) | 0;
        if (b >= 0 && b < nb) speedBuckets[b]++;
        b = ((vMetab - mbRange.min) / (mbRange.max - mbRange.min) * nb) | 0;
        if (b >= 0 && b < nb) metabBuckets[b]++;

        // Lineage accumulation (seen lineages, max generation).
        seenLineages.add(lineageId[id]);
        if (generation[id] > maxGeneration) maxGeneration = generation[id];
      }

      return {
        ticks: this.ticks,
        ants,
        herbivores,
        predators,
        advanced,
        plantCells: this.world.plantCellCount(),
        speed: n ? speed / n : 0,
        sense: n ? sense / n : 0,
        metabolism: n ? metabolism / n : 0,
        repro: n ? repro / n : 0,
        mutability: n ? mutability / n : 0,
        aggression: n ? aggression / n : 0,
        thermal: n ? thermal / n : 0,
        sociality: n ? sociality / n : 0,
        wFood: n ? wFood / n : 0,
        wFlee: n ? wFlee / n : 0,
        wShelter: n ? wShelter / n : 0,
        wFarm: n ? wFarm / n : 0,
        wPheromone: n ? wPheromone / n : 0,
        avgTelomere: n ? avgTelomere / n : 0,
        avgDamage: n ? avgDamage / n : 0,
        cancerCount,
        diversity: this._computeDiversity(sumX, sumXX, counts, spCount),
        speedHist: Array.from(speedBuckets),
        metabHist: Array.from(metabBuckets),
        lineageCount: seenLineages.size,
        maxGeneration,
        eventLog: this.eventLog.slice(-5),
      };
    }

    /**
     * Reduce the per-trait sums into { mean, std, cv } snapshots.
     * Coefficient of variation (std/mean) is the unit-free diversity measure:
     * it collapses to ~0 under a hard bottleneck and rises as the population
     * explores trait space, so a falling CV visually flags a diversity crash.
     */
    _computeDiversity(sumX, sumXX, counts, spCount) {
      const out = {};
      const names = DIVERSITY.TRAITS;
      for (let t = 0; t < spCount; t++) {
        const c = counts[t];
        const name = names[t];
        if (c <= 1) {
          out[name] = { mean: c ? sumX[t] / c : 0, std: 0, cv: 0 };
          continue;
        }
        const mean = sumX[t] / c;
        // Population variance from sum(x) and sum(x^2).
        const variance = Math.max(0, sumXX[t] / c - mean * mean);
        const std = Math.sqrt(variance);
        out[name] = { mean, std, cv: mean > 1e-6 ? std / mean : 0 };
      }
      return out;
    }

    /// Export the current world state to a JSON string.
    exportState() {
      const entities = [];
      const n = ECS.activeCount;
      for (let i = 0; i < n; i++) {
        const id = active[i];
        const gOff = id * GENOME_LENGTH;
        const mOff = id * Genetics.MEMOME_LENGTH;
        entities.push({
          x: posX[id],
          y: posY[id],
          species: species[id],
          energy: energy[id],
          age: age[id],
          genome: Array.from(genome.subarray(gOff, gOff + GENOME_LENGTH)),
          memome: Array.from(memome.subarray(mOff, mOff + Genetics.MEMOME_LENGTH)),
          lineageId: lineageId[id],
          generation: generation[id],
          birthTick: birthTick[id],
          lineageOriginTick: lineageOriginTick[id],
          telomere: telomere[id],
          cellMass: cellMass[id],
          cellDamage: cellDamage[id],
          cancerous: cancerous[id],
          homeX: homeX[id],
          homeY: homeY[id],
        });
      }

      return JSON.stringify({
        version: 4,
        ticks: this.ticks,
        noiseSeed: this.noiseSeed,
        params: {
          initialAnts: this.initialAnts,
          initialHerbivores: this.initialHerbivores,
          initialPredators: this.initialPredators,
          initialAdvanced: this.initialAdvanced,
        },
        world: this.world.exportGrid(),
        entities,
        history: this.history,
        eventLog: this.eventLog,
      });
    }

    /// Inspect a single cell and return its state.
    inspectCell(x, y) {
      const wx = ((x % this.world.width) + this.world.width) % this.world.width;
      const wy = ((y % this.world.height) + this.world.height) % this.world.height;
      const idx = wy * this.world.width + wx;
      return {
        x: wx,
        y: wy,
        biome: this.world.biome[idx],
        temperature: this.world.temperature[idx],
        moisture: this.world.moisture[idx],
        plantBiomass: this.world.plantBiomass[idx],
        nutrients: this.world.nutrients[idx],
        pheromone: this.world.pheromone[idx],
        tileType: this.world.tileType[idx],
        antCount: this.world.antCount[idx],
        herbivoreCount: this.world.herbivoreCount[idx],
        predatorCount: this.world.predatorCount[idx],
        advancedCount: this.world.advancedCount[idx],
        organism: this._inspectOrganismAt(wx, wy),
      };
    }

    /**
     * Find the first living organism at (wx, wy) via the spatial hash and return
     * a snapshot of its cellular state for the inspect panel. Returns null when
     * the cell is empty.
     */
    _inspectOrganismAt(wx, wy) {
      this._interactScratch = this._interactScratch || [];
      this._interactScratch.length = 0;
      this.spatial.queryCell(wx, wy, this._interactScratch);
      for (let i = 0; i < this._interactScratch.length; i++) {
        const id = this._interactScratch[i];
        if (!alive[id]) continue;
        const sp = species[id];
        if (sp === SPECIES.NONE) continue;
        const pOff = id * PH.COUNT;
        const speciesNames = ["", "Ant", "Herbivore", "Predator", "Advanced"];
        return {
          speciesName: speciesNames[sp] || "Unknown",
          age: age[id],
          energy: energy[id],
          telomere: telomere[id],
          telomereCap: phenome[pOff + PH.TELOMERE_LENGTH],
          cellMass: cellMass[id],
          cellMassCap: phenome[pOff + PH.MAX_CELL_MASS],
          cellDamage: cellDamage[id],
          cancerous: cancerous[id] === 1,
        };
      }
      return null;
    }

    /// Import a world state from a JSON string.
    importState(json) {
      try {
        const data = JSON.parse(json);
        if (data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== 4) return false;

        ECS.reset();
        this.world.reset();
        this.spatial.clear();
        this.ticks = data.ticks || 0;
        this.eventLog = data.eventLog || [];
        this.history = data.history || {
          ticks: [], ants: [], herbivores: [], predators: [], advanced: [], plants: [],
        };
        this.noiseSeed = data.noiseSeed || Math.floor(Math.random() * 1000000);

        if (data.params) {
          this.initialAnts = data.params.initialAnts || 800;
          this.initialHerbivores = data.params.initialHerbivores || 800;
          this.initialPredators = data.params.initialPredators || 200;
          this.initialAdvanced = data.params.initialAdvanced || 100;
        }

        if (data.world) {
          this.world.importGrid(data.world);
        } else {
          this.world.generateBiomes(this.noiseSeed);
        }

        for (const e of data.entities) {
          const sp = e.species;
          // Older saves carry shorter genomes (fewer genes / smaller NN). Copy
          // what exists and backfill the tail with species-typical defaults so
          // new loci get sane values instead of NaN.
          const srcGenome = e.genome || [];
          const g = new Float64Array(GENOME_LENGTH);
          for (let i = 0; i < Math.min(srcGenome.length, GENOME_LENGTH); i++) {
            g[i] = srcGenome[i];
          }
          if (srcGenome.length < GENOME_LENGTH) {
            const fallback = createSpeciesGenome(sp);
            for (let i = srcGenome.length; i < GENOME_LENGTH; i++) {
              g[i] = fallback[i];
            }
          }
          const hasLineage = data.version >= 2 && e.lineageId;
          const id = create(e.x, e.y, sp, e.energy, g, hasLineage ? {
            parentId: 0,
            parentLineageId: e.lineageId,
            parentGen: e.generation || 0,
            birthTick: e.birthTick || 0,
            parentOriginTick: e.lineageOriginTick || 0,
          } : undefined);
          if (id >= 0) {
            age[id] = e.age || 0;
            // Cellular state: restore from save (v3+) or fall back to
            // the freshly-initialized values from create().
            if (data.version >= 3) {
              telomere[id] = e.telomere != null ? e.telomere : telomere[id];
              cellMass[id] = e.cellMass != null ? e.cellMass : cellMass[id];
              cellDamage[id] = e.cellDamage != null ? e.cellDamage : 0;
              cancerous[id] = e.cancerous || 0;
            }
            // Colony home (v4+); older saves default to the spawn position,
            // which create() already assigned.
            if (data.version >= 4 && e.homeX != null && e.homeY != null) {
              homeX[id] = e.homeX;
              homeY[id] = e.homeY;
            }
            const mOff = id * Genetics.MEMOME_LENGTH;
            const eMemome = e.memome || [];
            for (let i = 0; i < Math.min(eMemome.length, Genetics.MEMOME_LENGTH); i++) {
              memome[mOff + i] = eMemome[i];
            }
            this.world.addOrganism(e.x, e.y, sp);
          }
        }

        this.spatial.rebuild();
        return true;
      } catch (err) {
        console.error("Failed to import world state:", err);
        return false;
      }
    }
  }

  return { SimulationEngine };
})();
