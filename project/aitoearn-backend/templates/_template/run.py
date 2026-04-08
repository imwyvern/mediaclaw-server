from __future__ import annotations

from typing import Any, Dict


def run(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Standard template contract.
    The real media pipeline is orchestrated by the NestJS production service.
    """
    extra = params.get("extra") or {}
    return {
        "status": "failed",
        "video_url": "",
        "cover_url": "",
        "title": extra.get("title", ""),
        "copy": extra.get("copy", {}),
        "cost": 0.0,
        "duration_sec": 0.0,
        "error": "Implement template-specific orchestration before direct execution.",
    }
