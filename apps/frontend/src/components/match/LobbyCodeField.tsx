import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setLobbyCode } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  matchId: string;
  gameNumber: number;
  currentCode: string | null;
  canEdit: boolean;
}

export function LobbyCodeField({ matchId, gameNumber, currentCode, canEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentCode ?? '');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (code: string | null) => setLobbyCode(matchId, gameNumber, code || null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['match-games', matchId] });
      setEditing(false);
    },
  });

  const copied = useCopyToClipboard();

  if (!canEdit && !currentCode) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">
        Lobby Code <span className="text-rizzotto-stone-600">(optional)</span>
      </span>

      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Enter lobby code…"
            className="h-8 text-sm font-mono max-w-[180px]"
            maxLength={64}
            autoFocus
          />
          <Button
            size="sm"
            variant="forge"
            onClick={() => mutation.mutate(draft)}
            disabled={mutation.isPending}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {currentCode ? (
            <>
              <span className="font-mono text-sm text-rizzotto-stone-100 bg-rizzotto-iron-800 px-2 py-0.5 rounded border border-rizzotto-iron-600">
                {currentCode}
              </span>
              <button
                onClick={() => copied(currentCode)}
                className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-gold-400 transition-colors"
              >
                Copy
              </button>
              {canEdit && (
                <button
                  onClick={() => { setDraft(currentCode); setEditing(true); }}
                  className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-gold-400 transition-colors"
                >
                  Edit
                </button>
              )}
            </>
          ) : (
            canEdit && (
              <button
                onClick={() => { setDraft(''); setEditing(true); }}
                className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-gold-400 transition-colors"
              >
                + Add lobby code
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function useCopyToClipboard() {
  return (text: string) => {
    void navigator.clipboard.writeText(text);
  };
}
