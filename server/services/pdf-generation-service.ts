import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { type ClientPayment, type ClientCreditNote } from '@shared/schema';
import { type PublicClientInvoice } from '../lib/client-public-columns';
import { readTayHeaderImage } from '../lib/tay-header-asset';

/**
 * Service de génération PDF
 * 
 * Responsabilités:
 * - Générer factures clients en PDF
 * - Générer reçus de paiement en PDF
 * - Formatage professionnel avec logo et TVA
 */
export class PDFGenerationService {
  private headerImageDataUrl: string | null = null;
  private headerImageLoaded = false;

  private readonly companyInfo = {
    nameFr: "Société de Transport ABOUBAKAR Yaroro",
    nameEn: "ABOUBAKAR Yaroro Transport Company",
    addressFr: "BP 14871 Yaoundé",
    addressEn: "P.O. Box 14871, Yaoundé",
    email: "etsyaroro.logistique@gmail.com",
  };
  
  /**
   * Générer une facture PDF
   */
  async generateInvoicePDF(invoiceData: {
    invoice: PublicClientInvoice;
    client: { name: string; address?: string; email?: string; phone?: string };
    mission?: {
      orderNumber: string;
      deliveryAddress: string;
      deliveryDate?: Date | string;
      deliveryDateLabel?: string;
    };
    items?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  }): Promise<Buffer> {
    const { invoice, client, mission, items } = invoiceData;
    
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let currentY = await this.addOfficialHeader(doc);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(15, 23, 42);
    doc.text('Facture client', margin, currentY);

    doc.setFontSize(12);
    doc.text(`N° ${invoice.invoiceNumber}`, pageWidth - margin, currentY, { align: 'right' });

    currentY += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Émise le ${this.formatDate(invoice.invoiceDate)}`, margin, currentY);
    doc.text(`Échéance ${this.formatDate(invoice.dueDate)}`, pageWidth - margin, currentY, { align: 'right' });
    currentY += 6;

    const cardGap = 5;
    const cardWidth = (contentWidth - cardGap) / 2;
    const cardHeight = 41;

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, cardWidth, cardHeight, 2.5, 2.5, 'FD');
    doc.roundedRect(margin + cardWidth + cardGap, currentY, cardWidth, cardHeight, 2.5, 2.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('Facturé à', margin + 3, currentY + 5.5);
    doc.text('Références facture', margin + cardWidth + cardGap + 3, currentY + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    let leftY = currentY + 11;
    doc.text(client.name, margin + 3, leftY);
    leftY += 5;
    if (client.address) {
      doc.text(doc.splitTextToSize(client.address, cardWidth - 6), margin + 3, leftY);
      leftY += 5;
    }
    if (client.email) {
      doc.text(client.email, margin + 3, leftY);
      leftY += 5;
    }
    if (client.phone) doc.text(client.phone, margin + 3, leftY);

    const rightX = margin + cardWidth + cardGap + 3;
    let rightY = currentY + 11;
    doc.text(`Facture: ${invoice.invoiceNumber}`, rightX, rightY);
    rightY += 5;
    doc.text(`Date facture: ${this.formatDate(invoice.invoiceDate)}`, rightX, rightY);
    rightY += 5;
    doc.text(`Date échéance: ${this.formatDate(invoice.dueDate)}`, rightX, rightY);
    if (mission) {
      rightY += 5;
      doc.text(`Mission: ${mission.orderNumber}`, rightX, rightY);
      rightY += 5;
      doc.text(doc.splitTextToSize(mission.deliveryAddress, cardWidth - 6), rightX, rightY);
      if (mission.deliveryDate) {
        rightY += 5;
        const deliveryLabel = mission.deliveryDateLabel || "Livraison";
        doc.text(`${deliveryLabel}: ${this.formatDate(mission.deliveryDate)}`, rightX, rightY);
      }
    }
    currentY += cardHeight + 7;
    
    // Tableau des items
    const tableItems = items || (invoice.items as any[]) || [];
    const tableData = tableItems.map(item => [
      item.description,
      item.quantity.toString(),
      `${this.formatCurrency(item.unitPrice)}`,
      `${this.formatCurrency(item.total)}`
    ]);
    
    autoTable(doc, {
      startY: currentY,
      head: [['Description', 'Quantité', 'Prix Unitaire', 'Total']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 9.5, textColor: [15, 23, 42], lineColor: [226, 232, 240], lineWidth: 0.1 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 30, halign: 'center' },
        2: { cellWidth: 40, halign: 'right' },
        3: { cellWidth: 40, halign: 'right' }
      }
    });
    
    // Calcul de la position après le tableau
    const finalY = (doc as any).lastAutoTable.finalY + 6;
    const amountBoxX = pageWidth - margin - 72;
    const amountBoxY = finalY;
    const amountBoxW = 72;
    const amountBoxH = parseFloat(invoice.balance) > 0 ? 31 : 24;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(amountBoxX, amountBoxY, amountBoxW, amountBoxH, 2.5, 2.5, 'FD');

    // Montants (alignés à droite)
    const amountX = amountBoxX + 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    doc.text('Montant HT:', amountX, amountBoxY + 6);
    doc.text(this.formatCurrency(invoice.amountHT), amountBoxX + amountBoxW - 4, amountBoxY + 6, { align: 'right' });
    
    doc.text(`TVA (${invoice.vatRate}%):`, amountX, amountBoxY + 12);
    doc.text(this.formatCurrency(invoice.vatAmount), amountBoxX + amountBoxW - 4, amountBoxY + 12, { align: 'right' });
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Total TTC:', amountX, amountBoxY + 19);
    doc.text(this.formatCurrency(invoice.amountTTC), amountBoxX + amountBoxW - 4, amountBoxY + 19, { align: 'right' });
    
    // Solde restant
    if (parseFloat(invoice.balance) > 0) {
      doc.setFontSize(9.5);
      doc.setTextColor(220, 53, 69);
      doc.text('Solde dû:', amountX, amountBoxY + 26);
      doc.text(this.formatCurrency(invoice.balance), amountBoxX + amountBoxW - 4, amountBoxY + 26, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    }
    
    // Pied de page
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text('Merci de votre confiance.', pageWidth / 2, 286, { align: 'center' });
    doc.text(`Document généré le ${new Date().toLocaleString('fr-FR')}`, pageWidth / 2, 292, { align: 'center' });
    
    return Buffer.from(doc.output('arraybuffer'));
  }
  
  /**
   * Générer un avoir client PDF (lot V1, PR5).
   * Cite la facture d'origine et, si elle est déposée chez le client, sa date de dépôt : le net à payer
   * figé au dépôt ne change pas, l'avoir s'impute sur le solde.
   */
  async generateCreditNotePDF(data: {
    creditNote: ClientCreditNote;
    invoice: PublicClientInvoice;
    client: { name: string; address?: string; email?: string; phone?: string };
  }): Promise<Buffer> {
    const { creditNote, invoice, client } = data;

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let currentY = await this.addOfficialHeader(doc);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(15, 23, 42);
    doc.text('Avoir client', margin, currentY);
    doc.setFontSize(12);
    doc.text(`N° ${creditNote.creditNoteNumber}`, pageWidth - margin, currentY, { align: 'right' });

    currentY += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Émis le ${this.formatDate(creditNote.createdAt)}`, margin, currentY);
    currentY += 6;

    const cardGap = 5;
    const cardWidth = (contentWidth - cardGap) / 2;
    const cardHeight = 36;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, cardWidth, cardHeight, 2.5, 2.5, 'FD');
    doc.roundedRect(margin + cardWidth + cardGap, currentY, cardWidth, cardHeight, 2.5, 2.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('Avoir établi pour', margin + 3, currentY + 5.5);
    doc.text("Facture d'origine", margin + cardWidth + cardGap + 3, currentY + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    let leftY = currentY + 11;
    doc.text(client.name, margin + 3, leftY);
    leftY += 5;
    if (client.address) {
      doc.text(doc.splitTextToSize(client.address, cardWidth - 6), margin + 3, leftY);
      leftY += 5;
    }
    if (client.email) doc.text(client.email, margin + 3, leftY);

    const rightX = margin + cardWidth + cardGap + 3;
    let rightY = currentY + 11;
    doc.text(`Facture: ${invoice.invoiceNumber}`, rightX, rightY);
    rightY += 5;
    doc.text(`Date facture: ${this.formatDate(invoice.invoiceDate)}`, rightX, rightY);
    if (invoice.depositedAt) {
      rightY += 5;
      doc.text(`Déposée chez le client le ${this.formatDate(invoice.depositedAt)}`, rightX, rightY);
    }
    currentY += cardHeight + 7;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Motif', margin, currentY);
    doc.setFont('helvetica', 'normal');
    const reasonLines = doc.splitTextToSize(creditNote.reason, contentWidth);
    doc.text(reasonLines, margin, currentY + 5);
    currentY += 5 + reasonLines.length * 5 + 6;

    const boxW = 90;
    const boxX = pageWidth - margin - boxW;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(boxX, currentY, boxW, 33, 2.5, 2.5, 'FD');
    const right = boxX + boxW - 4;
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    doc.text('Montant HT:', boxX + 4, currentY + 6);
    doc.text(this.formatCurrency(creditNote.amountHT), right, currentY + 6, { align: 'right' });
    doc.text(`TVA (${creditNote.vatRate}%):`, boxX + 4, currentY + 12);
    doc.text(this.formatCurrency(creditNote.vatAmount), right, currentY + 12, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Avoir TTC:', boxX + 4, currentY + 19);
    doc.text(this.formatCurrency(creditNote.amountTTC), right, currentY + 19, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text('Solde restant de la facture:', boxX + 4, currentY + 27);
    doc.text(this.formatCurrency(invoice.balance), right, currentY + 27, { align: 'right' });

    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text(`Document généré le ${new Date().toLocaleString('fr-FR')}`, pageWidth / 2, 292, { align: 'center' });

    return Buffer.from(doc.output('arraybuffer'));
  }

  /**
   * Générer un reçu de paiement PDF
   */
  async generateReceiptPDF(receiptData: {
    invoice: PublicClientInvoice;
    payment: ClientPayment;
    client: { name: string; address?: string };
    receiptNumber: string;
  }): Promise<Buffer> {
    const { invoice, payment, client, receiptNumber } = receiptData;
    
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let currentY = await this.addOfficialHeader(doc);
    
    // En-tête reçu
    doc.setFontSize(17);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Reçu de règlement', margin, currentY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Reçu N° ${receiptNumber}`, pageWidth - margin, currentY, { align: 'right' });
    currentY += 9;
    
    // Informations client
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('Reçu de :', margin, currentY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(client.name, margin + 25, currentY);
    if (client.address) {
      currentY += 6;
      doc.text(client.address, margin + 25, currentY);
    }
    currentY += 10;
    
    // Détails du paiement
    const detailsY = currentY;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('Détails du paiement', margin, detailsY);
    
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(`Facture N°:`, margin, detailsY + 8);
    doc.text(invoice.invoiceNumber, margin + 30, detailsY + 8);
    
    doc.text(`Date de paiement:`, margin, detailsY + 14);
    doc.text(this.formatDate(payment.paymentDate), margin + 30, detailsY + 14);
    
    doc.text(`Mode de paiement:`, margin, detailsY + 20);
    doc.text(this.translatePaymentMethod(payment.paymentMethod), margin + 30, detailsY + 20);
    
    if (payment.reference) {
      doc.text(`Référence:`, margin, detailsY + 26);
      doc.text(payment.reference, margin + 30, detailsY + 26);
    }
    
    // Montants
    const amountsY = detailsY + 40;
    doc.setFontSize(11);
    doc.text(`Montant facture:`, margin, amountsY);
    doc.text(this.formatCurrency(invoice.amountTTC), pageWidth - margin, amountsY, { align: 'right' });
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(`Montant payé:`, margin, amountsY + 10);
    doc.text(this.formatCurrency(payment.amount), pageWidth - margin, amountsY + 10, { align: 'right' });
    
    // Solde restant
    const balance = parseFloat(invoice.balance);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Solde restant:`, margin, amountsY + 20);
    doc.setFont('helvetica', 'bold');
    if (balance <= 0) {
      doc.setTextColor(40, 167, 69);
      doc.text('SOLDÉ', pageWidth - margin, amountsY + 20, { align: 'right' });
    } else {
      doc.setTextColor(220, 53, 69);
      doc.text(this.formatCurrency(balance), pageWidth - margin, amountsY + 20, { align: 'right' });
    }
    doc.setTextColor(0, 0, 0);
    
    // Notes (si présentes)
    if (payment.notes) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.text('Notes:', margin, amountsY + 35);
      doc.setFont('helvetica', 'normal');
      doc.text(payment.notes, margin, amountsY + 41, { maxWidth: pageWidth - margin * 2 });
    }
    
    // Signature et cachet (zone)
    const signY = 220;
    doc.setFontSize(10);
    doc.text('Signature:', margin, signY);
    doc.rect(margin, signY + 5, 80, 30);
    
    doc.text('Cachet entreprise:', pageWidth - 95, signY);
    doc.rect(pageWidth - 95, signY + 5, 80, 30);
    
    // Pied de page
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text('Ce reçu fait foi de paiement.', pageWidth / 2, 286, { align: 'center' });
    doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, pageWidth / 2, 292, { align: 'center' });
    
    return Buffer.from(doc.output('arraybuffer'));
  }

  private async addOfficialHeader(doc: jsPDF): Promise<number> {
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const headerDataUrl = await this.loadHeaderImageDataUrl();

    if (headerDataUrl) {
      const pixelToMm = 25.4 / 72;
      const headerWidth = 1067 * pixelToMm * 0.4;
      const headerHeight = 236 * pixelToMm * 0.4;
      const headerX = (pageWidth - headerWidth) / 2;
      const headerY = 8;
      doc.addImage(headerDataUrl, 'PNG', headerX, headerY, headerWidth, headerHeight);
      const lineY = headerY + headerHeight + 3;
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.4);
      doc.line(margin, lineY, pageWidth - margin, lineY);
      return lineY + 7;
    }

    // Fallback textuel si l'image n'est pas disponible
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 41, 59);
    doc.text(this.companyInfo.nameFr, margin, 16);
    doc.text(this.companyInfo.nameEn, pageWidth - margin, 16, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(this.companyInfo.addressFr, margin, 21);
    doc.text(this.companyInfo.addressEn, pageWidth - margin, 21, { align: 'right' });
    doc.text(this.companyInfo.email, pageWidth / 2, 26, { align: 'center' });
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.4);
    doc.line(margin, 30, pageWidth - margin, 30);
    return 37;
  }

  private async loadHeaderImageDataUrl(): Promise<string | null> {
    if (this.headerImageLoaded) return this.headerImageDataUrl;
    this.headerImageLoaded = true;

    const file = await readTayHeaderImage();
    if (file) {
      this.headerImageDataUrl = `data:image/png;base64,${file.toString('base64')}`;
      return this.headerImageDataUrl;
    }

    this.headerImageDataUrl = null;
    return null;
  }
  
  /**
   * Formater montant en FCFA
   */
  private formatCurrency(amount: string | number | null): string {
    if (amount === null || amount === undefined) return '0 FCFA';

    const parsed = typeof amount === 'string'
      ? Number.parseFloat(amount.replace(/\s+/g, '').replace(',', '.'))
      : amount;

    const normalized = Number.isFinite(parsed) ? Math.round(parsed) : 0;
    const formatted = normalized
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

    return `${formatted} FCFA`;
  }

  private formatDate(value: Date | string | null | undefined): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('fr-FR');
  }
  
  /**
   * Traduire mode de paiement
   */
  private translatePaymentMethod(method: string): string {
    const translations: Record<string, string> = {
      'bank_transfer': 'Virement bancaire',
      'check': 'Chèque',
      'cash': 'Espèces',
      'mobile_money': 'Mobile Money',
      'card': 'Carte bancaire',
    };
    return translations[method] || method;
  }
}

export const pdfGenerationService = new PDFGenerationService();
