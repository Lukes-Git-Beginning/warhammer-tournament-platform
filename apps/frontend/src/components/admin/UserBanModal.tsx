import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { banUser, unbanUser, type AdminUser } from '@/lib/api';

interface UserBanModalProps {
  user: AdminUser;
  onClose: () => void;
}

export function UserBanModal({ user, onClose }: UserBanModalProps) {
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();

  const isBanned = user.is_banned;

  const mutation = useMutation({
    mutationFn: () => (isBanned ? unbanUser(user.id) : banUser(user.id, reason || undefined)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ban-modal-title"
    >
      <div className="w-full max-w-md rounded-lg border border-stone-700 bg-stone-950 p-6 shadow-xl">
        <h2 id="ban-modal-title" className="mb-4 text-lg font-bold text-rizzotto-gold-500">
          {isBanned ? 'Ban aufheben' : 'User bannen'}
        </h2>

        <p className="mb-4 text-stone-300 text-sm">
          {isBanned ? (
            <>
              Ban für <span className="font-semibold text-stone-100">{user.username}</span>{' '}
              aufheben?
            </>
          ) : (
            <>
              <span className="font-semibold text-stone-100">{user.username}</span> bannen?
            </>
          )}
        </p>

        {!isBanned && (
          <div className="mb-4">
            <label htmlFor="ban-reason" className="mb-1 block text-xs font-medium text-stone-400">
              Grund (optional)
            </label>
            <input
              id="ban-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Regelverstoß, Betrug…"
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </div>
        )}

        {mutation.error && (
          <p className="mb-3 text-sm text-red-400">Fehler: {(mutation.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded border border-stone-700 px-4 py-2 text-sm text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-40 transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className={`rounded px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
              isBanned
                ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                : 'bg-red-700 text-white hover:bg-red-600'
            }`}
          >
            {mutation.isPending ? 'Bitte warten…' : isBanned ? 'Ban aufheben' : 'Jetzt bannen'}
          </button>
        </div>
      </div>
    </div>
  );
}
