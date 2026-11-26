#!/usr/bin/env python3
"""Builds the blog from its markdown posts.

    tools/make-blog.py

Reads   blog/posts/YYYY-MM-DD-slug.md
Writes  blog/index.html            the list of posts, newest first
        blog/<slug>/index.html     one page per post
        blog/feed.xml              Atom feed
        sitemap.xml                the home page, the blog and every post

A post starts with a small header, then the text in markdown:

    ---
    title: Hello, world
    summary: One line for the list, the feed and link previews.
    ---

    The text.

The date and the address come from the file name. Pictures go in blog/img/
and a post links them as ../img/name.png.

The pages are committed: the server only serves this repo as it is, nothing
is built there. CI (check.yml) runs this script and fails when its output
differs from what was pushed.

Needs python-markdown (apt: python3-markdown; CI pins the version with pip).
"""

import html
import os
import re
import shutil
import sys

import markdown

SITE_URL = "https://get-piccolo.app"
BLOG_TITLE = "piccolo's blog"
BLOG_DESCRIPTION = "News and progress notes from piccolo, a small libretro frontend for playing games."

# Folders under blog/ that are sources. Every other folder there is a
# generated post page and is rebuilt from nothing on each run, so a renamed
# or deleted post leaves no page behind.
SOURCE_FOLDERS = ["posts", "img"]

# Pages of this repo that aren't part of the blog, for sitemap.xml.
# /pair/ is noindex and stays out.
OTHER_PAGES = ["/"]

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

POST_NAME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})-([a-z0-9][a-z0-9-]*)\.md$")


def fail(message):
    print("make-blog: " + message, file=sys.stderr)
    sys.exit(1)


def read_text(path):
    with open(path, "r", encoding="utf-8") as file:
        return file.read()


def write_text(path, text):
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as file:
        file.write(text)


def post_split_header(path, text):
    """Returns (fields, markdown text) of a post file."""
    lines = text.split("\n")
    if len(lines) == 0 or lines[0].strip() != "---":
        fail(path + ": the first line must be ---")
    fields = {}
    index = 1
    while index < len(lines) and lines[index].strip() != "---":
        line = lines[index].strip()
        index += 1
        if line == "":
            continue
        colon = line.find(":")
        if colon < 0:
            fail(path + ": header line without a colon: " + line)
        fields[line[:colon].strip()] = line[colon + 1:].strip()
    if index == len(lines):
        fail(path + ": the header has no closing ---")
    body = "\n".join(lines[index + 1:])
    return fields, body


def post_load(posts_dir, name):
    path = os.path.join(posts_dir, name)
    match = POST_NAME.match(name)
    if match is None:
        fail(path + ": name it YYYY-MM-DD-slug.md (lowercase letters, digits, dashes)")
    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    slug = match.group(4)
    if month < 1 or month > 12 or day < 1 or day > 31:
        fail(path + ": not a date")
    if slug in SOURCE_FOLDERS:
        fail(path + ": '" + slug + "' is a folder the blog uses, pick another name")

    fields, body = post_split_header(path, read_text(path))
    if fields.get("title", "") == "":
        fail(path + ": the header needs a title")

    # A new converter per post: footnote numbers and the like start over.
    converter = markdown.Markdown(extensions=["extra"], output_format="html")
    return {
        "slug": slug,
        "date": "%04d-%02d-%02d" % (year, month, day),
        "date_text": "%d %s %d" % (day, MONTHS[month - 1], year),
        "title": fields["title"],
        "summary": fields.get("summary", ""),
        "html": converter.convert(body),
    }


def posts_load(posts_dir):
    """Every post, newest first; the same day sorts by name."""
    posts = []
    names = sorted(os.listdir(posts_dir))
    for name in names:
        if not name.endswith(".md"):
            continue
        posts.append(post_load(posts_dir, name))
    posts.reverse()

    seen = {}
    for post in posts:
        if post["slug"] in seen:
            fail("two posts are named '" + post["slug"] + "'")
        seen[post["slug"]] = True
    return posts


def page_render(template, values):
    """Fills {{name}} in the template. The content goes in last, so a post
    that happens to contain {{title}} is left alone."""
    page = template
    for name in values:
        if name != "content":
            page = page.replace("{{" + name + "}}", values[name])
    page = page.replace("{{content}}", values["content"])
    return page


def post_page(template, header, footer, post):
    content = (
        '<article class="post">\n'
        '<p class="label"><time datetime="' + post["date"] + '">' + post["date_text"] + "</time></p>\n"
        "<h1>" + html.escape(post["title"]) + "</h1>\n"
        + post["html"] + "\n"
        "</article>\n"
        '<p class="post-back"><a href="../">All posts</a></p>'
    )
    description = post["summary"]
    if description == "":
        description = BLOG_DESCRIPTION
    return page_render(template, {
        "title": html.escape(post["title"]) + " | " + html.escape(BLOG_TITLE),
        "description": html.escape(description),
        "og_type": "article",
        "url": SITE_URL + "/blog/" + post["slug"] + "/",
        "root": "../../",
        "header": header,
        "footer": footer,
        "content": content,
    })


def index_page(template, header, footer, posts):
    content = "<h1>Blog</h1>\n"
    if len(posts) == 0:
        content += '<p class="note">Nothing here yet.</p>'
    else:
        content += '<ul class="post-list">\n'
        for post in posts:
            content += (
                "<li>\n"
                '<p class="label"><time datetime="' + post["date"] + '">' + post["date_text"] + "</time></p>\n"
                '<h2><a href="' + post["slug"] + '/">' + html.escape(post["title"]) + "</a></h2>\n"
            )
            if post["summary"] != "":
                content += "<p>" + html.escape(post["summary"]) + "</p>\n"
            content += "</li>\n"
        content += "</ul>"
    return page_render(template, {
        "title": html.escape(BLOG_TITLE),
        "description": html.escape(BLOG_DESCRIPTION),
        "og_type": "website",
        "url": SITE_URL + "/blog/",
        "root": "../",
        "header": header,
        "footer": footer,
        "content": content,
    })


def feed_xml(posts):
    # No clock in here: the same posts always give the same file, which is
    # what lets CI compare. A post's time is midnight UTC of its day.
    updated = "1970-01-01T00:00:00Z"
    if len(posts) > 0:
        updated = posts[0]["date"] + "T00:00:00Z"
    feed = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom">\n'
        "  <title>" + html.escape(BLOG_TITLE) + "</title>\n"
        "  <subtitle>" + html.escape(BLOG_DESCRIPTION) + "</subtitle>\n"
        '  <link href="' + SITE_URL + '/blog/"/>\n'
        '  <link rel="self" href="' + SITE_URL + '/blog/feed.xml"/>\n'
        "  <id>" + SITE_URL + "/blog/</id>\n"
        "  <updated>" + updated + "</updated>\n"
        "  <author><name>piccolo</name></author>\n"
    )
    for post in posts:
        url = SITE_URL + "/blog/" + post["slug"] + "/"
        feed += (
            "  <entry>\n"
            "    <title>" + html.escape(post["title"]) + "</title>\n"
            '    <link href="' + url + '"/>\n'
            "    <id>" + url + "</id>\n"
            "    <published>" + post["date"] + "T00:00:00Z</published>\n"
            "    <updated>" + post["date"] + "T00:00:00Z</updated>\n"
        )
        if post["summary"] != "":
            feed += "    <summary>" + html.escape(post["summary"]) + "</summary>\n"
        feed += (
            '    <content type="html">' + html.escape(post["html"]) + "</content>\n"
            "  </entry>\n"
        )
    feed += "</feed>\n"
    return feed


def sitemap_xml(posts):
    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    )
    for page in OTHER_PAGES:
        sitemap += "  <url><loc>" + SITE_URL + page + "</loc></url>\n"
    sitemap += "  <url><loc>" + SITE_URL + "/blog/</loc></url>\n"
    for post in posts:
        sitemap += (
            "  <url><loc>" + SITE_URL + "/blog/" + post["slug"] + "/</loc>"
            "<lastmod>" + post["date"] + "</lastmod></url>\n"
        )
    sitemap += "</urlset>\n"
    return sitemap


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    blog_dir = os.path.join(root, "blog")
    posts_dir = os.path.join(blog_dir, "posts")
    if not os.path.isdir(posts_dir):
        fail("no blog/posts folder in " + root)

    template = read_text(os.path.join(root, "tools", "blog-page.html"))
    header = read_text(os.path.join(root, "assets", "v1", "sites-header.html")).rstrip("\n")
    footer = read_text(os.path.join(root, "assets", "v1", "sites-footer.html")).rstrip("\n")

    posts = posts_load(posts_dir)

    for name in sorted(os.listdir(blog_dir)):
        path = os.path.join(blog_dir, name)
        if os.path.isdir(path) and name not in SOURCE_FOLDERS:
            shutil.rmtree(path)

    for post in posts:
        write_text(os.path.join(blog_dir, post["slug"], "index.html"),
                   post_page(template, header, footer, post))
    write_text(os.path.join(blog_dir, "index.html"), index_page(template, header, footer, posts))
    write_text(os.path.join(blog_dir, "feed.xml"), feed_xml(posts))
    write_text(os.path.join(root, "sitemap.xml"), sitemap_xml(posts))

    print("make-blog: %d post(s)" % len(posts))


main()
