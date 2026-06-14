/**
 * Simulation engine: drives the tick loop for movement, eating,
 * metabolism, reproduction, mutation, and death.
 */

const Simulation = (function () {
  const { WorldGrid, WIDTH, HEIGHT, MAX_ANTS_PER_CELL } = World;
  const AntClass = Ant.Ant;
  const { createRandomGenome, cloneGenome, mutate } = Genetics;

  const INITIAL_ANTS = 2000;
  const INITIAL_FOOD_PATCHES = 30;
  const FOOD_PATCH_RADIUS = 5;
  const FOOD_PATCH_DENSITY = 0.35;
  const FOOD_SPAWN_RATE = 0.02; // chance per tick to start a new patch
  const FOOD_FLOOR_CELLS = 200; // guaranteed patch if food falls below this
  const SCATTERED_FOOD_CELLS = 20; // random cells sprinkled with food each tick
  const SCATTERED_FOOD_AMOUNT = 120;

  class SimulationEngine {
    constructor() {
      this.world = new WorldGrid();
      this.ants = [];
      this.ticks = 0;
      this.running = true;
      this.speed = 1; // simulation ticks per animation frame
      this.reset();
    }

    reset() {
      this.world.reset();
      this.ants = [];
      this.ticks = 0;

      // Seed food.
      for (let i = 0; i < INITIAL_FOOD_PATCHES; i++) {
        this.spawnRandomFoodPatch();
      }

      // Seed ants at random locations.
      for (let i = 0; i < INITIAL_ANTS; i++) {
        const x = Math.floor(Math.random() * WIDTH);
        const y = Math.floor(Math.random() * HEIGHT);
        if (this.world.addAnt(x, y)) {
          this.ants.push(new AntClass(x, y, createRandomGenome()));
        }
      }
    }

    spawnRandomFoodPatch() {
      const cx = Math.floor(Math.random() * WIDTH);
      const cy = Math.floor(Math.random() * HEIGHT);
      this.world.spawnFoodPatch(cx, cy, FOOD_PATCH_RADIUS, FOOD_PATCH_DENSITY);
    }

    spawnScatteredFood() {
      for (let i = 0; i < SCATTERED_FOOD_CELLS; i++) {
        const x = Math.floor(Math.random() * WIDTH);
        const y = Math.floor(Math.random() * HEIGHT);
        this.world.addFood(x, y, SCATTERED_FOOD_AMOUNT);
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

      // Natural food spawn: patches plus scattered background crumbs.
      if (Math.random() < FOOD_SPAWN_RATE || this.world.foodCellCount() < FOOD_FLOOR_CELLS) {
        this.spawnRandomFoodPatch();
      }
      this.spawnScatteredFood();

      // Randomize processing order to avoid directional bias.
      this.shuffleAnts();

      const ants = this.ants;
      const world = this.world;
      const nextAnts = [];

      for (let i = 0; i < ants.length; i++) {
        const ant = ants[i];

        // 1. Sense and move.
        this.moveAnt(ant);

        // 2. Eat if on food.
        const foodHere = world.getFood(ant.x, ant.y);
        if (foodHere > 0) {
          const bite = 2 * ant.pFoodEfficiency;
          const eaten = world.takeFood(ant.x, ant.y, bite);
          ant.energy += eaten;
        }

        // 3. Metabolize and age.
        ant.energy -= ant.pMetabolism;
        ant.age++;

        // 4. Death.
        if (ant.energy <= 0 || ant.age > ant.pLongevity) {
          world.removeAnt(ant.x, ant.y);
          continue; // drop from nextAnts
        }

        nextAnts.push(ant);

        // 5. Reproduce (asexual budding with mutation).
        if (ant.energy > ant.pReproThreshold + 25) {
          const child = this.tryReproduce(ant);
          if (child) {
            nextAnts.push(child);
          }
        }
      }

      this.ants = nextAnts;
    }

    moveAnt(ant) {
      const world = this.world;

      // 1. Choose a primary movement vector.
      let dx = 0;
      let dy = 0;
      if (Math.random() < ant.pTurnBias) {
        dx = Math.floor(Math.random() * 3) - 1;
        dy = Math.floor(Math.random() * 3) - 1;
      } else {
        const target = world.findBestFood(ant.x, ant.y, ant.pSenseRange);
        if (target) {
          dx = Math.sign(target.x - ant.x);
          dy = Math.sign(target.y - ant.y);
        } else if (Math.random() < ant.pExploreBias) {
          const dir = Math.floor(Math.random() * 8);
          dx = (dir % 3) - 1;
          dy = Math.floor(dir / 3) - 1;
          if (dx === 0 && dy === 0) dx = 1;
        } else {
          dx = Math.floor(Math.random() * 3) - 1;
          dy = Math.floor(Math.random() * 3) - 1;
        }
      }

      if (dx === 0 && dy === 0) return;

      // 2. Speed determines number of grid steps this tick (max 3).
      let steps = Math.floor(ant.pSpeed);
      if (Math.random() < ant.pSpeed - steps) steps++;
      steps = Math.max(1, Math.min(steps, 3));

      let nx = ant.x;
      let ny = ant.y;
      let moved = false;

      for (let s = 0; s < steps; s++) {
        const tx = ((nx + dx) + WIDTH) % WIDTH;
        const ty = ((ny + dy) + HEIGHT) % HEIGHT;

        if (world.getAntCount(tx, ty) < MAX_ANTS_PER_CELL) {
          if (!moved) {
            world.removeAnt(nx, ny);
            moved = true;
          }
          world.addAnt(tx, ty);
          nx = tx;
          ny = ty;
        } else {
          // Blocked: try a random alternative direction once.
          const alt = this.randomDirection();
          const ax = ((nx + alt.dx) + WIDTH) % WIDTH;
          const ay = ((ny + alt.dy) + HEIGHT) % HEIGHT;
          if (world.getAntCount(ax, ay) < MAX_ANTS_PER_CELL) {
            if (!moved) {
              world.removeAnt(nx, ny);
              moved = true;
            }
            world.addAnt(ax, ay);
            nx = ax;
            ny = ay;
          } else {
            break; // fully blocked
          }
        }
      }

      if (moved) {
        ant.x = nx;
        ant.y = ny;
      }
    }

    randomDirection() {
      // Exclude the (0,0) stay direction.
      const dir = Math.floor(Math.random() * 8);
      return {
        dx: (dir % 3) - 1,
        dy: Math.floor(dir / 3) - 1,
      };
    }

    tryReproduce(parent) {
      const world = this.world;
      // Find an empty or available adjacent cell for the child.
      const candidates = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = ((parent.x + dx) + WIDTH) % WIDTH;
          const ty = ((parent.y + dy) + HEIGHT) % HEIGHT;
          if (world.getAntCount(tx, ty) < MAX_ANTS_PER_CELL) {
            candidates.push({ x: tx, y: ty });
          }
        }
      }
      if (candidates.length === 0) return null;

      const spot = candidates[Math.floor(Math.random() * candidates.length)];
      const childGenome = cloneGenome(parent.genome);
      mutate(childGenome, parent.pMutability);
      mutate(parent.genome, parent.pMutability * 0.3);
      parent.refresh();

      const child = new AntClass(spot.x, spot.y, childGenome);
      child.energy = 25;
      parent.energy -= 35;

      world.addAnt(spot.x, spot.y);
      return child;
    }

    shuffleAnts() {
      const arr = this.ants;
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }

    stats() {
      const ants = this.ants;
      const n = ants.length;
      if (n === 0) {
        return {
          ticks: this.ticks,
          ants: 0,
          foodCells: 0,
          speed: 0,
          sense: 0,
          metabolism: 0,
          repro: 0,
          mutability: 0,
        };
      }

      let speed = 0,
        sense = 0,
        metabolism = 0,
        repro = 0,
        mutability = 0;
      for (let i = 0; i < n; i++) {
        const a = ants[i];
        speed += a.pSpeed;
        sense += a.pSenseRange;
        metabolism += a.pMetabolism;
        repro += a.pReproThreshold;
        mutability += a.pMutability;
      }

      return {
        ticks: this.ticks,
        ants: n,
        foodCells: this.world.foodCellCount(),
        speed: speed / n,
        sense: sense / n,
        metabolism: metabolism / n,
        repro: repro / n,
        mutability: mutability / n,
      };
    }
  }

  return { SimulationEngine };
})();
