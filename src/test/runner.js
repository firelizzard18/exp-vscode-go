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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
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
var _RunnerSettings_instances, _RunnerSettings_update, _TestRunner_instances, _TestRunner_context, _TestRunner_resolver, _TestRunner_config, _TestRunner_createRun, _TestRunner_request, _TestRunner_token, _TestRunner_continuous, _TestRunner_run, _TestRunner_runPkg, _TestRunner_registerCapturedProfile, _TestRunner_spawn;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestRunner = exports.RunnerSettings = void 0;
exports.shouldRunBenchmarks = shouldRunBenchmarks;
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
var vscode_1 = require("vscode");
var item_1 = require("./item");
var utils_1 = require("./utils");
var profile_1 = require("./profile");
var config_1 = require("./config");
var settingsMemento = 'runnerSettings';
var RunnerSettings = /** @class */ (function () {
    function RunnerSettings(id, state) {
        _RunnerSettings_instances.add(this);
        this.profile = (0, profile_1.makeProfileTypeSet)();
        this.id = id;
        this.state = state;
        var _a = (state.get("".concat(settingsMemento, "[").concat(id, "]")) || {}).profile, profile = _a === void 0 ? [] : _a;
        this.profile.forEach(function (x) { return (x.enabled = profile.includes(x.id)); });
    }
    RunnerSettings.prototype.configure = function (args) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, r_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, args.showQuickPick(['Profiling'], { title: 'Go tests' })];
                    case 1:
                        _a = _b.sent();
                        switch (_a) {
                            case 'Profiling': return [3 /*break*/, 2];
                        }
                        return [3 /*break*/, 5];
                    case 2:
                        this.profile.forEach(function (x) { return (x.picked = x.enabled); });
                        return [4 /*yield*/, args.showQuickPick(this.profile, {
                                title: 'Profile',
                                canPickMany: true,
                            })];
                    case 3:
                        r_1 = _b.sent();
                        if (!r_1)
                            return [2 /*return*/];
                        this.profile.forEach(function (x) { return (x.enabled = r_1.includes(x)); });
                        return [4 /*yield*/, __classPrivateFieldGet(this, _RunnerSettings_instances, "m", _RunnerSettings_update).call(this)];
                    case 4:
                        _b.sent();
                        _b.label = 5;
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    return RunnerSettings;
}());
exports.RunnerSettings = RunnerSettings;
_RunnerSettings_instances = new WeakSet(), _RunnerSettings_update = function _RunnerSettings_update() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, this.state.update("runnerSettings[".concat(this.id, "]"), {
                        profile: this.profile.filter(function (x) { return x.enabled; }).map(function (x) { return x.id; }),
                    })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
};
var TestRunner = /** @class */ (function () {
    function TestRunner(context, provider, config, createRun, request, token) {
        _TestRunner_instances.add(this);
        _TestRunner_context.set(this, void 0);
        _TestRunner_resolver.set(this, void 0);
        _TestRunner_config.set(this, void 0);
        _TestRunner_createRun.set(this, void 0);
        _TestRunner_request.set(this, void 0);
        _TestRunner_token.set(this, void 0);
        _TestRunner_continuous.set(this, new Set());
        __classPrivateFieldSet(this, _TestRunner_context, context, "f");
        __classPrivateFieldSet(this, _TestRunner_resolver, provider, "f");
        __classPrivateFieldSet(this, _TestRunner_config, config, "f");
        __classPrivateFieldSet(this, _TestRunner_createRun, createRun, "f");
        __classPrivateFieldSet(this, _TestRunner_request, request, "f");
        __classPrivateFieldSet(this, _TestRunner_token, token, "f");
    }
    TestRunner.prototype.run = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: 
                    // Save all files to ensure `go test` tests the latest changes
                    return [4 /*yield*/, __classPrivateFieldGet(this, _TestRunner_context, "f").workspace.saveAll(false)];
                    case 1:
                        // Save all files to ensure `go test` tests the latest changes
                        _a.sent();
                        return [4 /*yield*/, __classPrivateFieldGet(this, _TestRunner_instances, "m", _TestRunner_run).call(this, __classPrivateFieldGet(this, _TestRunner_request, "f"))];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    TestRunner.prototype.queueForContinuousRun = function (items) {
        return __awaiter(this, void 0, void 0, function () {
            var _i, items_1, item;
            return __generator(this, function (_a) {
                for (_i = 0, items_1 = items; _i < items_1.length; _i++) {
                    item = items_1[_i];
                    __classPrivateFieldGet(this, _TestRunner_continuous, "f").add(item);
                }
                return [2 /*return*/];
            });
        });
    };
    TestRunner.prototype.runContinuous = function (uri) {
        return __awaiter(this, void 0, void 0, function () {
            var items, _i, _a, item, file, _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        items = new Set();
                        for (_i = 0, _a = __classPrivateFieldGet(this, _TestRunner_continuous, "f"); _i < _a.length; _i++) {
                            item = _a[_i];
                            file = item instanceof item_1.TestFile ? item : item.file;
                            if ("".concat(file.uri) === "".concat(uri)) {
                                items.add(item);
                                __classPrivateFieldGet(this, _TestRunner_continuous, "f").delete(item);
                            }
                        }
                        if (!items.size) return [3 /*break*/, 3];
                        _c = (_b = __classPrivateFieldGet(this, _TestRunner_instances, "m", _TestRunner_run)).call;
                        _d = [this];
                        return [4 /*yield*/, __classPrivateFieldGet(this, _TestRunner_request, "f").with(items)];
                    case 1: return [4 /*yield*/, _c.apply(_b, _d.concat([_e.sent(), true]))];
                    case 2:
                        _e.sent();
                        _e.label = 3;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return TestRunner;
}());
exports.TestRunner = TestRunner;
_TestRunner_context = new WeakMap(), _TestRunner_resolver = new WeakMap(), _TestRunner_config = new WeakMap(), _TestRunner_createRun = new WeakMap(), _TestRunner_request = new WeakMap(), _TestRunner_token = new WeakMap(), _TestRunner_continuous = new WeakMap(), _TestRunner_instances = new WeakSet(), _TestRunner_run = function _TestRunner_run(request_1) {
    return __awaiter(this, arguments, void 0, function (request, continuous) {
        var run, invalid, first, _a, _b, _c, pkg, e_1_1;
        var _d, e_1, _e, _f;
        if (continuous === void 0) { continuous = false; }
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    run = __classPrivateFieldGet(this, _TestRunner_createRun, "f").call(this, request);
                    _g.label = 1;
                case 1:
                    _g.trys.push([1, , 15, 16]);
                    invalid = request.size > 1 && __classPrivateFieldGet(this, _TestRunner_config, "f").profile.kind === vscode_1.TestRunProfileKind.Debug;
                    first = true;
                    _g.label = 2;
                case 2:
                    _g.trys.push([2, 8, 9, 14]);
                    _a = true, _b = __asyncValues(request.packages(run));
                    _g.label = 3;
                case 3: return [4 /*yield*/, _b.next()];
                case 4:
                    if (!(_c = _g.sent(), _d = _c.done, !_d)) return [3 /*break*/, 7];
                    _f = _c.value;
                    _a = false;
                    pkg = _f;
                    if (invalid) {
                        pkg.forEach(function (item) {
                            return run.errored(item, {
                                message: 'Debugging multiple test packages is not supported',
                            });
                        });
                        return [3 /*break*/, 6];
                    }
                    if (first) {
                        first = false;
                    }
                    else {
                        run.appendOutput('\r\n\r\n');
                    }
                    return [4 /*yield*/, __classPrivateFieldGet(this, _TestRunner_instances, "m", _TestRunner_runPkg).call(this, pkg, run, continuous)];
                case 5:
                    _g.sent();
                    _g.label = 6;
                case 6:
                    _a = true;
                    return [3 /*break*/, 3];
                case 7: return [3 /*break*/, 14];
                case 8:
                    e_1_1 = _g.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 14];
                case 9:
                    _g.trys.push([9, , 12, 13]);
                    if (!(!_a && !_d && (_e = _b.return))) return [3 /*break*/, 11];
                    return [4 /*yield*/, _e.call(_b)];
                case 10:
                    _g.sent();
                    _g.label = 11;
                case 11: return [3 /*break*/, 13];
                case 12:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 13: return [7 /*endfinally*/];
                case 14: return [3 /*break*/, 16];
                case 15:
                    run.end();
                    return [7 /*endfinally*/];
                case 16: return [2 /*return*/];
            }
        });
    });
}, _TestRunner_runPkg = function _TestRunner_runPkg(pkg, run, continuous) {
    return __awaiter(this, void 0, void 0, function () {
        var cfg, flags, profileDir, profileParent, time, _loop_1, this_1, _i, _a, profile, ws, niceFlags, _b, _c, _d, flag, value, r;
        var _this = this;
        var _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    pkg.forEach(function (item, goItem) {
                        run.enqueued(item);
                        goItem === null || goItem === void 0 ? void 0 : goItem.removeDynamicTestCases();
                    });
                    cfg = new config_1.TestConfig(__classPrivateFieldGet(this, _TestRunner_context, "f").workspace, pkg.goItem.uri);
                    flags = Object.assign({}, cfg.testFlags());
                    flags.fullpath = true; // Include the full path for output events
                    if (pkg.includeAll) {
                        // Include all test cases
                        flags.run = '.';
                        if (shouldRunBenchmarks(__classPrivateFieldGet(this, _TestRunner_context, "f").workspace, pkg.goItem)) {
                            flags.bench = '.';
                        }
                    }
                    else {
                        // Include specific test cases
                        flags.run = makeRegex(pkg.include.keys(), function (x) { return x.kind !== 'benchmark'; }) || '-';
                        flags.bench = makeRegex(pkg.include.keys(), function (x) { return x.kind === 'benchmark'; }) || '-';
                    }
                    if (pkg.exclude.size) {
                        // Exclude specific test cases
                        flags.skip = makeRegex(pkg.exclude.keys());
                    }
                    if (!(!continuous && __classPrivateFieldGet(this, _TestRunner_config, "f").settings.profile.some(function (x) { return x.enabled; }))) return [3 /*break*/, 5];
                    profileDir = profile_1.CapturedProfile.storageDir(__classPrivateFieldGet(this, _TestRunner_context, "f"), run);
                    return [4 /*yield*/, __classPrivateFieldGet(this, _TestRunner_context, "f").workspace.fs.createDirectory(profileDir)];
                case 1:
                    _f.sent();
                    profileParent = pkg.include.size === 1 ? __spreadArray([], pkg.include, true)[0][0] : pkg.goItem;
                    time = new Date();
                    _loop_1 = function (profile) {
                        var file;
                        return __generator(this, function (_g) {
                            switch (_g.label) {
                                case 0:
                                    if (!profile.enabled) {
                                        return [2 /*return*/, "continue"];
                                    }
                                    return [4 /*yield*/, __classPrivateFieldGet(this_1, _TestRunner_instances, "m", _TestRunner_registerCapturedProfile).call(this_1, run, profileParent, profileDir, profile, time)];
                                case 1:
                                    file = _g.sent();
                                    flags["".concat(profile.id, "profile")] = file.uri.fsPath;
                                    (_e = run.onDidDispose) === null || _e === void 0 ? void 0 : _e.call(run, function () { return __classPrivateFieldGet(_this, _TestRunner_context, "f").workspace.fs.delete(file.uri); });
                                    return [2 /*return*/];
                            }
                        });
                    };
                    this_1 = this;
                    _i = 0, _a = __classPrivateFieldGet(this, _TestRunner_config, "f").settings.profile;
                    _f.label = 2;
                case 2:
                    if (!(_i < _a.length)) return [3 /*break*/, 5];
                    profile = _a[_i];
                    return [5 /*yield**/, _loop_1(profile)];
                case 3:
                    _f.sent();
                    _f.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5:
                    ws = __classPrivateFieldGet(this, _TestRunner_context, "f").workspace.getWorkspaceFolder(pkg.goItem.uri);
                    niceFlags = Object.assign({}, flags);
                    if (ws) {
                        for (_b = 0, _c = Object.entries(niceFlags); _b < _c.length; _b++) {
                            _d = _c[_b], flag = _d[0], value = _d[1];
                            if (typeof value === 'string') {
                                niceFlags[flag] = value.replace(ws.uri.fsPath, '${workspaceFolder}');
                            }
                        }
                    }
                    pkg.append("$ cd ".concat(pkg.goItem.uri.fsPath, "\n$ go test ").concat((0, utils_1.flags2args)(niceFlags).join(' '), "\n\n"), undefined, pkg.testItem);
                    return [4 /*yield*/, __classPrivateFieldGet(this, _TestRunner_instances, "m", _TestRunner_spawn).call(this, __classPrivateFieldGet(this, _TestRunner_context, "f"), pkg.goItem.uri, flags, {
                            run: run,
                            cwd: pkg.goItem.uri.fsPath,
                            env: cfg.testEnvVars(),
                            cancel: __classPrivateFieldGet(this, _TestRunner_token, "f"),
                            stdout: function (s) {
                                if (!s)
                                    return;
                                __classPrivateFieldGet(_this, _TestRunner_context, "f").output.debug("stdout> ".concat(s));
                                pkg.onStdout(s);
                            },
                            stderr: function (s) {
                                if (!s)
                                    return;
                                __classPrivateFieldGet(_this, _TestRunner_context, "f").output.debug("stderr> ".concat(s));
                                pkg.onStderr(s);
                            },
                        }).catch(function (err) {
                            run.errored(pkg.testItem, {
                                message: "".concat(err),
                            });
                        })];
                case 6:
                    r = _f.sent();
                    if (r && r.code !== 0 && r.code !== 1) {
                        run.errored(pkg.testItem, {
                            message: "`go test` exited with ".concat(__spreadArray(__spreadArray([], (r.code ? ["code ".concat(r.code)] : []), true), (r.signal ? ["signal ".concat(r.signal)] : []), true).join(', ')),
                        });
                    }
                    return [2 /*return*/];
            }
        });
    });
}, _TestRunner_registerCapturedProfile = function _TestRunner_registerCapturedProfile(run, item, dir, type, time) {
    return __awaiter(this, void 0, void 0, function () {
        var profile;
        var _this = this;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, item.profiles.addProfile(dir, type, time)];
                case 1:
                    profile = _b.sent();
                    return [4 /*yield*/, __classPrivateFieldGet(this, _TestRunner_resolver, "f").reloadGoItem(item)];
                case 2:
                    _b.sent();
                    (_a = run.onDidDispose) === null || _a === void 0 ? void 0 : _a.call(run, function () { return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    item.profiles.removeProfile(profile);
                                    return [4 /*yield*/, __classPrivateFieldGet(this, _TestRunner_resolver, "f").reloadGoItem(item)];
                                case 1:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); });
                    return [2 /*return*/, profile];
            }
        });
    });
}, _TestRunner_spawn = function _TestRunner_spawn() {
    var _a, _b;
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    switch (__classPrivateFieldGet(this, _TestRunner_config, "f").profile.kind) {
        case vscode_1.TestRunProfileKind.Debug:
            return (_a = __classPrivateFieldGet(this, _TestRunner_context, "f")).debug.apply(_a, args);
        default:
            return (_b = __classPrivateFieldGet(this, _TestRunner_context, "f")).spawn.apply(_b, args);
    }
};
function shouldRunBenchmarks(workspace, pkg) {
    // When the user clicks the run button on a package, they expect all of the
    // tests within that package to run - they probably don't want to run the
    // benchmarks. So if a benchmark is not explicitly selected, don't run
    // benchmarks. But the user may disagree, so behavior can be changed with
    // `testExplorer.runPackageBenchmarks`. However, if the user clicks the run
    // button on a file or package that contains benchmarks and nothing else,
    // they likely expect those benchmarks to run.
    if (workspace.getConfiguration('goExp', pkg.uri).get('testExplorer.runPackageBenchmarks')) {
        return true;
    }
    for (var _i = 0, _a = pkg.getTests(); _i < _a.length; _i++) {
        var test_1 = _a[_i];
        if (test_1.kind !== 'benchmark') {
            return false;
        }
    }
    return true;
}
function makeRegex(tests, where) {
    if (where === void 0) { where = function () { return true; }; }
    return __spreadArray([], tests, true).filter(where)
        .map(function (x) {
        return x.name
            .split('/')
            .map(function (part) { return "^".concat(escapeRegExp(part), "$"); })
            .join('/');
    })
        .join('|');
}
// escapeRegExp escapes regex metacharacters.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
function escapeRegExp(v) {
    return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
