import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { DataProvider } from './lib/data';
import type { Profile } from './lib/types';
import Login from './pages/Login';
import OfficeLayout from './components/OfficeLayout';
import TechHome from './pages/tech/TechHome';
import CloseJob from './pages/tech/CloseJob';
import Dashboard from './pages/office/Dashboard';
import ItemEdit from './pages/office/ItemEdit';
import BulkBuy from './pages/office/BulkBuy';
import Tickets from './pages/office/Tickets';
import AuditList from './pages/office/AuditList';
import AuditRun from './pages/office/AuditRun';
import Settings from './pages/office/Settings';
import InventorySettings from './pages/office/InventorySettings';
import QuotesPage from './pages/office/quotes/QuotesPage';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMe(null); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).single().then(({ data, error }) => {
      if (error) setProfileError(error.message);
      else setMe(data as Profile);
    });
  }, [session]);

  if (session === undefined) return <div className="center-msg">Loading…</div>;
  if (!session) return <Login />;
  if (profileError) return <div className="center-msg">Couldn't load your account: {profileError}</div>;
  if (!me) return <div className="center-msg">Loading…</div>;

  if (me.role === 'tech') {
    return (
      <DataProvider me={me}>
        <Routes>
          <Route path="/" element={<TechHome />} />
          <Route path="/job" element={<CloseJob />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </DataProvider>
    );
  }

  return (
    <DataProvider me={me}>
      <Routes>
        <Route element={<OfficeLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/items/new" element={<ItemEdit />} />
          <Route path="/items/:id" element={<ItemEdit />} />
          <Route path="/bulk" element={<BulkBuy />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/audits" element={<AuditList />} />
          <Route path="/audits/:id" element={<AuditRun />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/inventory-settings" element={<InventorySettings />} />
          <Route path="/quotes" element={<QuotesPage />} />
        </Route>
        <Route path="/truck" element={<TechHome />} />
        <Route path="/job" element={<CloseJob />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DataProvider>
  );
}
