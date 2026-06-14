/**
 * Ant individual: position, energy, age, and a diploid genome.
 * Phenotypes are derived from allele sums plus epistatic trade-offs.
 */

const Ant = (function () {
  const { GENE, geneSum, createRandomGenome } = Genetics;

  class Ant {
    constructor(x, y, genome) {
      this.x = x | 0;
      this.y = y | 0;
      this.energy = 40 + Math.random() * 40;
      this.age = 0;
      this.genome = genome || createRandomGenome();
      this.cachePhenotype();
    }

    cachePhenotype() {
      const g = this.genome;

      // Raw additive values from diploid allele sums.
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

      // Phenotypes with soft clamps.
      this.pSpeed = Math.max(0.02, Math.min(2.5, speedSum * 0.35));
      this.pSenseRange = Math.max(2, Math.min(6, Math.floor(senseSum * 2.5 + 2)));
      this.pTurnBias = Math.max(0, Math.min(1, turnSum * 0.2 + 0.1));
      this.pWanderNoise = Math.max(0, Math.min(1, wanderSum * 0.2 + 0.05));
      this.pExploreBias = Math.max(0, Math.min(1, exploreSum * 0.15 + 0.05));
      this.pReproThreshold = Math.max(35, Math.min(180, reproSum * 22 + 40));
      this.pFoodEfficiency = Math.max(0.2, Math.min(3.0, effSum * 0.6 + 0.4));
      this.pMutability = Math.max(0.0005, Math.min(0.25, mutSum * 0.02));
      this.pLongevity = Math.max(80, Math.min(3000, longSum * 120 + 400));
      this.pCarryBonus = Math.max(0, Math.min(3, Math.floor(carrySum * 0.4)));
      this.pThermalEff = Math.max(0.2, Math.min(2.0, thermSum * 0.4 + 0.6));

      // Advanced epistatic metabolism:
      // faster + farther sensing is costly, but thermal efficiency helps.
      const speedCost = this.pSpeed * this.pSpeed * 0.12;
      const senseCost = this.pSenseRange * this.pSenseRange * 0.008;
      const baseCost = Math.max(0.05, metabSum * 0.08);
      this.pMetabolism = (baseCost + speedCost + senseCost) / this.pThermalEff;
    }

    /**
     * Recalculate phenotypes after mutation/recombination.
     */
    refresh() {
      this.cachePhenotype();
    }
  }

  return { Ant };
})();
