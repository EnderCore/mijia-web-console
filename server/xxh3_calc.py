import sys
import xxhash

CHUNK_SIZE = 256 * 1024


def compute_from_file(file_path):
    hasher = xxhash.xxh3_64(seed=0)
    with open(file_path, 'rb') as f:
        while True:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest().lower()


def compute_from_stdin():
    # 读取二进制字节流（网关用 pipe 把下载流转发过来做流式校验）
    hasher = xxhash.xxh3_64(seed=0)
    stream = getattr(sys.stdin, 'buffer', sys.stdin)
    while True:
        chunk = stream.read(CHUNK_SIZE)
        if not chunk:
            break
        hasher.update(chunk)
    return hasher.hexdigest().lower()


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python xxh3_calc.py <file_path|->\n")
        return 1

    target = sys.argv[1]
    try:
        # 参数为 "-" 时从 stdin 流式计算，避免大文件落盘
        result = compute_from_stdin() if target == '-' else compute_from_file(target)
    except Exception as e:
        sys.stderr.write(f"Error computing xxh3: {e}\n")
        return 1

    if not result:
        return 1

    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
