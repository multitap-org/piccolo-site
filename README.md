# piccolo-site

The website for [piccolo](https://github.com/multitap-org/piccolo): https://get-piccolo.app

Plain static HTML and CSS, no build step. GitHub Pages serves `main` as is
(`.nojekyll` turns Jekyll off).

- `index.html`: the page.
- `assets/v1/`: the look every piccolo website shares (colors, Fredoka and IBM
  Plex Mono served from here, the sites bar, the footer); see `assets/README.md`.
- `css/home.css`: this page's own parts.
- `tools/`: `make-manifest.sh` and `sync-snippets.sh` after changing assets/v1
  (CI checks), `fetch-site-assets.sh` for the other sites' copies.
- `img/`: copies of `piccolo/assets/branding` and `piccoletto/assets/branding` (the source of truth; copy again
  when the branding changes).

Preview locally:

    python3 -m http.server 8000
