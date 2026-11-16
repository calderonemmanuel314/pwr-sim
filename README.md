# PWR Simulation

An educational, browser-based simulation of a simplified pressurized-water reactor, built for Grade 10 classroom use. Students learn reactor dynamics by coordinating four control divisions (control rods, coolant pump, pressurizer, boron) and reading instruments such as temperature, pressure, grid power, k_eff and, in Advanced Mode, neutron count rate, dose, period and reactivity.

**Live app:** https://calderonemmanuel314.github.io/pwr-sim/
**Not for real plant use.** All numbers are classroom parameters. Read [`about.html`](about.html) for the physics, limitations and disclaimers.

## Modes

| Mode | What it is |
|---|---|
| Group | Projector host plus up to four phones (one division each) over PeerJS/WebRTC. Timed scenarios with win and failure endings. |
| Sandbox | One screen, all controls, no timer. |
| Learning | Clickable reactor schematic with explanations and a water phase map. |
| Advanced | Free Exploration with nuclear instrumentation and a CSV recorder. The Experiment Library is planned (see [`ROADMAP.md`](ROADMAP.md)). |

## Run it locally

The app uses native ES modules, so it cannot be opened with `file://`. Serve the folder over HTTP:

```
python3 -m http.server 8000
```

Then open http://localhost:8000/. There is no build step, no bundler and no npm install. GitHub Pages serves the same files directly.

## Project layout

```
index.html        HTML shell, screens, HUD, inline reactor SVG
about.html        Standalone documentation (limitations, disclaimers, AI disclosure)
ROADMAP.md        Planned work
css/              base.css, hud.css, client.css, advanced.css
js/
  main.js         Entry point, URL routing (?role=, ?mode=), menu
  config.js       APP_VERSION, APP_BUILD, scenarios (DIFF), endings (ES), Learning text (LEARN)
  physics.js      Neutron balance, point kinetics, saturation curve, dose, phase map
  host.js         Host loop (tick), scenarios, PeerJS room, override/reclaim
  client.js       Phone join page and division controller
  render.js       HUD, k_eff strip, instrumentation, effects
  recorder.js     Advanced Mode CSV recorder
  learn.js        Learning Mode explorer
  about.js        About overlay
  audio.js, qr.js, dom.js   Sound, QR/PeerJS loader, DOM helpers
tools/check-docs.mjs   Checks that docs agree with the code
```

External runtime dependencies are only JetBrains Mono (Google Fonts) and PeerJS 1.5.1 (CDN, three fallbacks, loaded in `js/qr.js`).

## How the model works

Everything runs at 1 Hz inside `tick()` in `js/host.js`. If a browser tab is throttled, a catch-up loop replays missed ticks (up to 10 per timer fire).

- **Neutronics:** one-group k_eff from a normalized weight balance (fuel, structure, rods, boron, xenon, leakage, feedbacks), then six-group point kinetics integrated with RK4.
- **Poisons:** a normalized iodine/xenon chain.
- **Thermal and pressure:** a lumped coolant temperature with a first-order lag, a fuel-temperature lag for Doppler feedback, and a linearized pressure model.
- **Water properties:** Wagner-Pruss saturation curve inverted by bisection.
- **Instruments (Advanced):** count rate, dose (four components), period, reactivity and thermal flux.

This README deliberately contains **no parameter values**, because they go stale. The values live in code:

| What | Where |
|---|---|
| Neutron weights, kinetics constants, dose coefficients | `js/physics.js` |
| Scenarios, limits, start states, endings, Learning text | `js/config.js` |
| Xenon and thermal update equations | `tick()` in `js/host.js` |

## Networking (Group Mode)

The host creates a PeerJS room (`gpwr-host-XXXX`; the prefix is an internal leftover from the old name) and shows a QR code and a 4-digit join code. Phones connect and send messages:

| Type | Direction | Purpose |
|---|---|---|
| `hello` | client to host | Announce role and session ID |
| `ack` | host to client | Confirm a command; send current values, cooldown, briefing, hint |
| `cap` | host to client | Update pump cap and slider limits |
| `cmd` | client to host | Send a control change |
| `reclaim` | client to host | Take control back after a host override |
| `st` | host to client | Phase: lobby, brief, run, overridden, win, lose, rejected |

Each phone stores a session ID in `sessionStorage`. The same session reconnecting is accepted, and a different session claiming an occupied division is rejected ("DIVISION TAKEN").

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Blank page or dead buttons locally | Opened via `file://`. Use the local HTTP server above. |
| `unavailable-id` at host start | Old peer ID still reserved. Reload the host page. |
| "ROOM NOT FOUND" on phone | Wrong code, or host page not running. |
| Phone shows LINK ERROR | Stale cache or network path. Hard-reload; put host and phones on the same Wi-Fi router. |
| "DIVISION TAKEN" after refresh | `sessionStorage` was cleared or a new tab was opened. Reload the same tab. |
| Four divisions in four tabs on one phone | Background tabs freeze. Use separate devices or desktop windows. |
| Advanced readouts show a dash | Fission power is below the near-noise guard, or a render error. Check the console. |
| CSV will not download | Recorder is still running, or has zero rows. Press STOP first. |
| About button hidden | `about.html` is missing at the repo root (HEAD check failed). |

`render()` and `updatePanelStatus()` catch and log errors, so keep the browser console open while debugging.

## Keeping documentation in sync

There is one source of truth for each fact:

1. **Version and build date:** `js/config.js` only. After bumping it, update the static fallbacks in `about.html` (header and footer) and the badge in `index.html`.
2. **Physics numbers quoted in `about.html`:** they must match what the code computes.
3. **Everything else:** write it once, in the code or in `about.html`, and link to it from here.

Run the checker before every commit (Node 18+ required, nothing to install):

```
node tools/check-docs.mjs
```

It compares versions and recomputes the quoted physics numbers from `js/physics.js`. The same command runs on GitHub through `.github/workflows/check-docs.yml`. If you change the xenon equations in `host.js`, update the copy inside the script when it warns you.

## Testing

There is no automated test suite beyond the docs checker. Verification is interactive: all four modes, the Group Mode join/override/reclaim flow, and the CSV export. A classroom stress test (four physical phones for several minutes, plus a full Hard playthrough) is still on the to-do list in the roadmap.

## License and AI disclosure

GNU AGPLv3 (see `LICENSE`). This project was built with AI assistance; the specifics are disclosed in the AI Assistance Disclosure section of `about.html`.

Project owner: Emmanuel Calderon (`calderonemmanuel314`).
