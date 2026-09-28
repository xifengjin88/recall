"""Card conversions: database row <-> recall_engine.Card <-> wire JSON."""

import re
from typing import Any

from recall_engine import Card, CardKind, Phase, Rating

from ..models import CardRow
from ..schemas.progress import CardOut
from ..timeconv import to_dt, to_dt_opt, to_ms, to_ms_opt


def row_to_card(row: CardRow, key: str) -> Card:
    return Card(
        id=key,
        kind=CardKind(row.kind),
        phase=Phase(row.phase),
        step=row.step,
        due=to_ms(row.due),
        interval=row.interval_days,
        ease=row.ease,
        reps=row.reps,
        lapses=row.lapses,
        last_review=to_ms_opt(row.last_review),
        last_rating=Rating(row.last_rating) if row.last_rating else None,
        leech=row.leech,
        suspended=row.suspended,
        updated_at=to_ms(row.updated_at),
    )


def card_to_row_values(card: Card) -> dict[str, Any]:
    return {
        "kind": card.kind.value,
        "phase": card.phase.value,
        "step": card.step,
        "due": to_dt(card.due),
        "interval_days": card.interval,
        "ease": card.ease,
        "reps": card.reps,
        "lapses": card.lapses,
        "last_review": to_dt_opt(card.last_review),
        "last_rating": card.last_rating.value if card.last_rating else None,
        "leech": card.leech,
        "suspended": card.suspended,
        "updated_at": to_dt(card.updated_at),
    }


def card_out(card: Card) -> CardOut:
    return CardOut(
        id=card.id,
        kind=card.kind.value,
        phase=card.phase.value,
        step=card.step,
        due=card.due,
        interval=card.interval,
        ease=card.ease,
        reps=card.reps,
        lapses=card.lapses,
        last_review=card.last_review,
        last_rating=card.last_rating.value if card.last_rating else None,
        leech=card.leech,
        suspended=card.suspended,
        updated_at=card.updated_at,
    )


def card_from_out(c: CardOut) -> Card:
    return Card(
        id=c.id,
        kind=CardKind(c.kind),
        phase=Phase(c.phase),
        step=c.step,
        due=c.due,
        interval=c.interval,
        ease=c.ease,
        reps=c.reps,
        lapses=c.lapses,
        last_review=c.last_review,
        last_rating=Rating(c.last_rating) if c.last_rating else None,
        leech=c.leech,
        suspended=c.suspended,
        updated_at=c.updated_at,
    )


# Preset option names: the web app uses camelCase (learnSteps), the engine snake_case (learn_steps).


def snake(name: str) -> str:
    return re.sub(r"(?<!^)([A-Z])", r"_\1", name).lower()


def camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)
