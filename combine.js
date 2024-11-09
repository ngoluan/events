const { checkbox } = require('@inquirer/prompts');
const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');

// Define the output file
const outputFile = './combinedFile.js';  // Default output file

// File to save the user's previous selection
const selectionFile = './previousSelection.json';

// Define the array of files and directories (with wildcards)
const filesToCombine = [
    '!./public/tailwind.config.js',  // Exclude tailwind.config.js
    "./services/*.js",
    "./routes/*.js",
    "./public/*",
    "./src/*",
    "./app.js"

];

// Specific files to exclude (absolute paths or relative to your project)
const excludeFiles = [
    './public/tailwind.config.js'
];

// Function to get all files that match patterns (wildcards or direct paths)
const getFilesFromPatterns = (patterns) => {
    let filePaths = [];

    patterns.forEach((pattern) => {
        // Use glob to handle wildcards and expand them into matching file paths
        const matchingFiles = glob.sync(pattern, { nodir: true });
        filePaths = filePaths.concat(matchingFiles);
    });

    return filePaths;
};

// Function to remove comments (both JS and HTML) using regex
const removeComments = (content) => {
    // Remove JavaScript comments (single-line // and multi-line /* */)
    let result = content.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');

    // Remove HTML comments (<!-- -->)
    result = result.replace(/<!--[\s\S]*?-->/g, '');

    return result;
};

// Function to save the user's selection
const saveSelection = (selectedFiles) => {
    try {
        fs.writeFileSync(selectionFile, JSON.stringify(selectedFiles, null, 2), 'utf8');
    } catch (err) {
        console.error('Error saving selection:', err);
    }
};

// Function to load the previous selection
const loadPreviousSelection = () => {
    if (fs.existsSync(selectionFile)) {
        try {
            const data = fs.readFileSync(selectionFile, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Error loading previous selection:', err);
        }
    }
    return [];
};

// Function to read and combine files
const combineFiles = (selectedFiles) => {
    const writeStream = fs.createWriteStream(outputFile);

    selectedFiles.forEach((file) => {
        if (fs.existsSync(file)) {
            let fileContent = fs.readFileSync(file, 'utf8');

            // Remove comments from the file content
            fileContent = removeComments(fileContent);

            writeStream.write(`\n//--- File: ${path.resolve(file)} ---\n`);
            writeStream.write(fileContent);
            writeStream.write('\n');  // Add a new line between files
        } else {
            console.log(`File not found: ${file}`);
        }
    });

    writeStream.end();
    console.log(`\nAll selected files have been combined into: ${outputFile}`);
};

// Main function to orchestrate the steps
const main = async () => {
    let allFiles = getFilesFromPatterns(filesToCombine);

    // Filter out files from the exclusion list
    allFiles = allFiles.filter(file => !excludeFiles.includes(path.resolve(file)));

    if (allFiles.length === 0) {
        console.log("No matching files found.");
        process.exit(1);
    }

    // Load the previous selection
    const previousSelection = loadPreviousSelection();

    // Mark previously selected files
    const choices = allFiles.map(file => ({
        name: file,
        value: file,
        checked: previousSelection.includes(file)  // Mark previously selected files
    }));

    // Prompt user for file selection using @inquirer/prompts
    const selectedFiles = await checkbox({
        message: 'Select files to combine:',
        choices
    });

    if (selectedFiles.length === 0) {
        console.log("No files selected. Exiting.");
        process.exit(0);
    }

    // Save the current selection for future runs
    saveSelection(selectedFiles);

    // Combine the selected files
    combineFiles(selectedFiles);
};

// Execute the main function
main();
