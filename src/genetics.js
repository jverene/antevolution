/**
 * Genetics engine: diploid chromosomes, quantitative traits,
 * point mutation, and meiotic crossover.
 *
 * Each ant has a genome of 16 genes x 2 alleles = 32 floating-point values.
 * Genes are additive (phenotype ~= allele sum) with nonlinear epistatic
 * penalties so trait combinations matter for fitness.
 */

const Genetics = (function () {
  const GENE_COUNT = 16;
  const ALLELES_PER_GENE = 2;
  const GENOME_LENGTH = GENE_COUNT * ALLELES_PER_GENE;

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
    for (let i = 0; i < GENOME_LENGTH; i++) {
      // Alleles centered around small positive defaults.
      g[i] = randNormal(0.5, 0.25);
    }
    return g;
  }

  function cloneGenome(source) {
    return new Float64Array(source);
  }

  /**
   * Point mutation plus rare chromosomal-scale events.
   * mutability is the ant's own per-allele mutation standard deviation.
   */
  function mutate(genome, mutability) {
    const baseRate = Math.max(0.0001, Math.min(0.5, mutability));
    const pointProb = 0.04 + baseRate * 0.5; // ~4-29% chance per allele touched

    for (let gene = 0; gene < GENE_COUNT; gene++) {
      for (let a = 0; a < ALLELES_PER_GENE; a++) {
        const idx = gene * ALLELES_PER_GENE + a;
        if (Math.random() < pointProb) {
          const effect = randNormal(0, 0.08 + baseRate * 0.5);
          genome[idx] += effect;
        }
      }
    }

    // Rare large-effect mutation (regulatory / chromosomal rearrangement).
    if (Math.random() < 0.005 * baseRate) {
      const gene = Math.floor(Math.random() * GENE_COUNT);
      const idx = gene * ALLELES_PER_GENE + Math.floor(Math.random() * 2);
      genome[idx] += randNormal(0, 1.2);
    }
  }

  /**
   * Meiotic crossover between two diploid genomes.
   * For each gene we swap one randomly chosen allele with probability 0.5,
   * modeling a single crossover event per chromosome.
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
  }

  /**
   * Sum the two alleles for a gene.
   */
  function geneSum(genome, gene) {
    const i = gene * ALLELES_PER_GENE;
    return genome[i] + genome[i + 1];
  }

  return {
    GENE_COUNT,
    ALLELES_PER_GENE,
    GENOME_LENGTH,
    GENE,
    randNormal,
    createRandomGenome,
    cloneGenome,
    mutate,
    crossover,
    geneSum,
  };
})();
