/**
 * Bridge to fxPanel core live-spectate APIs.
 * Works even when the deployed addon-sdk is older and does not expose addon.core yet.
 */

const pendingSlot = globalThis.__TX_PENDING_ADDON__;
const ipcChannel = pendingSlot && typeof pendingSlot === 'object' ? pendingSlot.channel : null;

const pendingApiCalls = new Map();
let correlationCounter = 0;

function nextId() {
    return `wlp-core-${++correlationCounter}-${Date.now()}`;
}

function sendToCore(message) {
    if (ipcChannel) {
        ipcChannel.sendToCore(message);
        return;
    }
    if (process.send) {
        process.send(message);
        return;
    }
    throw new Error('No IPC transport available for core API calls.');
}

function handleApiCallResponse(msg) {
    if (!msg || msg.type !== 'api-call-response' || !msg.id) return;
    const pending = pendingApiCalls.get(msg.id);
    if (!pending) return;
    pendingApiCalls.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.payload?.error) {
        pending.reject(new Error(msg.payload.error));
    } else {
        pending.resolve(msg.payload?.data);
    }
}

if (ipcChannel) {
    ipcChannel.onCoreMessage(handleApiCallResponse);
} else {
    process.on('message', handleApiCallResponse);
}

function apiCall(method, args) {
    return new Promise((resolve, reject) => {
        const id = nextId();
        const timer = setTimeout(() => {
            pendingApiCalls.delete(id);
            reject(new Error(`Core API call ${method} timed out after 15000ms`));
        }, 15000);
        pendingApiCalls.set(id, { resolve, reject, timer });
        sendToCore({ type: 'api-call', id, payload: { method, args } });
    });
}

function createFallbackCore(log) {
    log?.warn?.(
        'addon.core is missing from addon-sdk — using IPC fallback. '
        + 'Update node_modules/addon-sdk from this fxPanel build for the native API.',
    );
    return {
        liveSpectateStart(params) {
            return apiCall('liveSpectate.start', [params]);
        },
        liveSpectateStop(params) {
            return apiCall('liveSpectate.stop', [params]);
        },
    };
}

export function createCoreBridge(addon) {
    if (addon.core?.liveSpectateStart && addon.core?.liveSpectateStop) {
        return addon.core;
    }
    return createFallbackCore(addon.log);
}
