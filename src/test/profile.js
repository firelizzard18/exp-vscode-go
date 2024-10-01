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
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var _ProfileDocument_instances, _a, _ProfileDocument_active, _ProfileDocument_provider, _ProfileDocument_server, _ProfileDocument_proc, _ProfileDocument_subscriptions, _ProfileDocument_hovered, _ProfileDocument_panel, _ProfileDocument_postMessage, _ProfileDocument_didReceiveMessage, _ProfileEditorProvider_ext, _ProfileEditorProvider_go;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileEditorProvider = exports.CapturedProfile = exports.ProfileSet = exports.ProfileContainer = exports.ProfileType = void 0;
exports.registerProfileEditor = registerProfileEditor;
exports.makeProfileTypeSet = makeProfileTypeSet;
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
var node_crypto_1 = require("node:crypto");
var vscode_1 = require("vscode");
var node_child_process_1 = require("node:child_process");
var util_1 = require("../utils/util");
var processUtils_1 = require("../utils/processUtils");
var testing_1 = require("./testing");
var moment_1 = require("moment");
function registerProfileEditor(ctx, testCtx) {
    return __awaiter(this, void 0, void 0, function () {
        var command, provider;
        return __generator(this, function (_b) {
            command = function (name, fn) {
                ctx.subscriptions.push(vscode_1.commands.registerCommand(name, function () {
                    var args = [];
                    for (var _i = 0; _i < arguments.length; _i++) {
                        args[_i] = arguments[_i];
                    }
                    return (0, testing_1.doSafe)(testCtx, "executing ".concat(name), function () { return fn.apply(void 0, args); });
                }));
            };
            provider = new ProfileEditorProvider(ctx, testCtx.go);
            ctx.subscriptions.push(vscode_1.window.registerCustomEditorProvider('goExp.pprof', provider));
            // [Command] Show source
            command('goExp.pprof.showSource', function () { var _b; return (_b = ProfileDocument.active) === null || _b === void 0 ? void 0 : _b.showSource(); });
            // [Command] Ignore function
            command('goExp.pprof.ignore', function () { var _b; return (_b = ProfileDocument.active) === null || _b === void 0 ? void 0 : _b.ignoreFunc(); });
            return [2 /*return*/];
        });
    });
}
var ProfileType = /** @class */ (function () {
    function ProfileType(id, label, description) {
        this.id = id;
        this.label = label;
        this.description = description;
        this.enabled = false;
        this.picked = false;
    }
    return ProfileType;
}());
exports.ProfileType = ProfileType;
function makeProfileTypeSet() {
    return [
        new ProfileType('cpu', 'CPU', 'Profile CPU usage'),
        new ProfileType('mem', 'Memory', 'Profile memory usage'),
        new ProfileType('mutex', 'Mutexes', 'Profile mutex contention'),
        new ProfileType('block', 'Blocking', 'Profile blocking events'),
    ];
}
var ProfileContainer = /** @class */ (function () {
    function ProfileContainer(parent) {
        this.kind = 'profile-container';
        this.label = 'Profiles';
        this.profiles = new Map();
        this.parent = parent;
    }
    Object.defineProperty(ProfileContainer.prototype, "hasChildren", {
        get: function () {
            return this.getChildren().length > 0;
        },
        enumerable: false,
        configurable: true
    });
    ProfileContainer.prototype.getParent = function () {
        return this.parent;
    };
    ProfileContainer.prototype.getChildren = function () {
        return __spreadArray([], this.profiles.values(), true).filter(function (x) { return x.hasChildren; });
    };
    ProfileContainer.prototype.addProfile = function (dir, type, time) {
        return __awaiter(this, void 0, void 0, function () {
            var set, profile;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        set = this.profiles.get(time.getTime());
                        if (!set) {
                            set = new ProfileSet(this, time);
                            this.profiles.set(time.getTime(), set);
                        }
                        return [4 /*yield*/, CapturedProfile.new(set, dir, type, time)];
                    case 1:
                        profile = _b.sent();
                        set.profiles.add(profile);
                        return [2 /*return*/, profile];
                }
            });
        });
    };
    ProfileContainer.prototype.removeProfile = function (profile) {
        this.profiles.forEach(function (x) { return x.profiles.delete(profile); });
    };
    return ProfileContainer;
}());
exports.ProfileContainer = ProfileContainer;
var ProfileSet = /** @class */ (function () {
    function ProfileSet(parent, time) {
        this.kind = 'profile-set';
        this.profiles = new Set();
        this.parent = parent;
        this.time = time;
    }
    Object.defineProperty(ProfileSet.prototype, "label", {
        get: function () {
            var now = new Date();
            if (now.getFullYear() !== this.time.getFullYear()) {
                return (0, moment_1.default)(this.time).format('YYYY-MM-DD HH:mm:ss');
            }
            if (now.getMonth() !== this.time.getMonth() || now.getDate() !== this.time.getDate()) {
                return (0, moment_1.default)(this.time).format('MM-DD HH:mm:ss');
            }
            return (0, moment_1.default)(this.time).format('HH:mm:ss');
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ProfileSet.prototype, "hasChildren", {
        get: function () {
            return this.profiles.size > 0;
        },
        enumerable: false,
        configurable: true
    });
    ProfileSet.prototype.getParent = function () {
        return this.parent;
    };
    ProfileSet.prototype.getChildren = function () {
        return __spreadArray([], this.profiles, true);
    };
    return ProfileSet;
}());
exports.ProfileSet = ProfileSet;
/**
 * Represents a captured profile.
 */
var CapturedProfile = /** @class */ (function () {
    function CapturedProfile(parent, type, file, uri) {
        this.kind = 'profile';
        this.hasChildren = false;
        this.type = type;
        this.parent = parent;
        this.file = file;
        this.uri = uri;
    }
    /**
     * Returns the storage directory for the captured profile. If the test run
     * is persisted and supports onDidDispose, it returns the extensions's
     * storage URI. Otherwise, it returns an OS temp directory path.
     *
     * @param context - The context object.
     * @param run - The test run object.
     * @returns The storage directory URI.
     */
    CapturedProfile.storageDir = function (context, run) {
        // Profiles can be deleted when the run is disposed, but there's no way
        // to re-associated profiles with a past run when VSCode is closed and
        // reopened. So we always use the temp directory for now.
        // https://github.com/microsoft/vscode/issues/227924
        // if (run.isPersisted && run.onDidDispose && context.storageUri) {
        // 	return context.storageUri;
        // }
        return vscode_1.Uri.file((0, util_1.getTempDirPath)());
    };
    CapturedProfile.new = function (parent, dir, type, time) {
        return __awaiter(this, void 0, void 0, function () {
            var hash, file, uri;
            return __generator(this, function (_b) {
                hash = (0, node_crypto_1.createHash)('sha256').update("".concat(parent.parent.parent.uri)).digest('hex').substring(0, 16);
                file = vscode_1.Uri.joinPath(dir, "".concat(hash, "-").concat(type.id, "-").concat(time.getTime(), ".pprof"));
                uri = file;
                return [2 /*return*/, new this(parent, type, file, uri)];
            });
        });
    };
    Object.defineProperty(CapturedProfile.prototype, "key", {
        get: function () {
            return "".concat(this.uri);
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(CapturedProfile.prototype, "label", {
        get: function () {
            return this.type.label;
        },
        enumerable: false,
        configurable: true
    });
    CapturedProfile.prototype.getParent = function () {
        return this.parent;
    };
    CapturedProfile.prototype.getChildren = function () {
        return [];
    };
    return CapturedProfile;
}());
exports.CapturedProfile = CapturedProfile;
var nbsp = '\u00A0';
var ProfileDocument = /** @class */ (function () {
    function ProfileDocument(provider, uri, proc, server) {
        _ProfileDocument_instances.add(this);
        _ProfileDocument_provider.set(this, void 0);
        _ProfileDocument_server.set(this, void 0);
        _ProfileDocument_proc.set(this, void 0);
        _ProfileDocument_subscriptions.set(this, []);
        _ProfileDocument_hovered.set(this, { event: 'hovered' });
        _ProfileDocument_panel.set(this, void 0);
        __classPrivateFieldSet(this, _ProfileDocument_provider, provider, "f");
        this.uri = uri;
        __classPrivateFieldSet(this, _ProfileDocument_proc, proc, "f");
        __classPrivateFieldSet(this, _ProfileDocument_server, server, "f");
    }
    Object.defineProperty(ProfileDocument, "active", {
        get: function () {
            return __classPrivateFieldGet(this, _a, "f", _ProfileDocument_active);
        },
        enumerable: false,
        configurable: true
    });
    ProfileDocument.prototype.dispose = function () {
        (0, processUtils_1.killProcessTree)(__classPrivateFieldGet(this, _ProfileDocument_proc, "f"));
        __classPrivateFieldGet(this, _ProfileDocument_subscriptions, "f").forEach(function (x) { return x.dispose(); });
    };
    ProfileDocument.prototype.resolve = function (panel) {
        var _this = this;
        __classPrivateFieldSet(_a, _a, this, "f", _ProfileDocument_active);
        __classPrivateFieldSet(this, _ProfileDocument_panel, panel, "f");
        panel.onDidChangeViewState(function (e) {
            if (e.webviewPanel.active) {
                __classPrivateFieldSet(_a, _a, _this, "f", _ProfileDocument_active);
            }
            else if (__classPrivateFieldGet(_a, _a, "f", _ProfileDocument_active) === _this) {
                __classPrivateFieldSet(_a, _a, undefined, "f", _ProfileDocument_active);
            }
        }, null, __classPrivateFieldGet(this, _ProfileDocument_subscriptions, "f"));
        panel.webview.options = { enableScripts: true, enableCommandUris: true };
        panel.webview.onDidReceiveMessage(function (x) {
            if (!x || typeof x !== 'object')
                return;
            if (!('event' in x || 'command' in x))
                return;
            __classPrivateFieldGet(_this, _ProfileDocument_instances, "m", _ProfileDocument_didReceiveMessage).call(_this, x);
        }, null, __classPrivateFieldGet(this, _ProfileDocument_subscriptions, "f"));
        panel.webview.html = "\n\t\t\t<!DOCTYPE html>\n\t\t\t<html lang=\"en\">\n\t\t\t\t<head>\n\t\t\t\t\t<meta charset=\"UTF-8\">\n\t\t\t\t\t<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n\t\t\t\t\t<title>Profile Custom Editor</title>\n\t\t\t\t\t<link href=\"".concat(__classPrivateFieldGet(this, _ProfileDocument_provider, "f").uriFor(panel, 'pprof.css'), "\" rel=\"stylesheet\">\n\t\t\t\t\t<script id=\"profile-data\" type=\"application/json\" src=\"").concat(__classPrivateFieldGet(this, _ProfileDocument_server, "f"), "\"></script>\n\t\t\t\t</head>\n\t\t\t\t<body>\n\t\t\t\t\t<script src=\"").concat(__classPrivateFieldGet(this, _ProfileDocument_provider, "f").uriFor(panel, 'pprof.js'), "\"></script>\n\t\t\t\t</body>\n\t\t\t</html>\n\t\t");
    };
    ProfileDocument.prototype.showSource = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _b, func, lines, range, doc, editor, valueWidth, unitWidth, ratioWidth, fullWidth, lastLine, empty, _i, lines_1, line;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _b = __classPrivateFieldGet(this, _ProfileDocument_hovered, "f"), func = _b.func, lines = _b.lines;
                        if (!func)
                            return [2 /*return*/];
                        range = new vscode_1.Range(func.line - 1, 0, func.line - 1, 0);
                        return [4 /*yield*/, vscode_1.workspace.openTextDocument(func.file)];
                    case 1:
                        doc = _c.sent();
                        return [4 /*yield*/, vscode_1.window.showTextDocument(doc, {
                                preview: true,
                                selection: range,
                            })];
                    case 2:
                        editor = _c.sent();
                        if (!lines)
                            return [2 /*return*/];
                        valueWidth = Math.max.apply(Math, lines.map(function (_b) {
                            var value = _b.value;
                            return value.length;
                        }));
                        unitWidth = Math.max.apply(Math, lines.map(function (_b) {
                            var unit = _b.unit;
                            return unit.length;
                        }));
                        ratioWidth = Math.max.apply(Math, lines.map(function (_b) {
                            var ratio = _b.ratio;
                            return ratio.length + 3;
                        }));
                        fullWidth = valueWidth + 1 + unitWidth + 1 + ratioWidth + 1;
                        editor.setDecorations(__classPrivateFieldGet(this, _ProfileDocument_provider, "f").decoration, lines.map(function (_b) {
                            var line = _b.line, value = _b.value, unit = _b.unit, ratio = _b.ratio;
                            var valueStr = value.padStart(valueWidth, nbsp);
                            var unitStr = unit.padStart(unitWidth + 1, nbsp);
                            var ratioStr = "(".concat(ratio, "%)").padStart(ratioWidth + 1, nbsp);
                            return {
                                range: new vscode_1.Range(line, 0, line, 0),
                                renderOptions: {
                                    before: {
                                        contentText: "".concat(valueStr).concat(unitStr).concat(ratioStr),
                                        width: "".concat(fullWidth, "ch"),
                                        color: 'rgba(153, 153, 153, 0.65)',
                                    },
                                },
                            };
                        }));
                        lastLine = 0;
                        empty = [];
                        for (_i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
                            line = lines_1[_i].line;
                            for (; lastLine < line; lastLine++) {
                                empty.push(lastLine);
                            }
                            lastLine = line + 1;
                        }
                        for (; lastLine < doc.lineCount; lastLine++) {
                            empty.push(lastLine);
                        }
                        editor.setDecorations(__classPrivateFieldGet(this, _ProfileDocument_provider, "f").emptyDecoration, empty.map(function (line) { return ({
                            range: new vscode_1.Range(line, 0, line, 0),
                            renderOptions: { before: { contentText: '', width: "".concat(fullWidth, "ch") } },
                        }); }));
                        return [2 /*return*/];
                }
            });
        });
    };
    ProfileDocument.prototype.ignoreFunc = function () {
        return __awaiter(this, void 0, void 0, function () {
            var func;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        func = __classPrivateFieldGet(this, _ProfileDocument_hovered, "f").func;
                        if (!func)
                            return [2 /*return*/];
                        return [4 /*yield*/, __classPrivateFieldGet(this, _ProfileDocument_instances, "m", _ProfileDocument_postMessage).call(this, { command: 'ignore-func', func: func })];
                    case 1:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    return ProfileDocument;
}());
_a = ProfileDocument, _ProfileDocument_provider = new WeakMap(), _ProfileDocument_server = new WeakMap(), _ProfileDocument_proc = new WeakMap(), _ProfileDocument_subscriptions = new WeakMap(), _ProfileDocument_hovered = new WeakMap(), _ProfileDocument_panel = new WeakMap(), _ProfileDocument_instances = new WeakSet(), _ProfileDocument_postMessage = function _ProfileDocument_postMessage(message) {
    return __awaiter(this, void 0, void 0, function () {
        var ok;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, ((_b = __classPrivateFieldGet(this, _ProfileDocument_panel, "f")) === null || _b === void 0 ? void 0 : _b.webview.postMessage(message))];
                case 1:
                    ok = _c.sent();
                    if (!ok)
                        console.error('Failed to post message');
                    return [2 /*return*/];
            }
        });
    });
}, _ProfileDocument_didReceiveMessage = function _ProfileDocument_didReceiveMessage(message) {
    var _this = this;
    if (!('event' in message))
        return;
    switch (message.event) {
        case 'hovered':
            __classPrivateFieldSet(this, _ProfileDocument_hovered, message, "f");
            break;
        case 'action': {
            var action_1 = message.action, label = message.label;
            __classPrivateFieldGet(this, _ProfileDocument_provider, "f").didChange.fire({
                document: this,
                label: label,
                undo: function () { return __classPrivateFieldGet(_this, _ProfileDocument_instances, "m", _ProfileDocument_postMessage).call(_this, { command: 'undo', action: action_1 }); },
                redo: function () { return __classPrivateFieldGet(_this, _ProfileDocument_instances, "m", _ProfileDocument_postMessage).call(_this, { command: 'redo', action: action_1 }); },
            });
            break;
        }
    }
};
_ProfileDocument_active = { value: void 0 };
var ProfileEditorProvider = /** @class */ (function () {
    function ProfileEditorProvider(ext, go) {
        _ProfileEditorProvider_ext.set(this, void 0);
        _ProfileEditorProvider_go.set(this, void 0);
        this.didChange = new vscode_1.EventEmitter();
        this.onDidChangeCustomDocument = this.didChange.event;
        __classPrivateFieldSet(this, _ProfileEditorProvider_ext, ext, "f");
        __classPrivateFieldSet(this, _ProfileEditorProvider_go, go, "f");
        this.decoration = vscode_1.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            isWholeLine: true,
        });
        this.emptyDecoration = vscode_1.window.createTextEditorDecorationType({});
        ext.subscriptions.push(this.decoration);
    }
    ProfileEditorProvider.prototype.saveCustomDocument = function (document, cancellation) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_b) {
                return [2 /*return*/];
            });
        });
    };
    ProfileEditorProvider.prototype.saveCustomDocumentAs = function (document, destination, cancellation) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, vscode_1.workspace.fs.copy(document.uri, destination)];
                    case 1:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    ProfileEditorProvider.prototype.revertCustomDocument = function (document, cancellation) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_b) {
                return [2 /*return*/];
            });
        });
    };
    ProfileEditorProvider.prototype.backupCustomDocument = function (document, context, cancellation) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_b) {
                // Nothing to do
                return [2 /*return*/, {
                        id: "".concat(document.uri),
                        delete: function () { },
                    }];
            });
        });
    };
    ProfileEditorProvider.prototype.uriFor = function (panel, path) {
        return panel.webview.asWebviewUri(vscode_1.Uri.joinPath(__classPrivateFieldGet(this, _ProfileEditorProvider_ext, "f").extensionUri, 'dist', path));
    };
    ProfileEditorProvider.prototype.openCustomDocument = function (uri, context, token) {
        return __awaiter(this, void 0, void 0, function () {
            var binPath, proc, server;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        binPath = (__classPrivateFieldGet(this, _ProfileEditorProvider_go, "f").settings.getExecutionCommand('vscgo') || {}).binPath;
                        if (!binPath) {
                            throw new Error('Cannot locate vscgo');
                        }
                        proc = (0, node_child_process_1.spawn)(binPath, ['serve-pprof', ':', uri.fsPath]);
                        token.onCancellationRequested(function () { return (0, processUtils_1.killProcessTree)(proc); });
                        return [4 /*yield*/, new Promise(function (resolve, reject) {
                                proc.on('error', function (err) { return reject(err); });
                                proc.on('exit', function (code, signal) { return reject(signal || code); });
                                var stdout = '';
                                function capture(b) {
                                    stdout += b.toString('utf-8');
                                    if (!stdout.includes('\n'))
                                        return;
                                    try {
                                        var _b = JSON.parse(stdout).Listen, IP = _b.IP, Port = _b.Port;
                                        resolve("http://".concat(IP.includes(':') ? "[".concat(IP, "]") : IP, ":").concat(Port));
                                    }
                                    catch (error) {
                                        (0, processUtils_1.killProcessTree)(proc);
                                        reject(error);
                                    }
                                    proc.stdout.off('data', capture);
                                }
                                proc.stdout.on('data', capture);
                            })];
                    case 1:
                        server = _b.sent();
                        return [2 /*return*/, new ProfileDocument(this, uri, proc, server)];
                }
            });
        });
    };
    ProfileEditorProvider.prototype.resolveCustomEditor = function (document, panel, token) {
        document.resolve(panel);
    };
    return ProfileEditorProvider;
}());
exports.ProfileEditorProvider = ProfileEditorProvider;
_ProfileEditorProvider_ext = new WeakMap(), _ProfileEditorProvider_go = new WeakMap();
