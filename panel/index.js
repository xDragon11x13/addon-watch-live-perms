/* global React, globalThis */
const { createElement: h, useState, useEffect, useCallback, useRef, useMemo } = React;

const ADDON_ID = 'addon-watch-live-perms';
const ADDON_API = `/addons/${ADDON_ID}/api`;
const MAX_MULTI_STREAMS = 6;

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

function hasAnyWatchPerm() {
    return hasPerm(PERM_WATCH) || hasPerm(PERM_WATCH_TEAM);
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

function getSocketApi() {
    return globalThis.txAddonApi?.socket ?? null;
}

function applyPlayerlistEvents(currentPlayers, events) {
    if (!Array.isArray(events) || !events.length) {
        return { players: currentPlayers, mutex: null, changed: false };
    }

    let list = currentPlayers;
    let mutex = null;
    let changed = false;

    const startIndex = events.findIndex((event) => event?.type === 'fullPlayerlist');
    const slice = startIndex >= 0 ? events.slice(startIndex) : events;

    for (const event of slice) {
        if (!event || typeof event !== 'object') continue;

        if (event.type === 'fullPlayerlist') {
            list = Array.isArray(event.playerlist) ? event.playerlist : [];
            mutex = typeof event.mutex === 'string' ? event.mutex : null;
            changed = true;
            continue;
        }

        if (event.type === 'playerJoining') {
            list = [...list.filter((player) => player.netid !== event.netid), event];
            changed = true;
            continue;
        }

        if (event.type === 'playerDropped') {
            list = list.filter((player) => player.netid !== event.netid);
            changed = true;
        }
    }

    return { players: list, mutex, changed };
}

function useOnlinePlayers() {
    const [players, setPlayers] = useState([]);
    const [mutex, setMutex] = useState(null);
    const playersRef = useRef([]);

    useEffect(() => {
        playersRef.current = players;
    }, [players]);

    useEffect(() => {
        const socketApi = getSocketApi();
        const socket = socketApi?.get?.();
        if (!socketApi || !socket) return undefined;

        const handlePayload = (payload) => {
            const events = Array.isArray(payload) ? payload : [payload];
            const result = applyPlayerlistEvents(playersRef.current, events);
            if (!result.changed) return;
            playersRef.current = result.players;
            setPlayers(result.players);
            if (result.mutex) setMutex(result.mutex);
        };

        socketApi.joinRoom('playerlist');
        socket.on('playerlist', handlePayload);

        return () => {
            socket.off('playerlist', handlePayload);
            socketApi.leaveRoom('playerlist');
        };
    }, []);

    const sortedPlayers = useMemo(
        () => [...players].sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''))),
        [players],
    );

    return { players: sortedPlayers, mutex };
}

function getGridClass(count) {
    if (count <= 1) return 'grid grid-cols-1 gap-3';
    if (count === 2) return 'grid grid-cols-1 gap-3 xl:grid-cols-2';
    if (count <= 4) return 'grid grid-cols-1 gap-3 md:grid-cols-2';
    return 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3';
}

function WatchLiveStream({ sessionId, playerName, onStop, compact = false }) {
    const [frame, setFrame] = useState(null);
    const [timedOut, setTimedOut] = useState(false);
    const cleanupRef = useRef(null);

    useEffect(() => {
        if (!sessionId) return undefined;
        const timer = setTimeout(() => setTimedOut(true), 20000);
        return () => clearTimeout(timer);
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return undefined;
        const socket = getSocket();
        if (!socket) return undefined;

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

    const frameClass = compact
        ? 'flex aspect-video min-h-[180px] items-center justify-center rounded-lg bg-zinc-950'
        : 'flex min-h-[320px] items-center justify-center rounded-lg bg-zinc-950';

    const imageClass = compact
        ? 'h-full w-full object-contain'
        : 'max-h-[60vh] max-w-full';

    return h('div', { className: compact ? 'space-y-2' : 'space-y-3' },
        h('div', { className: 'flex items-center justify-between gap-2' },
            h('p', {
                className: compact
                    ? 'truncate text-xs font-medium text-foreground'
                    : 'text-sm font-medium text-foreground',
            }, `Live: ${playerName}`),
            h('button', {
                type: 'button',
                onClick: handleStop,
                className: 'shrink-0 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90',
            }, 'Stop'),
        ),
        h('div', { className: frameClass },
            !frame && !timedOut && h('p', { className: 'text-sm text-muted-foreground' }, 'Connecting…'),
            timedOut && !frame && h('p', { className: 'px-4 text-center text-sm text-destructive' },
                'Connection timed out — no frames received.'),
            frame && h('img', {
                src: frame,
                alt: `Live spectate of ${playerName}`,
                className: imageClass,
            }),
        ),
    );
}

async function startSpectateSession(player, mutex) {
    const tags = Array.isArray(player.tags) ? player.tags : [];
    const response = await fetch(`${ADDON_API}/spectate/start`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: getHeaders(),
        body: JSON.stringify({
            mutex: mutex ?? 'current',
            netid: player.netid,
            license: player.license,
            tags,
            displayName: player.displayName,
        }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data.sessionId;
}

async function stopSpectateSession(sessionId) {
    if (!sessionId) return;
    try {
        await fetch(`${ADDON_API}/spectate/stop`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: getHeaders(),
            body: JSON.stringify({ sessionId }),
        });
    } catch {
        // ignore
    }
}

function MultiStreamPage() {
    const { players, mutex } = useOnlinePlayers();
    const [activeStreams, setActiveStreams] = useState([]);
    const [search, setSearch] = useState('');
    const [busyNetids, setBusyNetids] = useState([]);
    const [error, setError] = useState(null);
    const activeStreamsRef = useRef([]);

    useEffect(() => {
        activeStreamsRef.current = activeStreams;
    }, [activeStreams]);

    useEffect(() => () => {
        for (const stream of activeStreamsRef.current) {
            stopSpectateSession(stream.sessionId);
        }
    }, []);

    useEffect(() => {
        setActiveStreams((current) => current.filter((stream) => (
            players.some((player) => player.netid === stream.netid)
        )));
    }, [players]);

    const filteredPlayers = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return players;
        return players.filter((player) => {
            const name = String(player.displayName || '').toLowerCase();
            const id = String(player.netid ?? '');
            return name.includes(query) || id.includes(query);
        });
    }, [players, search]);

    const setBusy = (netid, busy) => {
        setBusyNetids((current) => {
            if (busy) return current.includes(netid) ? current : [...current, netid];
            return current.filter((value) => value !== netid);
        });
    };

    const stopStream = async (stream) => {
        await stopSpectateSession(stream.sessionId);
        setActiveStreams((current) => current.filter((entry) => entry.netid !== stream.netid));
    };

    const startStream = async (player) => {
        const access = canWatchTarget(player.tags);
        if (!access.allowed) {
            setError(access.isStaff
                ? 'You need "Watch Live (Team)" to observe this team member.'
                : 'You do not have permission to watch this player.');
            return;
        }

        if (activeStreams.some((stream) => stream.netid === player.netid)) return;

        if (activeStreams.length >= MAX_MULTI_STREAMS) {
            setError(`You can watch up to ${MAX_MULTI_STREAMS} players at once.`);
            return;
        }

        setError(null);
        setBusy(player.netid, true);
        try {
            const sessionId = await startSpectateSession(player, mutex);
            setActiveStreams((current) => [...current, {
                netid: player.netid,
                displayName: player.displayName || `#${player.netid}`,
                license: player.license,
                tags: player.tags ?? [],
                sessionId,
            }]);
        } catch (err) {
            setError(err.message || 'Failed to start Watch Live.');
        } finally {
            setBusy(player.netid, false);
        }
    };

    const togglePlayer = (player) => {
        const existing = activeStreams.find((stream) => stream.netid === player.netid);
        if (existing) {
            stopStream(existing);
            return;
        }
        startStream(player);
    };

    const stopAll = async () => {
        const streams = [...activeStreams];
        setActiveStreams([]);
        await Promise.all(streams.map((stream) => stopSpectateSession(stream.sessionId)));
    };

    if (!hasAnyWatchPerm()) {
        return h('div', { className: 'p-6' },
            h('p', { className: 'text-sm text-muted-foreground' },
                'You do not have permission to use Multi-Stream.'),
        );
    }

    return h('div', { className: 'flex h-full min-h-0 flex-col gap-4 p-4 lg:flex-row' },
        h('div', { className: 'flex w-full shrink-0 flex-col gap-3 lg:w-80' },
            h('div', null,
                h('h1', { className: 'text-xl font-semibold text-foreground' }, 'Multi-Stream'),
                h('p', { className: 'mt-1 text-sm text-muted-foreground' },
                    'Select online players to watch several live streams at once. Each session is logged.'),
            ),
            h('input', {
                type: 'search',
                value: search,
                onChange: (event) => setSearch(event.target.value),
                placeholder: 'Search players…',
                className: 'border-input bg-background w-full rounded-md border px-3 py-2 text-sm',
            }),
            h('div', { className: 'flex items-center justify-between gap-2' },
                h('p', { className: 'text-xs text-muted-foreground' },
                    `${activeStreams.length}/${MAX_MULTI_STREAMS} active · ${players.length} online`),
                activeStreams.length > 0 && h('button', {
                    type: 'button',
                    onClick: stopAll,
                    className: 'text-xs font-medium text-destructive hover:underline',
                }, 'Stop all'),
            ),
            error && h('p', { className: 'text-sm text-destructive' }, error),
            h('div', { className: 'border-border/50 flex max-h-[calc(100vh-16rem)] flex-col gap-2 overflow-y-auto rounded-lg border p-2' },
                filteredPlayers.length === 0
                    ? h('p', { className: 'p-2 text-sm text-muted-foreground' }, 'No online players found.')
                    : filteredPlayers.map((player) => {
                        const access = canWatchTarget(player.tags);
                        const isActive = activeStreams.some((stream) => stream.netid === player.netid);
                        const isBusy = busyNetids.includes(player.netid);
                        const isStaff = access.isStaff;

                        return h('button', {
                            key: player.netid,
                            type: 'button',
                            disabled: !access.allowed || isBusy,
                            onClick: () => togglePlayer(player),
                            className: [
                                'flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                                isActive ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-secondary/40',
                                !access.allowed ? 'cursor-not-allowed opacity-50' : '',
                            ].join(' '),
                        },
                            h('span', {
                                className: [
                                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px]',
                                    isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                                ].join(' '),
                            }, isActive ? '✓' : ''),
                            h('div', { className: 'min-w-0 flex-1' },
                                h('div', { className: 'flex items-center gap-2' },
                                    h('p', { className: 'truncate text-sm font-medium text-foreground' },
                                        player.displayName || `Player #${player.netid}`),
                                    isStaff && h('span', {
                                        className: 'bg-amber-500/15 text-amber-300 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                                    }, 'Team'),
                                ),
                                h('p', { className: 'text-muted-foreground text-xs' }, `ID ${player.netid}`),
                                !access.allowed && h('p', { className: 'text-muted-foreground mt-1 text-[11px]' },
                                    isStaff
                                        ? 'Requires Watch Live (Team)'
                                        : 'No Watch Live permission'),
                            ),
                        );
                    }),
            ),
        ),
        h('div', { className: 'min-h-0 flex-1' },
            activeStreams.length === 0
                ? h('div', {
                    className: 'border-border/50 flex h-full min-h-[320px] items-center justify-center rounded-xl border border-dashed p-6',
                },
                    h('p', { className: 'max-w-md text-center text-sm text-muted-foreground' },
                        'Select one or more players on the left to start watching. The layout adapts automatically to the number of active streams.'),
                )
                : h('div', { className: getGridClass(activeStreams.length) },
                    activeStreams.map((stream) => h('div', {
                        key: stream.netid,
                        className: 'border-border/50 rounded-xl border bg-card/40 p-3',
                    },
                        h(WatchLiveStream, {
                            sessionId: stream.sessionId,
                            playerName: stream.displayName,
                            onStop: () => stopStream(stream),
                            compact: activeStreams.length > 1,
                        }),
                    )),
                ),
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
            return undefined;
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
            const sessionIdValue = await startSpectateSession({
                netid,
                license,
                tags,
                displayName,
            }, playerRef?.mutex ?? 'current');
            setSessionId(sessionIdValue);
        } catch (err) {
            setError(err.message || 'Failed to start Watch Live.');
        } finally {
            setBusy(false);
        }
    };

    const stopWatch = async () => {
        if (!sessionId) return;
        setError(null);
        await stopSpectateSession(sessionId);
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

export const pages = { MultiStreamPage };
export const widgets = { WatchLiveTab };
