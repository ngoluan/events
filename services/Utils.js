// emailUtils.js
class Utils {
    static cleanEmailContent(emailContent) {
        if (!emailContent) return '';
        
        return emailContent
            // Remove email signatures and contact info
            .replace(/TacoTaco Events Team[\s\S]*?eattaco\.ca/g, '')
            .replace(/Founder and Director[\s\S]*?@drdinakulik/g, '')
            // Remove email quotation marks and thread markers
            .replace(/^[>\s>>>>>]+/gm, '')  // Removes leading '>' characters
            .replace(/^[>]+\s*/gm, '')      // Removes '>' with spaces
            // Remove email headers
            .replace(/On.*wrote:$/gm, '')
            .replace(/From:.*$/gm, '')
            .replace(/Subject:.*$/gm, '')
            .replace(/Date:.*$/gm, '')
            .replace(/Sent:.*$/gm, '')
            .replace(/----- Original Message -----/g, '')
            .replace(/-{3,}/g, '')          // Remove separator lines (---)
            // Remove original message markers
            .replace(/Original Message[- ]*$/gm, '')
            .replace(/_{3,}/g, '')          // Remove underscore separators
            // Remove links and URLs
            .replace(/<[^>]+>/g, '')
            .replace(/https?:\/\/[^\s]+/g, '')
            // Remove phone numbers
            .replace(/\(\d{3}\)\s*\d{3}-\d{4}/g, '')
            // Remove email addresses
            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
            // Clean up whitespace and formatting
            .replace(/[\r\n]+/g, '\n')
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .replace(/\s{2,}/g, ' ')        // Replace multiple spaces with single space
            .trim();
    }
}

module.exports = Utils;