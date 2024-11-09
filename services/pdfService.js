const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

class PDFService {
    async createEventContract(data, res) {
        try {
            const inputPath = path.resolve("./public/files/Event Contract.pdf");
            
            // Fix the date format by replacing slashes with underscores
            const sanitizedDate = data.reservationDate.replace(/[\/-]/g, "_");
            const sanitizedName = data.contactName.replace(/ /g, "");
            const outputFileName = `EventContract_${sanitizedDate}_${sanitizedName}.pdf`;
            const outputPath = path.resolve("./public/files", outputFileName);

            await this.createPdf(inputPath, outputPath, data);
            res.send(true);
        } catch (error) {
            console.error('Error creating event contract:', error);
            res.status(500).send({ error: 'Failed to create event contract' });
        }
    }

    removeUnsupportedCharacters(text) {
        return text.replace(/[^\x00-\x7F]/g, "");
    }

    async createPdf(input, output, data) {
        try {
            // Read the file using promises
            const file = await fs.readFile(input);
            
            // Load the PDF document
            const pdfDoc = await PDFDocument.load(file);
            const form = pdfDoc.getForm();

            // Log all form fields (if needed for debugging)
            const fields = form.getFields();
            fields.forEach(field => {
                console.log('Available field:', field.getName());
            });

            // Process form fields
            const checks = ["dj", "band", "bar", "audio", "music", "kareoke", "lights", "catering", "drink"];
            
            for (const [key, value] of Object.entries(data)) {
                if (key === "clientSign") continue;

                try {
                    if (checks.includes(key)) {
                        const field = form.getCheckBox(key);
                        if (value === "true" || value === true) {
                            field.check();
                        }
                    } else {
                        const field = form.getTextField(key);
                        const cleanText = this.removeUnsupportedCharacters(value);
                        field.setText(cleanText);
                    }
                } catch (fieldError) {
                    console.warn(`Warning: Could not process field "${key}":`, fieldError.message);
                }
            }

            // Make sure the output directory exists
            const outputDir = path.dirname(output);
            await fs.mkdir(outputDir, { recursive: true });

            // Save the PDF and write to file
            const pdfBytes = await pdfDoc.save();
            await fs.writeFile(output, pdfBytes);

        } catch (error) {
            console.error('Error processing PDF:', error);
            throw new Error(`Failed to process PDF: ${error.message}`);
        }
    }
}

module.exports = new PDFService();