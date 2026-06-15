/**
 * Genetics engine: diploid chromosomes, quantitative traits,
 * behavior weights, memome (cultural vector), point mutation,
 * and meiotic crossover.
 *
 * Genome: BEHAVIOR_GENE_COUNT genes x 2 alleles.
 * Phenotypes are additive (allele sum) with nonlinear epistatic trade-offs.
 */

const Genetics = (function () {
  const ALLELES_PER_GENE = 2;

  // Physical / life-history genes.
  const GENE = {
    SPEED: 0,
    SENSE_RANGE: 1,
    METABOLISM_BASE: 2,
    TURN_BIAS: 3,
    REPRO_THRESHOLD: 4,
    FOOD_EFFICIENCY: 5,
    MUTABILITY: 6,
    AGGRESSION: 7,
    LONGEVITY: 8,
    WANDER_NOISE: 9,
    EXPLORE_BIAS: 10,
    CARRY_BONUS: 11,
    THERMAL_EFFICIENCY: 12,
    MEMORY: 13,
    LEARNING_RATE: 14,
    SOCIALITY: 15,
    // Behavior weights used by the utility decision system.
    W_FOOD: 16,
    W_PREY: 17,
    W_FLEE_PREDATOR: 18,
    W_AGGRESSION_SAME: 19,
    W_AGGRESSION_OTHER: 20,
    W_EXPLORE: 21,
    W_SHELTER: 22,
    W_FARM: 23,
  };

  const GENE_COUNT = 24;
  const BASE_GENOME_LENGTH = GENE_COUNT * ALLELES_PER_GENE;

  // Bicameral modulatory network: hardwired drives + learned/evoled gain control.
  // The NN takes sensory/context inputs and outputs multipliers on the base drives.
  const NN = {
    INPUTS: 8,
    HIDDEN: 4,
    OUTPUTS: 7,
  };
  const NN_OUT = {
    FOOD_MULT: 0,
    FLEE_MULT: 1,
    AGGR_SAME_MULT: 2,
    AGGR_OTHER_MULT: 3,
    SHELTER_MULT: 4,
    FARM_MULT: 5,
    EXPLORE_BOOST: 6,
  };
  const NN_INPUT = {
    FOOD_STRENGTH: 0,
    PREDATOR_COUNT: 1,
    SAME_COUNT: 2,
    OTHER_COUNT: 3,
    SHELTER_COUNT: 4,
    FARM_COUNT: 5,
    ENERGY: 6,
    TEMP_STRESS: 7,
  };
  const NN_WEIGHT_COUNT =
    NN.INPUTS * NN.HIDDEN + NN.HIDDEN + NN.HIDDEN * NN.OUTPUTS + NN.OUTPUTS;
  const GENOME_LENGTH = BASE_GENOME_LENGTH + NN_WEIGHT_COUNT;

  // Cultural / meme vector length. Not inherited genetically; transmitted horizontally.
  const MEMOME_LENGTH = 8;

  // Phenotype cache layout (indices into an entity's phenome array).
  // Physical traits.
  const PH = {
    SPEED: 0,
    SENSE_RANGE: 1,
    TURN_BIAS: 2,
    WANDER_NOISE: 3,
    EXPLORE_BIAS: 4,
    REPRO_THRESHOLD: 5,
    FOOD_EFFICIENCY: 6,
    MUTABILITY: 7,
    LONGEVITY: 8,
    CARRY_BONUS: 9,
    THERMAL_EFF: 10,
    AGGRESSION: 11,
    SOCIALITY: 12,
    METABOLISM: 13,
    // Behavior weights.
    W_FOOD: 14,
    W_PREY: 15,
    W_FLEE_PREDATOR: 16,
    W_AGGRESSION_SAME: 17,
    W_AGGRESSION_OTHER: 18,
    W_EXPLORE: 19,
    W_SHELTER: 20,
    W_FARM: 21,
    MEMORY: 22,
    LEARNING_RATE: 23,
    // Totals.
    COUNT: 24,
  };

  // Gaussian random via Box-Muller.
  let gaussSpare = null;
  function randNormal(mean = 0, std = 1) {
    if (gaussSpare !== null) {
      const v = mean + std * gaussSpare;
      gaussSpare = null;
      return v;
    }
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const mag = std * Math.sqrt(-2.0 * Math.log(u));
    gaussSpare = mag * Math.cos(2.0 * Math.PI * v);
    return mean + mag * Math.sin(2.0 * Math.PI * v);
  }

  function createRandomGenome() {
    const g = new Float64Array(GENOME_LENGTH);
    for (let i = 0; i < BASE_GENOME_LENGTH; i++) {
      g[i] = randNormal(0.5, 0.25);
    }
    // Initialize NN weights near zero so outputs start near neutral (multiplier ~1.0).
    for (let i = BASE_GENOME_LENGTH; i < GENOME_LENGTH; i++) {
      g[i] = randNormal(0, 0.08);
    }
    return g;
  }

  /**
   * Create a biased starting genome for a given ecological role.
   */
  function createSpeciesGenome(species) {
    const g = createRandomGenome();
    const setGeneMean = (gene, mean) => {
      const i0 = gene * ALLELES_PER_GENE;
      const i1 = i0 + 1;
      g[i0] = g[i0] * 0.3 + mean * 0.7;
      g[i1] = g[i1] * 0.3 + mean * 0.7;
    };

    if (species === 2) {
      // Herbivore: fast, skittish, efficient grazer.
      setGeneMean(GENE.SPEED, 1.4);
      setGeneMean(GENE.SENSE_RANGE, 1.2);
      setGeneMean(GENE.FOOD_EFFICIENCY, 1.4);
      setGeneMean(GENE.WANDER_NOISE, 1.2);
      setGeneMean(GENE.REPRO_THRESHOLD, 0.8);
      setGeneMean(GENE.LONGEVITY, 0.6);
      setGeneMean(GENE.AGGRESSION, -0.5);
      setGeneMean(GENE.W_FOOD, 1.4);
      setGeneMean(GENE.W_FLEE_PREDATOR, 0.5);
      setGeneMean(GENE.W_AGGRESSION_SAME, -0.5);
      setGeneMean(GENE.W_AGGRESSION_OTHER, -0.3);
      setGeneMean(GENE.W_EXPLORE, 0.25);
    } else if (species === 3) {
      // Predator: fast, long-range senses, aggressive, costly metabolism.
      setGeneMean(GENE.SPEED, 1.6);
      setGeneMean(GENE.SENSE_RANGE, 2.0);
      setGeneMean(GENE.FOOD_EFFICIENCY, 1.1);
      setGeneMean(GENE.AGGRESSION, 1.6);
      setGeneMean(GENE.METABOLISM_BASE, 1.0);
      setGeneMean(GENE.REPRO_THRESHOLD, 1.2);
      setGeneMean(GENE.LONGEVITY, 1.0);
      setGeneMean(GENE.WANDER_NOISE, 0.4);
      setGeneMean(GENE.W_PREY, 2.5);
      setGeneMean(GENE.W_FOOD, -0.5);
      setGeneMean(GENE.W_FLEE_PREDATOR, 0.2);
      setGeneMean(GENE.W_EXPLORE, 0.15);
      setGeneMean(GENE.W_AGGRESSION_SAME, -0.5);
      setGeneMean(GENE.W_AGGRESSION_OTHER, 1.0);
    } else if (species === 4) {
      // Advanced / proto-human: high memory, social, flexible behavior.
      setGeneMean(GENE.SPEED, 0.9);
      setGeneMean(GENE.SENSE_RANGE, 1.0);
      setGeneMean(GENE.FOOD_EFFICIENCY, 1.1);
      setGeneMean(GENE.METABOLISM_BASE, 0.8);
      setGeneMean(GENE.MEMORY, 1.2);
      setGeneMean(GENE.LEARNING_RATE, 1.0);
      setGeneMean(GENE.SOCIALITY, 1.0);
      setGeneMean(GENE.AGGRESSION, 0.2);
      setGeneMean(GENE.W_FOOD, 1.0);
      setGeneMean(GENE.W_FLEE_PREDATOR, 0.5);
      setGeneMean(GENE.W_SHELTER, 0.3);
      setGeneMean(GENE.W_FARM, 0.3);
      setGeneMean(GENE.W_EXPLORE, 0.25);
    } else {
      // Ant: balanced forager with latent social/aggressive traits.
      setGeneMean(GENE.SPEED, 0.6);
      setGeneMean(GENE.SENSE_RANGE, 0.8);
      setGeneMean(GENE.FOOD_EFFICIENCY, 1.0);
      setGeneMean(GENE.SOCIALITY, 0.6);
      setGeneMean(GENE.AGGRESSION, 0.2);
      setGeneMean(GENE.W_FOOD, 1.2);
      setGeneMean(GENE.W_FLEE_PREDATOR, 0.4);
      setGeneMean(GENE.W_AGGRESSION_SAME, -0.5);
      setGeneMean(GENE.W_AGGRESSION_OTHER, 0.0);
      setGeneMean(GENE.W_EXPLORE, 0.25);
    }
    return g;
  }

  function cloneGenome(source) {
    return new Float64Array(source);
  }

  /**
   * Point mutation plus rare chromosomal-scale events.
   */
  function mutate(genome, mutability) {
    const baseRate = Math.max(0.0001, Math.min(0.5, mutability));
    // Calibrate to realistic per-locus rates: ~0.3-0.6 base-genome mutations per offspring.
    const pointProb = 0.005 + baseRate * 0.25;

    for (let gene = 0; gene < GENE_COUNT; gene++) {
      for (let a = 0; a < ALLELES_PER_GENE; a++) {
        const idx = gene * ALLELES_PER_GENE + a;
        if (Math.random() < pointProb) {
          const effect = randNormal(0, 0.08 + baseRate * 0.5);
          genome[idx] += effect;
        }
      }
    }

    // NN weights mutate at a low per-weight rate (many more parameters than base genes).
    const nnRate = 0.008 + baseRate * 0.25;
    const nnStd = 0.04 + baseRate * 0.15;
    for (let i = BASE_GENOME_LENGTH; i < GENOME_LENGTH; i++) {
      if (Math.random() < nnRate) {
        genome[i] += randNormal(0, nnStd);
      }
    }

    if (Math.random() < 0.005 * baseRate) {
      const gene = Math.floor(Math.random() * GENE_COUNT);
      const idx = gene * ALLELES_PER_GENE + Math.floor(Math.random() * 2);
      genome[idx] += randNormal(0, 1.2);
    }
  }

  /**
   * Meiotic crossover between two diploid genomes.
   */
  function crossover(parentA, parentB, child) {
    for (let gene = 0; gene < GENE_COUNT; gene++) {
      const i0 = gene * ALLELES_PER_GENE;
      const i1 = i0 + 1;
      if (Math.random() < 0.5) {
        child[i0] = parentA[i0];
        child[i1] = parentB[i1];
      } else {
        child[i0] = parentB[i0];
        child[i1] = parentA[i1];
      }
    }
    // NN weights: uniform crossover per weight.
    for (let i = BASE_GENOME_LENGTH; i < GENOME_LENGTH; i++) {
      child[i] = Math.random() < 0.5 ? parentA[i] : parentB[i];
    }
  }

  /**
   * Sum the two alleles for a gene.
   */
  function geneSum(genome, gene) {
    const i = gene * ALLELES_PER_GENE;
    return genome[i] + genome[i + 1];
  }

  /**
   * Compute the full phenotype array from a genome and species.
   */
  function computePhenome(genome, species, out) {
    const g = genome;
    const sp = species | 0;

    // Raw additive sums.
    const speedSum = geneSum(g, GENE.SPEED);
    const senseSum = geneSum(g, GENE.SENSE_RANGE);
    const metabSum = geneSum(g, GENE.METABOLISM_BASE);
    const turnSum = geneSum(g, GENE.TURN_BIAS);
    const reproSum = geneSum(g, GENE.REPRO_THRESHOLD);
    const effSum = geneSum(g, GENE.FOOD_EFFICIENCY);
    const mutSum = geneSum(g, GENE.MUTABILITY);
    const longSum = geneSum(g, GENE.LONGEVITY);
    const wanderSum = geneSum(g, GENE.WANDER_NOISE);
    const exploreSum = geneSum(g, GENE.EXPLORE_BIAS);
    const carrySum = geneSum(g, GENE.CARRY_BONUS);
    const thermSum = geneSum(g, GENE.THERMAL_EFFICIENCY);
    const aggrSum = geneSum(g, GENE.AGGRESSION);
    const socialSum = geneSum(g, GENE.SOCIALITY);
    const memSum = geneSum(g, GENE.MEMORY);
    const learnSum = geneSum(g, GENE.LEARNING_RATE);

    const wFoodSum = geneSum(g, GENE.W_FOOD);
    const wPreySum = geneSum(g, GENE.W_PREY);
    const wFleeSum = geneSum(g, GENE.W_FLEE_PREDATOR);
    const wAggrSameSum = geneSum(g, GENE.W_AGGRESSION_SAME);
    const wAggrOtherSum = geneSum(g, GENE.W_AGGRESSION_OTHER);
    const wExploreSum = geneSum(g, GENE.W_EXPLORE);
    const wShelterSum = geneSum(g, GENE.W_SHELTER);
    const wFarmSum = geneSum(g, GENE.W_FARM);

    // Species multipliers shift starting ranges.
    const speciesSpeedMult = sp === 3 ? 1.25 : sp === 2 ? 1.15 : 1.0;
    const speciesSenseMult = sp === 3 ? 1.3 : sp === 2 ? 1.1 : 1.0;

    out[PH.SPEED] = Math.max(0.02, Math.min(2.8, speedSum * 0.35 * speciesSpeedMult));
    out[PH.SENSE_RANGE] = Math.max(2, Math.min(8, Math.floor(senseSum * 2.5 * speciesSenseMult + 2)));
    out[PH.TURN_BIAS] = Math.max(0, Math.min(1, turnSum * 0.2 + 0.1));
    out[PH.WANDER_NOISE] = Math.max(0, Math.min(1, wanderSum * 0.2 + 0.05));
    out[PH.EXPLORE_BIAS] = Math.max(0, Math.min(1, exploreSum * 0.15 + 0.05));
    out[PH.REPRO_THRESHOLD] = Math.max(35, Math.min(200, reproSum * 22 + 40));
    out[PH.FOOD_EFFICIENCY] = Math.max(0.2, Math.min(3.5, effSum * 0.6 + 0.4));
    out[PH.MUTABILITY] = Math.max(0.0005, Math.min(0.25, mutSum * 0.02));
    out[PH.LONGEVITY] = Math.max(60, Math.min(2500, longSum * 120 + 400));
    out[PH.CARRY_BONUS] = Math.max(0, Math.min(3, Math.floor(carrySum * 0.4)));
    out[PH.THERMAL_EFF] = Math.max(0.2, Math.min(2.5, thermSum * 0.4 + 0.6));
    out[PH.AGGRESSION] = Math.max(0, Math.min(3.0, aggrSum * 0.8 + 0.2));
    out[PH.SOCIALITY] = Math.max(0, Math.min(2.0, socialSum * 0.5 + 0.1));

    // Derived epistatic metabolism.
    const speedCost = out[PH.SPEED] * out[PH.SPEED] * 0.12;
    const senseCost = out[PH.SENSE_RANGE] * out[PH.SENSE_RANGE] * 0.008;
    const baseCost = Math.max(0.05, metabSum * 0.08);
    const predatorTax = sp === 3 ? 0.03 : 0;
    out[PH.METABOLISM] = (baseCost + speedCost + senseCost + predatorTax) / out[PH.THERMAL_EFF];

    // Behavior weights are allowed to be negative (repulsion) or positive.
    out[PH.W_FOOD] = wFoodSum;
    out[PH.W_PREY] = wPreySum;
    out[PH.W_FLEE_PREDATOR] = Math.max(0, wFleeSum);
    out[PH.W_AGGRESSION_SAME] = wAggrSameSum;
    out[PH.W_AGGRESSION_OTHER] = wAggrOtherSum;
    out[PH.W_EXPLORE] = Math.max(0, wExploreSum);
    out[PH.W_SHELTER] = wShelterSum;
    out[PH.W_FARM] = wFarmSum;

    out[PH.MEMORY] = Math.max(0, Math.min(8, Math.floor(memSum * 2 + 2)));
    out[PH.LEARNING_RATE] = Math.max(0, Math.min(1, learnSum * 0.2));

    return out;
  }

  /**
   * Run the bicameral modulatory network.
   * genome:       full Float64Array genome storage.
   * weightOffset: index where the NN weights begin for this organism.
   * inputs:       Float32Array/Array of length NN.INPUTS.
   * out:          Float32Array/Array of length NN.OUTPUTS.
   *
   * Outputs are multipliers centered around 1.0, clamped to [0.2, 2.0].
   */
  function computeNNOutputs(genome, weightOffset, inputs, out) {
    let w = weightOffset;
    let h0 = 0,
      h1 = 0,
      h2 = 0,
      h3 = 0;

    // Input -> hidden.
    for (let i = 0; i < NN.INPUTS; i++) {
      const v = inputs[i];
      h0 += v * genome[w++];
      h1 += v * genome[w++];
      h2 += v * genome[w++];
      h3 += v * genome[w++];
    }

    // Hidden bias + ReLU.
    h0 = h0 + genome[w++];
    h1 = h1 + genome[w++];
    h2 = h2 + genome[w++];
    h3 = h3 + genome[w++];
    if (h0 < 0) h0 = 0;
    if (h1 < 0) h1 = 0;
    if (h2 < 0) h2 = 0;
    if (h3 < 0) h3 = 0;

    // Hidden -> output. Each output is a multiplier around 1.0.
    for (let o = 0; o < NN.OUTPUTS; o++) {
      let sum = genome[w++]; // output bias
      sum += h0 * genome[w++];
      sum += h1 * genome[w++];
      sum += h2 * genome[w++];
      sum += h3 * genome[w++];
      const mult = 1.0 + 0.5 * sum;
      out[o] = mult < 0.2 ? 0.2 : mult > 2.0 ? 2.0 : mult;
    }
  }

  /**
   * Create a fresh memome vector (all zeros = no cultural knowledge).
   */
  function createMemome() {
    return new Float32Array(MEMOME_LENGTH);
  }

  /**
   * Copy a memome with optional small innovation noise.
   */
  function copyMemome(source, innovationRate = 0) {
    const m = new Float32Array(source);
    if (innovationRate > 0) {
      for (let i = 0; i < MEMOME_LENGTH; i++) {
        if (Math.random() < innovationRate) {
          m[i] += randNormal(0, 0.05);
        }
      }
    }
    return m;
  }

  return {
    GENE_COUNT,
    ALLELES_PER_GENE,
    BASE_GENOME_LENGTH,
    GENOME_LENGTH,
    GENE,
    NN,
    NN_OUT,
    NN_INPUT,
    NN_WEIGHT_COUNT,
    MEMOME_LENGTH,
    PH,
    randNormal,
    createRandomGenome,
    createSpeciesGenome,
    cloneGenome,
    mutate,
    crossover,
    geneSum,
    computePhenome,
    computeNNOutputs,
    createMemome,
    copyMemome,
  };
})();
