/**
 * Canvas renderer for the 1000x1000 world.
 * Uses ImageData for fast pixel manipulation.
 */

const Renderer = (function () {
  const BROWN = 0xff325078; // ABGR little-endian for RGBA(120,80,50)
  const GREEN = 0xff3cb432; // RGBA(50,180,60)
  const DARK_GREEN = 0xff1e5a19; // RGBA(25,90,25)
  const BLACK = 0xff000000;

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
     * Full render of the world. Brown background, green food, black ants.
     */
    render(world) {
      const pixels = this.pixels;
      const food = world.food;
      const ants = world.antCount;
      const area = world.area;

      // 1. Brown background.
      pixels.fill(BROWN);

      // 2. Overlay food and ants in one pass.
      for (let i = 0; i < area; i++) {
        if (ants[i] > 0) {
          pixels[i] = BLACK;
        } else if (food[i] > 0) {
          // Brighter green for fuller food.
          pixels[i] = food[i] > 500 ? GREEN : DARK_GREEN;
        }
      }

      this.ctx.putImageData(this.imageData, 0, 0);
    }
  }

  return { Renderer };
})();
