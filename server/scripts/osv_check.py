"""Check every package version in uv.lock against OSV.dev (NVD, GitHub advisories, PyPA).

Exits 1 when any locked version has a known vulnerability, 2 when OSV can't be reached.
Mirrors web/scripts/osv-check.mjs.
"""

import json
import sys
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

LOCK = Path(__file__).resolve().parent.parent / "uv.lock"
OSV_BATCH = "https://api.osv.dev/v1/querybatch"


def locked_packages() -> list[tuple[str, str]]:
    lock = tomllib.loads(LOCK.read_text())
    out: list[tuple[str, str]] = []
    for pkg in lock.get("package", []):
        source = pkg.get("source", {})
        # Skip the project itself (editable/virtual); only registry packages have CVEs on PyPI.
        if "registry" not in source:
            continue
        out.append((pkg["name"], pkg["version"]))
    return sorted(set(out))


def main() -> int:
    packages = locked_packages()
    queries = [{"package": {"name": n, "ecosystem": "PyPI"}, "version": v} for n, v in packages]
    request = urllib.request.Request(
        OSV_BATCH,
        data=json.dumps({"queries": queries}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            results = json.load(response)["results"]
    except (urllib.error.URLError, TimeoutError) as err:
        print(f"OSV query failed: {err}", file=sys.stderr)
        return 2
    hits = [(p, r.get("vulns", [])) for p, r in zip(packages, results, strict=True) if r.get("vulns")]
    print(f"OSV.dev: {len(packages)} Python package versions checked, {len(hits)} with known vulnerabilities")
    for (name, version), vulns in hits:
        print(f"  {name}=={version}: {', '.join(v['id'] for v in vulns)}")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
