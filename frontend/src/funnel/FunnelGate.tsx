import { Outlet } from 'react-router-dom';
import { useFunnel } from './FunnelContext';

// Gate the funnel step routes behind the draft-booking load. On reload, `booking`
// is briefly null while FunnelProvider re-fetches the draft; without this gate the
// steps' `if (!booking) navigate(...)` guards fire during that flash and bounce the
// user off their current step. Holding the steps until `loading` clears lets each
// guard see the real draft, so a reload keeps its position.
export default function FunnelGate() {
  const { loading } = useFunnel();
  if (loading) {
    return (
      <div className="screen funnel-loading" role="status" aria-label="Loading">
        <span className="funnel-spinner" aria-hidden="true" />
      </div>
    );
  }
  return <Outlet />;
}
