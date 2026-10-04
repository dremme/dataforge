"""Measure ComfyUI prompt extraction over a media folder, optionally against a saved baseline.

Run before and after touching backend/comfy_prompts.py:
  backend/.venv/Scripts/python scripts/sweep_comfy_prompts.py <folder> --save before.json
  backend/.venv/Scripts/python scripts/sweep_comfy_prompts.py <folder> --compare before.json

Keep baselines outside the repository: they hold paths and node classes from real workflows.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parent.parent / "backend"

#: Per file: branches as [node_id, class_type, prompt count], the unique match and orphan count.
type Record = dict[str, Any]


def _measure(path: str) -> Record | None:
    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))
    from comfy_prompts import extract_workflow_prompts

    try:
        result = extract_workflow_prompts(Path(path))
    except Exception as error:  # noqa: BLE001 - a crash on one file is itself a finding
        return {"error": f"{type(error).__name__}: {error}"}
    if not result.has_workflow:
        return None
    return {
        "branches": [
            [branch.node_id, branch.class_type, len(branch.prompts)] for branch in result.branches
        ],
        "matched": result.matched_node_id,
        "orphans": len(result.orphan_prompts),
    }


def sweep(folder: Path) -> dict[str, Record]:
    sys.path.insert(0, str(BACKEND))
    from constants import COMFY_WORKFLOW_EXTENSIONS

    paths = sorted(
        path
        for path in folder.rglob("*")
        if path.suffix.lower() in COMFY_WORKFLOW_EXTENSIONS and path.is_file()
    )
    records: dict[str, Record] = {}
    with ProcessPoolExecutor() as pool:
        for path, record in zip(
            paths, pool.map(_measure, map(str, paths), chunksize=32), strict=True
        ):
            if record is not None:
                records[path.relative_to(folder).as_posix()] = record
    return records


def _has_prompts(record: Record) -> bool:
    return any(count for _, _, count in record.get("branches", []))


def summarize(records: dict[str, Record]) -> list[str]:
    measured = [record for record in records.values() if "error" not in record]
    branches = sum(len(record["branches"]) for record in measured)
    return [
        f"files with a workflow     {len(records)}",
        f"errors                    {len(records) - len(measured)}",
        f"branches                  {branches} ({branches / max(len(measured), 1):.2f} per file)",
        f"files without branches    {sum(not record['branches'] for record in measured)}",
        f"files without any prompt  {sum(not _has_prompts(record) for record in measured)}",
        f"files matched uniquely    {sum(record['matched'] is not None for record in measured)}",
        f"files with orphan prompts {sum(record['orphans'] > 0 for record in measured)}",
    ]


def compare(before: dict[str, Record], after: dict[str, Record], examples: int) -> list[str]:
    removed: Counter[str] = Counter()
    added: Counter[str] = Counter()
    regressions: dict[str, list[str]] = {
        "lost every branch": [],
        "lost every prompt": [],
        "lost the unique match": [],
        "newly erroring": [],
    }

    for name in sorted(before.keys() | after.keys()):
        old, new = before.get(name, {}), after.get(name, {})
        if "error" in new and "error" not in old:
            regressions["newly erroring"].append(name)
            continue
        old_branches = {tuple(branch[:2]) for branch in old.get("branches", [])}
        new_branches = {tuple(branch[:2]) for branch in new.get("branches", [])}
        removed.update(class_type for _, class_type in old_branches - new_branches)
        added.update(class_type for _, class_type in new_branches - old_branches)
        if old_branches and not new_branches:
            regressions["lost every branch"].append(name)
        if _has_prompts(old) and not _has_prompts(new):
            regressions["lost every prompt"].append(name)
        if old.get("matched") is not None and new.get("matched") is None:
            regressions["lost the unique match"].append(name)

    lines = [f"files only before {len(before.keys() - after.keys())}"]
    lines.append(f"files only after  {len(after.keys() - before.keys())}")
    for title, counts in (("branches removed", removed), ("branches added", added)):
        lines.append(f"{title}: {sum(counts.values())}")
        lines.extend(f"  {count:6}  {class_type}" for class_type, count in counts.most_common())
    for title, names in regressions.items():
        lines.append(f"{title}: {len(names)}")
        lines.extend(f"  {name}" for name in names[:examples])
        if len(names) > examples:
            lines.append(f"  ... and {len(names) - examples} more")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", type=Path, help="Folder searched recursively for media.")
    parser.add_argument("--save", type=Path, help="Write the per-file results to this JSON file.")
    parser.add_argument("--compare", type=Path, help="Diff against a JSON file from --save.")
    parser.add_argument("--examples", type=int, default=10, help="File names listed per finding.")
    args = parser.parse_args()

    if not args.folder.is_dir():
        parser.error(f"{args.folder} is not a folder.")

    records = sweep(args.folder)
    print("\n".join(summarize(records)))

    if args.compare:
        baseline = json.loads(args.compare.read_text(encoding="utf-8"))
        print()
        print("\n".join(compare(baseline, records, args.examples)))
    if args.save:
        args.save.write_text(json.dumps(records, indent=1), encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
