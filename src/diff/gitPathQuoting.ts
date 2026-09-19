const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** C escapes Git emits inside a quoted path, mapped to the byte they stand for. */
const SIMPLE_ESCAPES = new Map<string, number>([
  ["a", 0x07],
  ["b", 0x08],
  ["t", 0x09],
  ["n", 0x0a],
  ["v", 0x0b],
  ["f", 0x0c],
  ["r", 0x0d],
  ['"', 0x22],
  ["\\", 0x5c],
]);

/**
 * Turn a path as Git printed it back into the real name.
 *
 * Git wraps a path in double quotes and C-escapes it whenever the name holds a
 * `"`, a backslash, or a control character — and, unless `core.quotepath=false`,
 * every non-ASCII byte as `\ooo` octal. Octal escapes are UTF-8 bytes, so they
 * are collected as bytes and decoded once at the end. An unquoted path is
 * returned unchanged.
 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }

  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  let literalStart = 0;

  // Literal runs are encoded whole so surrogate pairs survive.
  const flushLiteral = (end: number): void => {
    if (end > literalStart) {
      for (const byte of encoder.encode(body.slice(literalStart, end))) {
        bytes.push(byte);
      }
    }
  };

  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== "\\") {
      continue;
    }
    flushLiteral(i);

    const escape = body[i + 1];
    if (escape === undefined) {
      literalStart = body.length;
      break;
    }
    i += 1;

    const simple = SIMPLE_ESCAPES.get(escape);
    if (simple !== undefined) {
      bytes.push(simple);
    } else if (isOctalDigit(escape)) {
      let octal = escape;
      while (octal.length < 3 && isOctalDigit(body[i + 1])) {
        i += 1;
        octal += body[i];
      }
      bytes.push(Number.parseInt(octal, 8) & 0xff);
    } else {
      // Not an escape Git produces — keep the character itself.
      for (const byte of encoder.encode(escape)) {
        bytes.push(byte);
      }
    }
    literalStart = i + 1;
  }

  flushLiteral(body.length);
  return decoder.decode(Uint8Array.from(bytes));
}

/** Drop the `a/` or `b/` side prefix a diff header puts in front of a path. */
export function stripDiffSidePrefix(path: string): string {
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path;
}

function isOctalDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "7";
}
