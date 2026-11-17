# Roadmap

Only unfinished work is listed here, **with the detail needed to build it**. What already ships is documented by the code (`README.md` for structure, `about.html` for the model and its limits). When an item ships, delete it from this file.

Rough sizing from the original plan: Phase 5 about 300 lines; Phase 6 about 250; Phases 7 and 8 about 250 combined; Phase 9 about 250.

## 0. Before Phase 6

- [ ] **Classroom stress test.** Four physical phones on one Wi-Fi router for at least 2 minutes in Group Mode, and a full Hard playthrough (win attempt, heat failure, xenon lockout).
- [ ] **Confirm the `check-docs` workflow passes** on GitHub (Actions tab).
- [ ] **Fix the narrow-viewport overlap** of `#timerBox` with the reactor SVG in Group Mode.
- [ ] **Decide the xenon question** (section 6, first item) before building any xenon experiment.

## 1. Rules that constrain all remaining work

- **Reactor priority rule.** The reactor schematic is always the largest element on screen. Persistent UI (procedure card, recording indicator, timer) is a small floating overlay in a corner of the schematic area. Never place persistent UI beside the schematic in a way that shrinks it.
- **Additive, not disruptive.** Group, Sandbox, Learning and Free Exploration must behave exactly as before.
- **Deterministic physics.** Reactor state (`S.Nf`, `S.k`, `S.rho`, `S.T`, `S.P`) stays deterministic. Only measurement readouts may be random.
- **Honest limitations.** Every experiment briefing and worksheet preamble states the model simplifications that affect that experiment (see section 5).
- **Zero build.** Static HTML, CSS and native ES modules. No bundler, npm build, or backend.
- **Update docs together.** After shipping a phase, update `about.html`, bump `APP_VERSION` in `js/config.js`, and run `node tools/check-docs.mjs`.

## 2. Phase 4: Experiment Library shell (ACCOMPLISHED)

## 3. Phase 5: Rod calibration by 1/M (ACCOMPLISHED)

Remaining optional asset: `worksheets/rod-calibration-1m.pdf` (link stays hidden until present).

## 4. Experiment catalogue (Phases 6 to 9)

| Tier | Experiment | What students do | Physics taught | Model changes |
|---|---|---|---|---|
| 1 | Rod calibration by 1/M | See Phase 5 | Subcritical multiplication, Poisson statistics, 1/M method | Noise helper (Phase 5) |
| 1 | Rod worth by period (inhour) | Set rod, measure stable period, convert to reactivity | S-curve rod worth, inhour equation | None |
| 1 | Delayed neutron counting (Phase 6) | Reach steady power, SCRAM, log the flux decay on a log scale, identify the longest-lived delayed group (about 55 s half-life) | Six delayed groups, effective delayed fraction | None |
| 1 | SCRAM transient | Insert rods and watch the first seconds: prompt drop, then delayed tail | Prompt vs delayed response | None |
| 1 | Xenon transient | Watch iodine-to-xenon buildup or burnoff | Fission-product poisoning | None (see section 5) |
| 2 | N-16 dose decay | Shut down and follow dose falling in stages | Short-lived activation product, dose after shutdown | N-16 pool already exists |
| 2 | Xenon pit restart | Try to restart shortly after a trip | Why shutdown is not a reset | None |
| 2 | Doppler coefficient measurement | Change power and read the reactivity change | Fuel-temperature feedback | None (see section 5) |
| 3 | MTC measurement | Change coolant temperature and read reactivity | Moderator feedback | None |
| 3 | Boron worth | Change boron and read reactivity | Soluble absorber worth | None |
| 3 | Startup drill | Take the reactor from shutdown to power | Control coordination | None |
| 3 | Load following | Follow a changing grid demand | Feedback and xenon interplay | None |

**Phase 9** also adds log-scale strip charts for count rate, period and dose.

## 5. How model simplifications affect each experiment

Decide these before building, and state them in the briefing and worksheet.

| Experiment | Caveat |
|---|---|
| Rod calibration by 1/M | Steady-state multiplication does not depend on the generation time, so it is safe, though settling is slow near criticality. Rod worth follows an S-curve, so 1/M vs. rod % curves across wide travel (procedure teaches the halfway rule; DONE fits the 3 distinct near-critical points). Soft 25 MWth Auto-SCRAM and frozen xenon prevent runaways and poison drift. |
| Rod worth by period | Requires an inhour solution that uses the model's own generation time (`LAMBDA_PROMPT_MODEL`). Do not use one correction factor — the reactivity-period relation shifts by an amount that depends on the period (about 2× at very long periods, several times larger at short ones). Either solve the inhour equation with the model's own generation time, or reduce it in experiment mode. |
| Delayed neutron counting | The long-time decay is correct. The source floor sets the lowest count rate. |
| SCRAM transient | The prompt drop is visible at 1 Hz only because the generation time is stretched. Teach it qualitatively, not as a measurement of real prompt behavior. |
| Xenon experiments | Xenon timescales are compressed unevenly, so the post-trip peak is small and early. Decide on the fix in section 6 first. |
| Doppler measurement | Doppler is defined on fuel-minus-coolant temperature and the coefficient differs by scenario. Design the procedure around that, or change the model. |
| Any post-SCRAM cooling | Decay heat is a constant allowance, not a decaying curve. |
| Startup and load following | Rods move instantly and one slider moves the whole bank. Expect touchy control. |
| Any experiment | Briefings and worksheets must state the caveats above before the experiment ships. The per-experiment `limitations` field in `EXPERIMENTS` is the mechanism. |

## 6. Model fidelity backlog (optional; decide teaching value vs realism)

These came out of a code review. Each is a choice, not necessarily a bug. If you keep a simplification on purpose, `about.html` must say so.

- **Xenon timescales.** Iodine and xenon decay are compressed by different factors, so the post-trip peak is small and early. Compressing both by the same factor (with burnout about 3.7 times the xenon decay rate at reference power) gives a peak near 1.9 times equilibrium. It also makes the Hard start (xe = 1.4) physically reachable.
- **Xenon worth** is several times larger than a real PWR's. Lower `xenonCapture` and adjust the boron range if realism matters.
- **Decay heat** is a constant allowance. A decaying heat state charged by power history would make post-SCRAM cooling realistic.
- **Grid power** comes from fission-plus-residual power, not heat actually removed. Using heat removed makes electrical output lag the reactor.
- **Rod movement** is instant and one slider moves a shutdown-sized bank. Add a rate limit and/or a smaller regulating bank for realistic control feel.
- **Doppler feedback** uses fuel-minus-coolant temperature, not absolute fuel temperature.
- **Pressure** has a constant drift term unrelated to pressurizer physics.
- **Prompt response.** A prompt-jump approximation would keep delayed-neutron dynamics exact without the stiffness problem.
- **Robustness.** On a non-finite kinetics result the code returns a large fixed power instead of failing visibly.

## 7. Success criteria

**Learning goals**
1. Read a neutron count rate and estimate the power level.
2. Perform a delayed neutron counting experiment (Phase 6).
3. Perform a rod calibration by 1/M plot (Phase 5).
4. Read post-shutdown dose and describe its staged decay.
5. Understand that dose persists after shutdown.

**Platform checks (every release)**
- All modes load with no console errors over HTTP/HTTPS.
- `about.html` opens in one click; limitations, disclaimers and AI disclosure are visible inline.
- `node tools/check-docs.mjs` passes.

## 8. Non-goals

- Detailed neutron spectrum, 3D spatial flux, burnup, or full isotope inventories.
- Real operating procedures, plant validation, or shielding calculations.
- Servers, bundlers, or npm build pipelines (the project stays static and GitHub Pages friendly).

## 9. Decisions already made

- Experiment briefing UI: overlay.
- First experiment: rod calibration by 1/M.
- Worksheet format: static PDFs under `worksheets/`. Worksheet links are HEAD-checked at briefing open and hidden if the PDF is missing.
- Catalogue source: one `EXPERIMENTS` array in `js/config.js`. Card, briefing text, and worksheet link all derive from `id`; adding an experiment is a data change.
- Experiment shell state machine: idle → briefing → running → complete, in `js/experiments.js`. The procedure card is a floating overlay inside `#ctr` (reactor-priority rule).
- Unbuilt experiments carry `enabled: false` in `EXPERIMENTS` and appear greyed out in the library.
- Rod calibration plots **1/M**, not raw 1/cps. 1/M = cps_first / cps_current (first log is the reference). Detector efficiency cancels in the ratio, so a mis-calibrated detector does not bias the extrapolated critical position.
- `k_eff` (plus `ρ · REACTIVITY`, `PERIOD`, and the `S.k > 1.01` status hint) is **blinded** during rod-calibration logging (`body.k-blind`), then revealed at DONE so students must extrapolate by hand before checking their answer with TEST PREDICTION.
- Auto-coolant (holds ~307 °C), auto-pressurizer (holds 15.3–15.7 MPa), frozen xenon (`_experimentFreezeXe`), and a soft 25 MWth Auto-SCRAM (`_experimentMaxPower`) run during `rod-cal` via `_experimentActive` in `host.js`, suppressing `end()` so students cannot blow up the core. Free Exploration untouched.
- DONE fits the 3 distinct near-critical logged points (`nearCriticalPts(log, 3)`) instead of a global regression across the S-curve, and `settleAndLog()` blocks supercritical points (`k_eff >= 1`).

## 10. Decisions still open

- Which items from section 6 are worth doing for a Grade 10 audience, and which stay documented simplifications?
