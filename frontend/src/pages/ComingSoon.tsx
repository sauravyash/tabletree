import { Link } from 'react-router-dom';

export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="screen coming-soon">
      <p className="eyebrow">KosList.au</p>
      <h1 className="koslist-wordmark coming-soon-title">{title}</h1>
      <p className="coming-soon-note">Coming soon.</p>
      <Link to="/" className="coming-soon-home">← Back to home</Link>
    </div>
  );
}
