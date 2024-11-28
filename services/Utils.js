// emailUtils.js
class Utils {
    static cleanEmailContent(emailContent) {
        if (!emailContent) return '';

        return emailContent
            // Remove specific signatures while preserving email chain
            .replace(/TacoTaco Events Team\s*\(\d{3}\)\s*\d{3}-\d{4}\s*\|\s*info@eattaco\.ca\s*eattaco\.ca/g, '')
            .replace(/Founder and Director[\s\S]*?@drdinakulik/g, '')

            // Remove image links while preserving email addresses in angle brackets
            .replace(/\[https?:\/\/[^\]]+\]/g, '')
            .replace(/<(?![\w.@-]+>)[^>]+>/g, '')  // Only remove HTML tags, not email addresses in brackets

            // Clean up email client specific markers while preserving the chain
            .replace(/\s*Get Outlook for iOS\s*/, '')
            .replace(/\s*Learn why this is important\s*/, '')
            .replace(/\s*You don't often get email from.*?\s*/g, '')

            // Remove excess whitespace and formatting while preserving structure
            .replace(/[\t ]+/g, ' ')           // Replace tabs and multiple spaces with single space
            .replace(/\n\s*\n\s*\n/g, '\n\n')  // Reduce multiple blank lines to double
            .replace(/^\s+|\s+$/gm, '')        // Trim start/end of each line
            .replace(/________________________________/g, '\n---\n') // Replace long underscores with simple separator

            // Clean up quoted content markers while preserving the actual content
            .replace(/^[>\s>>>>>]+(?=\S)/gm, '') // Remove leading '>' only when followed by content

            // Final whitespace cleanup
            .replace(/[\r\n]+/g, '\n')         // Normalize line endings
            .trim();
    }
}

module.exports = Utils;