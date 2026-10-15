import Notice from '../../components/Notice.jsx';

export default function SalaryPendingNotice() {
  return (
    <Notice tone="info" title="Salary is not part of this screen">
      Salary is never entered on this form. The Main User records it separately, on the offer&apos;s
      details page, where every view and change is logged.
    </Notice>
  );
}
