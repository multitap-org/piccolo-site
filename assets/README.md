# The shared look of piccolo's websites

`assets/v1/` is the one source of the look every piccolo website shares:
get-piccolo.app (this repo), play. (piccolo's `web/`), cores. and releases.
(multitap-org/cores-server) and the beacon's status page
(multitap-org/multitap-beacon). Change the look here; the others follow.

- `site.css`: colors (piccolo's BLUE theme, dark and light), fonts, the sites
  bar, the footer, buttons, cards, panels, file listings.
- `fonts/`: Fredoka 600 (headings) and IBM Plex Mono 400/700 (text), woff2,
  latin, with their OFL licenses. Served from here: no Google Fonts.
- `sites-header.html`, `sites-footer.html`: the sites bar and the footer, the
  same markup on every site. A page sets `<body data-site="home|play|cores|releases|status">`
  and site.css lights that entry.
- `img/`: the icon and the logo (copies of piccolo/assets/branding).
- `MANIFEST`: `sha256  path` for every file above (`tools/make-manifest.sh`).

## How the other sites follow

Every site keeps its own copy, so it works on its own (another server, no
internet, get-piccolo.app down) and never loads anything from another origin:

- cores. / releases.: the publisher containers run `fetch-site-assets.sh`
  on every pass (every 15 minutes) into `<site>/_site/v1/` and rewrite the
  listing pages when the bar or footer changed. Their image carries a copy
  for the first start.
- play.: `web/package.sh` fetches the copy into the web build at build time,
  so every piccolo build (the `:main` image, the dev channel) has the look of
  that day; a release keeps the look it shipped with.
- the beacon's status page: a copy committed in its repo (packaging/status/_site/v1),
  checked against get-piccolo.app by CI, copied into the status volume by the
  container at start.

## Rules for v1

- Only add: class names, tokens and files in v1 are never renamed or removed,
  because pages already built use them.
- After any change: `tools/make-manifest.sh`, and `tools/sync-snippets.sh assets/v1 index.html`
  if the bar or footer changed. CI checks both.
- A change that breaks pages (renamed classes, new markup the old pages can't
  take) goes into a new folder, `assets/v2/`, next to v1; v1 stays served.
