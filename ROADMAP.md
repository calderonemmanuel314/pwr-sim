# Roadmap

Only unfinished work is listed here. What already ships is documented by the code itself (`README.md` for structure, `about.html` for the model and its limits). When an item ships, delete it from this file.

## 0. Before Phase 4

- [ ] **Classroom stress test.** Four physical phones on one Wi-Fi router for at least 2 minutes in Group Mode, and a full Hard playthrough (win attempt, heat failure, xenon lockout).
- [ ] **Add `LICENSE`** (AGPLv3 text) to the repo root if it is missing.
- [ ] **Add the docs checker workflow** (`.github/workflows/check-docs.yml`) so every push runs `tools/check-docs.mjs`.
- [ ] **Fix the narrow-viewport overlap** of `#timerBox` with the reactor SVG in Group Mode.

## 1. Phase 4: Experiment Library shell

- Card grid of experiments; clicking a card opens a briefing overlay (objective, procedure, what to record).
- Worksheet link to `worksheets/<experiment>.pdf`, hidden automatically if the file is missing.
- Enables `#advLibBtn` on the Advanced landing screen.
- Experiment UI keeps the reactor schematic the largest element on screen. Persistent UI (procedure card, recording indicator) is a small floating overlay in a corner, never a panel that shrinks the schematic.

## 2. Phase 5: Rod calibration by 1/M (first experiment)

Chosen first because it is short (about 15 minutes), self-verifying, and introduces the settle-and-log workflow.

**Fixed setup**
- Only the rod slider is live. Pump locked at 50%, boron at 1500 ppm, xenon starts at 0.
- Auto-pressurizer holds pressure in 15.3 to 15.7 MPa.
- Start state: rods 100%, deep subcritical (fission power about 1e-4 MWth), temperature and pressure at normal hot-standby values.

**Procedure:** students withdraw rods in steps (for example 5%), press SETTLE & LOG, and plot 1/count-rate against rod position to extrapolate to criticality.

**Settle-and-log**
- Runs internal 1 Hz ticks until `detectSettle()` passes, then takes 5 samples, averages them, and logs the step.
- Near criticality, the slowest delayed-neutron group (time constant about 80 s) can need more than 500 simulated seconds to settle. Use a safety cap of at least 1000 simulated seconds, or an explicit slope tolerance.

**Detector noise**
- Displayed count rate is Poisson-sampled with a per-session efficiency of 1 ± 0.03.
- The reactor physics (`S.Nf`, `S.k`, `S.rho`, `S.T`, `S.P`) stays fully deterministic; only the readout is random.

**Step CSV:** `step,rod_pct,sim_t,s1,s2,s3,s4,s5,avg_cps,inv_cps,k_eff`

**Finish:** linear fit on the last 4 to 5 points of 1/cps vs rod position (a tangent approximation along the S-curve), plus an optional TEST PREDICTION button that moves the rods to the extrapolated position and reports subcritical, critical or supercritical.

**Layouts:** floating card (about 380 x 260 px) bottom-right on desktop; collapsible bottom drawer on mobile.

### Rod worth by period (inhour variant)

Shares the settle-and-log code. **Important:** the model's stretched prompt generation time (see `LAMBDA_PROMPT_MODEL` in `js/physics.js`) changes the reactivity-period relation by a factor that depends on the period (about 2.2x at very long periods, much larger at short ones). Do not use a single correction factor. Either solve the inhour equation with the model's own value of the generation time, or reduce it in experiment mode.

## 3. Phase 6: Delayed neutron counting

Reach steady power, SCRAM, log the flux decay on a log scale and identify the longest-lived delayed group.

## 4. Phases 7 and 8: Transient experiments

- SCRAM transient: prompt drop vs delayed tail.
- Xenon transient and xenon-pit restart. Note the model's xenon timescales are compressed (see about.html).
- N-16 dose decay (the N-16 pool already exists).

## 5. Phase 9: Strip charts and Tier 3 experiments

Log-scale strip charts. Then MTC measurement, boron worth, startup drill, load-following, Doppler coefficient measurement.

## 6. Model fidelity backlog (optional; decide teaching value vs realism)

These came out of a code review. Each is a choice, not necessarily a bug. If you keep a simplification on purpose, make sure `about.html` says so.

- **Xenon timescales.** Iodine and xenon decay are compressed by different factors, so the post-trip peak is small and early. Compressing both by the same factor (with burnout about 3.7x the xenon decay rate at reference power) would give a peak near 1.9x equilibrium. This would also make the Hard start (xe = 1.4) physically reachable.
- **Xenon worth** is several times larger than a real PWR's. Lower `xenonCapture` and adjust the boron range if realism matters.
- **Decay heat** is a constant allowance. A decaying heat state (charged by power history) would make post-SCRAM cooling more realistic.
- **Grid power** is computed from fission-plus-residual power, not from heat actually removed. Using the heat removed makes electrical output lag the reactor, as in a real plant.
- **Rod movement** is instantaneous and one slider moves the whole shutdown-sized bank. Add a rate limit and/or a smaller regulating bank if you want realistic control feel.
- **Doppler feedback** uses fuel-minus-coolant temperature, not absolute fuel temperature.
- **Pressure** has a constant drift term unrelated to pressurizer physics, and the relief setpoint is a game value.
- **Prompt response.** The stretched generation time slows prompt transients. A prompt-jump approximation would keep delayed-neutron dynamics exact without the stiffness problem.
- **Robustness.** The kinetics currently returns a large fixed power on a non-finite result instead of failing visibly.

## Non-goals

- Spatial flux, burnup, or full isotope inventories.
- Real operating procedures, plant validation, or shielding calculations.
- Servers, bundlers, or npm build pipelines (the project stays static and GitHub Pages friendly).

## Decisions still open

- Do experiment worksheets stay as static PDFs under `worksheets/`?
- Which items from section 6 are worth doing for a Grade 10 audience, and which stay documented simplifications?
