import { useHealth } from "./useHealth";

export function HealthPage() {
  const { data, error, isPending } = useHealth();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Manguito Secret Manager</h1>

      {isPending && <p className="mt-4 text-text-muted">Checking API…</p>}

      {data && <p className="mt-4">Database: {data.db}</p>}

      {error && (
        // text-red-900 for the same reason Alert's banners carry one: this
        // panel sets its own light background and renders outside the shell,
        // so inheriting the theme's text colour makes it invisible in dark
        // mode.
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-4 text-red-900">
          <p className="font-mono text-sm">{error.code}</p>
          <p className="text-sm">{error.message}</p>
        </div>
      )}
    </main>
  );
}
