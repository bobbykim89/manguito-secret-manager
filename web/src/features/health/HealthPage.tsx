import { useHealth } from "./useHealth";

export function HealthPage() {
  const { data, error, isPending } = useHealth();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">secretbox</h1>

      {isPending && <p className="mt-4 text-slate-500">Checking API…</p>}

      {data && <p className="mt-4">Database: {data.db}</p>}

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-4">
          <p className="font-mono text-sm">{error.code}</p>
          <p className="text-sm">{error.message}</p>
        </div>
      )}
    </main>
  );
}
