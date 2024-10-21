const fs = require("fs");
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const axios = require('axios'); // Import axios for HTTP requests to download files.
const ioClient = require('socket.io-client');
const path = require('path');
const db = require("./db");

if (!db.get("displayID")) {
    db.set("displayID", Math.floor(Math.random() * 1e9))
}
const displayID = db.get("displayID");

if (!db.get("displayName")) {
    const words = fs.readFileSync("./words.txt").toString().split("\n");
    const word1 = words[Math.floor(Math.random() * words.length)];
    const word2 = words[Math.floor(Math.random() * words.length)];
    db.set("displayName", `${word1.trim()} ${word2.trim()}`);
}

let http, socket;
let serverAddress = db.get("lcueServerAddress");
if (serverAddress) {
    connectToServer(serverAddress);
}


function connectToServer(serverAddress) {
    axios.get(`http://${serverAddress}/api/healthcheck`) // Example endpoint to check server status
        .then(response => {
            // If the server responds, set up HTTP and socket connections
            http = axios.create({
                baseURL: `http://${serverAddress}`
            });

            socket = ioClient(`http://${serverAddress}`);

            socket.on('connect', () => {
                socket.emit("id", {
                    deviceType: "display",
                    id: displayID
                })
            });

            socket.on('disconnect', () => {
                socket.on('disconnect', () => {
                    console.warn('Disconnected from server, attempting to reconnect...');
                    socket.connect(); // Reconnect
                });
            });

            console.log('Connected to server successfully');
        })
        .catch(error => {
            // If the server is unreachable, set http and socket to null
            console.error('Failed to connect to server:', error);
            http = null;
            socket = null;
            return true;
        });
}

function changeServerAddress(newAddress) {
    if (http || socket) {
        console.log('Closing old connections...');
        if (socket) {
            socket.disconnect(); // Close the socket connection
            socket = null;
        }
        if (http) {
            http = null;
        }
    }

    serverAddress = newAddress; // Update the server address
    connectToServer(serverAddress); // Try to connect to the new address
}


let window, configWindow = null;

function createWindows() {
    // Create the control window
    window = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        alwaysOnTop: db.get("alwaysOnTop") || false,
        autoHideMenuBar: true,
        fullscreen: db.get("startFullscreen") || false,
        kiosk: db.get("startInKiosk") || false,
        roundedCorners: false
    });

    // Listen for the event to open a new window
    ipcMain.on('openConfig', () => {
        if (configWindow === null) {
            createConfigWindow();
        } else {
            if (configWindow.isMinimized()) configWindow.restore();
            configWindow.focus();
        }
    });
    window.webContents.on('did-finish-load', () => {
        window.webContents.send('file-list', getFilesFromDirectory("content"));
    });

    window.loadFile('display.html');
}

function createConfigWindow() {
    let { width, height } = window.getBounds();
    configWindow = new BrowserWindow({
        width: width || 400,
        height: height || 300,
        parent: window, // Ensures it's on top of the main window
        modal: true,        // Keeps the new window on top and blocks input to the main window
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    configWindow.loadFile('displayConfig.html'); // Load the HTML file for the new window

    configWindow.webContents.on('did-finish-load', () => {
        configWindow.webContents.send('file-list', getFilesFromDirectory("content"));
        configWindow.webContents.send('config', {
            displayName: db.get("displayName"),
            lcueServerAddress: db.get("lcueServerAddress"),
            alwaysOnTop: db.get("alwaysOnTop") || false,
            startFullscreen: db.get("startFullscreen") || false,
            startInKiosk: db.get("startInKiosk") || false
        });
        configWindow.webContents.send('playlists', db.at("playlists").all());
    });

    configWindow.on('closed', () => {
        configWindow = null;
    })
}


ipcMain.on('displayName', (e, name) => {
    db.set("displayName", name);
})
ipcMain.on('lcueServerAddress', (e, address) => {
    db.set("lcueServerAddress", address);
})
ipcMain.on('alwaysOnTop', (e, enabled) => {
    db.set("alwaysOnTop", !!enabled);
})
ipcMain.on('startFullscreen', (e, enabled) => {
    db.set("startFullscreen", !!enabled);
})
ipcMain.on('startInKiosk', (e, enabled) => {
    db.set("startInKiosk", !!enabled);
})
ipcMain.on('uploadContent', async (e) => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    console.log(result.filePaths);
    const contentDir = path.join(__dirname, 'content');

    // Ensure the content directory exists
    if (!fs.existsSync(contentDir)) {
        fs.mkdirSync(contentDir);
    }
    result.filePaths.forEach((filePath) => {
        const fileName = path.basename(filePath); // Get the file name from the file path
        const destinationPath = path.join(contentDir, fileName);

        // Copy the file to the /content directory
        fs.copyFile(filePath, destinationPath, (err) => {
            if (err) {
                console.error('File upload failed:', err);
                e.reply('upload-result', { success: false, message: 'Upload failed' });
            } else {
                console.log('File uploaded successfully:', destinationPath);
                e.reply('upload-result', { success: true, message: 'File uploaded successfully' });
                configWindow.webContents.send('file-list', getFilesFromDirectory("content"));
            }
        });
    })
});
ipcMain.on('file-show', async (e, file) => {
    window.webContents.send("file-show", file)
});

app.whenReady().then(createWindows);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
});



function getFilesFromDirectory(directoryPath) {
    try {
        const files = fs.readdirSync(directoryPath);
        const fileNames = files.filter(file => {
            return fs.statSync(path.join(directoryPath, file)).isFile();
        });
        return fileNames;
    } catch (err) {
        console.error('Error reading directory:', err);
        return [];
    }
}

const Events = {
    setAlwaysOnTop: function (alwaysOnTop) {
        if (window) {
            window.setAlwaysOnTop(alwaysOnTop);
        }
        db.set("alwaysOnTop", alwaysOnTop)
    }
}