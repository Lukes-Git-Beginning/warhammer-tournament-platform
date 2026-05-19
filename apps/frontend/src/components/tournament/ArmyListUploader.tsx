import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import {
  uploadArmyList,
  getMyArmyList,
  getOpponentArmyList,
  getAllArmyLists,
} from '@/lib/api';
import type { Tournament, TournamentArmyList } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAuthQuery } from '@/lib/auth';

export interface ArmyListUploaderProps {
  tournament: Tournament;
  existingList?: TournamentArmyList | null;
  /** User ID of the current opponent (from the active match). Used to enable "View opponent's list". */
  currentMatchOpponentId?: string;
}

// ---------------------------------------------------------------------------
// Dropzone primitive
// ---------------------------------------------------------------------------

interface DropzoneProps {
  label: string;
  hint: string;
  accept: string;
  required?: boolean;
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
}

function Dropzone({ label, hint, accept, required, file, onFile, disabled }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback(() => setDragging(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const dropped = e.dataTransfer.files[0];
      if (dropped) onFile(dropped);
    },
    [disabled, onFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0] ?? null;
      onFile(selected);
    },
    [onFile],
  );

  return (
    <div>
      <p className="text-xs font-semibold text-rizzotto-stone-300 mb-1.5 flex items-center gap-1">
        {label}
        {required && <span className="text-rizzotto-blood-500">*</span>}
      </p>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Upload ${label}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) inputRef.current?.click(); }}
        className={[
          'cursor-pointer rounded-md border-2 border-dashed px-4 py-5 text-center transition-colors',
          dragging
            ? 'border-rizzotto-gold-400 bg-rizzotto-gold-500/10'
            : file
              ? 'border-rizzotto-success/50 bg-rizzotto-success/5'
              : 'border-rizzotto-iron-600 bg-rizzotto-iron-900 hover:border-rizzotto-iron-500',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={handleChange}
          disabled={disabled}
        />
        {file ? (
          <div className="flex items-center justify-center gap-2">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-rizzotto-success" aria-hidden="true">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-rizzotto-stone-200 font-medium">{file.name}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onFile(null); }}
              className="ml-1 text-rizzotto-stone-500 hover:text-rizzotto-stone-300 text-xs"
              aria-label="Remove file"
            >
              ×
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-rizzotto-stone-400">{hint}</p>
            <p className="text-xs text-rizzotto-stone-600 mt-0.5">Drag & drop or click to browse</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screenshot preview
// ---------------------------------------------------------------------------

function ScreenshotPreview({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (e) => setSrc(e.target?.result as string);
    reader.readAsDataURL(file);
    return () => { reader.abort(); };
  }, [file]);

  if (!src) return null;

  return (
    <div className="rounded overflow-hidden border border-rizzotto-iron-700 max-h-40">
      <img src={src} alt="Preview" className="w-full h-full object-cover" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opponent list modal
// ---------------------------------------------------------------------------

interface OpponentListModalProps {
  tournament: Tournament;
  opponentId: string;
  onClose: () => void;
}

function OpponentListModal({ tournament, opponentId, onClose }: OpponentListModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['army-list', tournament.slug, opponentId],
    queryFn: () => getOpponentArmyList(tournament.slug, opponentId),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-rizzotto-obsidian/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="relative rounded-xl border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-6 max-w-lg w-full mx-4 shadow-rizzotto-banner"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-rizzotto-stone-500 hover:text-rizzotto-stone-300"
          aria-label="Close"
        >
          ✕
        </button>
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-400 mb-4">
          Opponent's Army List
        </h3>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <span className="h-6 w-6 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
          </div>
        )}
        {data && (
          <div className="space-y-4">
            <img
              src={data.screenshot_url}
              alt="Opponent's army list screenshot"
              className="w-full rounded border border-rizzotto-iron-700"
            />
            {data.army_setup_url && (
              <a
                href={data.army_setup_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-rizzotto-gold-400 hover:underline"
              >
                Download .army_setup file
              </a>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// All lists gallery
// ---------------------------------------------------------------------------

interface AllListsGalleryProps {
  tournament: Tournament;
  onClose: () => void;
}

function AllListsGallery({ tournament, onClose }: AllListsGalleryProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['army-lists-all', tournament.slug],
    queryFn: () => getAllArmyLists(tournament.slug),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-rizzotto-obsidian/80 backdrop-blur-sm overflow-y-auto py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.25 }}
        className="relative rounded-xl border border-rizzotto-iron-600 bg-rizzotto-iron-900 p-6 max-w-3xl w-full mx-4 shadow-rizzotto-banner"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-rizzotto-stone-500 hover:text-rizzotto-stone-300"
          aria-label="Close"
        >
          ✕
        </button>
        <h3 className="font-display text-lg font-semibold text-rizzotto-gold-400 mb-4">
          All Army Lists
        </h3>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <span className="h-6 w-6 rounded-full border-2 border-rizzotto-gold-400 border-t-transparent animate-spin" />
          </div>
        )}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {data.data.map((list) => (
              <a
                key={list.id}
                href={list.screenshot_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded overflow-hidden border border-rizzotto-iron-700 hover:border-rizzotto-gold-500 transition-colors"
              >
                <img
                  src={list.screenshot_url}
                  alt="Army list"
                  className="w-full aspect-[4/3] object-cover"
                />
              </a>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ArmyListUploader({ tournament, existingList: existingListProp, currentMatchOpponentId }: ArmyListUploaderProps) {
  const queryClient = useQueryClient();
  const { data: user } = useAuthQuery();

  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [armySetup, setArmySetup] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [opponentModalId, setOpponentModalId] = useState<string | null>(null);
  const [showAllGallery, setShowAllGallery] = useState(false);

  // Fetch current user's list
  const { data: myList } = useQuery({
    queryKey: ['army-list-me', tournament.slug],
    queryFn: () => getMyArmyList(tournament.slug),
    initialData: existingListProp,
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!screenshot) throw new Error('Screenshot is required');
      return uploadArmyList(tournament.slug, screenshot, armySetup);
    },
    onSuccess: () => {
      setScreenshot(null);
      setArmySetup(null);
      setValidationError(null);
      void queryClient.invalidateQueries({ queryKey: ['army-list-me', tournament.slug] });
    },
  });

  const now = Date.now();
  const startMs = new Date(tournament.start_date).getTime();
  const isLocked = startMs <= now;

  // SLT-reveal logic
  const isTournamentComplete = tournament.status === 'COMPLETED';

  function handleSubmit() {
    if (!screenshot) {
      setValidationError('A screenshot of your army list is required.');
      return;
    }
    setValidationError(null);
    uploadMutation.mutate();
  }

  if (myList) {
    const lockedAt = new Date(myList.locked_at).toLocaleString();

    return (
      <div className="space-y-4">
        {/* Locked confirmation */}
        <div className="rounded-md border border-rizzotto-success/40 bg-rizzotto-success/10 px-4 py-3 flex items-center gap-3">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-rizzotto-success shrink-0" aria-hidden="true">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-rizzotto-stone-200">
            Army list locked at{' '}
            <span className="font-semibold text-rizzotto-success">{lockedAt}</span>
          </p>
        </div>

        {/* Reveal actions */}
        <div className="flex gap-3 flex-wrap">
          {/* View opponent — requires reveal flag + a known opponent ID */}
          {myList.revealed_to_opponent_at && user && currentMatchOpponentId && (
            <Button
              variant="iron"
              size="sm"
              onClick={() => setOpponentModalId(currentMatchOpponentId)}
            >
              View opponent's list
            </Button>
          )}

          {/* View all — only after tournament complete */}
          {isTournamentComplete && (
            <Button variant="iron" size="sm" onClick={() => setShowAllGallery(true)}>
              View all lists
            </Button>
          )}
        </div>

        {opponentModalId && opponentModalId !== '__unknown__' && (
          <AnimatePresence>
            <OpponentListModal
              tournament={tournament}
              opponentId={opponentModalId}
              onClose={() => setOpponentModalId(null)}
            />
          </AnimatePresence>
        )}

        {showAllGallery && (
          <AnimatePresence>
            <AllListsGallery tournament={tournament} onClose={() => setShowAllGallery(false)} />
          </AnimatePresence>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Dropzone
        label="Army List Screenshot"
        hint="PNG or JPG, max 10 MB"
        accept="image/png,image/jpeg"
        required
        file={screenshot}
        onFile={setScreenshot}
        disabled={isLocked}
      />

      {screenshot && <ScreenshotPreview file={screenshot} />}

      <Dropzone
        label=".army_setup File"
        hint=".army_setup file (optional)"
        accept=".army_setup"
        file={armySetup}
        onFile={setArmySetup}
        disabled={isLocked}
      />

      {validationError && (
        <p className="text-sm text-rizzotto-danger">{validationError}</p>
      )}

      {uploadMutation.isError && (
        <p className="text-sm text-rizzotto-danger">
          {(uploadMutation.error as Error).message}
        </p>
      )}

      <Button
        variant="forge"
        size="md"
        disabled={isLocked || uploadMutation.isPending || !screenshot}
        onClick={handleSubmit}
      >
        {uploadMutation.isPending ? 'Uploading…' : isLocked ? 'Submission closed' : 'Lock In'}
      </Button>

      {isLocked && (
        <p className="text-xs text-rizzotto-stone-500">
          Army list submission is closed (tournament has started).
        </p>
      )}
    </div>
  );
}
