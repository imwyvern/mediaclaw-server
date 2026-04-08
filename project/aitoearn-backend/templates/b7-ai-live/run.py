from __future__ import annotations

from typing import Any, Dict


def run(params: Dict[str, Any]) -> Dict[str, Any]:
    brand_assets = params.get("brand_assets") or {}
    first_frame_url = params.get("first_frame_url") or ""
    reference_video_url = params.get("reference_video_url") or ""
    extra = params.get("extra") or {}

    if not brand_assets:
        return {
            "status": "failed",
            "video_url": "",
            "cover_url": "",
            "title": "",
            "copy": {},
            "cost": 0.0,
            "duration_sec": 0.0,
            "error": "brand_assets is required",
        }

    if not first_frame_url and not reference_video_url:
        return {
            "status": "failed",
            "video_url": "",
            "cover_url": "",
            "title": "",
            "copy": {},
            "cost": 0.0,
            "duration_sec": 0.0,
            "error": "first_frame_url or reference_video_url is required",
        }

    title = extra.get("title") or "AI 微动视频待生成"
    return {
        "status": "success",
        "video_url": extra.get("video_url", ""),
        "cover_url": extra.get("cover_url", ""),
        "title": title,
        "copy": extra.get(
            "copy",
            {
                "template_id": "b7-ai-live",
                "style_rewrite": params.get("style_rewrite", True),
                "notes": "该模板由 NestJS 生产编排器调度实际执行。",
            },
        ),
        "cost": float(extra.get("cost", 15.1)),
        "duration_sec": float(extra.get("duration_sec", 5.0)),
        "error": None,
    }
