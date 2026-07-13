#!/usr/bin/env python3
"""Local dev server that mirrors the droplet's nginx clean-URL behaviour:
   - /services            -> services.html      (try $uri.html before directory)
   - /case-studies/foo     -> case-studies/foo.html
   - /                    -> index.html
   - unknown paths        -> 404.html (styled)
Static assets (.css/.js/.svg/…) are served as-is.

Usage:  python3 serve.py [port]   (default 8000)   then open http://localhost:8000
This file is a local convenience only; production is served by nginx (see deploy/).
"""
import http.server
import os
import sys
import urllib.parse

DIRECTORY = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class CleanURLHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Local dev only: never let the browser cache, so edits to css/js/html
        # always show up on a plain refresh (production uses nginx, not this).
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def send_head(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        fs_path = self.translate_path(self.path)
        # Mirror nginx `try_files $uri.html ...`: if the exact path isn't a file
        # but "<path>.html" is, serve that.
        if path != "/" and not os.path.isfile(fs_path):
            candidate = fs_path.rstrip("/") + ".html"
            if os.path.isfile(candidate):
                self.path = path.rstrip("/") + ".html"
                if parsed.query:
                    self.path += "?" + parsed.query
        return super().send_head()

    def send_error(self, code, message=None, explain=None):
        # error_page 404 /404  -> serve the styled 404.html
        if code == 404:
            page = os.path.join(DIRECTORY, "404.html")
            if os.path.isfile(page):
                body = open(page, "rb").read()
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)
                return
        return super().send_error(code, message, explain)


if __name__ == "__main__":
    os.chdir(DIRECTORY)
    print(f"Clean-URL dev server on http://localhost:{PORT}  (Ctrl+C to stop)")
    http.server.test(HandlerClass=CleanURLHandler, port=PORT, bind="127.0.0.1")
