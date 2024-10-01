"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.substituteEnv = substituteEnv;
exports.resolvePath = resolvePath;
exports.resolveHomeDir = resolveHomeDir;
exports.correctBinname = correctBinname;
exports.rmdirRecursive = rmdirRecursive;
exports.getTempDirPath = getTempDirPath;
exports.getTempFilePath = getTempFilePath;
exports.cleanupTempDir = cleanupTempDir;
/* eslint-disable @typescript-eslint/no-explicit-any */
var node_fs_1 = require("node:fs");
var node_os_1 = require("node:os");
var node_path_1 = require("node:path");
// From vscode-go
function substituteEnv(input) {
    return input.replace(/\${env:([^}]+)}/g, function (match, capture) {
        return process.env[capture.trim()] || '';
    });
}
/**
 * Expands ~ to homedir in non-Windows platform and resolves
 * ${workspaceFolder}, ${workspaceRoot} and ${workspaceFolderBasename}
 */
function resolvePath(inputPath, workspaceFolder) {
    if (!inputPath || !inputPath.trim()) {
        return inputPath;
    }
    // if (!workspaceFolder && vscode.workspace.workspaceFolders) {
    // 	workspaceFolder = getWorkspaceFolderPath(
    // 		vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri
    // 	);
    // }
    if (workspaceFolder) {
        inputPath = inputPath.replace(/\${workspaceFolder}|\${workspaceRoot}/g, workspaceFolder);
        inputPath = inputPath.replace(/\${workspaceFolderBasename}/g, node_path_1.default.basename(workspaceFolder));
    }
    return resolveHomeDir(inputPath);
}
/**
 * Exapnds ~ to homedir in non-Windows platform
 */
function resolveHomeDir(inputPath) {
    if (!inputPath || !inputPath.trim()) {
        return inputPath;
    }
    return inputPath.startsWith('~') ? node_path_1.default.join(node_os_1.default.homedir(), inputPath.substr(1)) : inputPath;
}
function correctBinname(toolName) {
    if (process.platform === 'win32') {
        return toolName + '.exe';
    }
    return toolName;
}
function rmdirRecursive(dir) {
    if (node_fs_1.default.existsSync(dir)) {
        node_fs_1.default.readdirSync(dir).forEach(function (file) {
            var relPath = node_path_1.default.join(dir, file);
            if (node_fs_1.default.lstatSync(relPath).isDirectory()) {
                rmdirRecursive(relPath);
            }
            else {
                try {
                    node_fs_1.default.unlinkSync(relPath);
                }
                catch (err) {
                    console.log("failed to remove ".concat(relPath, ": ").concat(err));
                }
            }
        });
        node_fs_1.default.rmdirSync(dir);
    }
}
var tmpDir;
function getTempDirPath() {
    if (!tmpDir) {
        tmpDir = node_fs_1.default.mkdtempSync(node_os_1.default.tmpdir() + node_path_1.default.sep + 'vscode-go');
    }
    if (!node_fs_1.default.existsSync(tmpDir)) {
        node_fs_1.default.mkdirSync(tmpDir);
    }
    return tmpDir;
}
/**
 * Returns file path for given name in temp dir
 * @param name Name of the file
 */
function getTempFilePath(name) {
    return node_path_1.default.normalize(node_path_1.default.join(getTempDirPath(), name));
}
function cleanupTempDir() {
    if (tmpDir) {
        rmdirRecursive(tmpDir);
    }
    tmpDir = undefined;
}
