"""Phusion Passenger entry point for cPanel "Setup Python App" hosting.

cPanel runs your app through Passenger, which imports a WSGI callable named
``application`` from this file (in the application root). FastAPI is an ASGI
app, so it's wrapped with a2wsgi's ASGIMiddleware to present a WSGI interface.

The app's MySQL/SQLite backend is chosen by the ``DATABASE_URL`` env var — set
that in cPanel's Python app screen (Environment variables) to your MySQL DSN,
e.g. ``mysql://cpaneluser_dbuser:password@localhost/cpaneluser_dbname``.

Passenger sets up the virtualenv and working directory for you; no shebang or
manual interpreter line is needed.
"""

from a2wsgi import ASGIMiddleware

from python.main import app as _asgi_app

# Ensure the schema/tables exist on first boot (no-op if already created).
from python.db import init_db

init_db()

application = ASGIMiddleware(_asgi_app)
