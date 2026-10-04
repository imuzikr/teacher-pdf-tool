import { uid } from "./pdf-engine.js";

export function addAssemblyPages(entries, pages, ids) {
  return [
    ...entries,
    ...pages.filter((p) => ids.has(p.id)).map((page) => ({ id: uid(), page })),
  ];
}

export function resolveAssemblyPages(entries, pages) {
  const current = new Map(pages.map((page) => [page.id, page]));
  return entries.map((entry) => current.get(entry.page.id) || entry.page);
}

export function moveAssemblyEntry(entries, id, destination) {
  const from = entries.findIndex((entry) => entry.id === id);
  if (
    from < 0 ||
    destination < 0 ||
    destination >= entries.length ||
    from === destination
  )
    return entries;
  const next = [...entries];
  const [entry] = next.splice(from, 1);
  next.splice(destination, 0, entry);
  return next;
}
