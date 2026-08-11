import type { UserProfile } from "@/lib/types";

export function profileLabel(profile: UserProfile) {
  const name = profile.full_name?.trim() || profile.email.split("@")[0];
  return `${name} · ${profile.email}`;
}

export function UserSelect({
  users,
  value,
  onChange,
  placeholder = "Selecione um usuário",
  required = false,
  disabled = false,
}: {
  users: UserProfile[];
  value: string;
  onChange: (profile: UserProfile | null) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(users.find((user) => user.user_id === event.target.value) || null)}
      required={required}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {users.map((user) => (
        <option key={user.user_id} value={user.user_id}>{profileLabel(user)}</option>
      ))}
    </select>
  );
}
