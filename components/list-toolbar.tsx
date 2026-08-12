"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export function ListToolbar({
  query,
  onQueryChange,
  placeholder = "Buscar por nome, responsável ou localização",
  children,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div className="list-toolbar">
      <label className="list-search">
        <Search size={17} />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
      </label>
      {children ? <div className="list-filter-group"><SlidersHorizontal size={15} />{children}</div> : null}
    </div>
  );
}
