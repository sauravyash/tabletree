import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { supabase } from './supabase';
import FloralCollection from './pages/FloralCollection';
import Confirmation from './pages/Confirmation';
import StaffBookings from './pages/StaffBookings';
import StaffBooking from './pages/StaffBooking';
import './index.css';

// Demo convenience: sign in the seeded user so RLS-scoped reads/writes work.
// Wrapped in try/catch — in environments without a live Supabase backend (e.g. this
// sandbox, or CI) the request rejects, and an unhandled rejection here would otherwise
// prevent the router below from ever mounting, blanking the whole app.
try {
  await supabase.auth.signInWithPassword({
    email: import.meta.env.VITE_DEMO_EMAIL,
    password: import.meta.env.VITE_DEMO_PASSWORD,
  });
} catch (err) {
  console.warn('Demo sign-in failed (no live Supabase backend?):', err);
}

const router = createBrowserRouter([
  { path: '/', element: <FloralCollection /> },
  { path: '/confirmation', element: <Confirmation /> },
  { path: '/staff', element: <StaffBookings /> },
  { path: '/staff/:bookingId', element: <StaffBooking /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
