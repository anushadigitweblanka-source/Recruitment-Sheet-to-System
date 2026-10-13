import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../api/client.js';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

function StatusRow({ label, ok, detail }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        <StatusBadge tone={ok ? 'success' : 'danger'}>{ok ? 'OK' : 'Not working'}</StatusBadge>
      </td>
      <td>{detail}</td>
    </tr>
  );
}

// Development check: proves the frontend, the backend and the database connection work.
export default function SystemStatusPage({ page }) {
  const [result, setResult] = useState({ loading: true });

  const check = useCallback(() => {
    let cancelled = false;
    setResult({ loading: true });

    apiGet('/health')
      .then((res) => {
        if (!cancelled) setResult({ loading: false, body: res.body });
      })
      .catch(() => {
        if (!cancelled) setResult({ loading: false, body: null });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => check(), [check]);

  const { loading, body } = result;
  const backendOk = Boolean(body);
  const databaseOk = body?.database?.status === 'connected';

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          <button type="button" className="button" onClick={check} disabled={loading}>
            Check again
          </button>
        }
      />

      <section className="panel">
        {loading && <LoadingState message="Checking the backend and the database…" />}

        {!loading && !backendOk && (
          <ErrorState
            title="The backend did not respond"
            message="No answer from /api/health. Check that the backend is running."
            onRetry={check}
          />
        )}

        {!loading && (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">System status</caption>
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                <StatusRow label="Frontend" ok detail="This page loaded" />
                <StatusRow
                  label="Backend"
                  ok={backendOk}
                  detail={backendOk ? `Environment: ${body.environment}` : 'No response'}
                />
                <StatusRow
                  label="Database"
                  ok={databaseOk}
                  detail={
                    databaseOk ? `Connected in ${body.database.latencyMs} ms` : 'Not connected'
                  }
                />
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
