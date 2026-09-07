/**
 * Order Set Base QuickPick candidates (D6).
 * Prefer previous base, then common upstream defaults, then remaining refs.
 */

const PREFERRED_DEFAULTS = [
  "upstream/main",
  "origin/main",
  "origin/master",
  "main",
  "master",
] as const;

function isDevelopFamily(ref: string): boolean {
  const short = ref.includes("/") ? (ref.split("/").pop() ?? ref) : ref;
  return short === "develop" || short === "dev" || short.startsWith("develop/");
}

/**
 * @param refs - existing local/remote branch names
 * @param previousBase - last remembered base for this repo, if any
 */
export function orderBaseCandidates(refs: readonly string[], previousBase?: string): string[] {
  const available = new Set(refs);
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (ref: string | undefined): void => {
    if (!ref || seen.has(ref)) {
      return;
    }
    // Previous base may be a SHA or deleted remote; still offer it first.
    if (ref === previousBase || available.has(ref)) {
      ordered.push(ref);
      seen.add(ref);
    }
  };

  push(previousBase);

  for (const preferred of PREFERRED_DEFAULTS) {
    push(preferred);
  }

  const developRefs = [...refs].filter(isDevelopFamily).sort((a, b) => a.localeCompare(b));
  for (const ref of developRefs) {
    push(ref);
  }

  const rest = [...refs].filter((ref) => !seen.has(ref)).sort((a, b) => a.localeCompare(b));
  for (const ref of rest) {
    push(ref);
  }

  return ordered;
}
