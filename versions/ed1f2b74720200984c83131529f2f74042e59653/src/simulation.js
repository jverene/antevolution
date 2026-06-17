/**
 * Simulation engine: ECS tick loop for movement, grazing, predation,
 * aggression, metabolism, reproduction, mutation, biome forcing,
 * culture, reputation, and environmental modification.
 */

const Simulation = (function () {
  const { WorldGrid, WIDTH, HEIGHT, MAX_ORGANISMS_PER_CELL, SPECIES, BIOME, TILE } = World;
  const { GENOME_LENGTH, BASE_GENOME_LENGTH, PH, NN, NN_OUT, NN_INPUT, createSpeciesGenome, cloneGenome, mutate, crossover, copyMemome, createMemome, computeNNOutputs } = Genetics;
  const { posX, posY, energy, age, species, alive, torpor, genome, phenome, memome, active, create, destroy, cleanup, refreshPhenome, setReputation, getReputation } = ECS;

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
      this.randomizeParams();
      this.reset();
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

      this.world.generateBiomes(this.noiseSeed);
      this.world.seedNutrients(this.nutrientSeedDensity, this.nutrientSeedMin, this.nutrientSeedMax);

      for (let i = 0; i < this.initialPlantPatches; i++) {
        this.spawnRandomPlantPatch();
      }
      this.seedScatteredNutrients();

      this.seedSpecies(SPECIES.ANT, this.initialAnts);
      this.seedSpecies(SPECIES.HERBIVORE, this.initialHerbivores);
      this.seedSpecies(SPECIES.PREDATOR, this.initialPredators);
      this.seedSpecies(SPECIES.ADVANCED, this.initialAdvanced);

      this.spatial.rebuild();
    }

    seedSpecies(sp, count) {
      for (let i = 0; i < count; i++) {
        const x = Math.floor(Math.random() * WIDTH);
        const y = Math.floor(Math.random() * HEIGHT);
        if (this.world.addOrganism(x, y, sp)) {
          const g = createSpeciesGenome(sp);
          const startEnergy = sp === SPECIES.ADVANCED ? 60 + Math.random() * 40 : 40 + Math.random() * 40;
          const id = create(x, y, sp, startEnergy, g);
          if (id >= 0) {
            // Advanced agents start with no cultural knowledge; innovation must arise and spread.
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

        if (age[id] % 20 === 0 && energy[id] > phenome[id * PH.COUNT + PH.REPRO_THRESHOLD] + 25) {
          this.tryReproduce(id);
        }
      }

      cleanup();
      this.spatial.rebuild();
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

      // Scan modified tiles.
      let shx = 0, shy = 0, fmx = 0, fmy = 0;
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
        }
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

      // Score is alignment with desired direction plus exploration noise.
      let score = desiredDx * ux + desiredDy * uy;
      score += ph[pOff + PH.W_EXPLORE] * nn[no.EXPLORE_BOOST] * (Math.random() - 0.5) * 0.5;

      // Penalize staying still to keep agents moving.
      if (dx === 0 && dy === 0) score -= 0.5;

      return score;
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

      if (energy[id] <= 0 || age[id] > ph[pOff + PH.LONGEVITY]) {
        alive[id] = 0;
        this.world.removeOrganism(x, y, species[id]);
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

      const mateId = this.findMate(parentId, px, py, sp);

      const spot = candidates[Math.floor(Math.random() * candidates.length)];
      if (!this.world.addOrganism(spot.x, spot.y, sp)) return;

      const parentGenome = genome.subarray(parentId * GENOME_LENGTH, (parentId + 1) * GENOME_LENGTH);
      const childGenome = cloneGenome(parentGenome);
      const pMut = phenome[parentId * PH.COUNT + PH.MUTABILITY];

      if (mateId >= 0) {
        // Sexual reproduction: meiotic crossover with a nearby mate.
        const mateGenome = genome.subarray(mateId * GENOME_LENGTH, (mateId + 1) * GENOME_LENGTH);
        crossover(parentGenome, mateGenome, childGenome);
      }
      // If no mate is available, fall back to asexual cloning (apomixis).

      mutate(childGenome, pMut);
      mutate(parentGenome, pMut * 0.3);
      refreshPhenome(parentId);

      const childId = create(spot.x, spot.y, sp, 25, childGenome);
      if (childId < 0) {
        this.world.removeOrganism(spot.x, spot.y, sp);
        return;
      }

      // Inherit memome from parent with small innovation (vertical cultural transmission).
      const cOff = childId * Genetics.MEMOME_LENGTH;
      const pOff = parentId * Genetics.MEMOME_LENGTH;
      for (let i = 0; i < Genetics.MEMOME_LENGTH; i++) {
        memome[cOff + i] = memome[pOff + i] + (Math.random() - 0.5) * 0.02;
      }

      energy[parentId] -= 35;
    }

    // Aggregate statistics for the UI.
    stats() {
      let ants = 0, herbivores = 0, predators = 0, advanced = 0;
      let speed = 0, sense = 0, metabolism = 0, repro = 0, mutability = 0, aggression = 0;
      let thermal = 0, sociality = 0, wFood = 0, wFlee = 0, wShelter = 0, wFarm = 0;
      const n = ECS.activeCount;

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
        eventLog: this.eventLog.slice(-5),
      };
    }
  }

  return { SimulationEngine };
})();