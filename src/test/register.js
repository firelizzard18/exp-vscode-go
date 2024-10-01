"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTestingFeatures = registerTestingFeatures;
/* eslint-disable @typescript-eslint/no-explicit-any */
var vscode_1 = require("vscode");
var testing_1 = require("./testing");
var utils_1 = require("./utils");
var manager_1 = require("./manager");
var vscode_2 = require("vscode");
var browser_1 = require("../browser");
var profile_1 = require("./profile");
function registerTestingFeatures(ctx, go) {
    return __awaiter(this, void 0, void 0, function () {
        var testCtx;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    testCtx = {
                        workspace: vscode_1.workspace,
                        go: go,
                        spawn: utils_1.spawnProcess,
                        debug: utils_1.debugProcess,
                        testing: ctx.extensionMode === vscode_1.ExtensionMode.Test,
                        state: ctx.workspaceState,
                        storageUri: ctx.storageUri,
                        output: vscode_1.window.createOutputChannel('Go Tests (experimental)', { log: true }),
                        commands: {
                            modules: function (args) { return vscode_1.commands.executeCommand('gopls.modules', args); },
                            packages: function (args) { return vscode_1.commands.executeCommand('gopls.packages', args); },
                        },
                    };
                    return [4 /*yield*/, registerTestController(ctx, testCtx)];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, (0, profile_1.registerProfileEditor)(ctx, testCtx)];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function registerTestController(ctx, testCtx) {
    return __awaiter(this, void 0, void 0, function () {
        var event, command, manager, setup, watcher;
        var _this = this;
        return __generator(this, function (_a) {
            event = function (event, msg, fn) {
                ctx.subscriptions.push(event(function (e) { return (0, testing_1.doSafe)(testCtx, msg, function () { return fn(e); }); }));
            };
            command = function (name, fn) {
                ctx.subscriptions.push(vscode_1.commands.registerCommand(name, function () {
                    var args = [];
                    for (var _i = 0; _i < arguments.length; _i++) {
                        args[_i] = arguments[_i];
                    }
                    return (0, testing_1.doSafe)(testCtx, "executing ".concat(name), function () { return fn.apply(void 0, args); });
                }));
            };
            manager = new manager_1.TestManager(testCtx);
            setup = function () {
                manager.setup({
                    createTestController: vscode_1.tests.createTestController,
                    registerCodeLensProvider: vscode_2.languages.registerCodeLensProvider,
                    showQuickPick: vscode_1.window.showQuickPick,
                });
                vscode_1.window.visibleTextEditors.forEach(function (x) { return manager.reloadUri(x.document.uri); });
            };
            ctx.subscriptions.push(manager);
            // [Command] Refresh
            command('goExp.testExplorer.refresh', function (item) { return manager.enabled && manager.reloadViewItem(item); });
            // [Command] Run Test, Debug Test
            command('goExp.test.run', function (item) { return manager.enabled && manager.runTest(item); });
            command('goExp.test.debug', function (item) { return manager.enabled && manager.debugTest(item); });
            // [Command] Browser navigation
            command('goExp.browser.back', function () { var _a; return (_a = browser_1.Browser.active) === null || _a === void 0 ? void 0 : _a.back(); });
            command('goExp.browser.refresh', function () { var _a; return (_a = browser_1.Browser.active) === null || _a === void 0 ? void 0 : _a.reload(); });
            command('goExp.browser.forward', function () { var _a; return (_a = browser_1.Browser.active) === null || _a === void 0 ? void 0 : _a.forward(); });
            // [Event] Configuration change
            event(vscode_1.workspace.onDidChangeConfiguration, 'changed configuration', function (e) { return __awaiter(_this, void 0, void 0, function () {
                var enabled;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (e.affectsConfiguration('goExp.testExplorer.enable')) {
                                enabled = vscode_1.workspace.getConfiguration('goExp').get('testExplorer.enable');
                                if (enabled === manager.enabled) {
                                    return [2 /*return*/];
                                }
                                if (enabled) {
                                    setup();
                                }
                                else {
                                    manager.dispose();
                                }
                            }
                            if (!manager.enabled) {
                                return [2 /*return*/];
                            }
                            if (!(e.affectsConfiguration('files.exclude') ||
                                e.affectsConfiguration('goExp.testExplorer.exclude') ||
                                e.affectsConfiguration('goExp.testExplorer.discovery') ||
                                e.affectsConfiguration('goExp.testExplorer.showFiles') ||
                                e.affectsConfiguration('goExp.testExplorer.nestPackages') ||
                                e.affectsConfiguration('goExp.testExplorer.nestSubtests'))) return [3 /*break*/, 2];
                            return [4 /*yield*/, manager.reloadView()];
                        case 1:
                            _a.sent();
                            _a.label = 2;
                        case 2: return [2 /*return*/];
                    }
                });
            }); });
            // [Event] File open
            event(vscode_1.workspace.onDidOpenTextDocument, 'opened document', function (e) { return manager.enabled && manager.reloadUri(e.uri); });
            // [Event] File change
            event(vscode_1.workspace.onDidChangeTextDocument, 'updated document', function (e) {
                if (!manager.enabled) {
                    return;
                }
                // Ignore events that don't include changes. I don't know what
                // conditions trigger this, but we only care about actual changes.
                if (e.contentChanges.length === 0) {
                    return;
                }
                manager.reloadUri(e.document.uri, e.contentChanges.map(function (x) { return x.range; }), true);
            });
            // [Event] File save
            event(vscode_1.workspace.onDidSaveTextDocument, 'saved document', function (e) { return manager.enabled && manager.didSave(e.uri); });
            // [Event] Workspace change
            event(vscode_1.workspace.onDidChangeWorkspaceFolders, 'changed workspace', function () { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/, manager.enabled && manager.reloadView()];
            }); }); });
            watcher = vscode_1.workspace.createFileSystemWatcher('**/*_test.go', false, true, false);
            ctx.subscriptions.push(watcher);
            event(watcher.onDidCreate, 'created file', function (e) { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/, manager.enabled && manager.reloadUri(e)];
            }); }); });
            event(watcher.onDidDelete, 'deleted file', function (e) { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/, manager.enabled && manager.reloadUri(e)];
            }); }); });
            // Setup the controller (if enabled)
            if (vscode_1.workspace.getConfiguration('goExp').get('testExplorer.enable')) {
                setup();
            }
            return [2 /*return*/];
        });
    });
}
