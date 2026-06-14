/**
 * Smoke test: load the simulation modules in a minimal Node environment,
 * mock the DOM/canvas, and run a few thousand ticks to catch runtime errors.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Minimal DOM/canvas mocks.
const canvas = {
  width: 1000,
  height: 1000,
  style: {},
  getContext: () => ({
    createImageData: (w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
    putImageData: () => {},
  }),
};

global.document = {
  getElementById: (id) => {
    if (id === "world") return canvas;
    return {
      textContent: "",
      innerHTML: "",
      addEventListener: () => {},
    };
  },
  createElement: () => ({ textContent: "" }),
};

global.requestAnimationFrame = () => {};
// In the browser, `window` is the global object; mirror that here.
global.window = global;

// Load modules in browser order. Concatenating them into a single script
// keeps all top-level const declarations in the same scope, just like the
// browser does when loading <script> tags sequentially.
const files = [
  "src/noise.js",
  "src/genetics.js",
  "src/ecs.js",
  "src/spatial-hash.js",
  "src/world.js",
  "src/renderer.js",
  "src/simulation.js",
];
const fullSrc = files
  .map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8"))
  .join("\n");
vm.runInThisContext(fullSrc, { filename: "bundle.js" });

console.log("Modules loaded. Starting simulation...");

const sim = new Simulation.SimulationEngine();
console.log("Initial active:", ECS.activeCount);

for (let i = 0; i < 1000; i++) {
  sim.tick();
  if (i === 0 || i === 99 || i === 499 || i === 999) {
    console.log("Tick", i + 1, "active:", ECS.activeCount);
  }
}

const s = sim.stats();
console.log("Ticks:", s.ticks);
console.log("Population:", s.ants + s.herbivores + s.predators + s.advanced);
console.log("Ants/Herbivores/Predators/Advanced:", s.ants, s.herbivores, s.predators, s.advanced);
console.log("Plant cells:", s.plantCells);
console.log("Events:", s.eventLog);
console.log("Smoke test passed.");
