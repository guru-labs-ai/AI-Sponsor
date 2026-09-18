#!/usr/bin/env python3
"""Stamps a content hash onto every local script/stylesheet reference on the
site, so a visitor never gets a stale copy for longer than it takes GitHub
Pages to notice the URL changed.

WHY THIS EXISTS. getaisponsor.com is GitHub Pages behind Fastly, and every
file is served with `Cache-Control: max-age=600`: a browser or a CDN edge
node can hold on to an old copy for up to ten minutes after a push, and
GitHub Pages gives no way to set a shorter one (no custom headers at all).
Mariam, 18 Sep: "all the links should lead to current and correct version
of ai sponsor." The fix that works on a platform with no header control is
the standard one: change the URL, not the cache lifetime. A file whose
content changed gets a new `?v=` on every reference to it, so it is a brand
new resource to the cache and gets fetched immediately, whatever the old
one's TTL still had left. Nothing about the ten-minute window on a page's
own URL changes, because that would break bookmarks and incoming links.

WHAT IT VERSIONS. i18n.js and every i18n-*.js dictionary (also covers the
ones i18n.js itself loads later at runtime, via BUILD_VERSION below),
cookie-consent.js, legal.css, blog/blog.css. Not favicons, the manifest or
logos: those rarely change and a stale icon for ten minutes has never been
a real bug.

WHEN TO RUN IT. Any time i18n.js, an i18n-*.js dictionary, cookie-consent.js,
legal.css or blog/blog.css changes, before committing. Safe to run any time
otherwise too: if nothing changed, the hash comes out the same and nothing
in the working tree is touched.

    python scripts/stamp-cache-version.py
"""
import hashlib
import io
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    return io.open(path, encoding="utf-8", newline="").read()


def write(path, text):
    tmp = path + ".tmp"
    io.open(tmp, "w", encoding="utf-8", newline="").write(text)
    os.replace(tmp, path)


# ── 1. Compute one hash from everything that changes behaviour or copy ──────
VERSIONED_FILES = sorted(
    [os.path.join(REPO, "i18n.js")]
    + [os.path.join(REPO, f) for f in os.listdir(REPO) if re.match(r"^i18n-.*\.js$", f)]
    + [os.path.join(REPO, "cookie-consent.js")]
    + [os.path.join(REPO, "legal.css")]
    + [os.path.join(REPO, "blog", "blog.css")]
)
VERSIONED_FILES = [p for p in VERSIONED_FILES if os.path.exists(p)]

BUILD_LINE_RE = re.compile(r"var BUILD_VERSION = '[^']*';")

hasher = hashlib.sha256()
for path in VERSIONED_FILES:
    content = read(path)
    if path.endswith("i18n.js"):
        # Normalised so the hash reflects real content, not last run's own hash.
        content = BUILD_LINE_RE.sub("var BUILD_VERSION = '';", content, count=1)
    hasher.update(os.path.basename(path).encode("utf-8"))
    hasher.update(content.encode("utf-8"))
VERSION = hasher.hexdigest()[:10]

# ── 2. Write it into i18n.js, so its OWN dynamically-loaded dictionary
#      fetches (dictFile()) carry the same version as the static tag below ──
i18n_path = os.path.join(REPO, "i18n.js")
i18n_src = read(i18n_path)
new_line = "var BUILD_VERSION = '%s';" % VERSION
if BUILD_LINE_RE.search(i18n_src):
    i18n_src = BUILD_LINE_RE.sub(new_line, i18n_src, count=1)
else:
    marker = "  var SUPPORTED = ['en', 'es', 'fr', 'de'];"
    assert marker in i18n_src, "insertion point for BUILD_VERSION not found in i18n.js"
    i18n_src = i18n_src.replace(
        marker,
        "  /* Stamped by scripts/stamp-cache-version.py. Also rides on dictFile()'s\n"
        "     own URLs, so a changed dictionary is fetched fresh the same way a\n"
        "     changed i18n.js is: see WHY THIS EXISTS at the top of that script. */\n"
        "  " + new_line + "\n" + marker,
        1,
    )
# A literal match, not a bracket-counting regex: the real line has nested
# parens (the ternary, the regex literal's own capture group), which a naive
# "up to the first )" pattern would stop inside and corrupt.
DICT_FILE_LINE = (
    "    return HERE.replace(/i18n\\.js(\\?.*)?$/, 'i18n-' + "
    "(name ? name + '-' : '') + code + '.js');"
)
DICT_FILE_LINE_VERSIONED = DICT_FILE_LINE[:-1] + " + '?v=' + BUILD_VERSION;"
if DICT_FILE_LINE_VERSIONED not in i18n_src:
    assert DICT_FILE_LINE in i18n_src, "dictFile() return line not found, or already changed shape"
    i18n_src = i18n_src.replace(DICT_FILE_LINE, DICT_FILE_LINE_VERSIONED, 1)
write(i18n_path, i18n_src)

# ── 3. Stamp every HTML reference to a versioned file ───────────────────────
REWRITE = [
    (re.compile(r'((?:src|href)="/?i18n\.js)(\?[^"]*)?(")'), r"\1?v=%s\3" % VERSION),
    (re.compile(r'((?:src|href)="/?cookie-consent\.js)(\?[^"]*)?(")'), r"\1?v=%s\3" % VERSION),
    (re.compile(r'((?:src|href)="/?legal\.css)(\?[^"]*)?(")'), r"\1?v=%s\3" % VERSION),
    (re.compile(r'((?:src|href)="/?blog/blog\.css)(\?[^"]*)?(")'), r"\1?v=%s\3" % VERSION),
]

touched = []
for root, _dirs, files in os.walk(REPO):
    if "/node_modules" in root.replace("\\", "/") or "/ai-sponsor-backend" in root.replace("\\", "/"):
        continue
    for name in files:
        if not name.endswith(".html"):
            continue
        path = os.path.join(root, name)
        html = read(path)
        original = html
        for pattern, repl in REWRITE:
            html = pattern.sub(repl, html)
        if html != original:
            write(path, html)
            touched.append(os.path.relpath(path, REPO))

print("version:", VERSION)
print("stamped i18n.js (BUILD_VERSION + dictFile())")
print("stamped %d html file(s):" % len(touched))
for t in touched:
    print("  " + t)
