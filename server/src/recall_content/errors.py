"""Content problems, each naming the file, line and item so an author can fix it."""

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ContentError:
    file: str  # relative to the course folder
    line: int | None
    key: str | None  # the question/exercise key, when the problem is inside one
    message: str

    def __str__(self) -> str:
        where = f"{self.file}:{self.line}" if self.line else self.file
        return f"{where} {self.key}: {self.message}" if self.key else f"{where}: {self.message}"


@dataclass
class ContentErrors(Exception):
    errors: list[ContentError] = field(default_factory=list[ContentError])

    def __str__(self) -> str:
        return "\n".join(str(e) for e in self.errors)
