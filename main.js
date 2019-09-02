const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage } = require('electron');
const io = require('socket.io-client');
const emit = require('events');
const path = require('path');
const request = require('request');
const Connection = require('./Connection');
const { CONNECTION_CREATED, CONNECTION_RECEIVED, CONNECTION_LOOK } = require('./utils/constants');
const config = require('./config');

emit.EventEmitter.defaultMaxListeners = 0;

let mainWindow;
let tray = null;
const socket = io(config.ws || 'ws://localhost:3000');
const iconPath = nativeImage.createFromPath(path.join(__dirname, 'resources/icon.ico'));

const shouldQuit = app.makeSingleInstance(() => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

if (shouldQuit) {
    app.quit();
    return;
}

app.on('ready', () => {
    tray = new Tray(iconPath);
    tray.setToolTip('optimus');
    tray.setContextMenu(
        Menu.buildFromTemplate([
            {
                label: 'Connection',
                click: createWindow,
            },
            {
                label: 'Quit',
                click: () => app.quit(),
            },
        ])
    );
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        mainWindow = null;
        if (config.isDevelopment) {
            app.quit();
        }
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

ipcMain.on(CONNECTION_LOOK, async event => {
    const result = await Connection.look();
    event.returnValue = result;
});

ipcMain.on(CONNECTION_CREATED, async (event, data) => {
    socket.emit('valid partner', data.code, async err => {
        if (!err) {
            try {
                const result = await Connection.store(data);
                socket.emit('new partner', data.code /*, (error) => {}*/);
                event.sender.send(CONNECTION_RECEIVED, null, result);
            } catch (error) {
                dialog.showErrorBox('Connection failure', error.message);
                event.sender.send(CONNECTION_RECEIVED, error.message, null);
            }
            return;
        }
        const error = new Error('Invalid Code');
        dialog.showErrorBox('Connection failure', error.message);
        event.sender.send(CONNECTION_RECEIVED, error.message, null);
    });
});

socket.on('connect', async () => {
    const conn = await Connection.look();
    if (conn) {
        socket.emit('new partner', conn.code, err => {
            if (err) {
                dialog.showErrorBox('connect fail', `code ${conn.code} err`);
            }
        });
    }
});

socket.on('query', async (sql, callback) => {
    const result = await Connection.query(sql)
        .then(res => {
            return res.rows;
        })
        .catch(() => []);

    callback(result);
});

socket.on('request', (options, callback) => {
    const newOptions = Object.assign({}, options, { headers: { 'user-agent': 'node.js' } });
    try {
        request(newOptions, (error, { statusCode, statusMessage }, body) => {
            let errorMessage = null;
            const response = {
                statusCode,
                statusMessage,
                body,
            };

            if (error) {
                errorMessage = error.message;
            } else if (!(statusCode >= 200 && statusCode < 300)) {
                errorMessage = 'request failure';
            }

            return callback(errorMessage, response);
        });
    } catch (error) {
        return callback(error.message);
    }
});

socket.on('disconnect', reason => {
    if (reason === 'io client disconnect') {
        socket.connect();
    }
});

const browserOption = {
    title: 'Optimus',
    icon: iconPath,
    width: 520,
    height: 700,
    maximizable: true,
    resizable: true,
    webPreferences: {
        nodeIntegration: true,
    },
};

if (!config.isDevelopment) {
    browserOption.maximizable = false;
    browserOption.resizable = false;

    process.on('uncaughtException', (/*error*/) => {
        socket.disconnect();
    });

    process.on('error', (/*error*/) => {
        socket.disconnect();
    });
}

function createWindow() {
    if (mainWindow == null) {
        mainWindow = new BrowserWindow(browserOption);

        if (config.isDevelopment) {
            mainWindow.webContents.openDevTools();
        } else {
            mainWindow.setMenu(null);
        }

        mainWindow.loadFile(`renderer/index.html`);
        mainWindow.on('closed', () => {
            mainWindow = null;
        });
    }
}
