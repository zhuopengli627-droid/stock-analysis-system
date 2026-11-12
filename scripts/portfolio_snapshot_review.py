"""Write a broker snapshot review to a new local report directory."""

import argparse
import json
from pathlib import Path
from tempfile import mkdtemp

from src.services.portfolio_snapshot_review import (
    BrokerSnapshot,
    build_snapshot_review,
    render_snapshot_review,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path, help="Local broker snapshot JSON")
    args = parser.parse_args()
    try:
        snapshot = BrokerSnapshot.model_validate_json(args.snapshot.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    review = build_snapshot_review(snapshot)
    markdown = render_snapshot_review(review)
    structured = json.dumps(review, ensure_ascii=False, indent=2) + "\n"
    report_root = Path("reports") / "portfolio-snapshots"
    report_root.mkdir(parents=True, exist_ok=True)
    staging = Path(mkdtemp(prefix=f".pending-{snapshot.observed_at.date()}-", dir=report_root))
    (staging / "review.md").write_text(markdown, encoding="utf-8")
    (staging / "review.json").write_text(structured, encoding="utf-8")
    output = staging.rename(staging.with_name(staging.name.removeprefix(".pending-")))
    print(output.resolve())


if __name__ == "__main__":
    main()
