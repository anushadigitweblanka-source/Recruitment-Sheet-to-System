import Notice from '../../components/Notice.jsx';

export default function LifecycleMentorNotice() {
  return (
    <Notice title="PENDING HR CONFIRMATION">
      The junior end date is calculated when probation passes: the junior months (Settings) from the
      day junior starts, as in the guide&apos;s worked example. That reading is the project
      owner&apos;s implementation decision; HR confirmation is still pending. A junior phase created
      before this was calculated has no stored end date, and HR enters it when recording the junior
      decision. The definitions of Discontinued and Terminated are also waiting for HR confirmation;
      the working definitions are applied meanwhile.
    </Notice>
  );
}
