/**
 * Minimal Entity Component System with Structure-of-Arrays storage.
 *
 * Entities are integer ids managed by a free list. Component data lives in
 * contiguous typed arrays for cache-friendly iteration.
 */

const ECS = (function () {
  const { GENOME_LENGTH, MEMOME_LENGTH, PH, computePhenome, createMemome } = Genetics;

  // Hard upper bound on simultaneous entities. The simulation stays well below
  // this, and a fixed pool avoids per-spawn allocation and GC pressure.
  const MAX_ENTITIES = 50000;

  // Tiny reputation ledger per entity: a few (partnerId, value) pairs.
  // We hash the partner id into one of these slots and overwrite on collision.
  const REPUTATION_SLOTS = 4;

  // --- Component arrays ----------------------------------------------------

  const posX = new Uint16Array(MAX_ENTITIES);
  const posY = new Uint16Array(MAX_ENTITIES);
  const energy = new Float32Array(MAX_ENTITIES);
  const age = new Uint16Array(MAX_ENTITIES);
  const species = new Uint8Array(MAX_ENTITIES);
  const alive = new Uint8Array(MAX_ENTITIES);

  // Flat genome / phenome / memome storage.
  const genome = new Float64Array(MAX_ENTITIES * GENOME_LENGTH);
  const phenome = new Float32Array(MAX_ENTITIES * PH.COUNT);
  const memome = new Float32Array(MAX_ENTITIES * MEMOME_LENGTH);

  // Reputation ledger: each entity has REPUTATION_SLOTS of (id, value).
  // Stored as two parallel arrays for cache locality.
  const repId = new Uint16Array(MAX_ENTITIES * REPUTATION_SLOTS);
  const repValue = new Float32Array(MAX_ENTITIES * REPUTATION_SLOTS);

  // Free-list management.
  const freeList = new Uint32Array(MAX_ENTITIES);
  const state = {
    freeCount: MAX_ENTITIES,
    activeCount: 0,
  };
  for (let i = 0; i < MAX_ENTITIES; i++) {
    freeList[i] = MAX_ENTITIES - 1 - i;
  }

  // Active entity iteration list. Maintained each tick.
  const active = new Uint32Array(MAX_ENTITIES);

  function isValid(id) {
    return id >= 0 && id < MAX_ENTITIES && alive[id];
  }

  /**
   * Create a new entity. Returns the entity id, or -1 if the pool is exhausted.
   */
  function create(x, y, sp, initialEnergy, initialGenome) {
    if (state.freeCount === 0) return -1;
    const id = freeList[--state.freeCount];

    posX[id] = x | 0;
    posY[id] = y | 0;
    energy[id] = initialEnergy;
    age[id] = 0;
    species[id] = sp | 0;
    alive[id] = 1;

    const gOffset = id * GENOME_LENGTH;
    for (let i = 0; i < GENOME_LENGTH; i++) {
      genome[gOffset + i] = initialGenome[i];
    }

    computePhenome(initialGenome, sp, phenome.subarray(id * PH.COUNT, (id + 1) * PH.COUNT));

    const mOffset = id * MEMOME_LENGTH;
    for (let i = 0; i < MEMOME_LENGTH; i++) {
      memome[mOffset + i] = 0;
    }

    const rOffset = id * REPUTATION_SLOTS;
    for (let i = 0; i < REPUTATION_SLOTS; i++) {
      repId[rOffset + i] = 0xffff;
      repValue[rOffset + i] = 0;
    }

    active[state.activeCount++] = id;
    return id;
  }

  /**
   * Mark an entity as dead. Its id will be recycled on the next cleanup pass.
   */
  function destroy(id) {
    if (id < 0 || id >= MAX_ENTITIES) return;
    alive[id] = 0;
  }

  /**
   * Rebuild the active list, recycling dead ids back to the free list.
   * Call once per tick after all systems have run.
   */
  function cleanup() {
    let write = 0;
    for (let i = 0; i < state.activeCount; i++) {
      const id = active[i];
      if (alive[id]) {
        active[write++] = id;
      } else {
        freeList[state.freeCount++] = id;
      }
    }
    state.activeCount = write;
  }

  /**
   * Recalculate phenome for an entity after its genome changes.
   */
  function refreshPhenome(id) {
    computePhenome(
      genome.subarray(id * GENOME_LENGTH, (id + 1) * GENOME_LENGTH),
      species[id],
      phenome.subarray(id * PH.COUNT, (id + 1) * PH.COUNT)
    );
  }

  /**
   * Accessors for the reputation ledger.
   */
  function setReputation(id, partnerId, delta) {
    const slot = (partnerId % REPUTATION_SLOTS) | 0;
    const idx = id * REPUTATION_SLOTS + slot;
    if (repId[idx] !== partnerId) {
      repId[idx] = partnerId;
      repValue[idx] = delta;
    } else {
      repValue[idx] += delta;
      // Soft clamp so old grudges don't last forever.
      if (repValue[idx] > 5) repValue[idx] = 5;
      if (repValue[idx] < -5) repValue[idx] = -5;
    }
  }

  function getReputation(id, partnerId) {
    const slot = (partnerId % REPUTATION_SLOTS) | 0;
    const idx = id * REPUTATION_SLOTS + slot;
    if (repId[idx] === partnerId) return repValue[idx];
    return 0;
  }

  /**
   * Reset the entire ECS for a new world.
   */
  function reset() {
    alive.fill(0);
    state.activeCount = 0;
    state.freeCount = MAX_ENTITIES;
    for (let i = 0; i < MAX_ENTITIES; i++) {
      freeList[i] = MAX_ENTITIES - 1 - i;
    }
    repId.fill(0xffff);
    repValue.fill(0);
  }

  return {
    MAX_ENTITIES,
    REPUTATION_SLOTS,
    posX,
    posY,
    energy,
    age,
    species,
    alive,
    genome,
    phenome,
    memome,
    repId,
    repValue,
    active,
    get activeCount() {
      return state.activeCount;
    },
    get freeCount() {
      return state.freeCount;
    },
    isValid,
    create,
    destroy,
    cleanup,
    refreshPhenome,
    setReputation,
    getReputation,
    reset,
  };
})();