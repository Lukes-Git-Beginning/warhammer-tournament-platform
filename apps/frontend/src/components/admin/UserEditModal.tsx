import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateUser, setBotMessagePolicy, type AdminUser, type BotMessagePolicy } from '@/lib/api';

/**
 * Admin edit of a user's basic profile fields (username / email / timezone).
 * Role has its own inline control; Steam reset and ban are separate actions.
 */
export function UserEditModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email ?? '');
  const [timezone, setTimezone] = useState(user.timezone ?? '');
  const [policy, setPolicy] = useState<BotMessagePolicy>(user.bot_message_policy ?? 'NORMAL');

  const mutation = useMutation({
    mutationFn: async () => {
      await updateUser(user.id, {
        username: username.trim(),
        email: email.trim() === '' ? null : email.trim(),
        timezone: timezone.trim() === '' ? null : timezone.trim(),
      });
      if (policy !== (user.bot_message_policy ?? 'NORMAL')) {
        await setBotMessagePolicy(user.id, policy);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-stone-700 bg-stone-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold text-stone-100">Edit user</h3>
        <p className="mb-4 text-xs text-stone-500">{user.username}</p>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-400">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-400">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="—"
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-400">Timezone (IANA)</span>
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="e.g. Europe/Berlin"
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-rizzotto-gold-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-400">Bot messages</span>
            <select
              value={policy}
              onChange={(e) => setPolicy(e.target.value as BotMessagePolicy)}
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-1.5 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
            >
              <option value="NORMAL">Normal (all bot messages)</option>
              <option value="NO_BROADCASTS">No broadcasts (still gets notifications)</option>
              <option value="NO_BOT_MESSAGES">No bot messages at all</option>
            </select>
          </label>
        </div>

        {mutation.isError && (
          <p className="mt-3 text-xs text-red-400">Failed to save. Check the values and try again.</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={mutation.isPending || username.trim() === ''}
            onClick={() => mutation.mutate()}
            className="rounded bg-rizzotto-gold-500 px-3 py-1.5 text-sm font-semibold text-stone-950 hover:bg-rizzotto-gold-400 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
