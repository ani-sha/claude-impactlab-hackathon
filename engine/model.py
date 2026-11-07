"""Every engine output is a Line: value + source + label (SOURCED | ASSUMPTION | DERIVED | UNKNOWN)."""
from dataclasses import dataclass, field


@dataclass
class Line:
    name: str
    value: float | None
    label: str  # SOURCED | ASSUMPTION | DERIVED | UNKNOWN
    source: str = ""
    note: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def known(self) -> bool:
        return self.value is not None and self.label != "UNKNOWN"
