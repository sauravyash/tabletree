import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { supabase } from './supabase';
import FloralCollection from './pages/FloralCollection';
import Confirmation from './pages/Confirmation';
import StaffBookings from './pages/StaffBookings';
import CardSave from './pages/CardSave';
import './index.css';

// Demo convenience: sign in the seeded customer so RLS-scoped reads/writes work —
// but ONLY when there is no existing session. Otherwise this clobbers a staff
// session (from the /staff sign-in) on every page load, forcing staff back to the
// demo customer. supabase-js persists the session, so a signed-in user survives reloads.
// Wrapped in try/catch — in environments without a live Supabase backend (e.g. this
// sandbox, or CI) the request rejects, and an unhandled rejection here would otherwise
// prevent the router below from ever mounting, blanking the whole app.
try {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    await supabase.auth.signInWithPassword({
      email: import.meta.env.VITE_DEMO_EMAIL,
      password: import.meta.env.VITE_DEMO_PASSWORD,
    });
  }
} catch (err) {
  console.warn('Demo sign-in failed (no live Supabase backend?):', err);
}

const router = createBrowserRouter([
  { path: '/', element: <FloralCollection /> },
  { path: '/confirmation', element: <Confirmation /> },
  { path: '/staff', element: <StaffBookings /> },
  { path: '/staff/:bookingId', element: <StaffBookings /> },
  { path: '/card', element: <CardSave bookingId={import.meta.env.VITE_DEMO_BOOKING_ID as string} /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
