"""Flask app factory. One database session per request, committed at the end (rolled back on error)."""

import time
from collections.abc import Callable

from flask import Flask, g
from sqlalchemy.orm import Session

from .config import load_config
from .db import make_engine
from .errors import register_error_handlers

SessionFactory = Callable[[], Session]


def create_app(
    session_factory: SessionFactory | None = None, clock: Callable[[], int] | None = None
) -> Flask:
    """`session_factory` lets tests hand every request their rolled-back session; `clock` fixes "now" (epoch ms)."""
    app = Flask(__name__)
    app.extensions["recall.clock"] = clock or (lambda: time.time_ns() // 1_000_000)
    owns_sessions = session_factory is None
    if session_factory is None:
        engine = make_engine(load_config().database_url)

        def new_session() -> Session:
            return Session(engine, expire_on_commit=False)

        session_factory = new_session

    app.extensions["recall.session_factory"] = session_factory

    @app.teardown_request
    def _finish(exc: BaseException | None) -> None:
        session: Session | None = g.pop("db", None)
        if session is None:
            return
        if exc is None:
            session.commit()
        else:
            session.rollback()
        if owns_sessions:
            session.close()

    register_error_handlers(app)

    from .api.catalog import bp as catalog
    from .api.exercises import bp as exercises
    from .api.progress import bp as progress
    from .api.reviews import bp as reviews
    from .api.settings import bp as settings

    app.register_blueprint(catalog)
    app.register_blueprint(exercises)
    app.register_blueprint(progress)
    app.register_blueprint(reviews)
    app.register_blueprint(settings)

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    return app


def get_db() -> Session:
    """The current request's session."""
    if "db" not in g:
        from flask import current_app

        g.db = current_app.extensions["recall.session_factory"]()
    return g.db


def now_ms() -> int:
    """The server's notion of now (UTC epoch ms): all scheduling uses it, never the client's clock."""
    from flask import current_app

    return current_app.extensions["recall.clock"]()
