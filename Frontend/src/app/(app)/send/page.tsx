import { Suspense } from 'react';
import { SendFlow } from './send-flow';

export default function SendPage() {
  return (
    <Suspense>
      <SendFlow />
    </Suspense>
  );
}
