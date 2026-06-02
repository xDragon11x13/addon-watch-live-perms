import { createAddon } from 'addon-sdk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoreBridge } from './coreBridge.js';
import { applyWatchLiveCorePatch } from './applyPatches.js';

const addon = createAddon();
const addonDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const core = createCoreBridge(addon);

const PERM_WATCH = 'addon.addon-watch-live-perms.watch_live';
const PERM_WATCH_TEAM = 'addon.addon-watch-live-perms.watch_live_team';

const ACTION_START = 'addon.addon-watch-live-perms.live_spectate.start';
const ACTION_START_TEAM = 'addon.addon-watch-live-perms.live_spectate.start.team';
const ACTION_STOP = 'addon.addon-watch-live-perms.live_spectate.stop';

function hasPerm(req, permission) {
    return req.admin.hasPermission(permission) || req.admin.hasPermission('all_permissions');
}

function canWatchTarget(req, targetIsStaff) {
    if (hasPerm(req, 'all_permissions')) return true;
    if (targetIsStaff) return hasPerm(req, PERM_WATCH_TEAM);
    return hasPerm(req, PERM_WATCH) || hasPerm(req, PERM_WATCH_TEAM);
}

function hasAnyWatchPerm(req) {
    return hasPerm(req, PERM_WATCH) || hasPerm(req, PERM_WATCH_TEAM);
}

addon.registerRoute('POST', '/spectate/start', async (req) => {
    if (!hasAnyWatchPerm(req)) {
        return { status: 403, body: { error: 'You do not have permission to use Watch Live.' } };
    }

    const { mutex, netid, license, tags, displayName } = req.body || {};
    if (typeof netid !== 'number' && typeof netid !== 'string') {
        return { status: 400, body: { error: 'Invalid player reference.' } };
    }

    const tagList = Array.isArray(tags) ? tags : [];
    const targetIsStaff = tagList.includes('staff');

    if (!canWatchTarget(req, targetIsStaff)) {
        return {
            status: 403,
            body: {
                error: targetIsStaff
                    ? 'You do not have permission to watch team members.'
                    : 'You do not have permission to use Watch Live.',
            },
        };
    }

    try {
        const result = await core.liveSpectateStart({
            adminName: req.admin.name,
            mutex: typeof mutex === 'string' ? mutex : 'current',
            netid: String(netid),
            license: typeof license === 'string' ? license : undefined,
            targetIsStaff,
            startActionId: targetIsStaff ? ACTION_START_TEAM : ACTION_START,
            startMessage: targetIsStaff
                ? `Started Watch Live for team member [#${netid}] ${displayName || 'Unknown'}.`
                : `Started Watch Live for [#${netid}] ${displayName || 'Unknown'}.`,
        });

        return { status: 200, body: { sessionId: result.sessionId } };
    } catch (error) {
        let message = error.message || 'Failed to start Watch Live.';
        if (message.includes('unknown API method: liveSpectate')) {
            message += ' Deploy core/index.js from this monitor build and restart fxPanel.';
        }
        return { status: 400, body: { error: message } };
    }
});

addon.registerRoute('POST', '/spectate/stop', async (req) => {
    if (!hasAnyWatchPerm(req)) {
        return { status: 403, body: { error: 'You do not have permission to use Watch Live.' } };
    }

    const { sessionId } = req.body || {};
    if (typeof sessionId !== 'string' || !sessionId.length) {
        return { status: 400, body: { error: 'Invalid session ID.' } };
    }

    try {
        await core.liveSpectateStop({
            adminName: req.admin.name,
            sessionId,
        });
        return { status: 200, body: { success: true } };
    } catch (error) {
        let message = error.message || 'Failed to stop Watch Live.';
        if (message.includes('unknown API method: liveSpectate')) {
            message += ' Deploy core/index.js from this monitor build and restart fxPanel.';
        }
        return { status: 400, body: { error: message } };
    }
});

applyWatchLiveCorePatch(addonDir)
    .then((result) => {
        if (result.status === 'patched') {
            addon.log.warn(
                'Core patched for Watch Live bridge — restart fxPanel now, then try Watch Live again.',
            );
        } else if (result.status === 'missing') {
            addon.log.warn(`Core patch skipped: ${result.relativePath} not found.`);
        }
    })
    .catch((error) => {
        addon.log.error(`Core patch failed: ${error.message}`);
    });

addon.log.info('Watch Live Permissions addon loaded');
addon.ready();
