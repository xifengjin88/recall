"""Study days start at 04:00 in the learner's zone; DST days are 23/25 hours long."""

from datetime import date
from typing import Any

from recall_engine import StudyClock, add_days, day_start_ms, days_between, study_day


def test_golden_study_days_and_day_starts(g: dict[str, Any], clock: StudyClock) -> None:
    for case in g["clock"]:
        day = study_day(case["ms"], clock)
        assert day.isoformat() == case["studyDay"], case["ms"]
        assert day_start_ms(day, clock) == case["dayStart"]
        for plus in case["plus"]:
            later = add_days(day, plus["n"])
            assert later.isoformat() == plus["day"]
            assert day_start_ms(later, clock) == plus["start"]


def test_rollover_in_another_zone() -> None:
    la = StudyClock(tz="America/Los_Angeles")
    # 2026-09-28 03:59 PDT (10:59 UTC) still belongs to the 27th; 04:00 PDT starts the 28th.
    assert study_day(1790593140000, la) == date(2026, 9, 27)
    assert study_day(1790593200000, la) == date(2026, 9, 28)
    assert day_start_ms(date(2026, 9, 28), la) == 1790593200000


def test_dst_days_have_23_and_25_hours() -> None:
    ny = StudyClock(tz="America/New_York")
    spring = day_start_ms(date(2026, 3, 9), ny) - day_start_ms(date(2026, 3, 8), ny)
    autumn = day_start_ms(date(2026, 11, 2), ny) - day_start_ms(date(2026, 11, 1), ny)
    assert spring == 24 * 3_600_000  # 04:00 → 04:00 after the jump, 24h
    assert day_start_ms(date(2026, 3, 8), ny) - day_start_ms(date(2026, 3, 7), ny) == 23 * 3_600_000
    assert day_start_ms(date(2026, 11, 1), ny) - day_start_ms(date(2026, 10, 31), ny) == 25 * 3_600_000
    assert autumn == 24 * 3_600_000


def test_days_between_counts_calendar_days() -> None:
    assert days_between(date(2026, 3, 7), date(2026, 3, 9)) == 2
    assert days_between(date(2026, 3, 9), date(2026, 3, 7)) == -2
