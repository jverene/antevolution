# Evolution Ecosystem Simulation

A long-running, browser-based evolution toy. Thousands of organisms wander a 1000×1000 toroidal world, eat, reproduce asexually with mutation, and evolve quantitative traits encoded by diploid chromosomes.

## Run it

Clone the repository and start the dev server:

```bash
git clone https://github.com/jverene/antevolution
cd evolution
npm run dev
# then open http://localhost:8765
```

No build step or external dependencies are required — the dev server uses Node’s built-in `http` module to serve the simulation.

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
- **Dark red** squares are ant colony nests.
- **Pale cyan** tint marks pheromone trails (stronger = fresher).
- Up to 5 organisms may occupy the same square.

## Controls

- **Pause / Play** — freeze or resume the simulation.
- **Reset** — restart with a fresh random world.
- **Speed** — run multiple simulation ticks per animation frame.
- **View older versions** — click the link in the UI to open a gallery of prior commits and run the simulation exactly as it was at each point in history.

## Version history gallery

The `versions/` directory contains a static snapshot of the simulation source for each of the last 12 commits. The `scripts/build-versions.js` tool regenerates this gallery from `git log`, and `versions/index.html` provides a menu where you can open and run any historical iteration.

To refresh the gallery after new commits:

```bash
npm run build-versions
```

## Ecosystem

The simulation is a food web with three trophic levels plus an optional advanced lineage:

1. **Plants** — regrow from soil nutrients and form the base of the food web. Biomes modify growth rate (jungles are lush, deserts sparse, tundras slow).
2. **Ants & herbivores** — graze on plants. Herbivores are faster and reproduce more quickly; ants retain latent social and aggressive traits.
3. **Predators** — hunt ants and herbivores. A successful catch transfers energy to the predator and removes the prey, creating real predation pressure.
4. **Advanced agents** — carry memory, a cultural "memome", and can build shelters and farms. They are slower but can learn and teach nearby agents.

## Evolution model

Each organism carries a diploid genome of 33 genes × 2 alleles (66 floating-point values) plus a small neural-network weight vector. Genes influence physical traits (speed, sense range, metabolism, thermal efficiency, longevity) and behavioral weights (food attraction, predator fear, aggression toward same/other species, shelter/farm attraction, pheromone attraction and deposition, exploration).

Traits are computed from allele sums plus **epistatic trade-offs**: faster movement and wider sensing increase metabolic cost, while thermal-efficiency genes reduce it. Mutations are Gaussian point mutations plus rare large-effect chromosomal events. Selection emerges from energy balance, starvation, aging, competition for space and food, predation, and biome-specific thermodynamic costs.

### Sexual reproduction

Reproduction is sexual when a mature mate of the same species is nearby (within 2 cells). The child genome is created by meiotic crossover: for each gene it receives one allele from each parent, and the NN weights are uniformly recombined. If no mate is available, the parent falls back to asexual cloning. This mirrors many real organisms that reproduce sexually when partners are abundant and asexually when isolated.

### Trophic energy transfer

Predators no longer receive a fixed energy reward per kill. Instead, they assimilate a fraction of the prey's current stored energy (40–60%, scaled by the predator's food-efficiency trait). This mirrors the ecological reality that predators convert only part of a prey item into usable energy and creates stronger selection for efficient hunters. Predators use their evolved `W_PREY` drive to actively pursue prey within their sense radius and can strike prey in adjacent cells.

### Density-dependent regulation

Hard per-cell caps are supplemented with soft density dependence. Organisms in crowded cells pay a quadratic metabolism penalty as competition stress, and reproduction is strongly suppressed when local density is high. This makes carrying capacity emergent rather than enforced by a fixed ceiling.

### Evolvable survival traits

The genome has expanded beyond basic physiology and behavior weights to include evolvable survival specializations:

- **Strike range** — how far a predator can reach to catch prey (0–3 cells).
- **Predation skill** — a bonus to a predator's catch chance.
- **Hibernation drive** — the tendency to enter torpor when energy is low or temperature stress is high. Hibernating organisms skip movement and interaction, pay halved metabolism, and do not age.

These traits are inherited, recombined sexually, and mutate, so lineages can evolve toward specialist hunters, efficient grazers, or hardy hibernators depending on the biome and ecological pressures.

### Genetic diversity readout

Evolution is a change in the *distribution* of traits, not merely their average. The diversity panel shows live histograms of the speed and metabolism phenotypes across the whole population, plus the **coefficient of variation** (CV = std / mean) for speed, metabolism, sense range, and aggression.

A mean alone hides whether a population is uniform, bimodal, drifting, or under directional selection. A collapsing CV is the visible signature of a **bottleneck** (a few survivors repopulate the world) or a **hard selection sweep** (one optimal strategy dominates); a rising CV means the population is exploring trait space. Watch the histograms narrow during a die-off and re-broaden as descendants diversify.

## Behavior system

Agents use a **bicameral decision architecture** inspired by the idea of ancient hardwired drives modulated by a flexible control layer:

- **Hardwired drives** are encoded as evolved behavioral weights in the genome: food attraction, predator fear, aggression toward same/other species, shelter/farm attraction, and exploration.
- **Modulatory neural net**: a tiny fixed-topology network (9 inputs, 4 hidden ReLU neurons, 8 outputs) reads sensory context and internal state, then outputs multipliers on each drive. For example, it can suppress food attraction when predators are nearby, boost shelter-seeking in cold biomes, dial up trail-following when a pheromone gradient is strong, or dial up exploration when energy is high.
- Each tick the agent senses nearby food, predators, same-species neighbors, other species, shelters, and farms; the NN scales the drive weights; and the agent moves in the direction that best aligns with the resulting desired vector.
- Both the base drive weights and the NN weights are inherited and evolve, so strategies such as "flee predators", "hunt prey", "seek shelter in tundra", or "farm fertile tiles" can emerge without being explicitly programmed.

The NN is kept small and allocation-free so the simulation stays fast: inference is just a tight loop over typed arrays, with no dynamic topology or backpropagation.

## Pheromone trails (ACO)

Ants forage from permanent **colony nests** using an ant-colony-optimization-style stigmergy loop:

- **Colony founding** — at reset, 3–10 nests (scaled to the initial ant population) are placed where plant biomass within foraging range is richest, so no colony is founded in barren land. Most ants hatch in a ring around a nest; the rest spawn scattered as a reserve that keeps the species alive if a colony's neighborhood fails.
- **Trail laying** — after a good meal far from home, an ant enters a homing state: it beelines back to its nest, depositing pheromone every tick. Trails therefore connect rich food patches to colonies.
- **Evaporation** — the pheromone field loses a fixed fraction every tick (half-life ~45 ticks), so trails to depleted patches fade instead of misleading foragers.
- **Recruitment** — a forager senses the strongest pheromone cell nearby and climbs the gradient, which points at the food end of an active trail where deposits are renewed.
- **Relocation** — a fed ant that finds an exceptionally rich patch far from home adopts it as a new anchor, and an ant whose played-out home neighborhood has been stripped bare cuts the anchor and roams free. Colonies thus collapse and re-found as the food landscape shifts.

Trail following (`W_PHEROMONE`) and trail laying rate (`PHEROMONE_DEPOSIT`) are ordinary evolvable genes with a dedicated neural-net input and output, so trail use can strengthen, weaken, or even invert (trail aversion) under selection — and non-ant species can evolve or lose the trait. Ants start as colony foragers; herbivores and predators start with the trait switched off. Colony membership is hereditary (offspring keep their parent's nest) and survives save/load.

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
