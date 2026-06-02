export const PATCH_MARKER = 'checkWatchLiveAddonPermission';

export const LIVE_SPECTATE_START_HANDLER = '}else if(method2==="liveSpectate.start"){const[params]=args2;if(!params||typeof params!=="object"){respond(null,"invalid arguments");return}const result3=beginLiveSpectateSession(params);if(result3.error){respond(null,result3.error);return}respond(result3)}else if(method2==="liveSpectate.stop"){const[params]=args2;if(!params||typeof params!=="object"){respond(null,"invalid arguments");return}const result3=endLiveSpectateSession(params.adminName,params.sessionId);if(result3.error){respond(null,result3.error);return}respond(result3)}';

export const UNKNOWN_API_ANCHOR = '}else{respond(null,`unknown API method: ${method2}`)}';

export const CHECK_PERM_FN = 'function checkWatchLiveAddonPermission(admin,player){const PERM_WATCH="addon.addon-watch-live-perms.watch_live";const PERM_WATCH_TEAM="addon.addon-watch-live-perms.watch_live_team";if(admin.testPermission("all_permissions",modulename39))return null;const targetIsStaff=computePlayerTags(player).includes("staff");if(targetIsStaff){if(!admin.testPermission(PERM_WATCH_TEAM,modulename39))return"You do not have permission to watch team members."}else if(!admin.testPermission(PERM_WATCH,modulename39)&&!admin.testPermission(PERM_WATCH_TEAM,modulename39)){return"You do not have permission to use Watch Live."}return null}';

export const LIVE_START_BLOCK_OLD = 'async function LiveSpectateStart(ctx){if(anyUndefined(ctx.query)){return ctx.utils.error(400,"Invalid Request")}const{mutex,netid,license}=ctx.query;const sendResp=data=>ctx.send(data);if(isWatchLivePermissionsAddonActive()){return sendResp({error:"Watch Live is managed by the Watch Live Permissions addon. Use the Watch Live tab in the player modal."})}if(!ctx.admin.testPermission("players.spectate",modulename39)){return sendResp({error:"You don\'t have permission to execute this action."})}const result3=beginLiveSpectateSession({adminName:ctx.admin.name,mutex,netid,license,targetIsStaff:false});if(result3.error){return sendResp({error:result3.error})}return sendResp({sessionId:result3.sessionId})}';

export const LIVE_START_BLOCK_NEW = 'async function LiveSpectateStart(ctx){if(anyUndefined(ctx.query)){return ctx.utils.error(400,"Invalid Request")}const{mutex,netid,license}=ctx.query;const sendResp=data=>ctx.send(data);let player;try{const refMutex=mutex==="current"?SYM_CURRENT_MUTEX:mutex;player=playerResolver_default(refMutex,parseInt(netid),license)}catch(error49){return sendResp({error:emsg(error49)})}if(!(player instanceof ServerPlayer)||!player.isConnected){return sendResp({error:"This player is not connected to the server."})}if(isWatchLivePermissionsAddonActive()){const permError=checkWatchLiveAddonPermission(ctx.admin,player);if(permError)return sendResp({error:permError});const targetIsStaff=computePlayerTags(player).includes("staff");const result3=beginLiveSpectateSession({adminName:ctx.admin.name,mutex,netid,license,targetIsStaff,startActionId:targetIsStaff?"addon.addon-watch-live-perms.live_spectate.start.team":"addon.addon-watch-live-perms.live_spectate.start",startMessage:targetIsStaff?`Started Watch Live for team member [#${player.netid}] ${player.displayName}.`:`Started Watch Live for [#${player.netid}] ${player.displayName}.`});if(result3.error)return sendResp({error:result3.error});return sendResp({sessionId:result3.sessionId})}if(!ctx.admin.testPermission("players.spectate",modulename39)){return sendResp({error:"You don\'t have permission to execute this action."})}const result3=beginLiveSpectateSession({adminName:ctx.admin.name,mutex,netid,license,targetIsStaff:false});if(result3.error){return sendResp({error:result3.error})}return sendResp({sessionId:result3.sessionId})}';

export const LIVE_STOP_BLOCK_OLD = 'async function LiveSpectateStop(ctx){const{sessionId}=ctx.request.body;const sendResp=data=>ctx.send(data);if(isWatchLivePermissionsAddonActive()){return sendResp({error:"Watch Live is managed by the Watch Live Permissions addon."})}if(typeof sessionId!=="string"){return sendResp({error:"Invalid session ID."})}if(!ctx.admin.testPermission("players.spectate",modulename39)){return sendResp({error:"You don\'t have permission to execute this action."})}const result3=endLiveSpectateSession(ctx.admin.name,sessionId);if(result3.error){return sendResp({error:result3.error})}return sendResp({success:true})}';

export const LIVE_STOP_BLOCK_NEW = 'async function LiveSpectateStop(ctx){const{sessionId}=ctx.request.body;const sendResp=data=>ctx.send(data);if(typeof sessionId!=="string"){return sendResp({error:"Invalid session ID."})}if(isWatchLivePermissionsAddonActive()){const PERM_WATCH="addon.addon-watch-live-perms.watch_live";const PERM_WATCH_TEAM="addon.addon-watch-live-perms.watch_live_team";if(!ctx.admin.testPermission("all_permissions",modulename39)&&!ctx.admin.testPermission(PERM_WATCH,modulename39)&&!ctx.admin.testPermission(PERM_WATCH_TEAM,modulename39)){return sendResp({error:"You do not have permission to use Watch Live."})}}else if(!ctx.admin.testPermission("players.spectate",modulename39)){return sendResp({error:"You don\'t have permission to execute this action."})}const result3=endLiveSpectateSession(ctx.admin.name,sessionId);if(result3.error){return sendResp({error:result3.error})}return sendResp({success:true})}';

export const JOIN_SPECTATE_OLD = 'socket.on("joinSpectate",sessionId=>{if(typeof sessionId!=="string")return;if(!authedAdmin.hasPermission("players.spectate"))return;socket.join(`spectate:${sessionId}`)});';

export const JOIN_SPECTATE_NEW = 'socket.on("joinSpectate",sessionId=>{if(typeof sessionId!=="string")return;const canSpectate=authedAdmin.hasPermission("players.spectate")||authedAdmin.hasPermission("all_permissions")||(isWatchLivePermissionsAddonActive()&&(authedAdmin.hasPermission("addon.addon-watch-live-perms.watch_live")||authedAdmin.hasPermission("addon.addon-watch-live-perms.watch_live_team")));if(!canSpectate)return;socket.join(`spectate:${sessionId}`)});';

export function needsCorePatch(content) {
    return !content.includes(PATCH_MARKER)
        || content.includes('Watch Live is managed by the Watch Live Permissions addon. Use the Watch Live tab')
        || content.includes('if(!authedAdmin.hasPermission("players.spectate"))return;socket.join(`spectate:${sessionId}`)');
}

export function patchCoreIndex(content) {
    let next = content;

    if (!next.includes(PATCH_MARKER)) {
        const permAnchor = 'async function LiveSpectateStart(ctx)';
        if (!next.includes(permAnchor)) {
            throw new Error('Could not find LiveSpectateStart in core/index.js');
        }
        next = next.replace(permAnchor, `${CHECK_PERM_FN}${permAnchor}`);
    }

    if (next.includes('Watch Live is managed by the Watch Live Permissions addon. Use the Watch Live tab')) {
        if (!next.includes(LIVE_START_BLOCK_OLD)) {
            throw new Error('Could not find legacy LiveSpectateStart block in core/index.js');
        }
        next = next.replace(LIVE_START_BLOCK_OLD, LIVE_START_BLOCK_NEW);
    }

    if (next.includes('Watch Live is managed by the Watch Live Permissions addon."})}if(typeof sessionId')) {
        next = next.replace(LIVE_STOP_BLOCK_OLD, LIVE_STOP_BLOCK_NEW);
    }

    if (next.includes(JOIN_SPECTATE_OLD)) {
        next = next.replace(JOIN_SPECTATE_OLD, JOIN_SPECTATE_NEW);
    }

    if (!next.includes('method2==="liveSpectate.start"') && next.includes(UNKNOWN_API_ANCHOR)) {
        if (!next.includes('function beginLiveSpectateSession(')) {
            throw new Error('core/index.js has no beginLiveSpectateSession');
        }
        next = next.replace(UNKNOWN_API_ANCHOR, `${LIVE_SPECTATE_START_HANDLER}${UNKNOWN_API_ANCHOR}`);
    }

    if (!next.includes('var WATCH_LIVE_PERMS_ADDON_ID="addon-watch-live-perms"')) {
        const liveSpectateAnchor = 'var modulename39="WebServer:LiveSpectate";';
        if (!next.includes(liveSpectateAnchor)) {
            throw new Error('Could not find LiveSpectate module anchor in core/index.js');
        }
        const watchLiveHelper = 'var WATCH_LIVE_PERMS_ADDON_ID="addon-watch-live-perms";var isWatchLivePermissionsAddonActive=()=>{var _a3;const addon=(_a3=txCore.addonManager)==null?void 0:_a3.addons.get(WATCH_LIVE_PERMS_ADDON_ID);return(addon==null?void 0:addon.state)==="running"};';
        next = next.replace(liveSpectateAnchor, `${watchLiveHelper}${liveSpectateAnchor}`);
    }

    return next;
}
