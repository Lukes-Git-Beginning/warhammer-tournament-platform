import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ArmyListUpload } from './ArmyListUpload';
import type { ArmyList } from './ArmyListUpload';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvalidateQueries = vi.fn();
const mockMutate = vi.fn();
let mutationState: {
  isPending: boolean;
  data: ArmyList | undefined;
  mutate: (file: File) => void;
} = { isPending: false, data: undefined, mutate: mockMutate };

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((opts: { onSuccess?: (data: ArmyList) => void; onError?: (err: Error) => void; mutationFn?: (file: File) => Promise<ArmyList> }) => {
    // Store opts so tests can trigger onSuccess / onError manually
    mutationState = {
      isPending: false,
      data: undefined,
      mutate: (file: File) => {
        mockMutate(file);
        if (opts.mutationFn) {
          opts.mutationFn(file)
            .then((data) => {
              mutationState.data = data;
              opts.onSuccess?.(data);
            })
            .catch((err: Error) => {
              opts.onError?.(err);
            });
        }
      },
    };
    return mutationState;
  }),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: mockInvalidateQueries,
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = 'army.txt', type = 'text/plain'): File {
  return new File(['Chaos Warriors x20'], name, { type });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArmyListUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationState = { isPending: false, data: undefined, mutate: mockMutate };
  });

  it('rendert File-Input ohne Upload-Button wenn keine Datei ausgewählt', () => {
    const html = renderToStaticMarkup(
      <ArmyListUpload factionId="faction-1" />,
    );
    expect(html).toContain('type="file"');
    // Upload-Button darf noch nicht sichtbar sein
    expect(html).not.toContain('Upload');
  });

  it('zeigt Upload-Button nach File-Auswahl', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      createRoot(container).render(
        <ArmyListUpload factionId="faction-1" />,
      );
    });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    // Vor Auswahl: kein Button
    expect(container.querySelector('button')).toBeNull();

    // Datei simulieren
    const file = makeFile();
    Object.defineProperty(input, 'files', {
      value: { 0: file, length: 1, item: () => file },
      configurable: true,
    });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('Upload');

    document.body.removeChild(container);
  });

  it('ruft onUploadComplete mit Response-Daten nach erfolgreichem Upload', async () => {
    const mockResponse: ArmyList = {
      id: 'list-123',
      file_name: 'army.txt',
      file_type: 'TXT',
      parsed_data: { lord: 'Archaon', units: ['Chaos Warriors', 'Marauders'] },
      created_at: new Date().toISOString(),
    };

    // Mock global fetch
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal('fetch', fetchMock);

    const onUploadComplete = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      createRoot(container).render(
        <ArmyListUpload factionId="faction-1" onUploadComplete={onUploadComplete} />,
      );
    });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile();
    Object.defineProperty(input, 'files', {
      value: { 0: file, length: 1, item: () => file },
      configurable: true,
    });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();

    await act(async () => {
      button!.click();
    });

    // mutate was called with the file
    expect(mockMutate).toHaveBeenCalledWith(file);

    // Warte auf async fetch-Auflösung
    await act(async () => {
      await Promise.resolve();
    });

    expect(onUploadComplete).toHaveBeenCalledWith(mockResponse);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['army-lists'] });

    vi.unstubAllGlobals();
    document.body.removeChild(container);
  });

  it('zeigt Fehlermeldung wenn Upload fehlschlägt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'Dateityp nicht unterstützt' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => {
      createRoot(container).render(
        <ArmyListUpload factionId="faction-1" />,
      );
    });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('army.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    Object.defineProperty(input, 'files', {
      value: { 0: file, length: 1, item: () => file },
      configurable: true,
    });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const button = container.querySelector('button');
    await act(async () => {
      button!.click();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Dateityp nicht unterstützt');

    vi.unstubAllGlobals();
    document.body.removeChild(container);
  });
});
