"""recall_engine may import only the standard library (SPEC-sm2-engine: "pure")."""

import ast
import sys
from pathlib import Path

import recall_engine

PACKAGE = Path(recall_engine.__file__).parent


def test_engine_imports_only_the_standard_library() -> None:
    offenders: list[str] = []
    for path in PACKAGE.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            for name in names:
                if name.split(".")[0] not in sys.stdlib_module_names:
                    offenders.append(f"{path.name}: {name}")
    assert not offenders, offenders


def test_engine_never_reads_the_clock() -> None:
    forbidden = ("time.time", "datetime.now", "datetime.utcnow", "date.today", "time.monotonic")
    for path in PACKAGE.rglob("*.py"):
        text = path.read_text()
        for call in forbidden:
            assert call not in text, f"{path.name} calls {call}"
