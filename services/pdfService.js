// services/pdfService.js
const { PDFDocument } = require('pdf-lib')

const fs = require('fs');
const path = require('path');

class PDFService {
  createEventContract(data, res) {
    function removeUnsupportedCharacters(text) {
        return text.replace(/[^\x00-\x7F]/g, ""); // This removes all non-ASCII characters
    }

    // Usage
    async function createPdf(input, output, data, res) {

        fs.readFile(input, async function (err, file) {
            const pdfDoc = await PDFDocument.load(file)
            const form = pdfDoc.getForm()
            //log all form fields
            console.log(form.getFields())
            Object.keys(data).forEach((element) => {
                form.getFields().forEach(field => {
                    console.log(field.getName());
                });
                let checks = ["dj", "band", "bar", "audio", "music", "kareoke", "lights", "catering", "drink"]
                if (element == "clientSign") return true;
                let field = null
                if (checks.indexOf(element) > -1) {
                    field = form.getCheckBox(element)
                    if (data[element].indexOf("true") > -1) {
                        field.check()
                    }
                }
                else {
                    field = form.getTextField(element)
                    const cleanText = removeUnsupportedCharacters(data[element]);
                    field.setText(cleanText)
                }

            })
            const pdfBytes = await pdfDoc.save()
            fs.writeFile(output, pdfBytes, () => {
                res.send(true)
            })
        });



    }
    createPdf("./public/files/Event Contract.pdf", `./public/files/EventContract_${data.reservationDate.replace(/\-/g, "")}_${data.contactName.replace(/ /g, "")}.pdf`, data,res)
}
}

module.exports = new PDFService();
