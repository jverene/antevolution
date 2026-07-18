/**
 * Fast structural check: load all modules (including the new diversity panel),
 * run a handful of ticks, and assert the stats snapshot now carries diversity
 * data. Kept short so it does not hang in CI / the agent loop.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const canvas = {
  width: 1000,
  height: 1000,
  style: {},
  getBoundingClientRect: () => ({ width: 200, height: 60 }),
  getContext: () => ({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {},
    scale: () => {},
    setTransform: () => {},
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
  }),
};

global.document = {
  getElementById: (id) => {
    if (id === "world" || id === "population-chart") return canvas;
    return {
      textContent: "",
      innerHTML: "",
      style: {},
      dataset: {},
      getBoundingClientRect: () => ({ width: 200, height: 60 }),
      querySelectorAll: () => [],
      querySelector: () => ({ dataset: {} }),
      addEventListener: () => {},
    };
  },
  createElement: () => ({ textContent: "", style: {} }),
};
global.requestAnimationFrame = () => {};
global.window = global;

const files = [
  "src/noise.js",
  "src/genetics.js",
  "src/ecs.js",
  "src/spatial-hash.js",
  "src/world.js",
  "src/renderer.js",
  "src/simulation.js",
  "src/chart.js",
  "src/diversity.js",
];
const fullSrc = files.map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");
vm.runInThisContext(fullSrc, { filename: "bundle.js" });

const sim = new Simulation.SimulationEngine();
// Run a few ticks so populations and phenotypes settle a little.
for (let i = 0; i < 5; i++) sim.tick();

const s = sim.stats();
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("ok  :", msg);
};

assert(s.diversity && typeof s.diversity === "object", "stats() has diversity object");
assert(s.diversity.speed && "cv" in s.diversity.speed, "diversity.speed has cv");
assert(Array.isArray(s.speedHist) && s.speedHist.length === 16, "speedHist has 16 buckets");
assert(Array.isArray(s.metabHist) && s.metabHist.length === 16, "metabHist has 16 buckets");
const speedTotal = s.speedHist.reduce((a, b) => a + b, 0);
assert(speedTotal === s.ants + s.herbivores + s.predators + s.advanced, "histogram total equals population");
assert(typeof Diversity.Panel === "function", "Diversity.Panel is constructable");

// Lineage checks.
assert(typeof s.lineageCount === "number" && s.lineageCount > 0, "stats has lineageCount");
assert(typeof s.maxGeneration === "number", "stats has maxGeneration");
const n = ECS.activeCount;
let hasGen0 = false, hasGen1plus = false;
for (let i = 0; i < n; i++) {
  const id = ECS.active[i];
  if (ECS.generation[id] === 0) hasGen0 = true;
  if (ECS.generation[id] > 0) hasGen1plus = true;
}
assert(hasGen0, "found generation-0 founders");
// gen>0 unlikely in just 5 ticks, but lineage ids should be assigned.
const seenLineages = new Set();
for (let i = 0; i < n; i++) seenLineages.add(ECS.lineageId[ECS.active[i]]);
assert(seenLineages.size > 0, "lineage ids are assigned");

console.log("\ndiversity snapshot:", JSON.stringify(s.diversity));

// Cellular-biology checks.
assert(typeof s.avgTelomere === "number" && s.avgTelomere > 0, "stats has avgTelomere > 0");
assert(typeof s.avgDamage === "number" && s.avgDamage >= 0, "stats has avgDamage >= 0");
assert(typeof s.cancerCount === "number", "stats has cancerCount");
assert(s.diversity.telomere && "cv" in s.diversity.telomere, "diversity.telomere has cv");
assert(s.diversity.repairRate && "cv" in s.diversity.repairRate, "diversity.repairRate has cv");

// Verify ECS cellular arrays are populated and bounded.
let telOk = true, massOk = true, damOk = true;
for (let i = 0; i < n; i++) {
  const id = ECS.active[i];
  if (ECS.telomere[id] < 0 || ECS.cellMass[id] < 0 || ECS.cellDamage[id] < 0) {
    telOk = false; massOk = false; damOk = false;
  }
}
assert(telOk && massOk && damOk, "cellular state values are non-negative");

// Save/load round-trip: export, reimport, verify cellular fields survive.
let homeSumBefore = 0;
for (let i = 0; i < ECS.activeCount; i++) {
  homeSumBefore += ECS.homeX[ECS.active[i]] + ECS.homeY[ECS.active[i]];
}
const json = sim.exportState();
const saved = JSON.parse(json);
assert(saved.version === 4, "export version is 4");
assert(saved.entities.length > 0, "exported entities exist");
const e0 = saved.entities[0];
assert(typeof e0.telomere === "number", "entity has telomere in export");
assert(typeof e0.cellMass === "number", "entity has cellMass in export");
assert(typeof e0.cellDamage === "number", "entity has cellDamage in export");
assert(typeof e0.cancerous === "number", "entity has cancerous in export");

const sBefore = sim.stats();
assert(sim.importState(json) === true, "importState succeeds with v4 JSON");
const sAfter = sim.stats();
assert(sBefore.avgTelomere === sAfter.avgTelomere, "avgTelomere survives round-trip");
assert(sBefore.avgDamage === sAfter.avgDamage, "avgDamage survives round-trip");
assert(sBefore.cancerCount === sAfter.cancerCount, "cancerCount survives round-trip");
assert(sBefore.ants === sAfter.ants && sBefore.herbivores === sAfter.herbivores,
  "population counts survive round-trip");
let homeSumAfter = 0;
for (let i = 0; i < ECS.activeCount; i++) {
  homeSumAfter += ECS.homeX[ECS.active[i]] + ECS.homeY[ECS.active[i]];
}
assert(homeSumBefore === homeSumAfter, "colony homes survive round-trip");

console.log("Quick check passed.");
