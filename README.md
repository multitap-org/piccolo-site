# piccolo-site

The website for [piccolo](https://github.com/multitap-org/piccolo): https://get-piccolo.app

Plain static HTML and CSS, no build step. GitHub Pages serves `main` as is
(`.nojekyll` turns Jekyll off).

- `index.html`: the page.
- `css/site.css`: colors from piccolo's BLUE theme, dark by default, light with
  `prefers-color-scheme`.
- `img/`: copies of `piccolo/assets/branding` (the source of truth; copy again
  when the branding changes).

Preview locally:

    python3 -m http.server 8000
