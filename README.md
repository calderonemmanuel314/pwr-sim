# Worksheets

Static PDFs, one per experiment. Slugs match the `id` field of entries in
`EXPERIMENTS` in `js/config.js`.

Naming: lowercase with hyphens (GitHub Pages is case-sensitive). Example:
`rod-calibration-1m.pdf`.

The app links with `<a href="worksheets/<slug>.pdf" download>`. If a PDF is
missing, the link is hidden automatically (HEAD check). Drop a PDF here and
the link appears the next time that experiment's briefing opens.

PDFs are added as each experiment's phase ships. See ROADMAP.md §4 for the
catalogue and slug list.
