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

- **Biome tint** — the background color shows temperature/moisture-derived biomes (tundra, desert, grassland, forest, jungle).
- **Green** squares contain edible plants (brighter = more biomass).
- **Black** squares contain ants.
- **Blue** squares contain herbivores.
- **Red** squares contain predators.
- **Yellow** squares contain advanced / proto-human agents.
- **Brown** squares are shelters built by advanced agents.
- **Orange** squares are cultivated farms.
- Up to 5 organisms may occupy the same square.

## Controls

- **Pause / Play** — freeze or resume the simulation.
- **Reset** — restart with a fresh random world.
- **Speed** — run multiple simulation ticks per animation frame.

## Ecosystem

The simulation is a food web with three trophic levels plus an optional advanced lineage:

1. **Plants** — regrow from soil nutrients and form the base of the food web. Biomes modify growth rate (jungles are lush, deserts sparse, tundras slow).
2. **Ants & herbivores** — graze on plants. Herbivores are faster and reproduce more quickly; ants retain latent social and aggressive traits.
3. **Predators** — hunt ants and herbivores. A successful catch transfers energy to the predator and removes the prey, creating real predation pressure.
4. **Advanced agents** — carry memory, a cultural "memome", and can build shelters and farms. They are slower but can learn and teach nearby agents.

## Evolution model

Each organism carries a diploid genome of 24 genes × 2 alleles (48 floating-point values). Genes influence physical traits (speed, sense range, metabolism, thermal efficiency, longevity) and behavioral weights (food attraction, predator fear, aggression toward same/other species, shelter/farm attraction, exploration).

Traits are computed from allele sums plus **epistatic trade-offs**: faster movement and wider sensing increase metabolic cost, while thermal-efficiency genes reduce it. Mutations are Gaussian point mutations plus rare large-effect chromosomal events. Selection emerges from energy balance, starvation, aging, competition for space and food, predation, and biome-specific thermodynamic costs.

## Behavior system

Instead of hardcoded species state machines, agents use a weighted-utility decision function:

- They sense nearby food, predators, same-species neighbors, other species, shelters, and farms.
- A desired movement direction is computed as a weighted sum of these stimuli.
- Each tick they move in the direction that best aligns with the desired vector, with a small amount of stochastic exploration.
- Weights are encoded in the genome and evolve, so strategies such as "flee predators", "hunt prey", "seek shelter in tundra", or "farm fertile tiles" can emerge without being explicitly programmed.

## Biomes

The world is generated with two layers of deterministic value noise:

- **Temperature** — cold biomes increase metabolic cost unless the agent has high thermal efficiency.
- **Moisture** — combined with temperature, determines biome type and plant growth rate.

A high-speed/high-metabolism lineage will thrive in a jungle but may starve if it wanders into a desert or tundra. Selection therefore favors trait combinations matched to local conditions.

## Culture, reputation, and environmental modification

Advanced agents carry a separate **memome** (a small cultural vector) that is transmitted horizontally to nearby agents, not inherited genetically:

- **Teaching** — successful agents share their memome with neighbors, allowing useful strategies to spread faster than mutation.
- **Innovation** — small random drift can create new memetic variants.
- **Shelter building** — in cold biomes, agents with a strong shelter memome can convert a tile into a shelter that reduces ambient thermodynamic cost.
- **Agriculture** — agents with a strong farm memome can cultivate fertile tiles into farms with faster plant regrowth.

Agents also maintain a tiny reputation ledger. Helping another agent (e.g., attacking a predator that threatens them) improves reputation; stealing food or attacking same-species agents lowers it. This creates selective pressure for cooperative in-groups and retaliation against defectors.

## Performance

The simulation uses:

- **Entity Component System (ECS)** with Structure-of-Arrays (SoA) storage for cache-friendly iteration.
- **Fixed-grid spatial hash** for neighborhood queries, dropping vision/predation/collision checks from O(N²) to O(N).
- **Typed arrays** for all grid and entity data to minimize GC pressure.

## Randomized worlds

Every reset generates a different world: initial population sizes, biome layout, plant patch placement, soil nutrients, and starting genomes are all randomized within stable ranges. No two runs evolve the same way.

## Smoke test

A headless smoke test is included for quick regression checks:

```bash
node scripts/smoke-test.js
```

It loads the modules in a minimal Node environment and runs several thousand ticks, printing population summaries along the way.
