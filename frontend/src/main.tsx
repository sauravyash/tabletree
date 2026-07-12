import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';
import { FunnelProvider } from './funnel/FunnelContext';
import Landing from './funnel/Landing';
import Choose from './funnel/Choose';
import Beverage from './funnel/Beverage';
import Address from './funnel/Address';
import Slot from './funnel/Slot';
import Account from './funnel/Account';
import Card from './funnel/Card';
import FunnelGate from './funnel/FunnelGate';
import FloralCollection from './pages/FloralCollection';
import Confirmation from './pages/Confirmation';
import StaffBookings from './pages/StaffBookings';
import ComingSoon from './pages/ComingSoon';
import './index.css';

function FunnelLayout() {
  return <FunnelProvider><Outlet /></FunnelProvider>;
}

const router = createBrowserRouter([
  {
    element: <FunnelLayout />,
    children: [
      { path: '/', element: <Landing /> },
      {
        element: <FunnelGate />,
        children: [
          { path: '/choose', element: <Choose /> },
          { path: '/beverage', element: <Beverage /> },
          { path: '/address', element: <Address /> },
          { path: '/slot', element: <Slot /> },
          { path: '/account', element: <Account /> },
          { path: '/card', element: <Card /> },
        ],
      },
    ],
  },
  { path: '/bonus-flowers', element: <FloralCollection /> },
  { path: '/jobs', element: <ComingSoon title="Jobs" /> },
  { path: '/cowork', element: <ComingSoon title="Co-work" /> },
  { path: '/confirmation', element: <Confirmation /> },
  { path: '/staff', element: <StaffBookings /> },
  { path: '/staff/:bookingId', element: <StaffBookings /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
