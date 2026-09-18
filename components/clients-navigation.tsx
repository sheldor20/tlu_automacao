'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Ticket, Users } from 'lucide-react';

export function ClientsNavigation({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const active = pathname.startsWith('/clientes');
  const [preference, setPreference] = useState({ pathname, open: active });
  const open = preference.pathname === pathname ? preference.open : active;
  return <div className="nav-group">
    <button type="button" className={`nav-link nav-parent${active ? ' active' : ''}`} title="Clientes"
      aria-expanded={open} aria-controls="clients-submenu" onClick={() => setPreference({ pathname, open: !open })}>
      <Users size={19} /><span>Clientes</span><ChevronDown size={15} className={`nav-parent-chevron${open ? ' open' : ''}`} />
    </button>
    <div id="clients-submenu" className="nav-submenu" aria-label="Submenus de Clientes" hidden={!open}>
      <Link href="/clientes" className={`nav-sublink${pathname === '/clientes' ? ' active' : ''}`} onClick={onNavigate}>
        <Users size={15} /><span>Carteira de clientes</span></Link>
      <Link href="/clientes/clube-tlu" className={`nav-sublink${pathname.startsWith('/clientes/clube-tlu') ? ' active' : ''}`} onClick={onNavigate}>
        <Ticket size={15} /><span>Clube TLU</span></Link>
    </div>
  </div>;
}
