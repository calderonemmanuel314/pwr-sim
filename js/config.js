// SPDX-License-Identifier: AGPL-3.0-or-later
export const APP_VERSION = '2.4.1';
export const APP_BUILD = '2026-11-17';

export const ROLES = {
  rods: { n: 'DIV 1 · CONTROL RODS', k: ['rods'] },
  coolant: { n: 'DIV 2 · THERMAL-HYDRAULICS', k: ['pump'] },
  pressure: { n: 'DIV 3 · PRESSURIZER', k: ['heat', 'spray'] },
  xenon: { n: 'DIV 4 · BORON / POISON MANAGEMENT', k: ['boron'] },
};

export const ROLE_KEYS = ['rods', 'coolant', 'pressure', 'xenon'];
export const DEF = () => ({ rods: 70, pump: 50, heat: 0, spray: 0, boron: 500 });

export const DIFF = {
  easy: {
    k: 'easy', n: 'EASY', t: 'Morning Ramp-Up', rem: 600, band: 300, hold: 10, cd: 5, subcoolMargin: 5,
    pressureDrift: .10, tempDrift: 3.0, powerDrift: 55,
    thermalTau: 250, pressureRate: 0.5, alphaDoppler: 0.00015,
    thermalHigh: 360, thermalCritical: 400, pressureHigh: 19, pressureLow: 11, pressureCriticalHigh: 23, pressureCriticalLow: 10,
    failOver: 26, failDepr: 9,
    rodsMin: 5, rodsMax: 95, pumpMin: 25, pumpMax: 100, boronMin: 100, boronMax: 1500,
    initialFissionPower: 275, hints: 1,
    story: 'Overnight demand was light, so the reactor has been at about 30% power for 8 hours. Factories open at 7:00 and the city needs full output.',
    goal: 'Supply about 315 MWe to the grid (accepted range: ~220–410 MWe). Keep temperature and pressure safe, then leave ALL controls untouched for 10 seconds to pass.',
    short: 'Reach ~220–410 MWe, then leave controls untouched for 10 s.',
    st: { rods: 70, pump: 50, boron: 500, T: 298, P: 15.5, xe: .45, xi: .11 },
    ph: {
      rods: 'Pull rods out in small steps (lower %) for more power.',
      coolant: 'Raise pump % as power rises to keep coolant cool.',
      pressure: 'Use ▲ HEAT if pressure drops, ▼ SPRAY if it climbs.',
      xenon: 'Keep boron near 500 ppm unless fine-tuning.',
    },
  },
  moderate: {
    k: 'moderate', n: 'MODERATE', t: 'The Evening Surge', rem: 600, band: 150, hold: 8, cd: 10, subcoolMargin: 8,
    pressureDrift: .08, tempDrift: 2.5, powerDrift: 40,
    thermalTau: 175, pressureRate: 0.75, alphaDoppler: 0.00008,
    thermalHigh: 350, thermalCritical: 375, pressureHigh: 18, pressureLow: 12, pressureCriticalHigh: 22, pressureCriticalLow: 10,
    failOver: 25, failDepr: 9.5,
    rodsMin: 0, rodsMax: 100, pumpMin: 15, pumpMax: 100, boronMin: 50, boronMax: 2000,
    initialFissionPower: 105, hints: 0,
    story: 'The reactor has run at low power for 15 hours. Heatwave drives up demand; grid requests ~315 MWe.',
    goal: 'Supply about 315 MWe (accepted range: ~265–360 MWe). Watch xenon changes, keep conditions safe, and leave ALL controls untouched for 8 seconds to pass.',
    short: 'Reach ~265–360 MWe, then hold controls untouched 8 s.',
    st: { rods: 58, pump: 30, boron: 900, T: 293, P: 14.8, xe: .3319, xi: .06 },
  },
  hard: {
    k: 'hard', n: 'HARD', t: 'Restart in the Xenon Pit', rem: 480, band: 90, hold: 15, cd: 15, subcoolMargin: 6,
    pressureDrift: .06, tempDrift: 2.0, powerDrift: 32,
    thermalTau: 150, pressureRate: 1.0, alphaDoppler: 0.00005,
    thermalHigh: 350, thermalCritical: 355, pressureHigh: 17.5, pressureLow: 13, pressureCriticalHigh: 20, pressureCriticalLow: 10,
    failOver: 24, failDepr: 10,
    rodsMin: 0, rodsMax: 100, pumpMin: 0, pumpMax: 100, boronMin: 0, boronMax: 2000,
    initialFissionPower: .05, hints: 0,
    story: 'Another plant tripped. Your reactor shut down hours ago, attempting restart near the modeled xenon peak.',
    goal: 'Supply about 315 MWe (accepted range: ~285–340 MWe) within 8 minutes. Manage high xenon and equipment faults, keep conditions safe, and hold controls untouched for 15 seconds.',
    short: 'Restart from xenon pit; reach ~285–340 MWe within 8 min.',
    xeLockout: 1.05,
    st: { rods: 100, pump: 40, boron: 1200, T: 285, P: 14.2, xe: 1.4, xi: .168 },
  },
};

DIFF.sandbox = Object.assign({}, DIFF.easy, {
  k: 'sandbox', hints: 0, ph: null, rodsMin: 0, rodsMax: 100, pumpMin: 0, pumpMax: 100, boronMin: 0, boronMax: 2000,
});
DIFF.advanced = Object.assign({}, DIFF.easy, {
  k: 'advanced', hints: 0, ph: null, rodsMin: 0, rodsMax: 100, pumpMin: 0, pumpMax: 100, boronMin: 0, boronMax: 2000,
});

export const ES = {
  boil: { res: 'lose', m: 0, cls: 'es-boil', t: 'COOLANT CAN NO LONGER BE COOLED SAFELY', x: 'The model detected very hot coolant together with low pressure.' },
  xenonLockout: { res: 'lose', m: 0, cls: 'es-panic', t: 'THE REACTOR COULD NOT RESTART', x: 'Xenon absorbed too many neutrons to restart, and the crew returned to shutdown settings.' },
  spike: { res: 'lose', m: 0, cls: 'es-spike', t: 'POWER RAN AWAY · EMERGENCY STOP', x: 'Extremely hot coolant, nearly withdrawn rods, and very little boron.' },
  time: { res: 'lose', m: 0, cls: 'es-time', t: 'TIME IS UP · GRID TARGET NOT REACHED', x: 'Time ran out before grid power was held steady in the target band.' },
  win: { res: 'win', m: 0, cls: 'es-win', t: 'SUCCESS · STEADY ELECTRICITY TO THE GRID', x: 'Team held grid power near 315 MWe with safe temperature and pressure.' },
  heat: { res: 'lose', m: 0, cls: 'es-boil', t: 'COOLANT TEMPERATURE TOO HIGH', x: 'Hot-leg coolant much hotter than the game’s allowed limit.' },
  over: { res: 'lose', m: 0, cls: 'es-boil', t: 'PRESSURE TOO HIGH', x: 'Pressure went beyond the game’s pressure limit.' },
  depr: { res: 'lose', m: 0, cls: 'es-boil', t: 'PRESSURE TOO LOW', x: 'Pressure fell below the game’s limit.' },
};

export const LEARN = {
  core: ['Reactor vessel and coolant', 'The reactor pressure vessel contains the fuel assemblies and primary coolant. Fission releases energy in the fuel; the pressurized water carries that heat to the steam generator and also slows (moderates) neutrons.', 'The top temperature gauge is the modeled hot-leg coolant temperature.'],
  fuel: ['Fuel assemblies', 'Fuel pellets are enclosed in fuel-rod cladding and grouped into assemblies. Fission releases energy and additional neutrons that can sustain a chain reaction.', 'Fuel temperature is computed internally (for Doppler feedback) but is not shown as a separate readout. Cladding temperature is not modeled.'],
  rods: ['Control rods', 'Inserting control rods (higher %) absorbs more neutrons and lowers power; pulling them out (lower %) raises power. Their effect follows an S-curve, not a straight line.', 'Division 1. Each 1% step has its strongest effect near the middle (~50%) and weaker effects near 0% and 100%.'],
  boron: ['Soluble boron', 'Boric acid dissolved in primary coolant absorbs neutrons evenly throughout the core. Diluting boron (lower ppm) raises power; adding boron (higher ppm) lowers power.', 'Division 4 sets simplified boron concentration in ppm.'],
  pump: ['Primary coolant pump', 'The primary pump circulates pressurized coolant through the reactor core and steam generator to carry heat away.', 'Division 2 adjusts pump speed (%) to control how fast heat leaves the core.'],
  press: ['Pressurizer', 'The pressurizer helps control primary-system pressure. Pressure sets the saturation temperature of the coolant.', 'Division 3 selects heaters, spray, or hold.'],
  valve: ['Pressurizer relief valve', 'A relief valve opens when set pressure is exceeded.', 'This model opens at 17.2 MPa and reseats near 16.4 MPa.'],
  keff: ['Chain reaction: growing, shrinking, or steady?', 'k_eff compares generations of neutrons: k_eff = neutrons in the next generation ÷ neutrons in the current generation. k_eff < 1: chain reaction weakens (subcritical). k_eff = 1: steady (critical). k_eff > 1: chain reaction grows (supercritical). k_eff describes how the chain reaction is behaving — it is not the same as reactor power.', 'The model uses ν̄ = 2.43, β ≈ 0.0065, six delayed-neutron groups, and Λ = 0.10 s (stretched for pacing). Includes fuel-temperature/Doppler feedback — negative reactivity proportional to (T_fuel − T_coolant). Calibrated classroom parameters.'],
  xenon: ['Iodine-135 and xenon-135', 'Fission produces iodine-135, which decays into xenon-135, a strong absorber.', 'Normalized iodine/xenon with compressed time constants — teaching device.'],
  phase: ['Phase map: primary coolant', 'Plots hot-leg and cold-leg coolant temperatures against pressure. Anywhere below the blue boiling curve, the water stays liquid (subcooled).', 'Saturation-boundary only. Not a plant operating diagram.', 'chart'],
  sg: ['Steam generator', 'Hot primary coolant transfers heat across tube walls to secondary water.', 'The model shows the energy-conversion path.'],
  turb: ['Turbine', 'Steam expands through the turbine and transfers energy to a rotating shaft.', 'Animation driven by the model power value.'],
  gen: ['Generator and the path to the grid', '(1) Fission releases energy. (2) Reactor carries it as heat. (3) Heat produces steam. (4) Steam spins turbine. (5) Shaft spins generator. (6) Some electricity runs plant equipment. (7) Rest goes to the grid.', 'Reactor heat × 33% = generator gross. × 5% = plant use. Gross − plant use = net grid.'],
  cond: ['Condenser', 'Removes heat from turbine exhaust.', 'Illustrative animation.'],
  hot: ['Hot leg', 'Carries primary coolant from reactor to steam generator.', 'Yellow phase-map marker tracks hot-leg coolant temperature.'],
  cold: ['Cold leg', 'Returns primary coolant from the steam generator through the pump.', 'Cold-leg reference fixed near 280 °C.'],
  steam: ['Secondary loop', 'Receives heat through the steam-generator tubes, produces steam, drives the turbine.', 'Primary and secondary water are separate circuits.'],
  dome: ['Containment building', 'A major barrier designed to limit radioactive releases during accidents.', 'Teaching aid.'],
  dnb: ['Boiling crisis and DNB', 'Departure from nucleate boiling (DNB) happens if a hot fuel surface forms a steam blanket that blocks cooling water.', 'This classroom model does NOT calculate DNB, critical heat flux, or DNBR.'],
  model: ['What this model does and does not calculate', 'Classroom model of how chain reaction, cooling, pressure, steam, turbine, and generator affect one another.', 'Grid-power estimate: 33% heat-to-electric minus 5% plant use. All warning and failure limits are game settings.'],
};

// Experiment catalogue (Phase 4 shell).
// enabled: false for everything except the dev shell-test card until each phase ships.
// phase:  which roadmap phase builds the mechanics. duration is seconds (approx).
export const EXPERIMENTS = [
  // ── Tier 1 ──
{ id: 'rod-calibration-1m', title: 'ROD CALIBRATION BY 1/M', tier: 1, duration: 900, phase: 5, enabled: true, worksheet: 'rod-calibration-1m.pdf',
    concept: 'As you withdraw control rods, fewer neutrons are absorbed, so each fission triggers more follow-up fissions (subcritical multiplication, M). As the reactor approaches critical (k_eff = 1), M grows toward infinity—meaning its inverse 1/M drops toward 0. Plotting 1/M against rod % lets you extend a line down to 0 and predict the critical rod position safely before crossing critical.',
    goal: 'Collect subcritical 1/M measurements at your own pace, extrapolate where 1/M hits 0, and verify your prediction lands near k_eff = 1.000 without tripping Auto-SCRAM.',
    objective: 'Extrapolate the critical rod position from a 1/M plot using near-critical subcritical steps.',
    criteria: [
      'Log a baseline at 100% rods, plus at least 3 more distinct subcritical rod positions (4+ total steps).',
      'Pull rods close enough to critical that 1/M drops to 0.50 or lower (without triggering Auto-SCRAM).',
      'Click DONE to fit your near-critical points and run TEST PREDICTION.',
      'Pass target: tested k_eff in 0.998–1.002 (CRITICAL), or within ±0.010 without Auto-SCRAM (CLOSE).',
    ],
    procedure: [
      'Setup: auto-coolant holds ~307 °C, auto-pressurizer holds ~15.5 MPa, boron is locked at 1800 ppm, and xenon is frozen at 0.',
      'Start at 100% rods and press SETTLE & LOG to record your baseline (1/M = 1.00).',
      'Withdraw rods at your own pace and press SETTLE & LOG at each stop (larger steps early on; smaller 2–5% steps once 1/M falls fast).',
      'Stay subcritical: if power rises above 25 MWth, Auto-SCRAM resets rods to 100%.',
      'When you have 4+ distinct steps and 1/M has dropped clearly (ideally ≤ 0.50), press DONE to reveal k_eff and fit your line, then press TEST PREDICTION.',
    ],
    record: 'Step CSV: step, rod_pct, sim_t, s1–s5 (five cps samples), avg_cps, inv_M, k_eff.',
    limitations: 'Rod worth follows an S-curve, so 1/M vs. rod % bends across wide travel; points closer to criticality give a much better straight-line prediction. Settling is slower near k_eff = 1, and a 25 MWth Auto-SCRAM protects the core during this lab. See about.html §5.' },
  { id: 'rod-worth-inhour', title: 'ROD WORTH BY PERIOD', tier: 1, duration: 900, phase: 7, enabled: false, worksheet: 'rod-worth-inhour.pdf',
    objective: 'Convert stable period to reactivity via the inhour equation; build an integral-worth curve.',
    procedure: [], record: 'Rod position, stable period, derived reactivity.',
    limitations: 'Uses the model’s own stretched generation time; a single correction factor will not do.' },

  { id: 'delayed-neutron-counting', title: 'DELAYED NEUTRON COUNTING', tier: 1, duration: 600, phase: 6, enabled: false, worksheet: 'delayed-neutron-counting.pdf',
    objective: 'Identify the longest-lived delayed group from a post-SCRAM flux decay.',
    procedure: [], record: 'Time and count rate after SCRAM; group half-lives.',
    limitations: 'Long-time decay correct. Source floor sets the lowest count rate.' },

  { id: 'scram-transient', title: 'SCRAM TRANSIENT', tier: 1, duration: 300, phase: 7, enabled: false, worksheet: 'scram-transient.pdf',
    objective: 'Observe the prompt drop followed by the delayed tail after a SCRAM.',
    procedure: [], record: 'Time-resolved power in the first seconds.',
    limitations: 'Prompt drop visible at 1 Hz only because generation time is stretched. Teach qualitatively.' },

  { id: 'xenon-transient', title: 'XENON TRANSIENT', tier: 1, duration: 600, phase: 7, enabled: false, worksheet: 'xenon-transient.pdf',
    objective: 'Watch iodine-to-xenon buildup and burnoff after a power change.',
    procedure: [], record: 'Time, iodine, xenon, reactivity.',
    limitations: 'Xenon timescales compressed unevenly; post-trip peak small and early. See roadmap §6.' },

  // ── Tier 2 ──
  { id: 'n16-dose-decay', title: 'N-16 DOSE DECAY', tier: 2, duration: 900, phase: 8, enabled: false, worksheet: 'n16-dose-decay.pdf',
    objective: 'Follow post-shutdown dose through its staged decay.',
    procedure: [], record: 'Time and dose after shutdown.',
    limitations: 'N-16 pool exists in the model; activation products (Co-60, Fe-59) not modeled.' },

  { id: 'xenon-pit-restart', title: 'XENON PIT RESTART', tier: 2, duration: 900, phase: 8, enabled: false, worksheet: 'xenon-pit-restart.pdf',
    objective: 'Experience why shutdown is not a reset.',
    procedure: [], record: 'Restart attempt: rods, boron, xenon, period.',
    limitations: 'Xenon model distortion applies. See roadmap §6.' },

  { id: 'doppler-coefficient', title: 'DOPPLER COEFFICIENT', tier: 2, duration: 600, phase: 8, enabled: false, worksheet: 'doppler-coefficient.pdf',
    objective: 'Measure fuel-temperature feedback from a power step.',
    procedure: [], record: 'Power step, fuel temperature, reactivity change.',
    limitations: 'Doppler defined on fuel-minus-coolant temperature, not absolute fuel temperature.' },

  // ── Tier 3 ──
  { id: 'mtc-measurement', title: 'MTC MEASUREMENT', tier: 3, duration: 900, phase: 9, enabled: false, worksheet: 'mtc-measurement.pdf',
    objective: 'Measure reactivity coefficient of coolant temperature.',
    procedure: [], record: 'Coolant temperature change, reactivity change.',
    limitations: 'One-group lumped coolant, no spatial distribution.' },

  { id: 'boron-worth', title: 'BORON WORTH', tier: 3, duration: 600, phase: 9, enabled: false, worksheet: 'boron-worth.pdf',
    objective: 'Determine differential and integral boron worth.',
    procedure: [], record: 'Boron ppm, reactivity change.',
    limitations: 'Boron worth is a single linear coefficient in this model.' },

  { id: 'startup-drill', title: 'STARTUP DRILL', tier: 3, duration: 900, phase: 9, enabled: false, worksheet: 'startup-drill.pdf',
    objective: 'Take the reactor from shutdown to power by coordinating all four divisions.',
    procedure: [], record: 'Rods, boron, temperature, period at each step.',
    limitations: 'Rods move instantly; one slider moves the whole bank. Expect touchy control.' },

  { id: 'load-following', title: 'LOAD FOLLOWING', tier: 3, duration: 900, phase: 9, enabled: false, worksheet: 'load-following.pdf',
    objective: 'Track a changing grid demand through feedback and xenon interplay.',
    procedure: [], record: 'Demand, actual power, control actions.',
    limitations: 'Rods move instantly; xenon model distortion applies.' },
];
