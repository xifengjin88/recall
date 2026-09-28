"""Study days. All instants are UTC epoch ms; the learner's zone only locates day boundaries."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True, slots=True)
class StudyClock:
    """Where study days begin for one learner: `rollover_hour`:00 local time in `tz`."""

    tz: str
    rollover_hour: int = 4

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.tz)  # ZoneInfo caches instances


def study_day(ms: int, clock: StudyClock) -> date:
    """The study day an instant belongs to: local wall-clock time shifted back by the rollover hour."""
    local = datetime.fromtimestamp(ms // 1000, tz=clock.zone).replace(microsecond=(ms % 1000) * 1000)
    return (local.replace(tzinfo=None) - timedelta(hours=clock.rollover_hour)).date()


def day_start_ms(day: date, clock: StudyClock) -> int:
    """When a study day begins, as a UTC instant (DST gaps resolve like JS: offset before the change)."""
    start = datetime(day.year, day.month, day.day, clock.rollover_hour, tzinfo=clock.zone)
    return int(start.timestamp()) * 1000


def add_days(day: date, n: int) -> date:
    return day + timedelta(days=n)


def days_between(a: date, b: date) -> int:
    """Whole calendar days from a to b (b - a)."""
    return (b - a).days
