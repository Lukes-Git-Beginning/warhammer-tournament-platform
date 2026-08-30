import { useEffect } from 'react';
import { useAuthQuery } from '@/lib/auth';
import { captureRefFromUrl, syncReferralSource } from '@/lib/referrals';

/**
 * Invisible: on load, capture a `?ref=` click (+ remember first/last touch); once the
 * viewer is logged in, report their first-touch acquisition source. Mounted once at the root.
 */
export function ReferralCapture(): null {
  const { data: me } = useAuthQuery();
  useEffect(() => {
    captureRefFromUrl();
  }, []);
  useEffect(() => {
    if (me) syncReferralSource();
  }, [me]);
  return null;
}
