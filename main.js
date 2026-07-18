const { app, BrowserWindow } = require('electron/main')

const path = require('node:path')
const { ipcMain } = require('electron');

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
	webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })
  // Vite dev server çalışıyorsa ona bağlan
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
  } else {
    // Build sonrası dist klasöründen yükle
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  }
  //win.loadFile('index.html')
}




app.whenReady().then(() => {
	ipcMain.handle('ping', () => {
		return 'pong';
	});
	createWindow();
  
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})