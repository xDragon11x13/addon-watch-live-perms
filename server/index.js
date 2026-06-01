import { createAddon } from 'addon-sdk';

const addon = createAddon();

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
        const result = await addon.core.liveSpectateStart({
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
        return { status: 400, body: { error: error.message || 'Failed to start Watch Live.' } };
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
        await addon.core.liveSpectateStop({
            adminName: req.admin.name,
            sessionId,
        });
        return { status: 200, body: { success: true } };
    } catch (error) {
        return { status: 400, body: { error: error.message || 'Failed to stop Watch Live.' } };
    }
});

addon.log.info('Watch Live Permissions addon loaded');
addon.ready();
