import { useMemo, useState } from "react";
import { searchItems } from "../search";
import { Task } from "../types";

// filteredItems is derived, not its own state kept in sync via useEffect: unfilteredItems
// is a new array reference on every render of the caller (list-tasks.tsx re-filters tasks
// each time), and an effect depending on that reference re-ran — and called setState —
// on every single render, which is exactly what caused a real "Maximum update depth
// exceeded" loop in production. Computing it directly during render can't loop.
export function useSearch(unfilteredItems: Task[], initialSearchText?: string) {
  const [searchText, setSearchText] = useState(initialSearchText ?? "");
  const filteredItems = useMemo(
    () => (searchText === "" ? unfilteredItems : searchItems(unfilteredItems, searchText)),
    [unfilteredItems, searchText],
  );

  return { searchText, setSearchText, filteredItems };
}
