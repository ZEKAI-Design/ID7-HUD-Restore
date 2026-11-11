'use strict';

const net = require('net');
const mgu = require('./kit/mgu');
const SOCKET = '/run/zekai-hud-restore/control.sock';

function request(command) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(SOCKET);
        let buffer = '';
        socket.setEncoding('utf8');
        socket.setTimeout(3000, () => socket.destroy(new Error('Timed out')));
        socket.on('error', reject);
        socket.on('connect', () => socket.write(command + '\n'));
        socket.on('data', chunk => {
            buffer += chunk;
            if (buffer.length > 512) return socket.destroy(new Error('Invalid reply'));
            const end = buffer.indexOf('\n');
            if (end < 0) return;
            try { resolve(JSON.parse(buffer.slice(0, end))); }
            catch (error) { reject(error); }
            socket.destroy();
        });
        socket.on('close', () => reject(new Error('No reply')));
    });
}

const messages = {
    restored: 'Saved. Restart iDrive, then centre the affected HUD widget.',
    unchanged: 'Already set to 800 x 480. Restart iDrive if the old layout is still visible.',
    missing: 'Cluster renderer is missing. Check Tools in MGU Store.',
    override: 'A local override controls this canvas. Review that configuration first.',
    unsupported: 'Unrecognised renderer configuration. No settings were written.',
    retry: 'Renderer configuration changed during the request. Try again.',
    failed: 'Could not save the configuration. Try again while parked.'
};

mgu.run({
    start(ctx) {
        const { ui, signals, log } = ctx;
        let busy = false;
        let lastSpeed = null;
        let sequence = 0;

        function showReply(reply) {
            const size = reply && reply.size;
            return ui.text('CURRENT', /^\d{3,4}x\d{3,4}$/.test(size || '')
                ? 'Configured canvas: ' + size.replace('x', ' x ')
                : 'Configured canvas: unavailable');
        }

        async function refresh() {
            const ticket = ++sequence;
            try {
                const reply = await request('status');
                if (ticket === sequence) {
                    await showReply(reply);
                    if (messages[reply.code]) await ui.text('STATUS', messages[reply.code]);
                }
            } catch (_) {
                if (ticket === sequence) await ui.text('STATUS', 'Restore helper unavailable. Check Tools, then restart iDrive.');
            }
        }

        ui.onClick('RESTORE', async () => {
            if (busy) return;
            if (!lastSpeed || lastSpeed.value !== 0 || Date.now() - lastSpeed.time > 2500) {
                return ui.text('STATUS', 'Stop the vehicle and wait for iDrive to read zero speed.');
            }
            busy = true;
            sequence++;
            try {
                const reply = await request('restore');
                await showReply(reply);
                await ui.text('STATUS', messages[reply.code] || 'Unexpected reply. Check the canvas before trying again.');
            } catch (_) {
                await ui.text('STATUS', 'Restore helper unavailable. Check Tools, then restart iDrive.');
            } finally {
                busy = false;
            }
        });

        ui.onVisible((screen, visible) => {
            if (screen === 'MAIN' && visible && !busy) refresh();
        });
        signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2: value => {
                lastSpeed = { value: value && value.speedVehicleCentreOfGravity, time: Date.now() };
            }
        }, log, { pollMs: 800, readTimeoutMs: 1000, shouldPoll: () => ui.isVisible('MAIN') })
            .catch(error => log.warn('Vehicle speed unavailable: ' + error.message));
        refresh();
    }
});
