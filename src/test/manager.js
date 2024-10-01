"use strict";
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
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
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
var _TestManager_instances, _TestManager_didSave, _TestManager_codeLens, _TestManager_disposable, _TestManager_ctrl, _TestManager_resolver, _TestManager_run, _TestManager_debug, _TestManager_executeTestRun;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestManager = void 0;
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
var vscode_1 = require("vscode");
var testing_1 = require("./testing");
var resolver_1 = require("./resolver");
var runner_1 = require("./runner");
var run_1 = require("./run");
var codeLens_1 = require("./codeLens");
var eventEmitter_1 = require("../utils/eventEmitter");
var TestManager = /** @class */ (function () {
    function TestManager(context) {
        _TestManager_instances.add(this);
        _TestManager_didSave.set(this, new eventEmitter_1.EventEmitter());
        _TestManager_codeLens.set(this, void 0);
        _TestManager_disposable.set(this, []);
        _TestManager_ctrl.set(this, void 0);
        _TestManager_resolver.set(this, void 0);
        _TestManager_run.set(this, void 0);
        _TestManager_debug.set(this, void 0);
        this.context = context;
        __classPrivateFieldSet(this, _TestManager_codeLens, new codeLens_1.CodeLensProvider(context, this), "f");
        __classPrivateFieldSet(this, _TestManager_run, { settings: new runner_1.RunnerSettings('run', this.context.state) }, "f");
        __classPrivateFieldSet(this, _TestManager_debug, { settings: new runner_1.RunnerSettings('debug', this.context.state) }, "f");
    }
    Object.defineProperty(TestManager.prototype, "enabled", {
        get: function () {
            return !!__classPrivateFieldGet(this, _TestManager_ctrl, "f");
        },
        enumerable: false,
        configurable: true
    });
    TestManager.prototype.setup = function (args) {
        var _this = this;
        __classPrivateFieldGet(this, _TestManager_disposable, "f").push(args.registerCodeLensProvider({ language: 'go', scheme: 'file', pattern: '**/*_test.go' }, __classPrivateFieldGet(this, _TestManager_codeLens, "f")));
        var ctrl = args.createTestController('goExp', 'Go (experimental)');
        var resolver = new resolver_1.TestResolver(this.context, ctrl);
        __classPrivateFieldSet(this, _TestManager_ctrl, ctrl, "f");
        __classPrivateFieldSet(this, _TestManager_resolver, resolver, "f");
        __classPrivateFieldGet(this, _TestManager_disposable, "f").push(ctrl);
        resolver.onDidChangeTestItem(function () { return __classPrivateFieldGet(_this, _TestManager_codeLens, "f").reload(); });
        ctrl.refreshHandler = function () { return (0, testing_1.doSafe)(_this.context, 'refresh tests', function () { return resolver.reloadView(); }); };
        ctrl.resolveHandler = function (item) {
            return (0, testing_1.doSafe)(_this.context, 'resolve test', function () { return (item ? resolver.reloadViewItem(item) : resolver.reloadView()); });
        };
        // Normal and debug test runners
        __classPrivateFieldGet(this, _TestManager_run, "f").profile = ctrl.createRunProfile('Run', vscode_1.TestRunProfileKind.Run, function (rq, token) { return __classPrivateFieldGet(_this, _TestManager_instances, "m", _TestManager_executeTestRun).call(_this, __classPrivateFieldGet(_this, _TestManager_run, "f"), rq, token); }, true, { id: 'canRun' }, true);
        __classPrivateFieldGet(this, _TestManager_debug, "f").profile = ctrl.createRunProfile('Debug', vscode_1.TestRunProfileKind.Debug, function (rq, token) { return __classPrivateFieldGet(_this, _TestManager_instances, "m", _TestManager_executeTestRun).call(_this, __classPrivateFieldGet(_this, _TestManager_debug, "f"), rq, token); }, true, { id: 'canDebug' });
        __classPrivateFieldGet(this, _TestManager_disposable, "f").push(__classPrivateFieldGet(this, _TestManager_debug, "f").profile, __classPrivateFieldGet(this, _TestManager_run, "f").profile);
        __classPrivateFieldGet(this, _TestManager_run, "f").profile.configureHandler = function () {
            return (0, testing_1.doSafe)(_this.context, 'configure profile', function () { return __classPrivateFieldGet(_this, _TestManager_run, "f").settings.configure(args); });
        };
        __classPrivateFieldGet(this, _TestManager_debug, "f").profile.configureHandler = function () {
            return (0, testing_1.doSafe)(_this.context, 'configure profile', function () { return __classPrivateFieldGet(_this, _TestManager_debug, "f").settings.configure(args); });
        };
    };
    TestManager.prototype.dispose = function () {
        __classPrivateFieldGet(this, _TestManager_disposable, "f").forEach(function (x) { return x.dispose(); });
        __classPrivateFieldGet(this, _TestManager_disposable, "f").splice(0, __classPrivateFieldGet(this, _TestManager_disposable, "f").length);
        __classPrivateFieldSet(this, _TestManager_ctrl, undefined, "f");
        __classPrivateFieldSet(this, _TestManager_resolver, undefined, "f");
        __classPrivateFieldGet(this, _TestManager_run, "f").profile = undefined;
        __classPrivateFieldGet(this, _TestManager_debug, "f").profile = undefined;
    };
    TestManager.prototype.runTest = function (item) {
        __classPrivateFieldGet(this, _TestManager_instances, "m", _TestManager_executeTestRun).call(this, __classPrivateFieldGet(this, _TestManager_run, "f"), new vscode_1.TestRunRequest([item]));
    };
    TestManager.prototype.debugTest = function (item) {
        if (!__classPrivateFieldGet(this, _TestManager_debug, "f"))
            return;
        __classPrivateFieldGet(this, _TestManager_instances, "m", _TestManager_executeTestRun).call(this, __classPrivateFieldGet(this, _TestManager_debug, "f"), new vscode_1.TestRunRequest([item]));
    };
    TestManager.prototype.reloadView = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, ((_a = __classPrivateFieldGet(this, _TestManager_resolver, "f")) === null || _a === void 0 ? void 0 : _a.reloadView.apply(_a, args))];
                    case 1:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    TestManager.prototype.reloadViewItem = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, ((_a = __classPrivateFieldGet(this, _TestManager_resolver, "f")) === null || _a === void 0 ? void 0 : _a.reloadViewItem.apply(_a, args))];
                    case 1:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    TestManager.prototype.reloadGoItem = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, ((_a = __classPrivateFieldGet(this, _TestManager_resolver, "f")) === null || _a === void 0 ? void 0 : _a.reloadGoItem.apply(_a, args))];
                    case 1:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    TestManager.prototype.reloadUri = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return __awaiter(this, void 0, void 0, function () {
            var uri, ws;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        uri = args[0];
                        if (uri.scheme !== 'file') {
                            return [2 /*return*/];
                        }
                        // Ignore anything that's not a Go file
                        if (!uri.path.endsWith('.go')) {
                            return [2 /*return*/];
                        }
                        ws = this.context.workspace.getWorkspaceFolder(uri);
                        if (!ws) {
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, ((_a = __classPrivateFieldGet(this, _TestManager_resolver, "f")) === null || _a === void 0 ? void 0 : _a.reloadUri.apply(_a, __spreadArray([ws], args, false)))];
                    case 1:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    TestManager.prototype.didSave = function (uri) {
        __classPrivateFieldGet(this, _TestManager_didSave, "f").fire(uri);
    };
    TestManager.prototype.resolveTestItem = function (goItem, create) {
        var _a;
        if (create === void 0) { create = false; }
        if (!create) {
            return (_a = __classPrivateFieldGet(this, _TestManager_resolver, "f")) === null || _a === void 0 ? void 0 : _a.get(goItem);
        }
        return __classPrivateFieldGet(this, _TestManager_resolver, "f").getOrCreateAll(goItem);
    };
    TestManager.prototype.resolveGoTestItem = function (id) {
        var _a;
        return (_a = __classPrivateFieldGet(this, _TestManager_resolver, "f")) === null || _a === void 0 ? void 0 : _a.getGoItem(id);
    };
    Object.defineProperty(TestManager.prototype, "rootTestItems", {
        get: function () {
            var _a;
            return ((_a = __classPrivateFieldGet(this, _TestManager_resolver, "f")) === null || _a === void 0 ? void 0 : _a.viewRoots) || [];
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestManager.prototype, "rootGoTestItems", {
        get: function () {
            var _this = this;
            return (function () { return __awaiter(_this, void 0, void 0, function () { var _a; return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, ((_a = __classPrivateFieldGet(this, _TestManager_resolver, "f")) === null || _a === void 0 ? void 0 : _a.goRoots)];
                    case 1: return [2 /*return*/, (_b.sent()) || []];
                }
            }); }); })();
        },
        enumerable: false,
        configurable: true
    });
    return TestManager;
}());
exports.TestManager = TestManager;
_TestManager_didSave = new WeakMap(), _TestManager_codeLens = new WeakMap(), _TestManager_disposable = new WeakMap(), _TestManager_ctrl = new WeakMap(), _TestManager_resolver = new WeakMap(), _TestManager_run = new WeakMap(), _TestManager_debug = new WeakMap(), _TestManager_instances = new WeakSet(), _TestManager_executeTestRun = function _TestManager_executeTestRun(_a, rq, token) {
    return __awaiter(this, void 0, void 0, function () {
        var cancel, request, runner, s1_1, s2_1;
        var _this = this;
        var profile = _a.profile, config = __rest(_a, ["profile"]);
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!profile || !__classPrivateFieldGet(this, _TestManager_resolver, "f")) {
                        return [2 /*return*/];
                    }
                    if (!token && rq.continuous) {
                        throw new Error('Continuous test runs require a CancellationToken');
                    }
                    if (!token) {
                        cancel = new vscode_1.CancellationTokenSource();
                        token = cancel.token;
                    }
                    return [4 /*yield*/, run_1.TestRunRequest.from(this, rq)];
                case 1:
                    request = _b.sent();
                    runner = new runner_1.TestRunner(this.context, __classPrivateFieldGet(this, _TestManager_resolver, "f"), __assign({ profile: profile }, config), function (rq) { return __classPrivateFieldGet(_this, _TestManager_ctrl, "f").createTestRun(rq.source); }, request, token);
                    if (!rq.continuous) return [3 /*break*/, 2];
                    s1_1 = __classPrivateFieldGet(this, _TestManager_resolver, "f").onDidInvalidateTestResults(function (items) { return __awaiter(_this, void 0, void 0, function () { var _a; return __generator(this, function (_b) {
                        switch (_b.label) {
                            case 0:
                                _a = items;
                                if (!_a) return [3 /*break*/, 2];
                                return [4 /*yield*/, runner.queueForContinuousRun(items)];
                            case 1:
                                _a = (_b.sent());
                                _b.label = 2;
                            case 2: return [2 /*return*/, _a];
                        }
                    }); }); });
                    s2_1 = __classPrivateFieldGet(this, _TestManager_didSave, "f").event(function (e) {
                        return (0, testing_1.doSafe)(_this.context, 'run continuous', function () { return runner.runContinuous(e); });
                    });
                    token.onCancellationRequested(function () { return (s1_1 === null || s1_1 === void 0 ? void 0 : s1_1.dispose(), s2_1.dispose()); });
                    return [3 /*break*/, 4];
                case 2: return [4 /*yield*/, runner.run()];
                case 3:
                    _b.sent();
                    _b.label = 4;
                case 4:
                    cancel === null || cancel === void 0 ? void 0 : cancel.cancel();
                    return [2 /*return*/];
            }
        });
    });
};
