import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PresetEditor } from './PresetEditor';
import type { CreateDraftPresetRequest } from '@rizzotto/types';

// Mock @dnd-kit modules — they rely on browser APIs not available in happy-dom
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  closestCenter: vi.fn(),
  KeyboardSensor: class {},
  PointerSensor: class {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arrayMove: vi.fn((arr: any[], from: number, to: number): any[] => {
    const result = [...arr];
    const [removed] = result.splice(from, 1);
    if (removed !== undefined) result.splice(to, 0, removed);
    return result;
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => ''),
    },
  },
}));

// Mock useQuery — CategoryLimitsEditor calls useQuery for factions
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

describe('PresetEditor', () => {
  it('rendert ohne initialPreset (Create-Modus)', () => {
    const onSave = vi.fn(async (_: CreateDraftPresetRequest) => {});
    const html = renderToStaticMarkup(<PresetEditor onSave={onSave} />);
    // Should render the basic form structure
    expect(html).toContain('Basic Settings');
    expect(html).toContain('Save preset');
    expect(html).toContain('+ Host Move');
    expect(html).toContain('+ Guest Move');
    expect(html).toContain('+ Admin Reveal Move');
  });

  it('+ Host Move Button erhöht Turn-Count um 1', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onSave = vi.fn(async (_: CreateDraftPresetRequest) => {});

    await act(async () => {
      const root = createRoot(container);
      root.render(<PresetEditor onSave={onSave} />);
    });

    // Initially no turn rows
    const turnsBefore = container.querySelectorAll('[data-turn-item]').length;

    // Click "+ Host Move"
    const buttons = Array.from(container.querySelectorAll('button'));
    const hostButton = buttons.find((b) => b.textContent?.includes('+ Host Move'));
    expect(hostButton).toBeTruthy();

    await act(async () => {
      hostButton!.click();
    });

    // Should have one more turn row — check by "Zug #" appearing in DOM
    // At minimum the Delete button for the new turn should exist
    const deleteButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('Delete'),
    );
    expect(deleteButtons.length).toBe(turnsBefore + 1);

    document.body.removeChild(container);
  });

  it('Delete-Button entfernt den Zug aus der Liste', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onSave = vi.fn(async (_: CreateDraftPresetRequest) => {});

    await act(async () => {
      const root = createRoot(container);
      root.render(<PresetEditor onSave={onSave} />);
    });

    // Add two turns
    const getHostBtn = () =>
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('+ Host Move'),
      )!;

    await act(async () => { getHostBtn().click(); });
    await act(async () => { getHostBtn().click(); });

    const deleteBtns = () =>
      Array.from(container.querySelectorAll('button')).filter((b) =>
        b.textContent?.includes('Delete'),
      );

    expect(deleteBtns().length).toBe(2);

    // Delete first turn
    await act(async () => {
      deleteBtns()[0]!.click();
    });

    expect(deleteBtns().length).toBe(1);

    document.body.removeChild(container);
  });
});
