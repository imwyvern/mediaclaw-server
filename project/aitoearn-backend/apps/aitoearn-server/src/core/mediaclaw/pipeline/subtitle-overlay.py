#!/usr/bin/env python3

import argparse
from PIL import Image, ImageDraw, ImageFont


def load_font(size: int):
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--ai-label", required=True)
    parser.add_argument("--watermark", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    image = Image.new("RGBA", (args.width, args.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    label_font = load_font(28)
    subtitle_font = load_font(56)
    watermark_font = load_font(28)

    draw.rectangle(
        [(40, args.height - 260), (args.width - 40, args.height - 80)],
        fill=(0, 0, 0, 90),
    )
    draw.text((40, 42), args.ai_label, fill=(248, 211, 75, 255), font=label_font)

    watermark_box = draw.textbbox((0, 0), args.watermark, font=watermark_font)
    watermark_width = watermark_box[2] - watermark_box[0]
    draw.text((args.width - watermark_width - 40, 42), args.watermark, fill=(255, 255, 255, 255), font=watermark_font)

    subtitle_box = draw.textbbox((0, 0), args.text, font=subtitle_font)
    subtitle_width = subtitle_box[2] - subtitle_box[0]
    x = max((args.width - subtitle_width) // 2, 40)
    draw.text((x, args.height - 170), args.text, fill=(255, 255, 255, 255), font=subtitle_font)

    image.save(args.output)


if __name__ == "__main__":
    main()
