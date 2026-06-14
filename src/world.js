/**
 * World state: 1000x1000 grid, food, ant density tracking,
 * and helper functions for sensing / spawning.
 */

const World = (function () {
  const WIDTH = 1000;
  const HEIGHT = 1000;
  const MAX_ANTS_PER_CELL = 5;
  const FOOD_CAPACITY = 1000; // touches before gone

  class WorldGrid {
    constructor() {
      this.width = WIDTH;
      this.height = HEIGHT;
      this.area = WIDTH * HEIGHT;
      this.food = new Uint16Array(this.area); // 0..FOOD_CAPACITY
      this.antCount = new Uint8Array(this.area); // 0..MAX_ANTS_PER_CELL
    }

    idx(x, y) {
      // Wrap edges for a toroidal world.
      x = ((x | 0) + this.width) % this.width;
      y = ((y | 0) + this.height) % this.height;
      return y * this.width + x;
    }

    getFood(x, y) {
      return this.food[this.idx(x, y)];
    }

    setFood(x, y, value) {
      this.food[this.idx(x, y)] = Math.max(0, Math.min(FOOD_CAPACITY, value | 0));
    }

    addFood(x, y, amount) {
      const i = this.idx(x, y);
      const v = this.food[i] + (amount | 0);
      this.food[i] = v > FOOD_CAPACITY ? FOOD_CAPACITY : v;
    }

    takeFood(x, y, amount) {
      const i = this.idx(x, y);
      const take = Math.min(this.food[i], amount);
      this.food[i] -= take;
      return take;
    }

    getAntCount(x, y) {
      return this.antCount[this.idx(x, y)];
    }

    addAnt(x, y) {
      const i = this.idx(x, y);
      if (this.antCount[i] < MAX_ANTS_PER_CELL) {
        this.antCount[i]++;
        return true;
      }
      return false;
    }

    removeAnt(x, y) {
      const i = this.idx(x, y);
      if (this.antCount[i] > 0) {
        this.antCount[i]--;
      }
    }

    /**
     * Spawn a roughly circular food patch centered at (cx, cy).
     */
    spawnFoodPatch(cx, cy, radius, density) {
      const r2 = radius * radius;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= r2 && Math.random() < density) {
            this.addFood(cx + dx, cy + dy, FOOD_CAPACITY);
          }
        }
      }
    }

    /**
     * Count total food in the world.
     */
    totalFood() {
      let sum = 0;
      for (let i = 0; i < this.area; i++) sum += this.food[i];
      return sum;
    }

    /**
     * Count cells that contain any food.
     */
    foodCellCount() {
      let count = 0;
      for (let i = 0; i < this.area; i++) {
        if (this.food[i] > 0) count++;
      }
      return count;
    }

    /**
     * Find the strongest nearby food within a square sense radius.
     * Returns {x, y, food} or null.
     */
    findBestFood(x, y, radius) {
      let bestX = 0,
        bestY = 0,
        bestF = -1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const f = this.getFood(x + dx, y + dy);
          if (f > bestF) {
            bestF = f;
            bestX = x + dx;
            bestY = y + dy;
          }
        }
      }
      return bestF > 0 ? { x: bestX, y: bestY, food: bestF } : null;
    }

    reset() {
      this.food.fill(0);
      this.antCount.fill(0);
    }
  }

  return {
    WIDTH,
    HEIGHT,
    MAX_ANTS_PER_CELL,
    FOOD_CAPACITY,
    WorldGrid,
  };
})();
