import { NavLink, Outlet } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';

export default function OfficeLayout() {
  const { me } = useData();
  const links = [
    { to: '/', label: 'Inventory', end: true },
    { to: '/tickets', label: 'Tickets' },
    { to: '/audits', label: 'Audits' },
    { to: '/bulk', label: 'Bulk buy' },
    { to: '/settings', label: 'Settings' },
    { to: '/truck', label: 'Tech view' },
  ];
  return (
    <>
      <header className="topbar">
        <div className="brand">Integrity Inventory</div>
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>{l.label}</NavLink>
          ))}
        </nav>
        <div className="who">
          <span>{me.full_name} · {me.role === 'owner' ? 'Owner' : 'Inventory manager'}</span>
          <button className="linkbtn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <Outlet />
    </>
  );
}
