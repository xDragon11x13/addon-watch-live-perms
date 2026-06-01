/* global React, globalThis */
const { createElement: h, useState, useEffect, useCallback, useRef } = React;

const ADDON_ID = 'addon-watch-live-perms';
const ADDON_API = `/addons/${ADDON_ID}/api`;

const PERM_WATCH = 'addon.addon-watch-live-perms.watch_live';
const PERM_WATCH_TEAM = 'addon.addon-watch-live-perms.watch_live_team';

function getHeaders() {
    return globalThis.txAddonApi?.getHeaders?.() ?? { 'Content-Type': 'application/json' };
}

function getPermissions() {
    return globalThis.txConsts?.preAuth?.permissions ?? [];
}

function hasPerm(permission) {
    const perms = getPermissions();
    return perms.includes('all_permissions') || perms.includes(permission);
}

function canWatchTarget(tags) {
    const isStaff = Array.isArray(tags) && tags.includes('staff');
    if (hasPerm('all_permissions')) return { allowed: true, isStaff };
    if (isStaff) return { allowed: hasPerm(PERM_WATCH_TEAM), isStaff };
    return { allowed: hasPerm(PERM_WATCH) || hasPerm(PERM_WATCH_TEAM), isStaff };
}

function getSocket() {
    if (globalThis.txAddonApi?.socket?.get) return globalThis.txAddonApi.socket.get();
    return null;
}

function WatchLiveStream({ sessionId, playerName, onStop }) {
    const [frame, setFrame] = useState(null);
    const [timedOut, setTimedOut] = useState(false);
    const cleanupRef = useRef(null);

    useEffect(() => {
        if (!sessionId) return;
        const timer = setTimeout(() => setTimedOut(true), 20000);
        return () => clearTimeout(timer);
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return;
        const socket = getSocket();
        if (!socket) return;

        socket.emit('joinSpectate', sessionId);
        const onFrame = (payload) => {
            if (payload?.sessionId === sessionId) {
                setFrame(payload.frame);
                setTimedOut(false);
            }
        };
        socket.on('spectateFrame', onFrame);

        const cleanup = () => {
            socket.off('spectateFrame', onFrame);
            socket.emit('leaveSpectate', sessionId);
        };
        cleanupRef.current = cleanup;
        return cleanup;
    }, [sessionId]);

    const handleStop = useCallback(() => {
        cleanupRef.current?.();
        cleanupRef.current = null;
        setFrame(null);
        setTimedOut(false);
        onStop();
    }, [onStop]);

    return h('div', { className: 'space-y-3' },
        h('div', { className: 'flex items-center justify-between gap-2' },
            h('p', { className: 'text-sm font-medium text-foreground' }, `Live: ${playerName}`),
            h('button', {
                type: 'button',
                onClick: handleStop,
                className: 'rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90',
            }, 'Stop'),
        ),
        h('div', {
            className: 'flex min-h-[320px] items-center justify-center rounded-lg bg-zinc-950',
        },
            !frame && !timedOut && h('p', { className: 'text-sm text-muted-foreground' }, 'Connecting to live stream…'),
            timedOut && !frame && h('p', { className: 'text-destructive text-center text-sm px-4' },
                'Connection timed out — no frames received from the player.'),
            frame && h('img', {
                src: frame,
                alt: `Live spectate of ${playerName}`,
                className: 'max-h-[60vh] max-w-full',
            }),
        ),
    );
}

export function WatchLiveTab({ license, displayName, netid, playerRef }) {
    const [tags, setTags] = useState([]);
    const [loadingTags, setLoadingTags] = useState(true);
    const [sessionId, setSessionId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!playerRef) {
            setLoadingTags(false);
            return;
        }
        setLoadingTags(true);
        const params = new URLSearchParams();
        if (playerRef.mutex) params.set('mutex', playerRef.mutex);
        if (playerRef.netid != null) params.set('netid', String(playerRef.netid));
        if (playerRef.license) params.set('license', playerRef.license);

        fetch(`/player?${params.toString()}`, { credentials: 'same-origin', headers: getHeaders() })
            .then((res) => res.json())
            .then((data) => {
                setTags(Array.isArray(data?.player?.tags) ? data.player.tags : []);
                setLoadingTags(false);
            })
            .catch(() => {
                setTags([]);
                setLoadingTags(false);
            });
    }, [playerRef]);

    const access = canWatchTarget(tags);

    const startWatch = async () => {
        setError(null);
        setBusy(true);
        try {
            const res = await fetch(`${ADDON_API}/spectate/start`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: getHeaders(),
                body: JSON.stringify({
                    mutex: playerRef?.mutex ?? 'current',
                    netid,
                    license,
                    tags,
                    displayName,
                }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setError(data.error || `HTTP ${res.status}`);
                return;
            }
            setSessionId(data.sessionId);
        } catch (err) {
            setError(err.message || 'Failed to start Watch Live.');
        } finally {
            setBusy(false);
        }
    };

    const stopWatch = async () => {
        if (!sessionId) return;
        setError(null);
        try {
            await fetch(`${ADDON_API}/spectate/stop`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: getHeaders(),
                body: JSON.stringify({ sessionId }),
            });
        } catch (_) { /* ignore */ }
        setSessionId(null);
    };

    if (loadingTags) {
        return h('p', { className: 'text-sm text-muted-foreground p-2' }, 'Loading…');
    }

    if (!access.allowed) {
        return h('div', { className: 'space-y-2 p-2' },
            h('p', { className: 'text-sm text-muted-foreground' },
                access.isStaff
                    ? 'You need the "Watch Live (Team)" permission to observe this team member.'
                    : 'You do not have permission to use Watch Live.'),
        );
    }

    if (!netid) {
        return h('p', { className: 'text-sm text-muted-foreground p-2' },
            'This player is offline. Watch Live is only available for connected players.');
    }

    if (sessionId) {
        return h(WatchLiveStream, {
            sessionId,
            playerName: displayName || `#${netid}`,
            onStop: stopWatch,
        });
    }

    return h('div', { className: 'space-y-3 p-2' },
        h('p', { className: 'text-sm text-muted-foreground' },
            access.isStaff
                ? 'You are about to watch a staff-tagged team member. This action is logged.'
                : 'Stream this player\'s live screen in the panel. This action is logged.'),
        error && h('p', { className: 'text-sm text-destructive' }, error),
        h('button', {
            type: 'button',
            disabled: busy,
            onClick: startWatch,
            className: 'inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
        }, busy ? 'Starting…' : 'Start Watch Live'),
    );
}

export const widgets = { WatchLiveTab };
