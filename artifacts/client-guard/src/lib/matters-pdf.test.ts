import type { Matter } from '@workspace/api-client-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pdfMocks = vi.hoisted(() => {
  const doc = {
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
    save: vi.fn(),
    internal: {
      pageSize: {
        getHeight: () => 595,
        getWidth: () => 842,
      },
    },
  };

  return {
    doc,
    autoTable: vi.fn(),
  };
});

vi.mock('jspdf', () => ({
  jsPDF: vi.fn(function () {
    return pdfMocks.doc;
  }),
}));

vi.mock('jspdf-autotable', () => ({
  default: pdfMocks.autoTable,
}));

import { downloadMattersPdf } from './matters-pdf';

const northstar = {
  id: 11,
  title: 'Northstar acquisition',
  reference: 'MAT-011',
  clientId: 5,
  clientName: 'Northstar Ltd',
  matterType: 'Acquisition',
  responsible: 'A. Morgan',
  status: 'open',
  riskLevel: 'low',
  dueAt: null,
} as Matter;

const harbor = {
  id: 12,
  title: 'Harbor employment review',
  reference: 'MAT-012',
  clientId: 6,
  clientName: 'Harbor Group',
  matterType: 'Employment',
  responsible: 'J. Lee',
  status: 'on_hold',
  riskLevel: 'medium',
  dueAt: null,
} as Matter;

describe('matter PDF downloads', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('writes only the chosen matter and saves it with the selected filename', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));

    downloadMattersPdf([northstar], 'selected');

    expect(pdfMocks.autoTable).toHaveBeenCalledWith(
      pdfMocks.doc,
      expect.objectContaining({
        body: [[
          'Northstar acquisition',
          'MAT-011',
          'Northstar Ltd',
          'Acquisition',
          'A. Morgan',
          'open',
          'low',
          'Not set',
        ]],
      }),
    );
    expect(pdfMocks.doc.text).toHaveBeenCalledWith(
      expect.stringContaining('Selected firm matters  |  1 record'),
      36,
      56,
    );
    expect(pdfMocks.doc.save).toHaveBeenCalledWith('clientguard-selected-matters-2026-10-13.pdf');
  });

  it('writes all supplied matters and saves it with the all-matters filename', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));

    downloadMattersPdf([northstar, harbor], 'all');

    expect(pdfMocks.autoTable).toHaveBeenCalledWith(
      pdfMocks.doc,
      expect.objectContaining({
        body: [
          ['Northstar acquisition', 'MAT-011', 'Northstar Ltd', 'Acquisition', 'A. Morgan', 'open', 'low', 'Not set'],
          ['Harbor employment review', 'MAT-012', 'Harbor Group', 'Employment', 'J. Lee', 'on hold', 'medium', 'Not set'],
        ],
      }),
    );
    expect(pdfMocks.doc.text).toHaveBeenCalledWith(
      expect.stringContaining('All firm matters  |  2 records'),
      36,
      56,
    );
    expect(pdfMocks.doc.save).toHaveBeenCalledWith('clientguard-all-matters-2026-10-13.pdf');
  });
});
