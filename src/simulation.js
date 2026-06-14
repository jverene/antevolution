/**
 * Simulation engine: drives the tick loop for movement, grazing,
 * predation, metabolism, reproduction, mutation, and death across
 * multiple species.
 */

const Simulation = (function () {
  const { WorldGrid, WIDTH, HEIGHT, MAX_ORGANISMS_PER_CELL, SPECIES } = World;
  const OrganismClass = Organism.Organism;
  const { createSpeciesGenome, cloneGenome, mutate } = Genetics;

  const PARAM_RANGES = {
    initialAnts: { min: 600, max: 3000 },
    initialHerbivores: { min: 300, max: 1500 },
    initialPredators: { min: 40, max: 200 },
    initialPlantPatches: { min: 15, max: 60 },
    plantPatchRadius: { min: 4, max: 10 },
    plantPatchDensity: { min: 0.25, max: 0.65 },
    nutrientSeedDensity: { min: 0.015, max: 0.045 },
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
      this.organisms = [];
      this.ticks = 0;
      this.running = true;
      this.speed = 1; // simulation ticks per animation frame
      this.randomizeParams();
      this.reset();
    }

    randomizeParams() {
      this.initialAnts = randInt(PARAM_RANGES.initialAnts.min, PARAM_RANGES.initialAnts.max);
      this.initialHerbivores = randInt(PARAM_RANGES.initialHerbivores.min, PARAM_RANGES.initialHerbivores.max);
      this.initialPredators = randInt(PARAM_RANGES.initialPredators.min, PARAM_RANGES.initialPredators.max);
      this.initialPlantPatches = randInt(PARAM_RANGES.initialPlantPatches.min, PARAM_RANGES.initialPlantPatches.max);
      this.plantPatchRadius = randInt(PARAM_RANGES.plantPatchRadius.min, PARAM_RANGES.plantPatchRadius.max);
      this.plantPatchDensity = randFloat(PARAM_RANGES.plantPatchDensity.min, PARAM_RANGES.plantPatchDensity.max);
      this.nutrientSeedDensity = randFloat(PARAM_RANGES.nutrientSeedDensity.min, PARAM_RANGES.nutrientSeedDensity.max);
      this.nutrientSeedMin = randInt(PARAM_RANGES.nutrientSeedMin.min, PARAM_RANGES.nutrientSeedMin.max);
      this.nutrientSeedMax = randInt(PARAM_RANGES.nutrientSeedMax.min, PARAM_RANGES.nutrientSeedMax.max);
      this.scatteredNutrientCells = randInt(PARAM_RANGES.scatteredNutrientCells.min, PARAM_RANGES.scatteredNutrientCells.max);
      this.scatteredNutrientAmount = randInt(PARAM_RANGES.scatteredNutrientAmount.min, PARAM_RANGES.scatteredNutrientAmount.max);
    }

    reset() {
      this.world.reset();
      this.organisms = [];
      this.ticks = 0;
      this.randomizeParams();

      // Seed baseline nutrients so the world isn't permanently barren.
      this.world.seedNutrients(
        this.nutrientSeedDensity,
        this.nutrientSeedMin,
        this.nutrientSeedMax
      );

      // Seed plant patches.
      for (let i = 0; i < this.initialPlantPatches; i++) {
        this.spawnRandomPlantPatch();
      }

      // Seed scattered nutrient hotspots for background regrowth.
      this.seedScatteredNutrients();

      // Seed ants.
      this.seedSpecies(SPECIES.ANT, this.initialAnts);
      // Seed herbivores.
      this.seedSpecies(SPECIES.HERBIVORE, this.initialHerbivores);
      // Seed predators.
      this.seedSpecies(SPECIES.PREDATOR, this.initialPredators);
    }

    seedSpecies(species, count) {
      for (let i = 0; i < count; i++) {
        const x = Math.floor(Math.random() * WIDTH);
        const y = Math.floor(Math.random() * HEIGHT);
        if (this.world.addOrganism(x, y, species)) {
          this.organisms.push(new OrganismClass(x, y, species, createSpeciesGenome(species)));
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

    /**
     * Run one simulation tick.
     */
    tick() {
      this.ticks++;
      const world = this.world;

      // 1. Ecology: plants regrow from nutrients.
      world.growPlants();

      // 2. Occasional new plant patches and nutrient hotspots.
      if (Math.random() < 0.02 || world.plantCellCount() < 200) {
        this.spawnRandomPlantPatch();
      }
      if (Math.random() < 0.03) {
        this.seedScatteredNutrients();
      }

      // 3. Randomize processing order to avoid directional bias.
      this.shuffleOrganisms();

      const organisms = this.organisms;
      const nextOrganisms = [];

      for (let i = 0; i < organisms.length; i++) {
        const org = organisms[i];
        if (org.dead) continue;

        // 4. Sense and move.
        this.moveOrganism(org);

        // 5. Feed.
        if (org.species === SPECIES.PREDATOR) {
          org.energy += this.attemptPredation(org);
        } else {
          // Ants and herbivores graze on plants.
          const plantsHere = world.getPlantBiomass(org.x, org.y);
          if (plantsHere > 0) {
            const bite = 2 * org.pFoodEfficiency;
            const eaten = world.takePlantBiomass(org.x, org.y, bite);
            org.energy += eaten;
          }
        }

        // 6. Metabolize and age.
        org.energy -= org.pMetabolism;
        org.age++;

        // 7. Death.
        if (org.energy <= 0 || org.age > org.pLongevity) {
          world.removeOrganism(org.x, org.y, org.species);
          continue;
        }

        nextOrganisms.push(org);

        // 8. Reproduce (asexual budding, same species, with mutation).
        if (org.energy > org.pReproThreshold + 25) {
          const child = this.tryReproduce(org);
          if (child) {
            nextOrganisms.push(child);
          }
        }
      }

      this.organisms = nextOrganisms;
    }

    moveOrganism(org) {
      const world = this.world;

      // 1. Choose a primary movement vector.
      let dx = 0;
      let dy = 0;

      if (Math.random() < org.pTurnBias) {
        dx = Math.floor(Math.random() * 3) - 1;
        dy = Math.floor(Math.random() * 3) - 1;
      } else if (org.species === SPECIES.PREDATOR) {
        const target = world.findBestPrey(org.x, org.y, org.pSenseRange);
        if (target) {
          dx = Math.sign(target.x - org.x);
          dy = Math.sign(target.y - org.y);
        } else if (Math.random() < org.pExploreBias) {
          const dir = this.randomDirection();
          dx = dir.dx;
          dy = dir.dy;
        } else {
          dx = Math.floor(Math.random() * 3) - 1;
          dy = Math.floor(Math.random() * 3) - 1;
        }
      } else {
        // Ants and herbivores forage for plants.
        const target = world.findBestPlants(org.x, org.y, org.pSenseRange);
        if (target) {
          dx = Math.sign(target.x - org.x);
          dy = Math.sign(target.y - org.y);
        } else if (Math.random() < org.pExploreBias) {
          const dir = this.randomDirection();
          dx = dir.dx;
          dy = dir.dy;
        } else {
          dx = Math.floor(Math.random() * 3) - 1;
          dy = Math.floor(Math.random() * 3) - 1;
        }
      }

      if (dx === 0 && dy === 0) return;

      // 2. Speed determines number of grid steps this tick (max 3).
      let steps = Math.floor(org.pSpeed);
      if (Math.random() < org.pSpeed - steps) steps++;
      steps = Math.max(1, Math.min(steps, 3));

      let nx = org.x;
      let ny = org.y;
      let moved = false;

      for (let s = 0; s < steps; s++) {
        const tx = ((nx + dx) + WIDTH) % WIDTH;
        const ty = ((ny + dy) + HEIGHT) % HEIGHT;

        if (world.getTotalOrganisms(tx, ty) < MAX_ORGANISMS_PER_CELL) {
          if (!moved) {
            world.removeOrganism(nx, ny, org.species);
            moved = true;
          }
          world.addOrganism(tx, ty, org.species);
          nx = tx;
          ny = ty;
        } else {
          // Blocked: try a random alternative direction once.
          const alt = this.randomDirection();
          const ax = ((nx + alt.dx) + WIDTH) % WIDTH;
          const ay = ((ny + alt.dy) + HEIGHT) % HEIGHT;
          if (world.getTotalOrganisms(ax, ay) < MAX_ORGANISMS_PER_CELL) {
            if (!moved) {
              world.removeOrganism(nx, ny, org.species);
              moved = true;
            }
            world.addOrganism(ax, ay, org.species);
            nx = ax;
            ny = ay;
          } else {
            break; // fully blocked
          }
        }
      }

      if (moved) {
        org.x = nx;
        org.y = ny;
      }
    }

    randomDirection() {
      // 8-way movement, excluding the (0,0) stay direction.
      const dir = Math.floor(Math.random() * 8);
      const dx = (dir % 3) - 1;
      const dy = Math.floor(dir / 3) - 1;
      if (dx === 0 && dy === 0) {
        // dir === 4 maps to (0,0); bump it to (1,0).
        return { dx: 1, dy: 0 };
      }
      return { dx, dy };
    }

    /**
     * Predators attempt to catch prey in their current cell.
     * Returns energy gained (0 if no catch).
     */
    attemptPredation(predator) {
      if (predator.species !== SPECIES.PREDATOR) return 0;
      const world = this.world;
      const x = predator.x;
      const y = predator.y;
      const antCount = world.getOrganismCount(x, y, SPECIES.ANT);
      const herbCount = world.getOrganismCount(x, y, SPECIES.HERBIVORE);
      if (antCount + herbCount === 0) return 0;

      // Choose prey species weighted by local abundance.
      const preySpecies = Math.random() < antCount / (antCount + herbCount) ? SPECIES.ANT : SPECIES.HERBIVORE;

      // Find a living prey organism at this location.
      const prey = this.findLivingPreyAt(x, y, preySpecies);
      if (!prey) return 0;

      // Catch chance depends on speed advantage, predator aggression,
      // and prey defense (aggression + nearby allies via sociality).
      const nearbyAllies = world.getOrganismCount(x, y, prey.species) - 1;
      const preyDefense = prey.pAggression + prey.pSociality * 0.5 + nearbyAllies * 0.15;
      const speedAdvantage = predator.pSpeed / Math.max(0.1, prey.pSpeed);
      const aggressionAdvantage = predator.pAggression / Math.max(0.1, preyDefense + 1);
      const catchChance = Math.min(0.85, 0.2 + speedAdvantage * 0.22 + aggressionAdvantage * 0.22);

      if (Math.random() < catchChance) {
        const energyGain = 28 * predator.pFoodEfficiency;
        prey.dead = true;
        world.removeOrganism(prey.x, prey.y, prey.species);
        return energyGain;
      }
      return 0;
    }

    /**
     * Scan for a living prey organism of the given species at (x, y).
     * Starts at a random offset to avoid always killing the same individual.
     */
    findLivingPreyAt(x, y, species) {
      const organisms = this.organisms;
      const n = organisms.length;
      if (n === 0) return null;
      let idx = Math.floor(Math.random() * n);
      for (let k = 0; k < n; k++) {
        const org = organisms[(idx + k) % n];
        if (!org.dead && org.species === species && org.x === x && org.y === y) {
          return org;
        }
      }
      return null;
    }

    tryReproduce(parent) {
      const world = this.world;
      // Find an empty or available adjacent cell for the child.
      const candidates = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = ((parent.x + dx) + WIDTH) % WIDTH;
          const ty = ((parent.y + dy) + HEIGHT) % HEIGHT;
          if (world.getTotalOrganisms(tx, ty) < MAX_ORGANISMS_PER_CELL) {
            candidates.push({ x: tx, y: ty });
          }
        }
      }
      if (candidates.length === 0) return null;

      const spot = candidates[Math.floor(Math.random() * candidates.length)];
      const childGenome = cloneGenome(parent.genome);
      mutate(childGenome, parent.pMutability);
      mutate(parent.genome, parent.pMutability * 0.3); // parent also mutates slightly (somatic / late-life)
      parent.refresh();

      const child = new OrganismClass(spot.x, spot.y, parent.species, childGenome);
      child.energy = 25;
      parent.energy -= 35;

      world.addOrganism(spot.x, spot.y, parent.species);
      return child;
    }

    shuffleOrganisms() {
      const arr = this.organisms;
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }

    // Aggregate statistics for the UI.
    stats() {
      const organisms = this.organisms;
      const n = organisms.length;
      let ants = 0,
        herbivores = 0,
        predators = 0;
      let speed = 0,
        sense = 0,
        metabolism = 0,
        repro = 0,
        mutability = 0,
        aggression = 0;

      for (let i = 0; i < n; i++) {
        const a = organisms[i];
        if (a.species === SPECIES.ANT) ants++;
        else if (a.species === SPECIES.HERBIVORE) herbivores++;
        else if (a.species === SPECIES.PREDATOR) predators++;

        speed += a.pSpeed;
        sense += a.pSenseRange;
        metabolism += a.pMetabolism;
        repro += a.pReproThreshold;
        mutability += a.pMutability;
        aggression += a.pAggression;
      }

      return {
        ticks: this.ticks,
        ants,
        herbivores,
        predators,
        plantCells: this.world.plantCellCount(),
        speed: n ? speed / n : 0,
        sense: n ? sense / n : 0,
        metabolism: n ? metabolism / n : 0,
        repro: n ? repro / n : 0,
        mutability: n ? mutability / n : 0,
        aggression: n ? aggression / n : 0,
      };
    }
  }

  return { SimulationEngine };
})();
