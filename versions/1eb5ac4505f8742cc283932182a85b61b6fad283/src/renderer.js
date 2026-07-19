/**
 * Canvas renderer for the 1000x1000 world.
 * Uses ImageData for fast pixel manipulation.
 * Renders biome background, plants, modified tiles, and organisms.
 */

const Renderer = (function () {
  const { SPECIES, BIOME, TILE } = World;

  const BLACK = 0xff000000;
  const BLUE = 0xffd06a35; // ABGR for RGBA(53,106,208)
  const RED = 0xff3b4ee8; // ABGR for RGBA(232,78,59)
  const YELLOW = 0xff00ffff; // ABGR for RGBA(255,255,0)
  const SHELTER = 0xff8b4513; // ABGR for RGBA(139,69,19)
  const FARM = 0xff00a5ff; // ABGR for RGBA(255,165,0)
  const NEST = 0xff2d2d8b; // ABGR for RGBA(139,45,45) — dark red colony mound

  function rgba(r, g, b, a = 255) {
    return (a << 24) | (b << 16) | (g << 8) | r;
  }

  function biomeColor(biome, moisture) {
    switch (biome) {
      case BIOME.TUNDRA:
        return rgba(220, 235, 245, 255);
      case BIOME.DESERT:
        return rgba(230, 210, 160, 255);
      case BIOME.GRASSLAND:
        return rgba(170, 190, 120, 255);
      case BIOME.FOREST:
        return rgba(100, 140, 70, 255);
      case BIOME.JUNGLE:
        return rgba(60, 120, 50, 255);
      default:
        return rgba(160, 140, 100, 255);
    }
  }

  class Renderer {
    constructor(canvasId, width, height) {
      this.canvas = document.getElementById(canvasId);
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx = this.canvas.getContext("2d", { alpha: false });
      this.imageData = this.ctx.createImageData(width, height);
      this.pixels = new Uint32Array(this.imageData.data.buffer);
      this.width = width;
      this.height = height;
    }

    resizeToWindow() {
      this.canvas.style.width = "100vw";
      this.canvas.style.height = "100vh";
    }

    render(world) {
      const pixels = this.pixels;
      const plantBiomass = world.plantBiomass;
      const biome = world.biome;
      const moisture = world.moisture;
      const tileType = world.tileType;
      const pheromone = world.pheromone;
      const antCount = world.antCount;
      const herbivoreCount = world.herbivoreCount;
      const predatorCount = world.predatorCount;
      const advancedCount = world.advancedCount;
      const area = world.area;

      for (let i = 0; i < area; i++) {
        const tt = tileType[i];
        const hasPredator = predatorCount[i] > 0;
        const hasHerbivore = herbivoreCount[i] > 0;
        const hasAnt = antCount[i] > 0;
        const hasAdvanced = advancedCount[i] > 0;

        if (hasPredator) {
          pixels[i] = RED;
        } else if (hasHerbivore) {
          pixels[i] = BLUE;
        } else if (hasAdvanced) {
          pixels[i] = YELLOW;
        } else if (hasAnt) {
          pixels[i] = BLACK;
        } else if (tt === TILE.SHELTER) {
          pixels[i] = SHELTER;
        } else if (tt === TILE.FARM) {
          pixels[i] = FARM;
        } else if (tt === TILE.NEST) {
          pixels[i] = NEST;
        } else if (plantBiomass[i] > 0) {
          const intensity = Math.min(1, plantBiomass[i] / 600);
          const base = biomeColor(biome[i], moisture[i]);
          const br = (base >> 0) & 0xff;
          const bg = (base >> 8) & 0xff;
          const bb = (base >> 16) & 0xff;
          const r = Math.floor(br * (1 - intensity) + 25 * intensity);
          const g = Math.floor(bg * (1 - intensity) + 140 * intensity);
          const b = Math.floor(bb * (1 - intensity) + 25 * intensity);
          pixels[i] = rgba(r, g, b, 255);
        } else if (pheromone[i] > 1) {
          // Pheromone trail: blend the biome toward pale cyan by trail strength.
          const intensity = Math.min(1, pheromone[i] / 60);
          const base = biomeColor(biome[i], moisture[i]);
          const br = (base >> 0) & 0xff;
          const bg = (base >> 8) & 0xff;
          const bb = (base >> 16) & 0xff;
          const r = Math.floor(br * (1 - intensity) + 190 * intensity);
          const g = Math.floor(bg * (1 - intensity) + 240 * intensity);
          const b = Math.floor(bb * (1 - intensity) + 230 * intensity);
          pixels[i] = rgba(r, g, b, 255);
        } else {
          const base = biomeColor(biome[i], moisture[i]);
          pixels[i] = base;
        }
      }

      this.ctx.putImageData(this.imageData, 0, 0);
    }
  }

  return { Renderer };
})();