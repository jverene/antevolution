/**
 * Entry point: wires simulation, renderer, and UI controls.
 */

(function () {
  const sim = new Simulation.SimulationEngine();
  const renderer = new Renderer.Renderer("world", World.WIDTH, World.HEIGHT);
  const chart = new Chart.PopulationChart("population-chart");
  const inspect = new InspectPanel.Panel();
  renderer.resizeToWindow();

  const ui = {
    btnPlay: document.getElementById("btn-play"),
    btnReset: document.getElementById("btn-reset"),
    btnSave: document.getElementById("btn-save"),
    btnLoad: document.getElementById("btn-load"),
    fileInput: document.getElementById("file-input"),
    speed: document.getElementById("speed"),
    statTicks: document.getElementById("stat-ticks"),
    statAnts: document.getElementById("stat-ants"),
    statHerbivores: document.getElementById("stat-herbivores"),
    statPredators: document.getElementById("stat-predators"),
    statAdvanced: document.getElementById("stat-advanced"),
    statPlants: document.getElementById("stat-plants"),
    statSpeed: document.getElementById("stat-speed"),
    statSense: document.getElementById("stat-sense"),
    statMetabolism: document.getElementById("stat-metabolism"),
    statRepro: document.getElementById("stat-repro"),
    statAggression: document.getElementById("stat-aggression"),
    statMutability: document.getElementById("stat-mutability"),
    statThermal: document.getElementById("stat-thermal"),
    statSociality: document.getElementById("stat-sociality"),
    statWFood: document.getElementById("stat-wfood"),
    statWFlee: document.getElementById("stat-wflee"),
    statWShelter: document.getElementById("stat-wshelter"),
    statWFarm: document.getElementById("stat-wfarm"),
    statEvents: document.getElementById("stat-events"),
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
    ui.statAdvanced.textContent = s.advanced.toLocaleString();
    ui.statPlants.textContent = s.plantCells.toLocaleString();
    ui.statSpeed.textContent = s.speed.toFixed(3);
    ui.statSense.textContent = s.sense.toFixed(2);
    ui.statMetabolism.textContent = s.metabolism.toFixed(3);
    ui.statRepro.textContent = s.repro.toFixed(1);
    ui.statAggression.textContent = s.aggression.toFixed(2);
    ui.statMutability.textContent = (s.mutability * 1000).toFixed(2) + "‰";
    ui.statThermal.textContent = s.thermal.toFixed(2);
    ui.statSociality.textContent = s.sociality.toFixed(2);
    ui.statWFood.textContent = s.wFood.toFixed(2);
    ui.statWFlee.textContent = s.wFlee.toFixed(2);
    ui.statWShelter.textContent = s.wShelter.toFixed(2);
    ui.statWFarm.textContent = s.wFarm.toFixed(2);

    ui.statEvents.innerHTML = "";
    for (let i = s.eventLog.length - 1; i >= 0; i--) {
      const li = document.createElement("li");
      li.textContent = `[${s.eventLog[i].tick.toLocaleString()}] ${s.eventLog[i].text}`;
      ui.statEvents.appendChild(li);
    }
  }

  function frame() {
    if (sim.running) {
      for (let i = 0; i < sim.speed; i++) {
        sim.tick();
      }
    }

    renderer.render(sim.world);

    if (sim.ticks - lastStatUpdate > 20) {
      renderStats(sim.stats());
      lastStatUpdate = sim.ticks;
    }

    // Render population chart every 30 ticks (~0.5s at 60fps).
    if (sim.ticks % 30 === 0) {
      chart.render(sim.getHistory());
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

  ui.btnSave.addEventListener("click", () => {
    const json = sim.exportState();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evolution-world-${sim.ticks}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  ui.btnLoad.addEventListener("click", () => {
    ui.fileInput.click();
  });

  ui.fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const success = sim.importState(event.target.result);
      if (success) {
        lastStatUpdate = 0;
        renderStats(sim.stats());
      } else {
        alert("Failed to load world state.");
      }
    };
    reader.readAsText(file);
    ui.fileInput.value = "";
  });

  ui.speed.addEventListener("input", () => {
    sim.setSpeed(parseInt(ui.speed.value, 10));
  });

  window.addEventListener("resize", () => {
    renderer.resizeToWindow();
    chart.resize();
  });

  // Click to inspect a cell.
  renderer.canvas.addEventListener("click", (e) => {
    const rect = renderer.canvas.getBoundingClientRect();
    const scaleX = World.WIDTH / rect.width;
    const scaleY = World.HEIGHT / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    const data = sim.inspectCell(x, y);
    inspect.show(e.clientX, e.clientY, data);
  });

  updateUI();
  renderStats(sim.stats());
  frame();
})();
