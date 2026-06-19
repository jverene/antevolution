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

console.log("\ndiversity snapshot:", JSON.stringify(s.diversity));
console.log("Quick check passed.");
