# Ant Evolution Simulation

A long-running, browser-based ant evolution toy. Thousands of ants wander a 1000×1000 toroidal world, eat food, reproduce asexually with mutation, and evolve quantitative traits encoded by diploid chromosomes.

## Run it

Open `index.html` directly in any modern browser, or run the dev server:

```bash
cd /Users/hjiang/Developer/evolution
npm run dev
# then open http://localhost:8765
```

No build step or external dependencies are required — the dev server uses Node’s built-in `http` module.

If port `8765` is already in use, the server automatically picks the next free port (`8766`, `8767`, …). You can also override the starting port:

```bash
PORT=3000 npm run dev
```

## What you see

- **Brown** squares are empty dirt.
- **Green** squares contain food (brighter = more food remaining).
- **Black** squares contain one or more ants.
- Up to 5 ants may occupy the same square.

## Controls

- **Pause / Play** — freeze or resume the simulation.
- **Reset** — restart with a fresh random world.
- **Speed** — run multiple simulation ticks per animation frame.

## Evolution model

Each ant carries a diploid genome of 16 genes × 2 alleles (32 floating-point values). Genes influence traits such as speed, sense range, metabolism, reproductive threshold, food efficiency, longevity, and mutability.

Traits are computed from allele sums plus **epistatic trade-offs**: faster movement and wider sensing increase metabolic cost, while thermal-efficiency genes reduce it. Mutations are Gaussian point mutations plus rare large-effect chromosomal events. Selection emerges from energy balance, starvation, aging, and competition for space and food.

Food spawns both as scattered background crumbs and as occasional denser patches; a food floor guarantees the world never goes completely barren.

## Randomized worlds

Every reset generates a different world: the initial number of ants, the number/size/density of starting food patches, the rate of ongoing food spawn, and the amount of scattered background food are all chosen randomly within stable ranges. Because each ant also starts with a unique diploid genome, no two runs evolve the same way.
