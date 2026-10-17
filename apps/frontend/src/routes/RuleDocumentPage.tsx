import { useEffect } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { getRuleDocuments } from '@/lib/api';
import { PageShell } from '@/components/layout/PageShell';

/**
 * Permalink for a rules document: rizzotto.gg/rules/<slug> forwards to wherever the admin points it
 * (e.g. the current Fruit Rules PDF). The link we share never changes when a new version comes out.
 */
export function RuleDocumentPage() {
  const { slug } = useParams({ from: '/rules/$slug' });
  const { data, isLoading, isError } = useQuery({ queryKey: ['rule-documents'], queryFn: getRuleDocuments });
  const doc = data?.documents.find((d) => d.slug === slug);

  useEffect(() => {
    if (doc?.url) window.location.replace(doc.url);
  }, [doc?.url]);

  let message: React.ReactNode;
  if (isLoading || doc?.url) {
    message = doc ? <>Opening {doc.label}…</> : 'Loading…';
  } else if (isError) {
    message = 'Could not load this rules document. Please try again.';
  } else if (!doc) {
    message = 'There is no rules document at this address.';
  } else {
    message = <>{doc.label} isn&apos;t linked yet.</>;
  }

  return (
    <PageShell variant="tight" spacing="loose" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-sm text-rizzotto-stone-300">{message}</p>
      {doc?.url && (
        <a href={doc.url} className="text-sm text-rizzotto-gold-400 underline">
          Open it directly
        </a>
      )}
      {!isLoading && !doc?.url && (
        <Link to="/" className="text-sm text-rizzotto-gold-400 underline">
          Back to RizzOtto&apos;s Arena
        </Link>
      )}
    </PageShell>
  );
}
