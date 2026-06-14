# Evolution Ecosystem Simulation

A long-running, browser-based evolution toy. Thousands of organisms wander a 1000×1000 toroidal world, eat, reproduce asexually with mutation, and evolve quantitative traits encoded by diploid chromosomes.

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
- **Green** squares contain edible plants (brighter = more biomass).
- **Black** squares contain one or more ants.
- **Blue** squares contain herbivores.
- **Red** squares contain predators.
- Up to 5 organisms may occupy the same square.

## Controls

- **Pause / Play** — freeze or resume the simulation.
- **Reset** — restart with a fresh random world.
- **Speed** — run multiple simulation ticks per animation frame.

## Ecosystem

The simulation is a minimal food web with three trophic levels:

1. **Plants** — regrow from soil nutrients and form the base of the food web.
2. **Ants & herbivores** — graze on plants. Herbivores are faster and reproduce more quickly; ants retain latent social and aggressive traits.
3. **Predators** — hunt ants and herbivores. A successful catch transfers energy to the predator and removes the prey, creating real predation pressure.

## Evolution model

Each organism carries a diploid genome of 16 genes × 2 alleles (32 floating-point values). Genes influence traits such as speed, sense range, metabolism, reproductive threshold, food efficiency, aggression, sociality, longevity, and mutability.

Traits are computed from allele sums plus **epistatic trade-offs**: faster movement and wider sensing increase metabolic cost, while thermal-efficiency genes reduce it. Mutations are Gaussian point mutations plus rare large-effect chromosomal events. Selection emerges from energy balance, starvation, aging, competition for space and food, and now also from predation.

## Randomized worlds

Every reset generates a different world: the initial number of ants, herbivores, and predators, the number/size/density of starting plant patches, soil nutrient distribution, and the rate of ongoing plant regrowth are all chosen randomly within stable ranges. Because each organism also starts with a unique diploid genome biased for its ecological role, no two runs evolve the same way.
