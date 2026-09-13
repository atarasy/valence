#!/usr/bin/env python3
"""Apply each mutation to disposable source and inspect executed replacements.

The instrumented subprocess observes string.replace at the moment it runs, so
an earlier replacement's intermediate text is valid and each file is checked
against its own contents. Single-quoted literals and computed anchors use the
same Python semantics as the mutation itself.

This tracks read_text results through replacement, addition and slicing. Other
string transformations may lose tracking. Replacements on unrelated strings
(such as normalising a route name) are deliberately excluded.

This checks executed attribute calls named replace, not every possible mutation
mechanism: aliased methods, re.sub, skipped branches and calls inside imported
helpers are not instrumented. A passing check proves neither unique targeting
nor that a mutation changes the behaviour its name describes. Never run this
while a sweep has changed the source being copied.
"""
import ast
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent.parent
HELPER = "__valence_anchor_replace_73a19"
READ_HELPER = "__valence_anchor_read_73a19"


class SourceText(str):
    """Track file-derived text through the string operations this corpus uses."""
    def __add__(self, other):
        return SourceText(super().__add__(other))

    def __radd__(self, other):
        return SourceText(other + str(self))

    def __getitem__(self, index):
        return SourceText(super().__getitem__(index))


class InspectReplacements(ast.NodeTransformer):
    def visit_Call(self, node):
        node = self.generic_visit(node)
        if isinstance(node.func, ast.Attribute) and node.func.attr == "replace":
            return ast.copy_location(ast.Call(
                func=ast.Name(id=HELPER, ctx=ast.Load()),
                args=[ast.Constant(node.lineno), node.func.value, *node.args],
                keywords=node.keywords,
            ), node)
        if isinstance(node.func, ast.Attribute) and node.func.attr == "read_text":
            return ast.copy_location(ast.Call(
                func=ast.Name(id=READ_HELPER, ctx=ast.Load()),
                args=[node], keywords=[],
            ), node)
        return node


def inspect_script(script: pathlib.Path, report: pathlib.Path) -> None:
    """Run only in the disposable subprocess; record even if the script raises."""
    result = {"checked": 0, "missing": [], "untracked_calls": 0}

    def replacement(line, receiver, *args, **kwargs):
        if isinstance(receiver, SourceText) and args and isinstance(args[0], str):
            result["checked"] += 1
            anchor = args[0]
            # An empty anchor or explicit zero count is an intentional no-op,
            # not a missing target. Preserve Python's own argument validation.
            count = args[2] if len(args) > 2 else kwargs.get("count", -1)
            if anchor and count != 0 and anchor not in receiver:
                result["missing"].append({"line": line, "anchor": anchor})
        else:
            result["untracked_calls"] += 1
        changed = receiver.replace(*args, **kwargs)
        return SourceText(changed) if isinstance(receiver, SourceText) else changed

    try:
        tree = ast.parse(script.read_text(), filename=str(script))
        # Do not silently shadow a mutation's own binding.
        if any(isinstance(n, ast.Name) and n.id in (HELPER, READ_HELPER) for n in ast.walk(tree)):
            raise ValueError("instrumentation helper name collides with mutation")
        tree = ast.fix_missing_locations(InspectReplacements().visit(tree))
        exec(compile(tree, str(script), "exec"), {
            "__name__": "__main__", "__file__": str(script), HELPER: replacement,
            READ_HELPER: lambda text: SourceText(text) if isinstance(text, str) else text,
        })
    finally:
        report.write_text(json.dumps(result))


def check_script(script: pathlib.Path, source: pathlib.Path, work: pathlib.Path):
    target = work / "src"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)
    report = work / "anchor-report.json"
    report.unlink(missing_ok=True)
    run = subprocess.run(
        [sys.executable, str(pathlib.Path(__file__).resolve()),
         "--inspect", str(script.resolve()), str(report.resolve())],
        cwd=work, capture_output=True, text=True,
    )
    return run, json.loads(report.read_text()) if report.exists() else None


def main() -> int:
    scripts = sorted((HERE / "scripts/mutations").glob("*.py"))
    if not scripts:
        print("no mutation scripts found")
        return 1
    raised, missing = [], []
    checked = non_string = 0
    with tempfile.TemporaryDirectory() as tmp:
        for script in scripts:
            run, report = check_script(script, HERE / "src", pathlib.Path(tmp))
            if run.returncode != 0:
                last = (run.stderr.strip().split("\n") or [""])[-1]
                raised.append((script.stem, last[:160]))
            if report is None:
                raised.append((script.stem, "instrumentation report missing"))
                continue
            checked += report["checked"]
            non_string += report["untracked_calls"]
            missing.extend((script.stem, item) for item in report["missing"])
    print(f"mutation scripts: {len(scripts)}")
    print(f"scripts that raised: {len(raised)}")
    for name, error in raised:
        print(f"  {name}: {error}")
    print(f"executed string replacements inspected: {checked}")
    print(f"executed replacement anchors missing: {len(missing)}")
    for name, item in missing:
        first = item["anchor"].strip().split("\n")[0][:90]
        print(f"  {name}:{item['line']}: {first}")
    print(f"replacement calls on untracked text not inspected: {non_string}")
    print("Scope: executed .replace calls on read_text-derived strings; aliases, imported helpers and skipped branches are not inspected.")
    print("Matching anchors do not prove unique targeting or the intended behavioural change.")
    return 1 if raised or missing else 0


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--inspect":
        inspect_script(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]))
    else:
        raise SystemExit(main())
