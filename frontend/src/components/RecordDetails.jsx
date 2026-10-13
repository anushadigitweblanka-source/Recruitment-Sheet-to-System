import DetailList from './DetailList.jsx';
import Notice from './Notice.jsx';
import PageHeader from './PageHeader.jsx';

// The standard "details" page for one record. Until the feature is connected
// there is no record to load, so every value shows "--".
export default function RecordDetails({ page, fields, actions, children }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} actions={actions} />
      <Notice>
        Feature not connected yet. No record can be loaded, so every value shows “--”.
      </Notice>
      <section className="panel">
        <DetailList fields={fields} />
      </section>
      {children}
    </>
  );
}
