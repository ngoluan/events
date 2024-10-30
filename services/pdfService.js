// services/pdfService.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PDFService {
  generateContract(eventData) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument();

        const fileName = `contract_${eventData.id}.pdf`;
        const filePath = path.join(__dirname, '..', 'contracts', fileName);

        // Ensure the contracts directory exists
        const contractsDir = path.join(__dirname, '..', 'contracts');
        if (!fs.existsSync(contractsDir)) {
          fs.mkdirSync(contractsDir);
        }

        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Add content to the PDF
        doc.fontSize(20).text('Event Contract', { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Event ID: ${eventData.id}`);
        doc.text(`Name: ${eventData.name}`);
        doc.text(`Email: ${eventData.email}`);
        doc.text(`Phone: ${eventData.phone}`);
        doc.text(`Start Time: ${eventData.startTime}`);
        doc.text(`End Time: ${eventData.endTime}`);
        doc.text(`Services: ${eventData.services.join(', ')}`);
        doc.text(`Notes: ${eventData.notes}`);
        // Add more event details as needed

        doc.end();

        stream.on('finish', () => {
          resolve({ fileName, filePath });
        });

        stream.on('error', (err) => {
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = new PDFService();
