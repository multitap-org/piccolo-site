# piccolo-site

The website for [piccolo](https://github.com/multitap-org/piccolo): https://get-piccolo.app

Plain static HTML and CSS, nothing is built where it is served. GitHub Pages serves `main` as is
(`.nojekyll` turns Jekyll off).

- `index.html`: the page.
- `assets/v1/`: the look every piccolo website shares (colors, Fredoka and IBM
  Plex Mono served from here, the sites bar, the footer); see `assets/README.md`.
- `css/home.css`: this page's own parts.
- `tools/`: `make-manifest.sh` and `sync-snippets.sh` after changing assets/v1
  (CI checks), `fetch-site-assets.sh` for the other sites' copies.
- `blog/`: the blog. Posts are markdown in `blog/posts/YYYY-MM-DD-slug.md`;
  `tools/make-blog.py` writes the pages, the feed and `sitemap.xml` from them
  (needs `python3-markdown`). Run it after adding or changing a post, or after
  changing the sites bar or footer, and commit what it wrote (CI checks). The
  page around a post is `tools/blog-page.html`, its styles `css/blog.css`.
- `img/`: copies of `piccolo/assets/branding` and `piccoletto/assets/branding` (the source of truth; copy again
  when the branding changes).

Preview locally:

    python3 -m http.server 8000
