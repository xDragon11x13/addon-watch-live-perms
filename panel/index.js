/* global React, globalThis */
const { createElement: h, useState, useEffect, useCallback, useRef, useMemo } = React;

const ADDON_ID = 'addon-watch-live-perms';
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

function getMultiStreamGridStyle(count) {
    if (count <= 1) return { cols: 1, rows: 1 };
    if (count === 2) return { cols: 2, rows: 1 };
    if (count <= 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 3, rows: 2 };
    return { cols: 3, rows: 3 };
}

function formatLatencyMs(lastFrameAt) {
    if (!lastFrameAt) return null;
    return Math.max(0, Date.now() - lastFrameAt);
}

function StreamStatusOverlay({ message, variant = 'waiting', playerName = '' }) {
    const isWaiting = variant === 'waiting';
    const spinnerClass = isWaiting
        ? 'border-emerald-500/30 border-t-emerald-400'
        : 'border-primary/40 border-t-primary';
    const textClass = variant === 'error'
        ? 'text-destructive'
        : isWaiting
            ? 'text-emerald-300'
            : 'text-muted-foreground';

    return h('div', {
        className: 'absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black px-3 text-center',
    },
        h('div', { className: `size-10 animate-spin rounded-full border-[3px] ${spinnerClass}` }),
        h('p', { className: `text-sm font-semibold ${textClass}` }, message),
        playerName && h('p', { className: 'text-muted-foreground text-xs' }, playerName),
    );
}

function MultiStreamTile({ sessionId, player, onStop }) {
    const [frame, setFrame] = useState(null);
    const [timedOut, setTimedOut] = useState(false);
    const [lastFrameAt, setLastFrameAt] = useState(null);
    const [latencyMs, setLatencyMs] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const cleanupRef = useRef(null);
    const viewportRef = useRef(null);
    const displayName = player.displayName || `Player #${player.netid}`;
    const tags = Array.isArray(player.tags) ? player.tags : [];

    useEffect(() => {
        if (!sessionId) return undefined;
        const timer = setTimeout(() => setTimedOut(true), 25000);
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
                const now = Date.now();
                setLastFrameAt(now);
                setLatencyMs(0);
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

    useEffect(() => {
        if (!lastFrameAt || !frame) {
            setLatencyMs(null);
            return undefined;
        }
        const timer = setInterval(() => {
            setLatencyMs(formatLatencyMs(lastFrameAt));
        }, 500);
        return () => clearInterval(timer);
    }, [lastFrameAt, frame]);

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === viewportRef.current);
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);

    const handleStop = useCallback(() => {
        if (document.fullscreenElement === viewportRef.current) {
            document.exitFullscreen?.().catch(() => {});
        }
        cleanupRef.current?.();
        cleanupRef.current = null;
        onStop();
    }, [onStop]);

    const toggleFullscreen = useCallback(() => {
        const el = viewportRef.current;
        if (!el) return;
        if (document.fullscreenElement === el) {
            document.exitFullscreen?.().catch(() => {});
            return;
        }
        el.requestFullscreen?.().catch(() => {});
    }, []);

    return h('div', { className: 'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-zinc-950/80 shadow-sm' },
        h('div', { className: 'flex shrink-0 items-start justify-between gap-2 border-b border-border/40 px-3 py-2' },
            h('div', { className: 'min-w-0' },
                h('p', { className: 'truncate text-sm font-semibold text-foreground' },
                    `#${player.netid} ${displayName}`),
                tags.length > 0 && h('div', { className: 'mt-1 flex flex-wrap gap-1' },
                    tags.includes('staff') && h('span', {
                        className: 'rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300',
                    }, 'Team'),
                    tags.filter((tag) => tag !== 'staff').slice(0, 3).map((tag) => h('span', {
                        key: tag,
                        className: 'rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium capitalize text-sky-200',
                    }, tag.replace(/_/g, ' '))),
                ),
            ),
            h('div', { className: 'flex shrink-0 items-center gap-1.5' },
                frame && latencyMs != null && h('span', {
                    className: 'rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300',
                }, `${latencyMs}ms`),
                h('button', {
                    type: 'button',
                    onClick: toggleFullscreen,
                    disabled: !frame,
                    className: 'rounded border border-border/60 px-2 py-1 text-[10px] hover:bg-zinc-800 disabled:opacity-40',
                    title: 'Fullscreen',
                }, '⛶'),
                h('button', {
                    type: 'button',
                    onClick: handleStop,
                    className: 'rounded bg-destructive/90 px-2 py-1 text-[10px] font-medium text-white hover:bg-destructive',
                }, 'Stop'),
            ),
        ),
        h('div', {
            ref: viewportRef,
            className: 'relative min-h-0 flex-1 bg-black',
        },
            !frame && !timedOut && h(StreamStatusOverlay, {
                message: 'Waiting for stream…',
                variant: 'waiting',
                playerName: displayName,
            }),
            timedOut && !frame && h(StreamStatusOverlay, {
                message: 'No stream received.',
                variant: 'error',
                playerName: displayName,
            }),
            frame && h('img', {
                src: frame,
                alt: `Live stream of ${displayName}`,
                className: 'absolute inset-0 h-full w-full object-contain',
            }),
            frame && h('span', {
                className: 'absolute bottom-2 right-2 flex size-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300',
                title: 'Live',
            }, '●'),
            isFullscreen && h('div', {
                className: 'absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between bg-black/75 px-4 py-3',
            },
                h('p', { className: 'truncate text-sm text-white' }, `#${player.netid} ${displayName}`),
                h('div', { className: 'flex gap-2' },
                    h('button', {
                        type: 'button',
                        onClick: toggleFullscreen,
                        className: 'rounded border border-white/20 px-3 py-1 text-xs text-white',
                    }, 'Exit'),
                    h('button', {
                        type: 'button',
                        onClick: handleStop,
                        className: 'rounded bg-destructive px-3 py-1 text-xs text-white',
                    }, 'Stop'),
                ),
            ),
        ),
    );
}

function WatchLiveStream({ sessionId, playerName, onStop, compact = false, fillCell = false }) {
    const [frame, setFrame] = useState(null);
    const [timedOut, setTimedOut] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const cleanupRef = useRef(null);
    const viewportRef = useRef(null);

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

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === viewportRef.current);
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);

    const handleStop = useCallback(() => {
        if (document.fullscreenElement === viewportRef.current) {
            document.exitFullscreen?.().catch(() => {});
        }
        cleanupRef.current?.();
        cleanupRef.current = null;
        setFrame(null);
        setTimedOut(false);
        onStop();
    }, [onStop]);

    const toggleFullscreen = useCallback(() => {
        const el = viewportRef.current;
        if (!el) return;
        if (document.fullscreenElement === el) {
            document.exitFullscreen?.().catch(() => {});
            return;
        }
        el.requestFullscreen?.().catch(() => {});
    }, []);

    const outerClass = fillCell
        ? 'flex h-full min-h-0 flex-col gap-2'
        : compact
            ? 'space-y-2'
            : 'space-y-3';

    const viewportClass = [
        'relative overflow-hidden rounded-lg bg-zinc-950',
        fillCell ? 'min-h-0 flex-1 w-full' : '',
        compact && !fillCell ? 'aspect-video min-h-[180px]' : '',
        !compact && !fillCell ? 'min-h-[320px]' : '',
        isFullscreen ? 'flex h-full w-full items-center justify-center bg-black' : 'flex items-center justify-center',
    ].filter(Boolean).join(' ');

    const imageClass = isFullscreen || fillCell || compact
        ? 'h-full w-full object-contain'
        : 'max-h-[60vh] max-w-full';

    const showControls = frame || isFullscreen;

    return h('div', { className: outerClass },
        !isFullscreen && h('div', { className: 'flex shrink-0 items-center justify-between gap-2' },
            h('p', {
                className: compact
                    ? 'truncate text-xs font-medium text-foreground'
                    : 'text-sm font-medium text-foreground',
            }, `Live: ${playerName}`),
            h('div', { className: 'flex shrink-0 items-center gap-1.5' },
                h('button', {
                    type: 'button',
                    onClick: toggleFullscreen,
                    disabled: !frame,
                    title: 'Fullscreen',
                    className: 'rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40',
                }, 'Fullscreen'),
                h('button', {
                    type: 'button',
                    onClick: handleStop,
                    className: 'rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90',
                }, 'Stop'),
            ),
        ),
        h('div', { ref: viewportRef, className: viewportClass },
            !frame && !timedOut && h(StreamStatusOverlay, { message: 'Connecting…', variant: 'muted' }),
            timedOut && !frame && h(StreamStatusOverlay, {
                message: 'Connection timed out — no frames received.',
                variant: 'error',
            }),
            frame && h('img', {
                src: frame,
                alt: `Live spectate of ${playerName}`,
                className: imageClass,
            }),
            isFullscreen && showControls && h('div', {
                className: 'absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between gap-2 bg-black/70 px-4 py-3',
            },
                h('p', { className: 'truncate text-sm font-medium text-white' }, playerName),
                h('div', { className: 'flex shrink-0 items-center gap-2' },
                    h('button', {
                        type: 'button',
                        onClick: toggleFullscreen,
                        className: 'rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20',
                    }, 'Exit fullscreen'),
                    h('button', {
                        type: 'button',
                        onClick: handleStop,
                        className: 'rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90',
                    }, 'Stop'),
                ),
            ),
            !isFullscreen && frame && h('button', {
                type: 'button',
                onClick: toggleFullscreen,
                title: 'Fullscreen',
                className: 'absolute right-2 top-2 z-20 rounded-md border border-white/20 bg-black/60 px-2 py-1 text-[11px] font-medium text-white hover:bg-black/80',
            }, '⛶'),
        ),
    );
}

async function startSpectateSession(player, mutex) {
    const params = new URLSearchParams();
    params.set('mutex', mutex ?? 'current');
    params.set('netid', String(player.netid));
    if (player.license) params.set('license', player.license);

    const response = await fetch(`/player/liveSpectate/start?${params.toString()}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: getHeaders(),
        body: JSON.stringify({}),
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
        await fetch('/player/liveSpectate/stop', {
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

    return h('div', { className: 'flex h-full min-h-[480px] flex-col gap-4 p-4 lg:flex-row lg:overflow-hidden' },
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
        h('div', { className: 'flex min-h-0 flex-1 flex-col overflow-hidden lg:min-h-[calc(100vh-6rem)]' },
            activeStreams.length === 0
                ? h('div', {
                    className: 'border-border/50 flex flex-1 min-h-[320px] items-center justify-center rounded-xl border border-dashed p-6',
                },
                    h('p', { className: 'max-w-md text-center text-sm text-muted-foreground' },
                        'Wähle links Spieler aus. Je mehr Streams aktiv sind, desto kleiner werden die Kacheln im Raster.'),
                )
                : h('div', {
                    className: 'grid min-h-0 flex-1 gap-2 p-1',
                    style: (() => {
                        const { cols, rows } = getMultiStreamGridStyle(activeStreams.length);
                        return {
                            height: 'calc(100vh - 7rem)',
                            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                        };
                    })(),
                },
                    activeStreams.map((stream) => {
                        const player = players.find((entry) => entry.netid === stream.netid) || {
                            netid: stream.netid,
                            displayName: stream.displayName,
                            tags: stream.tags,
                        };
                        return h(MultiStreamTile, {
                            key: stream.netid,
                            sessionId: stream.sessionId,
                            player,
                            onStop: () => stopStream(stream),
                        });
                    }),
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
