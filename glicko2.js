/**
 * Glicko2 Rating System Implementation
 *
 * Based on the Glicko-2 algorithm by Mark E. Glickman.
 * http://www.glicko.net/glicko/glicko2.pdf
 */

const PI_SQUARED = Math.PI * Math.PI;
const RATING_CONVERSION = 173.7178;
const RATING_OFFSET = 1500;
const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;
const DEFAULT_VOLATILITY = 0.06;
const TAU = 0.5;
const EPSILON = 1e-6;

// ─── Glicko2 scale conversions ────────────────────────────────────────────────

function toGlicko2(rating, rd) {
  return {
    mu: (rating - RATING_OFFSET) / RATING_CONVERSION,
    phi: rd / RATING_CONVERSION,
  };
}

function toGlicko1(mu, phi) {
  return {
    rating: RATING_CONVERSION * mu + RATING_OFFSET,
    rd: RATING_CONVERSION * phi,
  };
}

// ─── Core Glicko2 functions ───────────────────────────────────────────────────

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / PI_SQUARED);
}

function E(mu, mu_j, phi_j) {
  return 1 / (1 + Math.exp(-g(phi_j) * (mu - mu_j)));
}

/**
 * The f(x) function used in the volatility update iteration.
 */
function f(x, delta, phi, v, a, tau) {
  const exp_x = Math.exp(x);
  const numerator = exp_x * (delta * delta - phi * phi - v - exp_x);
  const denominator = 2 * (phi * phi + v + exp_x) * (phi * phi + v + exp_x);
  return numerator / denominator - (x - a) / (tau * tau);
}

/**
 * Update volatility using the bisection method (guaranteed convergence).
 */
function updateVolatility(sigma, delta, phi, v, tau) {
  const a = Math.log(sigma * sigma);
  let low, high;

  if (delta * delta > phi * phi + v) {
    const B = Math.log(delta * delta - phi * phi - v);
    // f(a) > 0 and f(B) = -(B-a)/τ² < 0 when δ² - φ² - v > σ²
    // f(a) < 0 and f(B) > 0 when δ² - φ² - v < σ²
    low = Math.min(a, B);
    high = Math.max(a, B);
  } else {
    // f(a) < 0 in this case; find B < a where f(B) > 0
    let k = 1;
    while (f(a - k * tau, delta, phi, v, a, tau) < 0) {
      k++;
    }
    low = a - k * tau;
    high = a;
  }

  // Safety: ensure f(low) and f(high) have opposite signs
  let f_low = f(low, delta, phi, v, a, tau);
  let f_high = f(high, delta, phi, v, a, tau);
  let guard = 0;
  while (f_low * f_high > 0 && guard < 50) {
    high = high + 1;
    f_high = f(high, delta, phi, v, a, tau);
    guard++;
  }
  if (guard >= 50) {
    // Fallback — return current volatility unchanged
    return sigma;
  }

  // Bisection
  while (high - low > EPSILON) {
    const mid = (low + high) / 2;
    const f_mid = f(mid, delta, phi, v, a, tau);

    if (f_mid * f_low <= 0) {
      high = mid;
      f_high = f_mid;
    } else {
      low = mid;
      f_low = f_mid;
    }
  }

  // Root x = (low + high)/2, new volatility = exp(x/2)
  return Math.exp((low + high) / 4);
}

// ─── Tier definitions ─────────────────────────────────────────────────────────

const TIERS = [
  { min: 0, max: 999, name: '初学' },
  { min: 1000, max: 1199, name: '业余1段' },
  { min: 1200, max: 1399, name: '业余2段' },
  { min: 1400, max: 1599, name: '业余3段' },
  { min: 1600, max: 1799, name: '业余4段' },
  { min: 1800, max: 1999, name: '业余5段' },
  { min: 2000, max: 2199, name: '业余6段' },
  { min: 2200, max: 2399, name: '业余7段' },
  { min: 2400, max: 2599, name: '业余8段' },
  { min: 2600, max: 2799, name: '业余9段' },
  { min: 2800, max: 2999, name: '专业1段' },
  { min: 3000, max: 3199, name: '专业2段' },
  { min: 3200, max: 3399, name: '专业3段' },
  { min: 3400, max: 3599, name: '专业4段' },
  { min: 3600, max: 3799, name: '专业5段' },
  { min: 3800, max: 3999, name: '专业6段' },
  { min: 4000, max: 4199, name: '专业7段' },
  { min: 4200, max: 4399, name: '专业8段' },
  { min: 4400, max: 4599, name: '专业9段' },
  { min: 4600, max: 4999, name: '大师' },
  { min: 5000, max: Infinity, name: '传奇' },
];

const TIER_COLORS = {
  '初学': '#8B7355',
  '业余1段': '#2E8B57', '业余2段': '#2E8B57', '业余3段': '#2E8B57',
  '业余4段': '#1E90FF', '业余5段': '#1E90FF', '业余6段': '#1E90FF',
  '业余7段': '#9370DB', '业余8段': '#9370DB', '业余9段': '#9370DB',
  '专业1段': '#FF4500', '专业2段': '#FF4500', '专业3段': '#FF4500',
  '专业4段': '#FF4500', '专业5段': '#FF4500', '专业6段': '#FF4500',
  '专业7段': '#FF4500', '专业8段': '#FF4500', '专业9段': '#FF4500',
  '大师': '#FFD700',
  '传奇': '#FF0000',
};

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Calculate new rating, RD, and volatility after a series of games.
 *
 * @param {number} [rating=1500]  - Current rating
 * @param {number} [rd=350]       - Current rating deviation
 * @param {number} [volatility=0.06] - Current volatility
 * @param {Array}  [results=[]]   - Array of { opponent_rating, opponent_rd, score }
 *                                  where score is 1 (win), 0.5 (draw), or 0 (loss)
 * @returns {{ rating: number, rd: number, volatility: number }}
 */
function calculate(rating, rd, volatility, results) {
  rating = rating !== undefined ? rating : DEFAULT_RATING;
  rd = rd !== undefined ? rd : DEFAULT_RD;
  volatility = volatility !== undefined ? volatility : DEFAULT_VOLATILITY;
  results = results || [];

  // Step 1: Convert to Glicko-2 scale
  const { mu, phi } = toGlicko2(rating, rd);

  // No games played — just expand RD and keep rating / volatility unchanged
  if (results.length === 0) {
    const newPhi = Math.sqrt(phi * phi + volatility * volatility);
    const { rating: newRating, rd: newRd } = toGlicko1(mu, newPhi);
    return { rating: newRating, rd: newRd, volatility };
  }

  // Step 2: Compute v (variance of the rating estimate) and Δ (delta)
  let vSum = 0;
  let deltaSum = 0;

  for (const result of results) {
    const { mu: mu_j, phi: phi_j } = toGlicko2(
      result.opponent_rating,
      result.opponent_rd,
    );
    const g_val = g(phi_j);
    const E_val = E(mu, mu_j, phi_j);
    vSum += g_val * g_val * E_val * (1 - E_val);
    deltaSum += g_val * (result.score - E_val);
  }

  const v = 1 / vSum;
  const delta = v * deltaSum;

  // Step 3: Update volatility
  const newSigma = updateVolatility(volatility, delta, phi, v, TAU);

  // Step 4: Update φ* (new pre-rating RD) and μ' (new rating)
  const phi_star = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phi_star * phi_star) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  // Step 5: Convert back to Glicko-1 scale
  const { rating: newRating, rd: newRd } = toGlicko1(newMu, newPhi);

  return {
    rating: newRating,
    rd: newRd,
    volatility: newSigma,
  };
}

/**
 * Calculate the expected score (win probability) against an opponent.
 *
 * @param {number} rating          - Player's rating
 * @param {number} opponent_rating - Opponent's rating
 * @param {number} opponent_rd     - Opponent's rating deviation
 * @returns {number} Win probability between 0 and 1
 */
function expectedScore(rating, opponent_rating, opponent_rd) {
  // Player's phi is not needed for the E formula — only the opponent's phi
  // and the rating difference matter.
  const mu = (rating - RATING_OFFSET) / RATING_CONVERSION;
  const { mu: mu_j, phi: phi_j } = toGlicko2(opponent_rating, opponent_rd);
  return E(mu, mu_j, phi_j);
}

/**
 * Get the tier name for a given rating.
 *
 * @param {number} rating
 * @returns {string} Tier name (e.g. '业余3段', '专业1段', '传奇')
 */
function getTier(rating) {
  for (const tier of TIERS) {
    if (rating >= tier.min && rating <= tier.max) {
      return tier.name;
    }
  }
  return '传奇';
}

/**
 * Get the hex color code for a given tier name.
 *
 * @param {string} tier - Tier name returned by getTier()
 * @returns {string} Hex color code (e.g. '#8B7355')
 */
function getTierColor(tier) {
  return TIER_COLORS[tier] || '#8B7355';
}

/**
 * Calculate a dynamic multiplier based on win/loss streak and total games played.
 *
 * @param {number} streak       - Positive = win streak, negative = lose streak
 * @param {number} games_played - Total number of games played
 * @returns {number} Multiplier (1.0 = normal, higher = bigger changes)
 */
function getStreakMultiplier(streak, games_played) {
  const absStreak = Math.abs(streak);
  let multiplier = 1.0;

  if (absStreak >= 3) {
    multiplier = 1.0 + (absStreak - 2) * 0.15;
    if (multiplier > 2.0) {
      multiplier = 2.0;
    }
  }

  if (games_played < 20) {
    multiplier *= 1.5;
  }

  return multiplier;
}

// ─── Module exports ───────────────────────────────────────────────────────────

module.exports = {
  calculate,
  expectedScore,
  getTier,
  getTierColor,
  getStreakMultiplier,
};