"""Single source of truth for the application version.

The GitHub release tag (e.g. ``v1.0.1``) is compared against this value to
decide whether an update is available. Bump it in the same commit you tag.
"""

__version__ = "1.0.0"

APP_NAME = "Attendance List"

# Public repository that hosts the releases used by the auto-updater.
GITHUB_OWNER = "krispx2811"
GITHUB_REPO = "attendance-list"

# Name of the executable asset attached to each release.
RELEASE_ASSET_NAME = "AttendanceList.exe"


def version_tuple(value: str) -> tuple:
    """Turn a version string into a comparable tuple.

    Accepts values with or without a leading ``v``. Any trailing non-numeric
    suffix (``1.2.0-beta``) is ignored so comparisons never raise.
    """
    cleaned = value.strip().lstrip("vV").split("-")[0].split("+")[0]
    parts = []
    for chunk in cleaned.split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        parts.append(int(digits) if digits else 0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])
