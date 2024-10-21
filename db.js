const fs = require('fs');
const path = require('path');

// Ensure the 'db' directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir);
}

// Function to get the file path for a key in a specific directory
function getFilePath(dir, key) {
    return path.join(dbDir, dir, `${key}.json`);
}

// Function to set a key-value pair in a specific directory
function set(dir, key, value) {
    const dirPath = path.join(dbDir, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
    }
    const filePath = getFilePath(dir, key);
    const data = JSON.stringify({ key, value }, null, 2); // Pretty-print JSON for readability
    fs.writeFileSync(filePath, data, 'utf-8');
}

// Function to get the value for a key in a specific directory
function get(dir, key) {
    const filePath = getFilePath(dir, key);
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const parsedData = JSON.parse(data);
        return parsedData.value;
    } else {
        return null; // Key doesn't exist
    }
}

// Function to remove a key-value pair in a specific directory
function remove(dir, key) {
    const filePath = getFilePath(dir, key);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

// Function to get all key-value pairs in a specific directory
function all(dir) {
    const dirPath = path.join(dbDir, dir);
    const result = {};
    if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        files.forEach(file => {
            const filePath = path.join(dirPath, file);
            const data = fs.readFileSync(filePath, 'utf-8');
            const parsedData = JSON.parse(data);
            result[parsedData.key] = parsedData.value;
        });
    }
    return result;
}

// Function to set a value using db.at syntax
function at(dir) {
    return {
        set: (key, value) => set(dir, key, value),
        get: (key) => get(dir, key),
        remove: (key) => remove(dir, key),
        all: () => all(dir),
    };
}

// Export the functions with default directory
module.exports = {
    set: (key, value) => set('default', key, value),
    get: (key) => get('default', key),
    remove: (key) => remove('default', key),
    all: () => all('default'),
    at,
};