/**
 * Entry point: wires simulation, renderer, and UI controls.
 */

(function () {
  const sim = new Simulation.SimulationEngine();
  const renderer = new Renderer.Renderer("world", World.WIDTH, World.HEIGHT);
  renderer.resizeToWindow();

  const ui = {
    btnPlay: document.getElementById("btn-play"),
    btnReset: document.getElementById("btn-reset"),
    speed: document.getElementById("speed"),
    statTicks: document.getElementById("stat-ticks"),
    statAnts: document.getElementById("stat-ants"),
    statHerbivores: document.getElementById("stat-herbivores"),
    statPredators: document.getElementById("stat-predators"),
    statPlants: document.getElementById("stat-plants"),
    statSpeed: document.getElementById("stat-speed"),
    statSense: document.getElementById("stat-sense"),
    statMetabolism: document.getElementById("stat-metabolism"),
    statRepro: document.getElementById("stat-repro"),
    statAggression: document.getElementById("stat-aggression"),
    statMutability: document.getElementById("stat-mutability"),
  };

  let lastStatUpdate = 0;
  let animationId = null;

  function updateUI() {
    ui.btnPlay.textContent = sim.running ? "Pause" : "Play";
  }

  function renderStats(s) {
    ui.statTicks.textContent = s.ticks.toLocaleString();
    ui.statAnts.textContent = s.ants.toLocaleString();
    ui.statHerbivores.textContent = s.herbivores.toLocaleString();
    ui.statPredators.textContent = s.predators.toLocaleString();
    ui.statPlants.textContent = s.plantCells.toLocaleString();
    ui.statSpeed.textContent = s.speed.toFixed(3);
    ui.statSense.textContent = s.sense.toFixed(2);
    ui.statMetabolism.textContent = s.metabolism.toFixed(3);
    ui.statRepro.textContent = s.repro.toFixed(1);
    ui.statAggression.textContent = s.aggression.toFixed(2);
    ui.statMutability.textContent = (s.mutability * 1000).toFixed(2) + "‰";
  }

  function frame() {
    if (sim.running) {
      for (let i = 0; i < sim.speed; i++) {
        sim.tick();
      }
    }

    renderer.render(sim.world);

    // Throttle stats updates.
    if (sim.ticks - lastStatUpdate > 20) {
      renderStats(sim.stats());
      lastStatUpdate = sim.ticks;
    }

    animationId = requestAnimationFrame(frame);
  }

  ui.btnPlay.addEventListener("click", () => {
    sim.togglePause();
    updateUI();
  });

  ui.btnReset.addEventListener("click", () => {
    sim.reset();
    lastStatUpdate = 0;
    renderStats(sim.stats());
  });

  ui.speed.addEventListener("input", () => {
    sim.setSpeed(parseInt(ui.speed.value, 10));
  });

  window.addEventListener("resize", () => {
    renderer.resizeToWindow();
  });

  updateUI();
  renderStats(sim.stats());
  frame();
})();
