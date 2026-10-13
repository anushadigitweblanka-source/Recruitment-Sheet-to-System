import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';

// Shown for every page whose feature has not been built yet.
export default function PlaceholderPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />
      <section className="panel">
        <EmptyState
          title="Feature not connected yet"
          message="This page is a placeholder. It will show real data once the feature is built."
        />
      </section>
    </>
  );
}
