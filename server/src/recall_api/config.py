"""Settings from the environment (see .env.example at the repo root)."""

import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Config:
    database_url: str


def load_config(env: Mapping[str, str] = os.environ) -> Config:
    url = env.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set. Copy .env.example to .env at the repo root.")
    return Config(database_url=url)
