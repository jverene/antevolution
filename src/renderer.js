/**
 * Canvas renderer for the 1000x1000 world.
 * Uses ImageData for fast pixel manipulation.
 */

const Renderer = (function () {
  const { SPECIES } = World;

  const BROWN = 0xff325078; // ABGR little-endian for RGBA(120,80,50)
  const BLACK = 0xff000000;
  const BLUE = 0xffd06a35; // ABGR for RGBA(53,106,208)
  const RED = 0xff3b4ee8; // ABGR for RGBA(232,78,59)

  // Pack RGBA into a single ABGR Uint32 (little-endian).
  function rgba(r, g, b, a = 255) {
    return (a << 24) | (b << 16) | (g << 8) | r;
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
      // CSS scales the canvas; internal resolution stays 1000x1000.
      this.canvas.style.width = "100vw";
      this.canvas.style.height = "100vh";
    }

    /**
     * Full render of the world. Brown dirt, green plants, and colored animals.
     */
    render(world) {
      const pixels = this.pixels;
      const plantBiomass = world.plantBiomass;
      const antCount = world.antCount;
      const herbivoreCount = world.herbivoreCount;
      const predatorCount = world.predatorCount;
      const area = world.area;

      // 1. Brown background with subtle nutrient variation.
      pixels.fill(BROWN);

      // 2. Overlay plants and organisms in one pass.
      for (let i = 0; i < area; i++) {
        const biomass = plantBiomass[i];
        const hasPredator = predatorCount[i] > 0;
        const hasHerbivore = herbivoreCount[i] > 0;
        const hasAnt = antCount[i] > 0;

        if (hasPredator) {
          pixels[i] = RED;
        } else if (hasHerbivore) {
          pixels[i] = BLUE;
        } else if (hasAnt) {
          pixels[i] = BLACK;
        } else if (biomass > 0) {
          // Brighter, more saturated green for denser vegetation.
          const intensity = Math.min(1, biomass / 600);
          const r = Math.floor(25 + 25 * (1 - intensity));
          const g = Math.floor(90 + 90 * intensity);
          const b = Math.floor(25 + 25 * (1 - intensity));
          pixels[i] = rgba(r, g, b);
        }
      }

      this.ctx.putImageData(this.imageData, 0, 0);
    }
  }

  return { Renderer };
})();
