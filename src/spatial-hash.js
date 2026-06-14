/**
 * Fixed-grid spatial hash for fast neighbor queries on a toroidal world.
 *
 * Entities are binned by grid cell. Neighbor queries only scan the entity's
 * bucket and the surrounding buckets, giving O(1) average lookup cost.
 */

const SpatialHash = (function () {
  // Bucket size in world cells. Should be at least the maximum sense radius
  // to guarantee that any entity within range lives in the same or an adjacent
  // bucket. The current max sense radius is 10, so 32 is comfortable.
  const BUCKET_SIZE = 32;

  function createSpatialHash(worldWidth, worldHeight, ecs) {
    const cols = Math.ceil(worldWidth / BUCKET_SIZE);
    const rows = Math.ceil(worldHeight / BUCKET_SIZE);
    const bucketCount = cols * rows;
    const buckets = new Array(bucketCount);
    for (let i = 0; i < bucketCount; i++) {
      buckets[i] = [];
    }

    function bucketIndex(x, y) {
      const bx = Math.floor(x / BUCKET_SIZE) % cols;
      const by = Math.floor(y / BUCKET_SIZE) % rows;
      return (by + rows) % rows * cols + (bx + cols) % cols;
    }

    function clear() {
      for (let i = 0; i < bucketCount; i++) {
        buckets[i].length = 0;
      }
    }

    function insert(id, x, y) {
      buckets[bucketIndex(x, y)].push(id);
    }

    function remove(id, x, y) {
      const list = buckets[bucketIndex(x, y)];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] === id) {
          list.splice(i, 1);
          return;
        }
      }
    }

    function move(id, oldX, oldY, newX, newY) {
      const oldIdx = bucketIndex(oldX, oldY);
      const newIdx = bucketIndex(newX, newY);
      if (oldIdx === newIdx) return;
      const list = buckets[oldIdx];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] === id) {
          list.splice(i, 1);
          break;
        }
      }
      buckets[newIdx].push(id);
    }

    /**
     * Append all entity ids near (x, y) within radius cells into `out`.
     * Uses square bounding-box bucket coverage; caller can filter by distance.
     */
    function queryRadius(x, y, radius, out) {
      const minBx = Math.floor((x - radius) / BUCKET_SIZE);
      const maxBx = Math.floor((x + radius) / BUCKET_SIZE);
      const minBy = Math.floor((y - radius) / BUCKET_SIZE);
      const maxBy = Math.floor((y + radius) / BUCKET_SIZE);

      const r2 = radius * radius;
      const posX = ecs.posX;
      const posY = ecs.posY;
      const alive = ecs.alive;

      for (let by = minBy; by <= maxBy; by++) {
        for (let bx = minBx; bx <= maxBx; bx++) {
          const b = buckets[((by + rows) % rows) * cols + ((bx + cols) % cols)];
          for (let i = 0; i < b.length; i++) {
            const id = b[i];
            if (!alive[id]) continue;
            const dx = Math.abs(posX[id] - x);
            const dy = Math.abs(posY[id] - y);
            // Account for toroidal wrap in distance check.
            const wdx = Math.min(dx, worldWidth - dx);
            const wdy = Math.min(dy, worldHeight - dy);
            if (wdx * wdx + wdy * wdy <= r2) {
              out.push(id);
            }
          }
        }
      }
    }

    /**
     * Append all entity ids in the same bucket as (x, y).
     */
    function queryCell(x, y, out) {
      const b = buckets[bucketIndex(x, y)];
      const alive = ecs.alive;
      for (let i = 0; i < b.length; i++) {
        const id = b[i];
        if (alive[id]) out.push(id);
      }
    }

    /**
     * Count entities of a specific species within radius.
     */
    function countSpecies(x, y, radius, sp) {
      const minBx = Math.floor((x - radius) / BUCKET_SIZE);
      const maxBx = Math.floor((x + radius) / BUCKET_SIZE);
      const minBy = Math.floor((y - radius) / BUCKET_SIZE);
      const maxBy = Math.floor((y + radius) / BUCKET_SIZE);

      const r2 = radius * radius;
      const posX = ecs.posX;
      const posY = ecs.posY;
      const alive = ecs.alive;
      const species = ecs.species;
      let count = 0;

      for (let by = minBy; by <= maxBy; by++) {
        for (let bx = minBx; bx <= maxBx; bx++) {
          const b = buckets[((by + rows) % rows) * cols + ((bx + cols) % cols)];
          for (let i = 0; i < b.length; i++) {
            const id = b[i];
            if (!alive[id] || species[id] !== sp) continue;
            const dx = Math.abs(posX[id] - x);
            const dy = Math.abs(posY[id] - y);
            const wdx = Math.min(dx, worldWidth - dx);
            const wdy = Math.min(dy, worldHeight - dy);
            if (wdx * wdx + wdy * wdy <= r2) count++;
          }
        }
      }
      return count;
    }

    /**
     * Rebuild the spatial hash from scratch using all active entities.
     */
    function rebuild() {
      clear();
      const active = ecs.active;
      const n = ecs.activeCount;
      const posX = ecs.posX;
      const posY = ecs.posY;
      for (let i = 0; i < n; i++) {
        const id = active[i];
        insert(id, posX[id], posY[id]);
      }
    }

    return {
      BUCKET_SIZE,
      cols,
      rows,
      clear,
      insert,
      remove,
      move,
      queryRadius,
      queryCell,
      countSpecies,
      rebuild,
    };
  }

  return { createSpatialHash, BUCKET_SIZE };
})();
