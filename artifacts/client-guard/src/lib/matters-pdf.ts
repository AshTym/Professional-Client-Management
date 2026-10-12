import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Matter } from '@workspace/api-client-react';

export function downloadMattersPdf(matters: Matter[], scope: 'selected' | 'all') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const generatedAt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date());
  const title = scope === 'all' ? 'All firm matters' : 'Selected firm matters';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(41, 70, 81);
  doc.text('ClientGuard matters', 36, 38);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(102, 117, 115);
  doc.text(`${title}  |  ${matters.length} ${matters.length === 1 ? 'record' : 'records'}  |  Generated ${generatedAt}`, 36, 56);

  autoTable(doc, {
    startY: 70,
    head: [['Matter', 'Reference', 'Client', 'Type', 'Responsible', 'Status', 'Risk', 'Due date']],
    body: matters.map((matter) => [
      matter.title,
      matter.reference,
      matter.clientName,
      matter.matterType,
      matter.responsible,
      matter.status.replace('_', ' '),
      matter.riskLevel,
      matter.dueAt
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(matter.dueAt))
        : 'Not set',
    ]),
    theme: 'grid',
    margin: { left: 36, right: 36, top: 32, bottom: 38 },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 5,
      overflow: 'linebreak',
      textColor: [50, 66, 67],
      lineColor: [225, 220, 209],
      lineWidth: 0.35,
    },
    headStyles: {
      fillColor: [41, 70, 81],
      textColor: [249, 246, 237],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [249, 247, 240] },
    didDrawPage: ({ pageNumber }) => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(130, 139, 134);
      doc.text(`ClientGuard  |  Page ${pageNumber}`, doc.internal.pageSize.getWidth() - 36, pageHeight - 16, { align: 'right' });
    },
  });

  const datePart = new Date().toISOString().slice(0, 10);
  doc.save(`clientguard-${scope}-matters-${datePart}.pdf`);
}
