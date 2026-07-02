// Root-mounted host for the post-call action sheet on INBOUND calls. Outbound
// keeps its local sheet in the dialer (calls.tsx onLogged); inbound calls end
// inside the global incoming-call modal where no screen can render a sheet, so
// twilio.ts publishes the logged communication here and we present it globally.

import { useRouter } from 'expo-router';
import { useSyncExternalStore } from 'react';

import { CallActionSheet } from '@/components/call-action-sheet';
import { getPostCall, setPostCall, subscribePostCall } from '@/lib/post-call-state';

export function PostCallSheetHost() {
  const comm = useSyncExternalStore(subscribePostCall, getPostCall, getPostCall);
  const router = useRouter();

  return (
    <CallActionSheet
      call={comm}
      polling={comm?.status === 'completed'}
      onClose={() => setPostCall(null)}
      onChanged={() => {}}
      onOpenCustomer={(cid) => {
        setPostCall(null);
        router.push({ pathname: '/customers/[id]', params: { id: cid } });
      }}
      onOpenProject={(cid, folder) => {
        setPostCall(null);
        router.push({
          pathname: '/customers/[id]/project/[folderId]',
          params: { id: cid, folderId: folder.id, title: folder.title, status: folder.status },
        } as never);
      }}
      onDial={(phone) => {
        setPostCall(null);
        router.push({ pathname: '/calls', params: { num: phone } });
      }}
    />
  );
}

export default PostCallSheetHost;
