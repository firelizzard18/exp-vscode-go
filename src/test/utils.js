"use strict";
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------
 * Copyright 2020 The Go Authors. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawnProcess = spawnProcess;
exports.debugProcess = debugProcess;
exports.flags2args = flags2args;
var child_process_1 = require("child_process");
var lineBuffer_1 = require("../utils/lineBuffer");
var vscode_1 = require("vscode");
var processUtils_1 = require("../utils/processUtils");
function spawnProcess(context, scope, flags, options) {
    return new Promise(function (resolve) {
        var stdout = options.stdout, stderr = options.stderr, cancel = options.cancel, rest = __rest(options, ["stdout", "stderr", "cancel"]);
        if (cancel.isCancellationRequested) {
            resolve();
            return;
        }
        var binPath = (context.go.settings.getExecutionCommand('go', scope) || {}).binPath;
        if (!binPath) {
            throw new Error('Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH');
        }
        var outbuf = new lineBuffer_1.LineBuffer();
        outbuf.onLine(stdout);
        outbuf.onDone(function (x) { return x && stdout(x); });
        var errbuf = new lineBuffer_1.LineBuffer();
        errbuf.onLine(stderr);
        errbuf.onDone(function (x) { return x && stderr(x); });
        flags.json = true;
        var tp = child_process_1.default.spawn(binPath, __spreadArray(['test'], flags2args(flags), true), __assign(__assign({}, rest), { stdio: 'pipe' }));
        cancel.onCancellationRequested(function () {
            (0, processUtils_1.killProcessTree)(tp);
        });
        tp.stdout.on('data', function (chunk) { return outbuf.append(chunk.toString('utf-8')); });
        tp.stderr.on('data', function (chunk) { return errbuf.append(chunk.toString('utf-8')); });
        tp.on('close', function (code, signal) {
            outbuf.done();
            errbuf.done();
            resolve({ code: code, signal: signal });
        });
    });
}
var debugSessionID = 0;
var debugSessionOutput = new Map();
vscode_1.debug === null || vscode_1.debug === void 0 ? void 0 : vscode_1.debug.registerDebugAdapterTrackerFactory('go', {
    createDebugAdapterTracker: function (s) {
        if (s.type !== 'go')
            return;
        var opts = debugSessionOutput.get(s.configuration.sessionID);
        if (!opts)
            return;
        return {
            onDidSendMessage: function (msg) {
                if (msg.type !== 'event')
                    return;
                if (msg.event !== 'output')
                    return;
                if (msg.body.category === 'stdout') {
                    opts.stdout(msg.body.output);
                }
                else {
                    opts.stderr(msg.body.output);
                }
            },
        };
    },
});
/**
 * Spawns a debug session with the given flags.
 *
 * VSCode does not provide a mechanism to capture the output of a debug session.
 * So instead of something clean like `debugSession.output`, we have to use a
 * debug adapter tracker to capture events and then pipe them to the caller.
 * However, we may be able to work around this issue by asking delve to copy the
 * test output to a secondary stream, or by using custom events.
 *
 * As an additional complication, delve does not have an equivalent to `go test
 * -json` so we have to pipe the output to `go tool test2json` to parse it.
 *
 * @see https://github.com/microsoft/vscode/issues/104208
 * @see https://github.com/microsoft/vscode/issues/108145
 */
function debugProcess(ctx, scope, flags, options) {
    return __awaiter(this, void 0, void 0, function () {
        var run, cancel, cwd, env, stdout, stderr, binPath, id, subs, event, didStart, didStop, outbuf, proc, flagArgs, buildFlags, _i, _a, _b, flag, value, ws, config;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    run = options.run, cancel = options.cancel, cwd = options.cwd, env = options.env, stdout = options.stdout, stderr = options.stderr;
                    if (cancel.isCancellationRequested) {
                        return [2 /*return*/, Promise.resolve()];
                    }
                    binPath = (ctx.go.settings.getExecutionCommand('go', scope) || {}).binPath;
                    if (!binPath) {
                        throw new Error('Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH');
                    }
                    id = "debug #".concat(debugSessionID++);
                    subs = [];
                    event = function (event, fn) {
                        subs.push(event(function (e) { return fn(e); }));
                    };
                    didStart = new Promise(function (resolve) {
                        return event(vscode_1.debug.onDidStartDebugSession, function (s) {
                            if (s.configuration.sessionID !== id) {
                                return;
                            }
                            resolve(s);
                            cancel.onCancellationRequested(function () { return vscode_1.debug.stopDebugging(s); });
                        });
                    });
                    didStop = new Promise(function (resolve) {
                        return event(vscode_1.debug.onDidTerminateDebugSession, function (s) {
                            if (s.type !== 'go' || s.configuration.sessionID !== id) {
                                return;
                            }
                            resolve();
                        });
                    });
                    outbuf = new lineBuffer_1.LineBuffer();
                    outbuf.onLine(stdout);
                    outbuf.onDone(function (x) { return x && stdout(x); });
                    proc = child_process_1.default.spawn(binPath, ['tool', 'test2json']);
                    proc.stdout.on('data', function (chunk) { return outbuf.append(chunk.toString('utf-8')); });
                    proc.on('close', function () { return outbuf.done(); });
                    subs.push({ dispose: function () { return (0, processUtils_1.killProcessTree)(proc); } });
                    // Capture output
                    debugSessionOutput.set(id, {
                        stderr: stderr,
                        stdout: function (line) { return proc.stdin.write(line); },
                    });
                    subs.push({ dispose: function () { return debugSessionOutput.delete(id); } });
                    flagArgs = [];
                    buildFlags = [];
                    for (_i = 0, _a = Object.entries(flags); _i < _a.length; _i++) {
                        _b = _a[_i], flag = _b[0], value = _b[1];
                        // Build flags must be handled separately, test flags must be prefixed
                        if (isBuildFlag(flag)) {
                            buildFlags.push(flag2arg(flag, value));
                        }
                        else {
                            flagArgs.push(flag2arg("test.".concat(flag), value));
                        }
                    }
                    ws = ctx.workspace.getWorkspaceFolder(vscode_1.Uri.file(cwd));
                    config = {
                        sessionID: id,
                        name: 'Debug test',
                        type: 'go',
                        request: 'launch',
                        mode: 'test',
                        program: cwd,
                        env: env,
                        buildFlags: buildFlags,
                        args: __spreadArray(['-test.v'], flagArgs, true),
                    };
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, , 5, 6]);
                    return [4 /*yield*/, vscode_1.debug.startDebugging(ws, config, { testRun: run })];
                case 2:
                    if (!(_c.sent())) {
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, didStart];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, didStop];
                case 4:
                    _c.sent();
                    return [3 /*break*/, 6];
                case 5:
                    subs.forEach(function (s) { return s.dispose(); });
                    return [7 /*endfinally*/];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function flags2args(flags) {
    return Object.entries(flags).map(function (_a) {
        var k = _a[0], v = _a[1];
        return flag2arg(k, v);
    });
}
function flag2arg(name, value) {
    return value === true ? "-".concat(name) : "-".concat(name, "=").concat(value);
}
function isBuildFlag(name) {
    switch (name) {
        case 'a':
        case 'race':
        case 'msan':
        case 'asan':
        case 'cover':
        case 'covermode':
        case 'coverpkg':
        case 'asmflags':
        case 'buildvcs':
        case 'compiler':
        case 'gccgoflags':
        case 'gcflags':
        case 'ldflags':
        case 'mod':
        case 'modcacherw':
        case 'modfile':
        case 'overlay':
        case 'pgo':
        case 'tags':
        case 'trimpath':
        case 'toolexec':
            return true;
        default:
            return false;
    }
}
