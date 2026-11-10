"""Tiny static server for a dist/ folder: serve.py <dir> <port>"""
import sys, http.server, functools
d, port = sys.argv[1], int(sys.argv[2])
class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=d, **k)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', port), Q).serve_forever()
