const { app, BrowserWindow, ipcMain, Notification, dialog, shell, Menu, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

const DATA_FILE = () => path.join(app.getPath('userData'), 'relances.json');
const DOC_DIR = () => path.join(app.getPath('userData'), 'documents');
const COLLS = ['contacts', 'entretiens', 'missions', 'documents', 'paies', 'prospects', 'formations'];
const DEFAULT_SETTINGS = { nom: '', tel: '', email: '', idFT: '', delaiInterim: 4, delaiEntreprise: 7, theme: 'auto',
  backup: { enabled: false, dir: '', freq: 'semaine', keep: 10 } };
const BACKUP_ROOT = 'Mes Relances - sauvegardes';
let win = null, splash = null;
const SPLASH_MIN_MS = 1700;
app.commandLine.appendSwitch('lang', 'fr-FR');

function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(DATA_FILE(), 'utf8')); } catch {}
  const d = {};
  for (const k of COLLS) d[k] = Array.isArray(raw[k]) ? raw[k] : [];
  d.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  d.settings.backup = { ...DEFAULT_SETTINGS.backup, ...((raw.settings || {}).backup || {}) };
  d.meta = { ...(raw.meta || {}) };
  return d;
}
function save(data) {
  const file = DATA_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch {}
  fs.renameSync(tmp, file);
}
function setMeta(patch) { const d = load(); d.meta = { ...d.meta, ...patch }; save(d); }

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => iso(new Date());
const parse = s => { const [y, m, d] = (s || '').split('-').map(Number); return y ? new Date(y, m - 1, d) : null; };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);
const short = s => { const d = parse(s); return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : ''; };

function showWin() { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }

// ---------- Sauvegarde automatique ----------
function backupNow() {
  const d = load();
  const b = d.settings.backup || {};
  if (!b.dir) throw new Error('Choisissez d\'abord un dossier de sauvegarde.');
  if (!fs.existsSync(b.dir)) throw new Error('Dossier de sauvegarde introuvable. La clé USB est peut-être débranchée.');
  const root = path.join(b.dir, BACKUP_ROOT);
  const now = new Date();
  const dest = path.join(root, `${todayISO()}_${pad(now.getHours())}h${pad(now.getMinutes())}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'relances.json'), JSON.stringify({ ...d, meta: {} }, null, 2), 'utf8');
  if (fs.existsSync(DOC_DIR())) fs.cpSync(DOC_DIR(), path.join(dest, 'documents'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'LISEZ-MOI.txt'), 'Sauvegarde de Mes Relances.\r\nPour la remettre : Mes Relances > Reglages > Restaurer une sauvegarde, puis choisissez ce dossier.\r\n', 'utf8');
  // garde seulement les N plus récentes (uniquement nos propres dossiers datés)
  const keep = Math.max(1, Number(b.keep) || 10);
  const dirs = fs.readdirSync(root).filter(n => /^\d{4}-\d\d-\d\d_\d\dh\d\d$/.test(n)).sort();
  for (const old of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    try { fs.rmSync(path.join(root, old), { recursive: true, force: true }); } catch {}
  }
  setMeta({ backupLast: now.toISOString(), backupError: '', backupDir: dest });
  return { last: now.toISOString(), dir: dest };
}
function backupDue() {
  const d = load(), b = d.settings.backup || {};
  if (!b.enabled || !b.dir) return false;
  const last = (d.meta.backupLast || '').slice(0, 10);
  if (!last) return true;
  return diffDays(todayISO(), last) >= (b.freq === 'jour' ? 1 : 7);
}
function autoBackup() {
  if (!backupDue()) return;
  try { backupNow(); }
  catch (e) { setMeta({ backupError: e.message, backupErrorDate: todayISO() }); }
}

// ---------- Rappels Windows (chaque élément une fois par jour) ----------
function checkReminders() {
  const d = load();
  const t = todayISO(), tm = addDays(t, 1);
  if (d.meta.notifDate !== t) { d.meta.notifDate = t; d.meta.notifKeys = []; }
  const keys = new Set(d.meta.notifKeys || []);
  const lines = [];
  const once = (k, line) => { if (!keys.has(k)) { keys.add(k); lines.push(line); } };

  const due = d.contacts.filter(c => ['attente', 'entretien'].includes(c.statut) && c.prochaineRelance && c.prochaineRelance <= t);
  if (due.length) once('rel', `${due.length} relance${due.length > 1 ? 's' : ''} à faire : ${due.slice(0, 3).map(c => c.nom).join(', ')}${due.length > 3 ? '…' : ''}`);
  for (const e of d.entretiens) {
    if (e.date === t || e.date === tm) once(`ent:${e.id}:${e.date}`, `Entretien ${e.date === t ? "aujourd'hui" : 'demain'}${e.heure ? ' à ' + e.heure.replace(':', 'h') : ''} : ${e.entreprise}`);
  }
  for (const m of d.missions) {
    if (!m.fin || m.agenceRelancee || m.debut > t || m.fin < t || diffDays(m.fin, t) > 3) continue;
    once(`mis:${m.id}:${m.fin}`, `Mission chez ${m.entreprise || m.agence} : fin le ${short(m.fin)}. Prévenez ${m.agence || "l'agence"} de vos disponibilités.`);
  }
  for (const doc of d.documents) {
    if (doc.expiration && diffDays(doc.expiration, t) <= 30) once(`doc:${doc.id}:${doc.expiration}`, `${doc.nom} ${diffDays(doc.expiration, t) < 0 ? 'a expiré' : 'expire'} le ${short(doc.expiration)}`);
  }
  for (const f of d.formations) {
    if (f.statut === 'obtenue' && f.expiration && diffDays(f.expiration, t) <= 60)
      once(`for:${f.id}:${f.expiration}`, `${f.nom} ${diffDays(f.expiration, t) < 0 ? 'a expiré' : 'expire'} le ${short(f.expiration)} : pensez au recyclage`);
    if ((f.statut === 'prevue') && (f.dateDebut === t || f.dateDebut === tm))
      once(`fors:${f.id}:${f.dateDebut}`, `Formation ${f.dateDebut === t ? "aujourd'hui" : 'demain'} : ${f.nom}`);
  }
  if (d.meta.backupError && d.settings.backup?.enabled) once('backup', `Sauvegarde impossible : ${d.meta.backupError}`);

  d.meta.notifKeys = [...keys];
  save(d);
  if (!lines.length || !Notification.isSupported()) return;
  const n = new Notification({
    title: lines.length === 1 ? 'Mes Relances' : `Mes Relances : ${lines.length} rappels`,
    body: lines.join('\n'),
    icon: path.join(__dirname, 'icon.png')
  });
  n.on('click', showWin);
  n.show();
}

function applyTheme(t) { nativeTheme.themeSource = t === 'dark' ? 'dark' : t === 'light' ? 'light' : 'system'; }

function splashInfo(d) {
  const t = todayISO(), tm = addDays(t, 1), chips = [];
  const due = d.contacts.filter(c => ['attente', 'entretien'].includes(c.statut) && c.prochaineRelance && c.prochaineRelance <= t).length;
  if (due) chips.push([`${due} relance${due > 1 ? 's' : ''} à faire`, true]);
  const entT = d.entretiens.filter(e => e.date === t).length, entTm = d.entretiens.filter(e => e.date === tm).length;
  if (entT) chips.push([`${entT > 1 ? entT + ' entretiens' : 'Entretien'} aujourd'hui`, true]);
  else if (entTm) chips.push([`${entTm > 1 ? entTm + ' entretiens' : 'Entretien'} demain`, false]);
  const mis = d.missions.filter(m => m.debut <= t && m.fin >= t).length;
  if (mis) chips.push([`${mis > 1 ? mis + ' missions' : 'Mission'} en cours`, false]);
  if (!chips.length && d.contacts.length) chips.push(['Rien d\'urgent aujourd\'hui', false]);
  return chips.slice(0, 3);
}
function createSplash(d) {
  splash = new BrowserWindow({
    width: 440, height: 330, frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    show: false, center: true, title: 'Mes Relances', backgroundColor: '#00000000',
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  const first = (d.settings.nom || '').trim().split(/\s+/)[0] || '';
  splash.loadFile(path.join(__dirname, 'splash.html'), { query: {
    dark: nativeTheme.shouldUseDarkColors ? '1' : '0', nom: first, v: require('./package.json').version, info: JSON.stringify(splashInfo(d)) } });
  splash.once('ready-to-show', () => splash && splash.show());
  splash.on('closed', () => { splash = null; });
}

function createWindow() {
  const d0 = load();
  applyTheme(d0.settings.theme);
  createSplash(d0);
  const started = Date.now();
  let shown = false;
  const reveal = () => {
    if (shown || !win) return; shown = true;
    setTimeout(() => {
      if (!win) return;
      win.show(); win.focus();
      if (splash) { splash.close(); }
    }, Math.max(0, SPLASH_MIN_MS - (Date.now() - started)));
  };
  win = new BrowserWindow({
    show: false,
    width: 1180, height: 840, minWidth: 420, minHeight: 520,
    title: 'Mes Relances', autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12151D' : '#F5F6F8',
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', reveal);
  setTimeout(reveal, 8000); // au cas où
  win.on('closed', () => { win = null; if (splash) splash.close(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto|tel):/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
}

const safeDoc = name => path.join(DOC_DIR(), path.basename(String(name || '')));

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', showWin);
  app.setAppUserModelId('fr.mesrelances.app');
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    ipcMain.handle('load', () => load());
    ipcMain.handle('save', (_e, data) => { const cur = load(); save({ ...data, meta: cur.meta }); return true; });
    ipcMain.handle('openExternal', (_e, url) => { if (/^(mailto|tel|https?):/.test(url)) shell.openExternal(url); });
    ipcMain.handle('setTheme', (_e, t) => { applyTheme(t); return nativeTheme.shouldUseDarkColors; });
    ipcMain.handle('getAutoStart', () => app.getLoginItemSettings().openAtLogin);
    ipcMain.handle('setAutoStart', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on }); return app.getLoginItemSettings().openAtLogin; });
    ipcMain.handle('dataPath', () => app.getPath('userData'));
    ipcMain.handle('checkReminders', () => { checkReminders(); return true; });

    // Documents (aussi utilisés pour les fiches de paie)
    ipcMain.handle('docPick', async (_e, title) => {
      const r = await dialog.showOpenDialog(win, { title: title || 'Choisir un document', properties: ['openFile'],
        filters: [{ name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'odt', 'jpg', 'jpeg', 'png', 'heic', 'txt'] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const src = r.filePaths[0];
      fs.mkdirSync(DOC_DIR(), { recursive: true });
      const fileName = `${Date.now()}-${path.basename(src).replace(/[^\w.\- ()À-ÿ]/g, '_')}`;
      fs.copyFileSync(src, path.join(DOC_DIR(), fileName));
      return { fileName, originalName: path.basename(src), size: fs.statSync(src).size };
    });
    ipcMain.handle('docOpen', async (_e, name) => { const p = safeDoc(name); if (!fs.existsSync(p)) return 'missing'; return shell.openPath(p); });
    ipcMain.handle('docShow', (_e, name) => { const p = safeDoc(name); if (fs.existsSync(p)) shell.showItemInFolder(p); else shell.openPath(DOC_DIR()); });
    ipcMain.handle('docDelete', (_e, name) => { try { fs.unlinkSync(safeDoc(name)); } catch {} return true; });

    // Import d'un tableau (CSV exporté depuis Excel)
    ipcMain.handle('readCsv', async () => {
      const r = await dialog.showOpenDialog(win, { title: 'Importer une liste d\'entreprises', properties: ['openFile'],
        filters: [{ name: 'Tableau CSV (Excel : Enregistrer sous > CSV)', extensions: ['csv', 'txt'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const buf = fs.readFileSync(r.filePaths[0]);
      let txt = buf.toString('utf8');
      if (txt.includes('�')) txt = buf.toString('latin1');
      return txt.replace(/^﻿/, '');
    });

    // Sauvegardes
    ipcMain.handle('pickDir', async () => {
      const r = await dialog.showOpenDialog(win, { title: 'Choisir où ranger les sauvegardes (clé USB conseillée)', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle('backupNow', () => { try { return { ok: true, ...backupNow() }; } catch (e) { setMeta({ backupError: e.message }); return { ok: false, error: e.message }; } });
    ipcMain.handle('backupStatus', () => { const m = load().meta; return { last: m.backupLast || '', error: m.backupError || '', dir: m.backupDir || '' }; });
    ipcMain.handle('backupOpen', () => { const b = load().settings.backup; const p = b.dir && path.join(b.dir, BACKUP_ROOT); if (p && fs.existsSync(p)) shell.openPath(p); else if (b.dir) shell.openPath(b.dir); });
    ipcMain.handle('backupRestore', async () => {
      const b = load().settings.backup;
      const def = b.dir && fs.existsSync(path.join(b.dir, BACKUP_ROOT)) ? path.join(b.dir, BACKUP_ROOT) : undefined;
      const r = await dialog.showOpenDialog(win, { title: 'Choisir le dossier de sauvegarde à remettre', defaultPath: def, properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      const src = r.filePaths[0];
      const json = path.join(src, 'relances.json');
      if (!fs.existsSync(json)) return { error: 'Ce dossier ne contient pas de sauvegarde Mes Relances (fichier relances.json absent).' };
      const ok = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Annuler', 'Remplacer mes données'], defaultId: 0, cancelId: 0,
        title: 'Restaurer une sauvegarde', message: `Remettre la sauvegarde « ${path.basename(src)} » ?`, detail: 'Vos données actuelles seront remplacées. Une copie de sécurité est gardée avant.' });
      if (ok.response !== 1) return null;
      try { fs.copyFileSync(DATA_FILE(), path.join(app.getPath('userData'), `avant-restauration-${todayISO()}.json`)); } catch {}
      const data = JSON.parse(fs.readFileSync(json, 'utf8'));
      if (fs.existsSync(path.join(src, 'documents'))) fs.cpSync(path.join(src, 'documents'), DOC_DIR(), { recursive: true });
      const cur = load();
      save({ ...data, settings: { ...data.settings, backup: cur.settings.backup }, meta: cur.meta });
      return { data: load() };
    });

    // Exports
    ipcMain.handle('export', async () => {
      const r = await dialog.showSaveDialog(win, { title: 'Exporter une sauvegarde', defaultPath: `mes-relances-${todayISO()}.json`, filters: [{ name: 'Sauvegarde', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return false;
      fs.writeFileSync(r.filePath, JSON.stringify(load(), null, 2), 'utf8'); return true;
    });
    ipcMain.handle('exportCsv', async (_e, csv, name) => {
      const r = await dialog.showSaveDialog(win, { title: 'Exporter pour Excel', defaultPath: name || `mes-relances-${todayISO()}.csv`, filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
      if (r.canceled || !r.filePath) return false;
      fs.writeFileSync(r.filePath, '﻿' + csv, 'utf8'); return true;
    });
    ipcMain.handle('pdf', async (_e, name) => {
      const r = await dialog.showSaveDialog(win, { title: 'Enregistrer en PDF', defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return false;
      const buf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: false, margins: { marginType: 'default' } });
      fs.writeFileSync(r.filePath, buf);
      shell.openPath(r.filePath);
      return true;
    });
    ipcMain.handle('import', async () => {
      const r = await dialog.showOpenDialog(win, { title: 'Importer une sauvegarde', properties: ['openFile'], filters: [{ name: 'Sauvegarde', extensions: ['json'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      if (!Array.isArray(data.contacts)) throw new Error('Fichier non reconnu');
      const cur = load();
      save({ ...data, meta: cur.meta }); return load();
    });

    createWindow();
    setTimeout(() => { autoBackup(); checkReminders(); }, 4000);
    setInterval(() => { autoBackup(); checkReminders(); }, 30 * 60 * 1000);
  });
  app.on('before-quit', () => { try { autoBackup(); } catch {} });
  app.on('window-all-closed', () => app.quit());
}
