"use client";

import type { ReactNode } from "react";

export type DetailTab<T extends string> = {
  key: T;
  label: string;
  icon?: ReactNode;
};

export function DetailTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: DetailTab<T>[];
  active: T;
  onChange: (tab: T) => void;
}) {
  return (
    <nav className="detail-tabs" aria-label="Seções do registro">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.key}
          className={active === tab.key ? "active" : ""}
          onClick={() => onChange(tab.key)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
