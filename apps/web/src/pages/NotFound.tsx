import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-brand-700 underline">
        Create new content
      </Link>
    </div>
  );
}
