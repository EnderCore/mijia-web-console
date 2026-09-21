import sys
import xxhash

def compute_xxh3(file_path):
    try:
        hasher = xxhash.xxh3_64(seed=0)
        with open(file_path, 'rb') as f:
            while True:
                chunk = f.read(256 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
        return hasher.hexdigest().lower()
    except Exception as e:
        sys.stderr.write(f"Error computing xxh3: {e}\n")
        return ""

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python xxh3_calc.py <file_path>\n")
        sys.exit(1)
    
    file_path = sys.argv[1]
    res = compute_xxh3(file_path)
    if res:
        print(res)
        sys.exit(0)
    else:
        sys.exit(1)
