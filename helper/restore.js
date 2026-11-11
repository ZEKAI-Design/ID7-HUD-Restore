'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = '/var/opt/cluster-render';
const SOCKET = '/run/zekai-hud-restore/control.sock';
const TARGET = '800x480';
const WAZE_SIZES = ['1000x600', '800x600'];
const LIMIT = 128 * 1024;
const OWNER = process.getuid();

function hudSetting(text) {
    const lines = text.match(/^[ \t]*hud_size[ \t]*=.*$/gm) || [];
    if (lines.length === 0) return null;
    if (lines.length !== 1) throw new Error('Duplicate hud_size');
    const match = /^([ \t]*hud_size[ \t]*=[ \t]*)(\d{3,4}x\d{3,4})([ \t]*(?:#.*)?)$/.exec(lines[0]);
    if (!match) throw new Error('Invalid hud_size');
    return { size: match[2], line: lines[0], replacement: match[1] + TARGET + match[3] };
}

function plan(main, local) {
    try {
        const setting = hudSetting(main);
        const override = hudSetting(local);
        if (override && override.size !== TARGET) return { code: 'override', size: override.size };
        if (!setting) return { code: 'unsupported' };
        if (setting.size === TARGET) return { code: 'unchanged', size: TARGET };
        if (WAZE_SIZES.indexOf(setting.size) === -1) return { code: 'unsupported', size: setting.size };
        return {
            code: 'available',
            size: override ? TARGET : setting.size,
            next: main.replace(/^[ \t]*hud_size[ \t]*=.*$/m, setting.replacement)
        };
    } catch (_) {
        return { code: 'unsupported' };
    }
}

function trustedDirectory(dir) {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.uid !== OWNER || (st.mode & 0o022)) throw new Error('Unsafe directory');
}

function readConfig(file) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.uid !== OWNER || (stat.mode & 0o022) || stat.size > LIMIT) throw new Error('Unsafe configuration');
        const text = fs.readFileSync(fd, 'utf8');
        if (Buffer.byteLength(text) > LIMIT) throw new Error('Configuration too large');
        return { text, stat };
    } finally {
        fs.closeSync(fd);
    }
}

function readLocal(file) {
    try { return readConfig(file).text; }
    catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
    }
}

function writeExclusive(file, content, mode, gid) {
    const fd = fs.openSync(file, 'wx', mode);
    try {
        fs.fchownSync(fd, OWNER, gid);
        fs.fchmodSync(fd, mode);
        fs.writeFileSync(fd, content, 'utf8');
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

function handle(command, rootPath = ROOT) {
    let dir, file, original, local, localFile;
    try {
        const root = fs.realpathSync(rootPath);
        trustedDirectory(root);
        trustedDirectory(path.join(root, 'versions'));
        dir = fs.realpathSync(path.join(root, 'current'));
        if (path.dirname(dir) !== path.join(root, 'versions')) return { code: 'unsupported' };
        trustedDirectory(dir);
        file = path.join(dir, 'cluster-render.conf');
        original = readConfig(file);
        localFile = path.join(root, 'cluster-render.local.conf');
        local = readLocal(localFile);
    } catch (error) {
        return { code: error.code === 'ENOENT' ? 'missing' : 'unsupported' };
    }

    const result = plan(original.text, local);
    if (command !== 'restore' || !result.next) return { code: result.code, size: result.size };

    const nonce = crypto.randomBytes(12).toString('hex');
    const backup = path.join(dir, 'cluster-render.conf.hud-restore-' + nonce + '.bak');
    const temp = path.join(dir, '.hud-restore-' + nonce + '.tmp');
    try {
        writeExclusive(backup, original.text, 0o600, original.stat.gid);
        writeExclusive(temp, result.next, original.stat.mode & 0o777, original.stat.gid);
        const current = readConfig(file);
        if (fs.realpathSync(path.join(rootPath, 'current')) !== dir ||
            current.stat.ino !== original.stat.ino || current.text !== original.text ||
            readLocal(localFile) !== local) return { code: 'retry' };
        fs.renameSync(temp, file);
        return { code: 'restored', size: TARGET };
    } catch (error) {
        console.error('HUD restore failed: ' + error.message);
        return { code: 'failed' };
    } finally {
        try { fs.unlinkSync(temp); } catch (_) { /* already moved or never created */ }
    }
}

function serve() {
    try { fs.unlinkSync(SOCKET); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const server = net.createServer(socket => {
        let input = '';
        let done = false;
        socket.setEncoding('utf8');
        socket.setTimeout(1500, () => socket.destroy());
        socket.on('error', () => socket.destroy());
        socket.on('data', chunk => {
            if (done) return;
            input += chunk;
            if (input.length > 8) return socket.destroy();
            if (input.indexOf('\n') < 0) return;
            done = true;
            if (input !== 'status\n' && input !== 'restore\n') return socket.destroy();
            socket.end(JSON.stringify(handle(input.trim())) + '\n');
        });
    });
    server.maxConnections = 8;
    server.listen(SOCKET, () => fs.chmodSync(SOCKET, 0o660));
}

if (require.main === module) serve();
module.exports = { handle };
