import importlib


def test_packages_import() -> None:
    for name in ("recall_engine", "recall_content", "recall_api"):
        assert importlib.import_module(name).__doc__
