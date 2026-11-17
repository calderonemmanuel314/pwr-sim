// SPDX-License-Identifier: AGPL-3.0-or-later
import { clamp } from './dom.js';

export const WATER_TC_K = 647.096;
export const WATER_PC_MPA = 22.064;
export const WATER_TTRIPLE_C = 0.01;
export const WATER_PTRIPLE_MPA = 0.000611657;

export const psat = T => {
  if (T <= WATER_TTRIPLE_C) return WATER_PTRIPLE_MPA;
  if (T >= WATER_TC_K - 273.15) return WATER_PC_MPA;
  const tk = T + 273.15, theta = 1 - tk / WATER_TC_K;
  const a = -7.85951783 * theta + 1.84408259 * Math.pow(theta, 1.5) - 11.7866497 * Math.pow(theta, 3)
    + 22.6807411 * Math.pow(theta, 3.5) - 15.9618719 * Math.pow(theta, 4) + 1.80122502 * Math.pow(theta, 7.5);
  return WATER_PC_MPA * Math.exp((WATER_TC_K / tk) * a);
};

export const tsat = P => {
  if (P <= WATER_PTRIPLE_MPA) return WATER_TTRIPLE_C;
  if (P >= WATER_PC_MPA) return WATER_TC_K - 273.15;
  let lo = WATER_TTRIPLE_C, hi = WATER_TC_K - 273.15;
  for (let n = 0; n < 48; n++) {
    const mid = (lo + hi) / 2;
    if (psat(mid) < P) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
};

export const PS = Array.from({ length: 75 }, (_, j) => {
  const t = WATER_TTRIPLE_C + (WATER_TC_K - 273.15 - WATER_TTRIPLE_C) * j / 74;
  return [t, psat(t)];
});

export const phaseOf = (T, P) => {
  if (T >= 373.946 && P >= 22.064) return ['SUPERCRITICAL FLUID', '#b36bff'];
  if (P >= 22.064 && T < 373.946) return ['COMPRESSED / SUBCOOLED LIQUID', '#35c8ff'];
  const deltaT = T - tsat(P);
  if (Math.abs(deltaT) <= .05) return ['SATURATION BOUNDARY', '#ffd400'];
  if (deltaT < 0) return ['SUBCOOLED LIQUID', '#35c8ff'];
  if (T >= 373.946) return ['SUPERHEATED VAPOR', '#ff7a2a'];
  return ['VAPOR REGION (MODEL)', '#ff2a2a'];
};

export const NU_BAR = 2.43;
export const BETA_GROUPS = [.000215, .001424, .001274, .002568, .000748, .000273];
export const LAMBDA_GROUPS = [.0124, .0305, .111, .301, 1.14, 3.01];
export const BETA_EFF = BETA_GROUPS.reduce((a, b) => a + b, 0);
export const LAMBDA_PROMPT_MODEL = .10;
export const THERMAL_TO_ELECTRIC = 0.33;
export const STATION_SERVICE_FRACTION = 0.05;
export const H_FUEL_COOLANT = 3.33;
export const TAU_FUEL = 3;
export const ALPHA_DOPPLER = 0.00005;
export const NEUTRON_SOURCE = 0.00005;
export const NEUTRON_WEIGHTS = { fuelCapture: .25, structuralCapture: .35, rodCapture: .20, boronCapture: .47, xenonCapture: .42, leakage: .35 };

export const gridPowerMWe = thermalMW => Math.max(0, thermalMW * THERMAL_TO_ELECTRIC * (1 - STATION_SERVICE_FRACTION));
const smoothStep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

const coolantFeedbackFraction = (T, P) => {
  if (P < 22.064) return smoothStep((T - tsat(P)) / 30);
  if (T >= 373.946) return smoothStep((T - 373.946) / 60);
  return 0;
};

export const neutronBalance = (i, xe, T, P, Tf, alphaD) => {
  const w = NEUTRON_WEIGHTS;
  const aD = (alphaD !== undefined) ? alphaD : ALPHA_DOPPLER;
  const rodFrac = clamp(i.rods, 0, 100) / 100;
  const rodWorthShape = rodFrac * rodFrac * (3 - 2 * rodFrac);
  const moderatorFeedback = .00008 * Math.max(0, T - 280);
  const coolantDensityFeedback = .05 * coolantFeedbackFraction(T, P);
  const dopplerFeedback = aD * Math.max(0, (Tf ?? T) - T);
  const channels = {
    fuelFission: 1,
    fuelNonFissionCapture: w.fuelCapture,
    structuralCapture: w.structuralCapture,
    controlRodAbsorption: w.rodCapture * rodWorthShape,
    solubleBoronAbsorption: w.boronCapture * clamp(i.boron, 0, 2000) / 2000,
    xenonAbsorption: w.xenonCapture * Math.max(0, xe),
    leakage: w.leakage,
    moderatorFeedback,
    coolantDensityFeedback,
    dopplerFeedback,
  };
  const totalWeight = Object.values(channels).reduce((a, b) => a + b, 0);
  const fissionProbability = channels.fuelFission / totalWeight;
  const kEff = NU_BAR * fissionProbability;
  const rho = (kEff - 1) / kEff;
  return { kEff, rho, fissionProbability, channels, totalWeight };
};

export const equilibriumPrecursors = power => BETA_GROUPS.map((b, j) => b * power / (LAMBDA_PROMPT_MODEL * LAMBDA_GROUPS[j]));

export function advancePointKinetics(power, precursors, rho) {
  const steps = 100, h = 1 / steps, y0 = [Math.max(0, power), ...precursors];
  const derivative = y => {
    const n = y[0], c = y.slice(1), d = [0, 0, 0, 0, 0, 0, 0];
    d[0] = ((rho - BETA_EFF) / LAMBDA_PROMPT_MODEL) * n + NEUTRON_SOURCE;
    for (let j = 0; j < 6; j++) {
      d[0] += LAMBDA_GROUPS[j] * c[j];
      d[j + 1] = (BETA_GROUPS[j] / LAMBDA_PROMPT_MODEL) * n - LAMBDA_GROUPS[j] * c[j];
    }
    return d;
  };
  let y = y0;
  for (let step = 0; step < steps; step++) {
    const k1 = derivative(y), y2 = y.map((v, j) => v + h * k1[j] / 2), k2 = derivative(y2),
      y3 = y.map((v, j) => v + h * k2[j] / 2), k3 = derivative(y3),
      y4 = y.map((v, j) => v + h * k3[j]), k4 = derivative(y4);
    y = y.map((v, j) => v + h * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]) / 6);
    if (!y.every(Number.isFinite)) return { power: 1e6, precursors: y0.slice(1) };
    y[0] = clamp(y[0], 0, 1e6);
    for (let j = 1; j < 7; j++) y[j] = clamp(y[j], 0, 1e12);
  }
  return { power: y[0], precursors: y.slice(1) };
}

export const coolantHeatRemovalFactor = (T, P) => {
  if (P >= 22.064 && T >= 373.946) return 1 - .35 * smoothStep((T - 373.946) / 60);
  return 1 - .45 * smoothStep(Math.max(0, T - tsat(P)) / 30);
};

export const formatCps = c => c < 1e3 ? c.toFixed(0) + ' cps'
  : c < 1e6 ? (c / 1e3).toFixed(2) + ' kcps'
  : c < 1e9 ? (c / 1e6).toFixed(2) + ' Mcps'
  : (c / 1e9).toFixed(2) + ' Gcps';

export const formatDose = u => u < 1000 ? u.toFixed(1) + ' µSv/hr' : (u / 1000).toFixed(2) + ' mSv/hr';
export const formatPeriod = (s, stable) => stable ? '+∞ (stable)' : ((s > 0 ? '+' : '−') + Math.abs(s).toFixed(0) + 's');
export const formatRho = p => (p >= 0 ? '+' : '') + p.toFixed(0) + ' pcm';

export function doseFromState(Nf, n16, precursors, fp) {
  const prompt = 5000 * (Nf / 1000);
  const n16d = 4000 * n16;
  const sumLC = precursors.reduce((a, c, i) => a + LAMBDA_GROUPS[i] * c, 0);
  const sumLCeq = BETA_EFF * 1000 / LAMBDA_PROMPT_MODEL;
  const delayed = 2600 * (sumLC / sumLCeq);
  const fpd = 2500 * fp;
  return prompt + n16d + delayed + fpd;
}

export const pmSVG = (pre, dots) => {
  const fx = T => 50 + T * .98, fy = P => 380 - P * 12, lp = 'M' + PS.map(a => fx(a[0]) + ' ' + fy(a[1])).join('L');
  const tx = (x, y, t, c, a) => '<text x="' + x + '" y="' + y + '" fill="' + (c || '#9ab') + '" font-size="11"' + (a ? ' text-anchor="' + a + '"' : '') + '>' + t + '</text>';
  let h = '<rect x="50" y="20" width="490" height="360" fill="#1a1d1a"/><path d="' + lp + 'L' + fx(373.946) + ' 20L50 20L50 380Z" fill="#1e6bff33"/><rect x="' + fx(373.946) + '" y="20" width="' + (540 - fx(373.946)) + '" height="' + (fy(22.064) - 20) + '" fill="#b36bff55"/><path d="' + lp + '" stroke="#35c8ff" stroke-width="2.5" fill="none"/>';
  for (let t = 0; t <= 500; t += 100) h += tx(fx(t), 396, t, 0, 'middle');
  for (let q = 0; q <= 30; q += 10) h += tx(44, fy(q) + 4, q, 0, 'end');
  h += '<path d="M50 ' + fy(17.2) + 'H540" stroke="#ffd400" stroke-dasharray="5 4"/>' + tx(56, fy(17.2) - 4, 'MODEL RELIEF SETPOINT 17.2 MPa', '#ffd400')
    + '<path d="M50 ' + fy(24) + 'H540" stroke="#ff2a2a" stroke-dasharray="5 4"/>' + tx(56, fy(24) - 4, 'MODEL PRESSURE LIMIT 24 MPa', '#ff6a6a')
    + tx(70, fy(10) - 6, 'LIQUID (subcooled)', '#7fb8ff') + tx(330, 350, 'STEAM / GAS', '#aaa') + tx(fx(373.946) + 6, fy(26) + 4, 'SUPERCRITICAL', '#d9a8ff')
    + tx(300, fy(5) - 6, 'IAPWS-95 saturation boundary', '#35c8ff')
    + '<circle cx="' + fx(373.946) + '" cy="' + fy(22.064) + '" r="5" fill="#fff"/>' + tx(fx(373.946) - 8, fy(22.064) + 16, 'CRITICAL POINT 373.946 °C · 22.064 MPa', '#fff', 'end')
    + '<circle cx="' + fx(315) + '" cy="' + fy(15.5) + '" r="7" fill="none" stroke="#39ff14" stroke-width="2"/>' + tx(fx(315) - 12, fy(15.5) + 18, 'ILLUSTRATIVE PWR POINT · 315 °C / 15.5 MPa', '#39ff14', 'end');
  if (dots) h += '<circle id="' + pre + 'dot2" r="6" fill="#35c8ff" stroke="#000" cx="' + fx(280) + '" cy="380"/><circle id="' + pre + 'dot" r="7" fill="#ffd400" stroke="#000" cx="50" cy="380"/>';
  return h + tx(60, 414, '● HOT LEG', '#ffd400') + tx(230, 414, '● COLD LEG (inlet, 280 °C)', '#35c8ff') + tx(300, 432, 'TEMPERATURE (°C)')
    + '<text transform="rotate(-90 12 200)" x="12" y="200" fill="#9ab" font-size="11" text-anchor="middle">PRESSURE (MPa)</text>' + tx(536, 372, 'MODEL MAP', '#ffd400', 'end');
};
