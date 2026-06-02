import { promises as fs } from 'node:fs';
import path from 'node:path';
import { needsCorePatch, patchCoreIndex } from '../shared/corePatch.js';

const PATCH_MARKER = 'watch-live-perms-core-patched';

async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
}

async function backupFile(backupRoot, monitorRoot, relativePath) {
    const sourcePath = path.join(monitorRoot, relativePath);
    const backupPath = path.join(backupRoot, relativePath);
    await ensureDir(path.dirname(backupPath));

    try {
        await fs.access(backupPath);
        return;
    } catch {
        // no backup yet
    }

    try {
        await fs.copyFile(sourcePath, backupPath);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

export async function applyWatchLiveCorePatch(addonDir) {
    const monitorRoot = path.resolve(addonDir, '../..');
    const backupRoot = path.join(addonDir, '.backups');
    const relativePath = 'core/index.js';
    const filePath = path.join(monitorRoot, relativePath);

    let content;
    try {
        content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { monitorRoot, status: 'missing', relativePath };
        }
        throw error;
    }

    if (!needsCorePatch(content)) {
        return { monitorRoot, status: 'unchanged', relativePath };
    }

    const nextContent = patchCoreIndex(content);
    if (nextContent === content) {
        return { monitorRoot, status: 'unchanged', relativePath };
    }

    await backupFile(backupRoot, monitorRoot, relativePath);
    await fs.writeFile(filePath, nextContent, 'utf8');
    await ensureDir(path.join(addonDir, '.runtime'));
    await fs.writeFile(
        path.join(addonDir, '.runtime', PATCH_MARKER),
        `${new Date().toISOString()}\n`,
        'utf8',
    );

    return { monitorRoot, status: 'patched', relativePath };
}
