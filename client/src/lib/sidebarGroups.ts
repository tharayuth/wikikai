/** A row of `GET /api/projects`, narrowed to what the sidebar needs. */
export interface SidebarProject {
  id: number | null;
  name: string;
  registered: boolean;
}

export interface DocumentlessOptions {
  /** True while the list is narrowed by search text, selected tags,
   *  starred-only or archived-only. A project with no documents cannot match
   *  any of those, so none are added. */
  narrowed: boolean;
  /** The parsed `?projects=` filter (`ProjectFilter` in `useHash`), or null
   *  when the param is absent. Only `ids` matters here: the "(no project)"
   *  bucket is never a registered project. */
  urlFilter?: { ids: readonly number[] } | null;
}

/**
 * Append a `[name, []]` group for every registered project that owns no
 * documents, so a project whose last document went away keeps a way in to its
 * board: the calendar icon on its group is the only UI entry to it, and
 * groups are otherwise built from knowledge rows alone.
 *
 * - Only `registered` projects with an id qualify; a name that appears only on
 *   knowledge rows already has a group, and an unregistered one has no board.
 * - Projects come out in the order the API returned them, after the groups.
 * - A narrowed list is returned unchanged.
 * - The `?projects=` filter applies as it does to documents: a project outside
 *   it stays hidden, and an explicit empty selection hides all of them.
 */
export function withDocumentlessProjects<T>(
  groups: [string, T[]][],
  projects: readonly SidebarProject[],
  { narrowed, urlFilter = null }: DocumentlessOptions,
): [string, T[]][] {
  if (narrowed) return groups;
  const present = new Set(groups.map(([name]) => name));
  const allowedIds = urlFilter == null ? null : new Set(urlFilter.ids);
  const extra: [string, T[]][] = [];
  for (const p of projects) {
    if (!p.registered || p.id == null || present.has(p.name)) continue;
    if (allowedIds != null && !allowedIds.has(p.id)) continue;
    present.add(p.name);
    extra.push([p.name, []]);
  }
  return extra.length === 0 ? groups : [...groups, ...extra];
}
