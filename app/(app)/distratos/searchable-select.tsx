"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { filterDistratoOptions, type DistratoSelectOption } from "@/lib/distratos-select-options";

export function SearchableSelect({ label, value, options, placeholder, disabled = false, className = "", onChange }: {
  label: string;
  value: string;
  options: DistratoSelectOption[];
  placeholder: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const expanded = open && !disabled;
  const filtered = filterDistratoOptions(options, query);
  const visible = query.trim() ? filtered : [{ value: "", label: placeholder }, ...filtered];
  const selected = options.find((option) => option.value === value)?.label || "";
  const activeOption = expanded && active >= 0 && active < visible.length ? active : -1;

  useEffect(() => {
    if (activeOption >= 0) document.getElementById(`${id}-option-${activeOption}`)?.scrollIntoView({ block: "nearest" });
  }, [activeOption, id]);

  function close() { setOpen(false); setQuery(""); setActive(-1); }
  function show() { if (!disabled && !open) { setQuery(""); setActive(-1); setOpen(true); } }
  function choose(next: string) { close(); onChange(next); }

  return <div className={`field distrato-select ${className}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <label className="field-label" htmlFor={id}>{label}</label>
    <div className="distrato-select-control">
      <input id={id} ref={input} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`} aria-activedescendant={activeOption >= 0 ? `${id}-option-${activeOption}` : undefined} autoComplete="off" disabled={disabled} placeholder={expanded ? `Buscar ${label.toLocaleLowerCase("pt-BR")}…` : placeholder} value={expanded ? query : selected} onFocus={(event) => event.currentTarget.select()} onClick={show} onChange={(event) => { setOpen(true); setQuery(event.target.value); setActive(-1); }} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); show();
          setActive(event.key === "ArrowDown" ? Math.min(activeOption + 1, visible.length - 1) : activeOption <= 0 ? visible.length - 1 : activeOption - 1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (expanded && activeOption >= 0) choose(visible[activeOption].value);
          else show();
        } else if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === "Tab") close();
      }} />
      {expanded && query ? <button type="button" className="distrato-select-clear" aria-label={`Limpar busca de ${label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(""); setActive(-1); input.current?.focus(); }}><X size={16} /></button> : null}
      <button type="button" className="distrato-select-toggle" disabled={disabled} tabIndex={-1} aria-label={`${expanded ? "Fechar" : "Abrir"} opções de ${label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (expanded) close(); else show(); input.current?.focus(); }}><ChevronDown size={17} /></button>
    </div>
    {expanded ? <div className="distrato-select-popup">
      <ul id={`${id}-options`} role="listbox" aria-label={label}>{visible.map((option, index) => <li id={`${id}-option-${index}`} key={option.value} role="option" aria-selected={option.value === value} className={index === activeOption ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => { choose(option.value); input.current?.focus(); }}>{option.label}</li>)}</ul>
      {!visible.length ? <p role="status">Nenhuma opção encontrada.</p> : null}
    </div> : null}
  </div>;
}
