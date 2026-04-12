"""FastMCP stdio server: tool implementations delegate to ../scripts/mcp-one-shot-call.mts."""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

from fastmcp import FastMCP


def _phase2_root() -> pathlib.Path:
    env = os.environ.get("PHASE2_SCHEDULING_ROOT", "").strip()
    if env:
        return pathlib.Path(env)
    here = pathlib.Path(__file__).resolve()
    for ancestor in here.parents:
        if (ancestor / "mcp" / "advisor-mcp-server.ts").is_file():
            return ancestor
    raise RuntimeError(
        "Cannot find phase-2-scheduling-core root (expected mcp/advisor-mcp-server.ts). "
        "Set PHASE2_SCHEDULING_ROOT or run from the repo checkout."
    )


def _script_path() -> pathlib.Path:
    return _phase2_root() / "scripts" / "mcp-one-shot-call.mts"

mcp = FastMCP("advisor-scheduling")


def _run_ts_tool(tool: str, arguments: dict) -> dict:
    root = _phase2_root()
    proc = subprocess.run(
        [
            "npx",
            "--yes",
            "tsx",
            str(_script_path()),
            tool,
            json.dumps(arguments),
        ],
        cwd=str(root),
        capture_output=True,
        text=True,
        env=os.environ.copy(),
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "subprocess failed").strip()
        return {"ok": False, "error": err}
    lines = [ln for ln in proc.stdout.strip().splitlines() if ln.strip()]
    if not lines:
        return {"ok": False, "error": "empty stdout from mcp-one-shot-call"}
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return {"ok": False, "error": "invalid_json_from_ts", "raw": lines[-1][:500]}


@mcp.tool()
def offer_slots(topic: str, day: str, time_preference: str) -> dict:
    """Return up to two real free slots from Google Calendar (IST) or waitlist with a code."""
    return _run_ts_tool(
        "offer_slots",
        {"topic": topic, "day": day, "time_preference": time_preference},
    )


@mcp.tool()
def lookup_pii_booking(booking_code: str, secure_link_token: str) -> dict:
    """Validate code + token for the post-call PII form (read-only)."""
    return _run_ts_tool(
        "lookup_pii_booking",
        {"booking_code": booking_code, "secure_link_token": secure_link_token},
    )


@mcp.tool()
def confirm_booking(topic: str, slot_display: str, startIso: str, endIso: str) -> dict:
    """Confirm booking: calendar hold, Sheets rows, advisor pre-bookings log, Gmail draft when configured."""
    return _run_ts_tool(
        "confirm_booking",
        {
            "topic": topic,
            "slot_display": slot_display,
            "startIso": startIso,
            "endIso": endIso,
        },
    )


@mcp.tool()
def submit_pii_booking(
    booking_code: str,
    secure_link_token: str,
    name: str,
    email: str,
    phone: str,
    account: str | None = None,
) -> dict:
    """Post-call PII path (also Phase 2 tool surface); encrypts to Sheets and sends mail when configured."""
    payload: dict = {
        "booking_code": booking_code,
        "secure_link_token": secure_link_token,
        "name": name,
        "email": email,
        "phone": phone,
    }
    if account is not None:
        payload["account"] = account
    return _run_ts_tool("submit_pii_booking", payload)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
