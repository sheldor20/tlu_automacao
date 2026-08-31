import { initials } from "@/lib/format";
import type { UserProfile } from "@/lib/types";
import { Check, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export function UserMultiSelect({
  users,
  value,
  onChange,
  disabled = false,
}: {
  users: UserProfile[];
  value: string[];
  onChange: (userIds: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const selectedUsers = users.filter((user) => value.includes(user.user_id));
  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return users;
    return users.filter((user) => `${user.full_name || ""} ${user.email}`.toLocaleLowerCase("pt-BR").includes(normalized));
  }, [query, users]);

  function toggle(userId: string) {
    if (disabled) return;
    onChange(value.includes(userId) ? value.filter((item) => item !== userId) : [...value, userId]);
  }

  return (
    <div className={`user-multi-select${disabled ? " is-disabled" : ""}`}>
      {selectedUsers.length ? <div className="user-multi-chips">{selectedUsers.map((user) => (
        <span key={user.user_id}><i>{initials(user.full_name || user.email)}</i>{user.full_name || user.email}<button type="button" onClick={() => toggle(user.user_id)} disabled={disabled} aria-label={`Remover ${user.full_name || user.email}`}><X size={12} /></button></span>
      ))}</div> : <div className="user-multi-empty">Selecione uma ou mais pessoas</div>}
      <div className="user-multi-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pessoa…" disabled={disabled} /></div>
      <div className="user-multi-options">
        {visibleUsers.map((user) => {
          const selected = value.includes(user.user_id);
          return <button type="button" key={user.user_id} className={selected ? "selected" : ""} onClick={() => toggle(user.user_id)} disabled={disabled}><span>{initials(user.full_name || user.email)}</span><div><strong>{user.full_name || user.email.split("@")[0]}</strong><small>{user.email}</small></div>{selected ? <Check size={15} /> : null}</button>;
        })}
      </div>
    </div>
  );
}
