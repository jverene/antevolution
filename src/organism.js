/**
 * Organism individual: position, energy, age, species, and a diploid genome.
 * Phenotypes are derived from allele sums plus epistatic trade-offs.
 */

const Organism = (function () {
  const { GENE, geneSum, createRandomGenome, createSpeciesGenome } = Genetics;

  class Organism {
    constructor(x, y, species, genome) {
      this.x = x | 0;
      this.y = y | 0;
      this.species = species | 0;
      this.energy = 40 + Math.random() * 40;
      this.age = 0;
      this.genome = genome || createRandomGenome();
      this.cachePhenotype();
    }

    cachePhenotype() {
      const g = this.genome;
      const sp = this.species;

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
      const aggrSum = geneSum(g, GENE.AGGRESSION);
      const socialSum = geneSum(g, GENE.SOCIALITY);

      // Phenotypes with soft clamps. Species-specific multipliers shift the
      // trait ranges so each ecological role starts in a viable region.
      const speciesSpeedMult = sp === 3 ? 1.25 : sp === 2 ? 1.15 : 1.0;
      const speciesSenseMult = sp === 3 ? 1.3 : sp === 2 ? 1.1 : 1.0;

      this.pSpeed = Math.max(0.02, Math.min(2.8, speedSum * 0.35 * speciesSpeedMult));
      this.pSenseRange = Math.max(2, Math.min(8, Math.floor(senseSum * 2.5 * speciesSenseMult + 2)));
      this.pTurnBias = Math.max(0, Math.min(1, turnSum * 0.2 + 0.1));
      this.pWanderNoise = Math.max(0, Math.min(1, wanderSum * 0.2 + 0.05));
      this.pExploreBias = Math.max(0, Math.min(1, exploreSum * 0.15 + 0.05));
      this.pReproThreshold = Math.max(35, Math.min(200, reproSum * 22 + 40));
      this.pFoodEfficiency = Math.max(0.2, Math.min(3.5, effSum * 0.6 + 0.4));
      this.pMutability = Math.max(0.0005, Math.min(0.25, mutSum * 0.02));
      this.pLongevity = Math.max(60, Math.min(2500, longSum * 120 + 400));
      this.pCarryBonus = Math.max(0, Math.min(3, Math.floor(carrySum * 0.4)));
      this.pThermalEff = Math.max(0.2, Math.min(2.0, thermSum * 0.4 + 0.6));
      this.pAggression = Math.max(0, Math.min(3.0, aggrSum * 0.8 + 0.2));
      this.pSociality = Math.max(0, Math.min(2.0, socialSum * 0.5 + 0.1));

      // Advanced epistatic metabolism:
      // faster + farther sensing is costly, but thermal efficiency helps.
      const speedCost = this.pSpeed * this.pSpeed * 0.12;
      const senseCost = this.pSenseRange * this.pSenseRange * 0.008;
      const baseCost = Math.max(0.05, metabSum * 0.08);
      // Predators pay a higher base metabolic tax for their active lifestyle.
      const predatorTax = sp === 3 ? 0.08 : 0;
      this.pMetabolism = (baseCost + speedCost + senseCost + predatorTax) / this.pThermalEff;
    }

    /**
     * Recalculate phenotypes after mutation/recombination.
     */
    refresh() {
      this.cachePhenotype();
    }

    /**
     * Convenience factory for a given species.
     */
    static create(x, y, species) {
      const genome = createSpeciesGenome(species);
      return new Organism(x, y, species, genome);
    }
  }

  return { Organism };
})();
