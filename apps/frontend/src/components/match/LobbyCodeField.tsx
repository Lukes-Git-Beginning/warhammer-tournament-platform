import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setLobbyCode, setLobbyPassword } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  matchId: string;
  gameNumber: number;
  currentCode: string | null;
  currentPassword: string | null;
  canEdit: boolean;
}

/** In-game lobby join details (code + optional password), editable by a participant or staff. */
export function LobbyCodeField({ matchId, gameNumber, currentCode, currentPassword, canEdit }: Props) {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['match-games', matchId] });

  // NI-1: when a lobby code is entered and no password is set yet, default the password to
  // "123" (still editable) so a freshly-shared lobby is always joinable. Clearing the code
  // never sets a password.
  const handleCodeSaved = (code: string | null) => {
    invalidate();
    if (code && !currentPassword) {
      void setLobbyPassword(matchId, gameNumber, '123').then(invalidate);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <LobbyValueRow
        label="Lobby Code"
        current={currentCode}
        placeholder="Enter lobby code…"
        addLabel="+ Add lobby code"
        canEdit={canEdit}
        onSave={(v) => setLobbyCode(matchId, gameNumber, v)}
        onSaved={handleCodeSaved}
      />
      <LobbyValueRow
        label="Lobby Password"
        current={currentPassword}
        placeholder="Enter lobby password…"
        addLabel="+ Add lobby password"
        canEdit={canEdit}
        onSave={(v) => setLobbyPassword(matchId, gameNumber, v)}
        onSaved={invalidate}
      />
    </div>
  );
}

interface RowProps {
  label: string;
  current: string | null;
  placeholder: string;
  addLabel: string;
  canEdit: boolean;
  onSave: (value: string | null) => Promise<unknown>;
  onSaved: (value: string | null) => void;
}

function LobbyValueRow({ label, current, placeholder, addLabel, canEdit, onSave, onSaved }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current ?? '');
  const copy = useCopyToClipboard();

  const mutation = useMutation({
    mutationFn: (value: string | null) => onSave(value),
    onSuccess: (_data, value) => {
      onSaved(value);
      setEditing(false);
    },
  });

  if (!canEdit && !current) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-rizzotto-stone-500 uppercase tracking-wider">
        {label} <span className="text-rizzotto-stone-600">(optional)</span>
      </span>

      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="h-8 text-sm font-mono max-w-[180px]"
            maxLength={64}
            autoFocus
          />
          <Button size="sm" variant="forge" onClick={() => mutation.mutate(draft || null)} disabled={mutation.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {current ? (
            <>
              <span className="font-mono text-sm text-rizzotto-stone-100 bg-rizzotto-iron-800 px-2 py-0.5 rounded border border-rizzotto-iron-600">
                {current}
              </span>
              <button
                onClick={() => copy(current)}
                className="text-xs text-rizzotto-stone-500 hover:text-rizzotto-gold-400 transition-colors"
              >
                Copy
              </button>
              {canEdit && (
                <button
                  onClick={() => { setDraft(current); setEditing(true); }}
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
                {addLabel}
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
