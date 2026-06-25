"""Phusion Passenger entry point for cPanel "Setup Python App" hosting.

cPanel runs your app through Passenger, which imports a WSGI callable named
``application`` from this file (in the application root). FastAPI is an ASGI
app, so it's wrapped with a2wsgi's ASGIMiddleware to present a WSGI interface.

The app's MySQL/SQLite backend is chosen by the ``DATABASE_URL`` env var — set
that in cPanel's Python app screen (Environment variables) to your MySQL DSN,
e.g. ``mysql://cpaneluser_dbuser:password@localhost/cpaneluser_dbname``.

Why the bridge is built lazily
------------------------------
a2wsgi's ``ASGIMiddleware`` starts a background asyncio loop in a daemon thread
*at construction time*. Passenger imports this module in a parent process and
then forks worker processes to serve requests. Threads do not survive ``fork``:
the loop thread is alive in the parent but **dead in every worker**, so the
first request's ``run_coroutine_threadsafe(...).result()`` blocks forever — the
symptom is a request that hangs with no response and no error in the log.

The fix is to construct the middleware (and thus its loop thread) lazily, inside
the worker, on the first request — after the fork. ``_App`` does exactly that.
"""

from python.db import init_db

# DB init + seed happen at import (cheap, fork-safe — no threads involved).
# a2wsgi never runs the ASGI lifespan protocol, so FastAPI's on_event("startup")
# handlers don't fire under this bridge; do the equivalent work here.
init_db()
try:
    from python.seed import seed

    seed()
except Exception as exc:  # pragma: no cover - best-effort, logged to stderr
    print(f"[passenger_wsgi] seed skipped: {exc}")


class _App:
    """Builds the a2wsgi bridge on first call, in the (post-fork) worker.

    Constructing ASGIMiddleware spawns a daemon thread for its event loop; doing
    that at import would leave a dead loop thread in forked workers. Deferring it
    to the first request guarantees the loop thread belongs to the worker that
    will use it.
    """

    def __init__(self):
        self._wsgi = None

    def __call__(self, environ, start_response):
        if self._wsgi is None:
            from a2wsgi import ASGIMiddleware
            from python.main import app as asgi_app

            self._wsgi = ASGIMiddleware(asgi_app)
        return self._wsgi(environ, start_response)


application = _App()
