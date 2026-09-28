"""UTC epoch milliseconds (engine and wire) <-> timezone-aware datetimes (Postgres timestamptz)."""

from datetime import UTC, datetime


def to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=UTC)


def to_ms(dt: datetime) -> int:
    return round(dt.timestamp() * 1000)


def to_dt_opt(ms: int | None) -> datetime | None:
    return None if ms is None else to_dt(ms)


def to_ms_opt(dt: datetime | None) -> int | None:
    return None if dt is None else to_ms(dt)
