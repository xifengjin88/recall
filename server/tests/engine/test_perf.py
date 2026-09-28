import time
from dataclasses import replace

from recall_engine import QUESTION_PRESET, CardKind, DoneToday, Phase, new_card, today_queue


def test_today_queue_over_10000_cards_is_fast() -> None:
    now = 1_790_000_000_000
    base = new_card("x", CardKind.QUESTION, QUESTION_PRESET)
    cards = {}
    ids = []
    for i in range(10_000):
        cid = f"c{i}"
        ids.append(cid)
        phase = (Phase.NEW, Phase.LEARNING, Phase.REVIEW, Phase.REVIEW)[i % 4]
        cards[cid] = replace(base, id=cid, phase=phase, due=now - (i % 97) * 60_000, interval=3)
    start = time.perf_counter()
    queue = today_queue(ids, cards, now, QUESTION_PRESET, DoneToday())
    elapsed = time.perf_counter() - start
    assert len(queue.review) == QUESTION_PRESET.reviews_per_day
    assert elapsed < 0.05, f"{elapsed * 1000:.1f} ms"
