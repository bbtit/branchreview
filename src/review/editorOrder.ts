/**
 * Put the active editor first so its decorations paint before other visible tabs
 * (requirements §21). Stable for the rest of the list.
 */
export function orderEditorsActiveFirst<T>(editors: readonly T[], active: T | undefined): T[] {
  if (!active || editors.length <= 1) {
    return [...editors];
  }
  const rest: T[] = [];
  let found = false;
  for (const editor of editors) {
    if (editor === active) {
      found = true;
      continue;
    }
    rest.push(editor);
  }
  return found ? [active, ...rest] : [...editors];
}
