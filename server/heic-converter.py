"""
HEIC / HEIF to JPEG Transcoder Helper
Reads HEIC file from argv[1], writes JPEG to argv[2] with optional max_dim in argv[3]
"""
import sys
from PIL import Image
import pillow_heif

def main():
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: python heic_convert.py <input_heic> <output_jpg> [max_dim]\n")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    max_dim = int(sys.argv[3]) if len(sys.argv) > 3 else 0

    try:
        pillow_heif.register_heif_opener()
        with Image.open(input_path) as img:
            # 自动处理 EXIF 方向
            try:
                from PIL import ImageOps
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass

            # 若指定了缩略图尺寸限制，按比例等比缩放
            if max_dim > 0 and (img.width > max_dim or img.height > max_dim):
                img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

            # 转换为 RGB 模式（HEIC 常见深度图或 RGBA 转 JPEG 必需）
            if img.mode != "RGB":
                img = img.convert("RGB")

            img.save(output_path, format="JPEG", quality=88, optimize=True)
            sys.stdout.write("OK\n")
            sys.exit(0)
    except Exception as e:
        sys.stderr.write(f"Transcode error: {e}\n")
        sys.exit(2)

if __name__ == "__main__":
    main()
