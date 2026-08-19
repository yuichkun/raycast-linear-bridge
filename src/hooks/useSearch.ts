import { useEffect, useState } from "react";
import { searchItems } from "../search";
import { Task } from "../types";

export function useSearch(unfilteredItems: Task[], initialSearchText?: string) {
  const [searchText, setSearchText] = useState(initialSearchText ?? "");
  const [filteredItems, setFilteredItems] = useState<Task[]>(unfilteredItems);

  useEffect(() => {
    if (searchText === "") {
      setFilteredItems(unfilteredItems);
      return;
    }
    setFilteredItems(searchItems(unfilteredItems, searchText));
  }, [searchText, unfilteredItems]);

  return { searchText, setSearchText, filteredItems };
}
