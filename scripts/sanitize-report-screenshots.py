import argparse
from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "report-sources"


def obscure_region(image: Image.Image, box: tuple[int, int, int, int]) -> None:
    """Irreversibly pixelate and blur a sensitive rectangle in-place."""
    left, top, right, bottom = box
    region = image.crop(box)
    small = region.resize(
        (max(8, region.width // 32), max(8, region.height // 24)),
        Image.Resampling.BOX,
    )
    obscured = small.resize(region.size, Image.Resampling.NEAREST).filter(
        ImageFilter.GaussianBlur(radius=6)
    )
    image.paste(obscured, (left, top, right, bottom))


SCREENSHOTS = (
    {
        "source_key": "report_selection",
        "output": "report-center-report-selection.jpg",
        "regions": (
            (0, 0, 2554, 32),       # browser bookmarks
            (286, 34, 438, 88),     # seller/store selector
            (1160, 925, 1395, 976), # report request identifier
        ),
    },
    {
        "source_key": "fulfilled_inventory",
        "output": "amazon-fulfilled-inventory-download.jpg",
        "regions": (
            (0, 0, 2879, 68),       # browser bookmarks
            (350, 470, 2805, 1110), # private report request history
        ),
    },
    {
        "source_key": "inventory_age",
        "output": "fba-inventory-age-analysis.jpg",
        "regions": (
            (300, 16, 465, 78),       # seller/store selector
            (420, 430, 2050, 780),    # date filters and seller KPIs
            (420, 800, 2380, 1695),   # inventory history and summary data
            (420, 1710, 2380, 2480),  # insight metrics and fee history
            (420, 2380, 2380, 3241),  # SKU, ASIN and product-level rows
        ),
    },
    {
        "source_key": "monthly_storage",
        "output": "monthly-storage-fees-download.jpg",
        "regions": (
            (0, 0, 2879, 96),        # browser address and bookmarks
            (350, 370, 2805, 1345),  # private report request history
        ),
    },
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create full-frame, irreversibly sanitized report screenshots."
    )
    parser.add_argument("--report-selection", type=Path, required=True)
    parser.add_argument("--fulfilled-inventory", type=Path, required=True)
    parser.add_argument("--inventory-age", type=Path, required=True)
    parser.add_argument("--monthly-storage", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    sources = {
        "report_selection": args.report_selection,
        "fulfilled_inventory": args.fulfilled_inventory,
        "inventory_age": args.inventory_age,
        "monthly_storage": args.monthly_storage,
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for item in SCREENSHOTS:
        source = sources[item["source_key"]]
        if not source.exists():
            raise FileNotFoundError(source)
        with Image.open(source) as original:
            image = original.convert("RGB")
            original_size = image.size
            for box in item["regions"]:
                obscure_region(image, box)
            output = OUTPUT_DIR / item["output"]
            image.save(output, "JPEG", quality=82, optimize=True, progressive=True)
        with Image.open(output) as check:
            if check.size != original_size:
                raise RuntimeError(f"Output dimension changed: {output}")
        print(f"{item['output']}: {original_size[0]}x{original_size[1]}")


if __name__ == "__main__":
    main()
