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
let fileList = getFilesFromDirectory("content");
let playlists = {};
getFilesFromDirectory("playlists").forEach((playlist) => {
    try {
        let playlist = JSON.stringify(fs.readFileSync(playlist));
        playlist[playlist.id] = playlist;
    } catch (e) {
        return {};
    }
})

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

            socket = ioClient(`http://${serverAddress}/display`);

            socket.on('connect', () => {
                socket.emit("register", {
                    displayVersion: 0,//Protocol version
                    id: displayID,
                    name: db.get("displayName"),
                    alwaysOnTop: db.get("alwaysOnTop"),
                    startFullscreen: db.get("startFullscreen"),
                    startInKiosk: db.get("startInKiosk"),
                    files: fileList,
                    playlists: playlists
                });
                socket.emit("fileList", fileList);
            });

            socket.on('showFile', showFile)
            socket.on('showPlaylist', showPlaylist)
            socket.on('advancePlaylist', advancePlaylist)
            socket.on('downloadFile', downloadFile)
            socket.on('alwaysOnTop', alwaysOnTop)
            socket.on('startFullScreen', startFullscreen)
            socket.on('startInKiosk', startInKiosk)
            socket.on('displayName', displayName)

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

function emit(event, data) {
    if (socket) {
        socket.emit(event, data);
    }
}

/**
 * @type BrowserWindow
 */
let window;
let configWindow = null;

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
    displayName(name);
})
ipcMain.on('lcueServerAddress', (e, address) => {
    db.set("lcueServerAddress", address);
})
ipcMain.on('alwaysOnTop', (e, enabled) => {
    alwaysOnTop(enabled);
})
ipcMain.on('startFullscreen', (e, enabled) => {
    startFullscreen(enabled);
})
ipcMain.on('startInKiosk', (e, enabled) => {
    startInKiosk(enabled);
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
        const destinationPath = path.join(contentDir, sanitizeFilename(fileName));

        // Copy the file to the /content directory
        fs.copyFile(filePath, destinationPath, (err) => {
            if (err) {
                console.error('File upload failed:', err);
                e.reply('upload-result', { success: false, message: 'Upload failed' });
            } else {
                console.log('File uploaded successfully:', destinationPath);
                e.reply('upload-result', { success: true, message: 'File uploaded successfully' });
                fileList = getFilesFromDirectory("content")
                configWindow.webContents.send('file-list', fileList);
                emit("fileList", fileList);
            }
        });
    })
});
ipcMain.on('file-show', async (e, file) => {
    showFile(file);
});

function downloadFile(filePath) {
    return new Promise(async(resolve, reject) => {
        try {
            // Use Axios to download the file
            const url = `http://${db.get("lcueServerAddress")}/download/${filePath}`;
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream'
            });

            // Create a writable stream to save the file
            const savePath = path.join(__dirname, 'content', path.basename(filePath));
            const writer = fs.createWriteStream(savePath);

            // Pipe the response data to the writable stream
            response.data.pipe(writer);

            // Return a promise that resolves when the file is fully written
            writer.on('finish', ()=>{
                resolve();
                fileList = getFilesFromDirectory("content");
                emit("fileList", fileList);
                if(configWindow) configWindow.webContents.send('file-list', fileList);
            });
            writer.on('error', reject);
        } catch (error) {
            console.error(`Error downloading the file: ${error.message}`);
            reject("error");
        }
    });
}

/**
 * Sets the display's name.
 * @param {String} name Set the name of the display to this value
 */
function displayName(name) {
    let sanitized = sanitizeName(name);
    db.set("displayName", sanitized);
    emit("displayName", sanitized)
    window?.setTitle(`LCue Display (${sanitized})`);
}
/**
 * Set's the main window to Always on top.
 * Will also start Always On Top.
 * @param {Boolean} enabled Weather Always On Top is enabled.
 */
function alwaysOnTop(enabled) {
    db.set("alwaysOnTop", !!enabled);
    emit("alwaysOnTop", !!enabled);
    window?.setAlwaysOnTop(!!enabled);
}
/**
 * Sets weather the main window should open fullscreened.
 * @param {Boolean} enabled Weather start Fullscreened is enabled.
 */
function startFullscreen(enabled) {
    emit("startFullscreen", !!enabled);
    db.set("startFullscreen", !!enabled);
}
/**
 * Sets weather the main window should open Kiosked.
 * @param {*} enabled Weather start Kiosked is enabled.
 */
function startInKiosk(enabled) {
    emit("startInKiosk", !!enabled);
    db.set("startInKiosk", !!enabled);
}
/**
 * Makes the main window display this file.
 * @param {String} file The filename of the file.
 * @param {String} [transition] Transition to use for the file (Overides Default)
 * @param {String} [transitionDuration] duration of the transition (Overides Default)
 */
function showFile(file, transition, transitionDuration) {
    emit("showingFile", file);
    window.webContents.send("file-show", file, transition, transitionDuration)
}
/**
 * Makes the main window display this playlist.
 * @param {Number} playlistNumber The number of the playlist to show.
 * @param {Object} [options] Optional parameters.
 * @param {Number} [options.startAtFileNumber = 1] The file number to start at.
 * @param {Boolean} [options.resumeFromLeftOff = false] Whether to resume from where it left off.
 * @param {Boolean} [options.autoAdvance = true] Whether to auto-advance.
 * @param {String} [options.transition = 'default'] Transition to use.
 * @param {String} [options.transitionDuration = 'default'] Duration of the transition.
 */
function showPlaylist(playlistNumber, options = {}) {
    const {
        startAtFileNumber = 1,
        resumeFromLeftOff = false,
        autoAdvance = true,
        transition = 'default',
        transitionDuration = 'default'
    } = options;
}
function advancePlaylist() {

}

app.whenReady().then(createWindows);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
});



function sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9 ]/g, ''); // Remove any characters that are not letters, numbers, or spaces
}
function sanitizeFilename(filename) {
    // Replace any invalid characters with an underscore
    return filename.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_')
        .replace(/[\x7F]/g, '_')
        .replace(/\.+$/, ''); // Remove trailing periods
}


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