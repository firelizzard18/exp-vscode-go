"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
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
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = {}, verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
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
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
var _TestRunRequest_instances, _TestRunRequest_packages, _TestRunRequest_resolveTestItems, _PackageTestRun_request, _PackageTestRun_run;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageTestRun = exports.TestRunRequest = void 0;
var item_1 = require("./item");
var runner_1 = require("./runner");
var node_path_1 = require("node:path");
var vscode_1 = require("vscode");
var vscode_2 = require("vscode");
var vscode_3 = require("vscode");
var profile_1 = require("./profile");
var TestRunRequest = /** @class */ (function () {
    function TestRunRequest(manager, original, packages, include, exclude) {
        _TestRunRequest_instances.add(this);
        _TestRunRequest_packages.set(this, void 0);
        this.manager = manager;
        this.source = original;
        __classPrivateFieldSet(this, _TestRunRequest_packages, packages, "f");
        this.include = include;
        this.exclude = exclude;
    }
    /**
     * Constructs a {@link TestRunRequest} from a {@link vscode.TestRunRequest}.
     */
    TestRunRequest.from = function (manager, request) {
        return __awaiter(this, void 0, void 0, function () {
            var include, exclude, roots, packages, tests, _i, _a, test_1, _b, tests_1, item, pkg, testsForPackage, _c, tests_2, item, pkg, excludeForPackage, _d, _e, item, pkg;
            var _this = this;
            var _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        include = (request.include || __spreadArray([], manager.rootTestItems, true)).map(function (x) { return resolveGoItem(manager, x); });
                        exclude = ((_f = request.exclude) === null || _f === void 0 ? void 0 : _f.map(function (x) { return resolveGoItem(manager, x); })) || [];
                        roots = new Set(include.filter(function (x) { return x instanceof item_1.RootItem; }));
                        exclude.forEach(function (x) { return roots.delete(x); });
                        packages = new Set(include.filter(function (x) { return x instanceof item_1.Package; }));
                        return [4 /*yield*/, Promise.all(__spreadArray([], roots, true).map(function (x) { return __awaiter(_this, void 0, void 0, function () {
                                var _i, _a, pkg;
                                return __generator(this, function (_b) {
                                    switch (_b.label) {
                                        case 0:
                                            _i = 0;
                                            return [4 /*yield*/, x.getPackages()];
                                        case 1:
                                            _a = _b.sent();
                                            _b.label = 2;
                                        case 2:
                                            if (!(_i < _a.length)) return [3 /*break*/, 4];
                                            pkg = _a[_i];
                                            packages.add(pkg);
                                            _b.label = 3;
                                        case 3:
                                            _i++;
                                            return [3 /*break*/, 2];
                                        case 4: return [2 /*return*/];
                                    }
                                });
                            }); }))];
                    case 1:
                        _g.sent();
                        exclude.forEach(function (x) { return packages.delete(x); });
                        tests = new Set(testCases(include));
                        for (_i = 0, _a = testCases(exclude); _i < _a.length; _i++) {
                            test_1 = _a[_i];
                            tests.delete(test_1);
                        }
                        // Remove redundant requests for specific tests
                        for (_b = 0, tests_1 = tests; _b < tests_1.length; _b++) {
                            item = tests_1[_b];
                            pkg = item.file.package;
                            if (!packages.has(pkg)) {
                                continue;
                            }
                            // If a package is selected, all tests within it will be run so ignore
                            // explicit requests for a test if its package is selected. Do the same
                            // for benchmarks, if shouldRunBenchmarks.
                            if (item.kind !== 'benchmark' || (0, runner_1.shouldRunBenchmarks)(manager.context.workspace, pkg)) {
                                tests.delete(item);
                            }
                        }
                        testsForPackage = new Map();
                        for (_c = 0, tests_2 = tests; _c < tests_2.length; _c++) {
                            item = tests_2[_c];
                            pkg = item.file.package;
                            packages.add(pkg);
                            if (!testsForPackage.has(pkg)) {
                                testsForPackage.set(pkg, []);
                            }
                            testsForPackage.get(pkg).push(item);
                        }
                        excludeForPackage = new Map();
                        for (_d = 0, _e = testCases(exclude); _d < _e.length; _d++) {
                            item = _e[_d];
                            pkg = item.file.package;
                            if (!packages.has(pkg))
                                continue;
                            if (!excludeForPackage.has(pkg)) {
                                excludeForPackage.set(pkg, []);
                            }
                            excludeForPackage.get(pkg).push(item);
                        }
                        return [2 /*return*/, new this(manager, request, packages, testsForPackage, excludeForPackage)];
                }
            });
        });
    };
    /**
     * Constructs a new {@link TestRunRequest} with the intersection of the
     * receiver's included tests and the given tests.
     */
    TestRunRequest.prototype.with = function (tests) {
        return __awaiter(this, void 0, void 0, function () {
            var candidates, _i, _a, pkg, packages, include, add, _b, tests_3, item, _c, _d, test_2, testItems;
            var _this = this;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        candidates = new Set();
                        for (_i = 0, _a = __classPrivateFieldGet(this, _TestRunRequest_packages, "f"); _i < _a.length; _i++) {
                            pkg = _a[_i];
                            (this.include.get(pkg) || pkg.getTests()).forEach(function (x) { return candidates.add(x); });
                            (this.exclude.get(pkg) || []).forEach(function (x) { return candidates.delete(x); });
                        }
                        packages = new Set();
                        include = new Map();
                        add = function (item) {
                            if (!candidates.has(item)) {
                                return;
                            }
                            var items = include.get(item.file.package) || [];
                            if (items.includes(item)) {
                                return;
                            }
                            packages.add(item.file.package);
                            items.push(item);
                            include.set(item.file.package, items);
                        };
                        for (_b = 0, tests_3 = tests; _b < tests_3.length; _b++) {
                            item = tests_3[_b];
                            if (item instanceof item_1.TestCase) {
                                add(item);
                            }
                            else {
                                for (_c = 0, _d = item.tests; _c < _d.length; _c++) {
                                    test_2 = _d[_c];
                                    add(test_2);
                                }
                            }
                        }
                        testItems = [];
                        return [4 /*yield*/, Promise.all(__spreadArray([], include.values(), true).map(function (x) {
                                return Promise.all(x.map(function (y) { return __awaiter(_this, void 0, void 0, function () {
                                    var item;
                                    return __generator(this, function (_a) {
                                        switch (_a.label) {
                                            case 0: return [4 /*yield*/, this.manager.resolveTestItem(y, true)];
                                            case 1:
                                                item = _a.sent();
                                                testItems.push(item);
                                                return [2 /*return*/];
                                        }
                                    });
                                }); }));
                            }))];
                    case 1:
                        _e.sent();
                        return [2 /*return*/, new TestRunRequest(this.manager, {
                                include: testItems,
                                exclude: [],
                                profile: this.source.profile,
                            }, packages, include, new Map())];
                }
            });
        });
    };
    Object.defineProperty(TestRunRequest.prototype, "size", {
        get: function () {
            return __classPrivateFieldGet(this, _TestRunRequest_packages, "f").size;
        },
        enumerable: false,
        configurable: true
    });
    TestRunRequest.prototype.packages = function (run) {
        return __asyncGenerator(this, arguments, function packages_1() {
            var _i, _a, pkg, pkgItem, include, exclude;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _i = 0, _a = __classPrivateFieldGet(this, _TestRunRequest_packages, "f");
                        _b.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 8];
                        pkg = _a[_i];
                        return [4 /*yield*/, __await(this.manager.resolveTestItem(pkg, true))];
                    case 2:
                        pkgItem = _b.sent();
                        return [4 /*yield*/, __await(__classPrivateFieldGet(this, _TestRunRequest_instances, "m", _TestRunRequest_resolveTestItems).call(this, this.include.get(pkg) || pkg.getTests()))];
                    case 3:
                        include = _b.sent();
                        return [4 /*yield*/, __await(__classPrivateFieldGet(this, _TestRunRequest_instances, "m", _TestRunRequest_resolveTestItems).call(this, this.exclude.get(pkg) || []))];
                    case 4:
                        exclude = _b.sent();
                        return [4 /*yield*/, __await(new PackageTestRun(this, run, pkg, pkgItem, include, exclude))];
                    case 5: return [4 /*yield*/, _b.sent()];
                    case 6:
                        _b.sent();
                        _b.label = 7;
                    case 7:
                        _i++;
                        return [3 /*break*/, 1];
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    return TestRunRequest;
}());
exports.TestRunRequest = TestRunRequest;
_TestRunRequest_packages = new WeakMap(), _TestRunRequest_instances = new WeakSet(), _TestRunRequest_resolveTestItems = function _TestRunRequest_resolveTestItems(goItems) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = Map.bind;
                    return [4 /*yield*/, Promise.all(goItems.map(function (x) { return __awaiter(_this, void 0, void 0, function () { var _a; return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    _a = [x];
                                    return [4 /*yield*/, this.manager.resolveTestItem(x, true)];
                                case 1: return [2 /*return*/, _a.concat([_b.sent()])];
                            }
                        }); }); }))];
                case 1: return [2 /*return*/, new (_a.apply(Map, [void 0, _b.sent()]))()];
            }
        });
    });
};
var PackageTestRun = /** @class */ (function () {
    function PackageTestRun(request, run, goItem, testItem, include, exclude) {
        _PackageTestRun_request.set(this, void 0);
        _PackageTestRun_run.set(this, void 0);
        this.stderr = [];
        this.output = new Map();
        this.currentLocation = new Map();
        this.goItem = goItem;
        this.testItem = testItem;
        this.include = include;
        this.exclude = exclude;
        __classPrivateFieldSet(this, _PackageTestRun_request, request, "f");
        __classPrivateFieldSet(this, _PackageTestRun_run, run, "f");
    }
    Object.defineProperty(PackageTestRun.prototype, "includeAll", {
        get: function () {
            return !__classPrivateFieldGet(this, _PackageTestRun_request, "f").include.has(this.goItem);
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Handles an event from `go test -json`.
     */
    PackageTestRun.prototype.onStdout = function (s) {
        return __awaiter(this, void 0, void 0, function () {
            var msg, test, item, _a, elapsed, id, _b, message, location_1, m, messages;
            var _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        try {
                            msg = JSON.parse(s);
                        }
                        catch (_) {
                            // Unknown output
                            this.append(s);
                            return [2 /*return*/];
                        }
                        test = msg.Test ? this.goItem.findTest(msg.Test, true) : undefined;
                        _a = test;
                        if (!_a) return [3 /*break*/, 2];
                        return [4 /*yield*/, __classPrivateFieldGet(this, _PackageTestRun_request, "f").manager.resolveTestItem(test, true)];
                    case 1:
                        _a = (_d.sent());
                        _d.label = 2;
                    case 2:
                        item = _a;
                        elapsed = typeof msg.Elapsed === 'number' ? msg.Elapsed * 1000 : undefined;
                        switch (msg.Action) {
                            case 'output': {
                                if (!msg.Output) {
                                    break;
                                }
                                id = (item || this.testItem).id;
                                if (!this.output.has(id)) {
                                    this.output.set(id, []);
                                }
                                this.output.get(id).push(msg.Output);
                                if (!item || /^(=== RUN|\s*--- (FAIL|PASS): )/.test(msg.Output)) {
                                    this.append(msg.Output, undefined, this.testItem);
                                    break;
                                }
                                _b = parseOutputLocation(msg.Output, node_path_1.default.join(item.uri.fsPath, '..')), message = _b.message, location_1 = _b.location;
                                if (location_1) {
                                    this.currentLocation.set(id, location_1);
                                }
                                this.append(message, location_1 || this.currentLocation.get(id), item);
                                m = msg.Output.match(/^(?<name>Benchmark[#/\w+]+)(?:-(?<procs>\d+)\s+(?<result>.*))?(?:$|\n)/);
                                if (m && msg.Test && ((_c = m.groups) === null || _c === void 0 ? void 0 : _c.name) === msg.Test) {
                                    __classPrivateFieldGet(this, _PackageTestRun_run, "f").passed(item);
                                }
                                break;
                            }
                            case 'run':
                            case 'start':
                                if (!msg.Test) {
                                    __classPrivateFieldGet(this, _PackageTestRun_run, "f").started(this.testItem);
                                }
                                else if (item) {
                                    __classPrivateFieldGet(this, _PackageTestRun_run, "f").started(item);
                                }
                                break;
                            case 'skip':
                                if (!msg.Test) {
                                    __classPrivateFieldGet(this, _PackageTestRun_run, "f").skipped(this.testItem);
                                }
                                else if (item) {
                                    __classPrivateFieldGet(this, _PackageTestRun_run, "f").skipped(item);
                                }
                                break;
                            case 'pass':
                                if (!msg.Test) {
                                    __classPrivateFieldGet(this, _PackageTestRun_run, "f").passed(this.testItem, elapsed);
                                }
                                else if (item) {
                                    __classPrivateFieldGet(this, _PackageTestRun_run, "f").passed(item, elapsed);
                                }
                                break;
                            case 'fail': {
                                if (!msg.Test) {
                                    processPackageFailure(__classPrivateFieldGet(this, _PackageTestRun_run, "f"), this.goItem, this.testItem, elapsed, this.output.get(this.testItem.id) || [], this.stderr);
                                }
                                else if (item) {
                                    messages = parseTestFailure(test, this.output.get(item.id) || []);
                                    __classPrivateFieldGet(this, _PackageTestRun_run, "f").failed(item, messages, elapsed);
                                }
                                break;
                            }
                            default:
                                // Ignore 'cont' and 'pause'
                                break;
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    PackageTestRun.prototype.onStderr = function (s) {
        this.append(s, undefined, this.testItem);
        this.stderr.push(s);
    };
    PackageTestRun.prototype.append = function (output, location, test) {
        if (!output.endsWith('\n'))
            output += '\n';
        output = output.replace(/\n/g, '\r\n');
        __classPrivateFieldGet(this, _PackageTestRun_run, "f").appendOutput(output, location, test);
    };
    PackageTestRun.prototype.forEach = function (fn) {
        var recurse = function (item, goItem) {
            fn(item, goItem);
            for (var _i = 0, _a = item.children; _i < _a.length; _i++) {
                var _b = _a[_i], child = _b[1];
                recurse(child);
            }
        };
        fn(this.testItem);
        for (var _i = 0, _a = this.include; _i < _a.length; _i++) {
            var _b = _a[_i], goItem = _b[0], item = _b[1];
            if (!this.exclude.has(goItem)) {
                recurse(item, goItem);
            }
        }
    };
    return PackageTestRun;
}());
exports.PackageTestRun = PackageTestRun;
_PackageTestRun_request = new WeakMap(), _PackageTestRun_run = new WeakMap();
function testCases(items) {
    var _i, items_1, item;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _i = 0, items_1 = items;
                _a.label = 1;
            case 1:
                if (!(_i < items_1.length)) return [3 /*break*/, 6];
                item = items_1[_i];
                if (!(item instanceof item_1.TestCase)) return [3 /*break*/, 3];
                return [4 /*yield*/, item];
            case 2:
                _a.sent();
                _a.label = 3;
            case 3:
                if (!(item instanceof item_1.TestFile)) return [3 /*break*/, 5];
                return [5 /*yield**/, __values(item.tests)];
            case 4:
                _a.sent();
                _a.label = 5;
            case 5:
                _i++;
                return [3 /*break*/, 1];
            case 6: return [2 /*return*/];
        }
    });
}
function resolveGoItem(mananger, item) {
    var pi = mananger.resolveGoTestItem(item.id);
    if (!pi)
        throw new Error("Cannot find test item ".concat(item.id));
    // VSCode appears to have a bug where clicking {run} on a test item that
    // has no children except `Profiles` selects the wrong item to run.
    if (pi instanceof profile_1.CapturedProfile)
        pi = pi.parent;
    if (pi instanceof profile_1.ProfileSet)
        pi = pi.parent;
    if (pi instanceof profile_1.ProfileContainer)
        pi = pi.parent;
    return pi;
}
function processPackageFailure(run, pkg, pkgItem, elapsed, stdout, stderr) {
    var buildFailed = stdout.some(function (x) { return /\[build failed\]\s*$/.test(x); });
    if (!buildFailed) {
        run.failed(pkgItem, [], elapsed);
        return;
    }
    var pkgMessages = [];
    var testMessages = new Map();
    var _loop_1 = function (line) {
        var _c = parseOutputLocation(line, pkg.uri.fsPath), message = _c.message, location_2 = _c.location;
        var test_3 = location_2 &&
            __spreadArray([], pkgItem.children, true).map(function (x) { return x[1]; })
                .find(function (x) { var _a; return x.uri.fsPath === location_2.uri.fsPath && ((_a = x.range) === null || _a === void 0 ? void 0 : _a.contains(location_2.range)); });
        if (!test_3) {
            pkgMessages.push({ message: message });
            return "continue";
        }
        if (!testMessages.has(test_3)) {
            testMessages.set(test_3, []);
        }
        testMessages.get(test_3).push({ message: message, location: location_2 });
    };
    for (var _i = 0, stderr_1 = stderr; _i < stderr_1.length; _i++) {
        var line = stderr_1[_i];
        _loop_1(line);
    }
    run.errored(pkgItem, pkgMessages, elapsed);
    for (var _a = 0, testMessages_1 = testMessages; _a < testMessages_1.length; _a++) {
        var _b = testMessages_1[_a], test_4 = _b[0], messages = _b[1];
        run.errored(test_4, messages);
    }
}
/**
 * Returns build/test error messages associated with source locations.
 * Location info is inferred heuristically by applying a simple pattern matching
 * over the output strings from `go test -json` `output` type action events.
 */
function parseTestFailure(test, output) {
    var messages = [];
    var gotI = output.indexOf('got:\n');
    var wantI = output.indexOf('want:\n');
    if (test.kind === 'example' && gotI >= 0 && wantI >= 0) {
        var got = output.slice(gotI + 1, wantI).join('');
        var want = output.slice(wantI + 1).join('');
        var message = vscode_2.TestMessage.diff('Output does not match', want, got);
        if (test.uri && test.range) {
            message.location = new vscode_1.Location(test.uri, test.range.start);
        }
        messages.push(message);
        output = output.slice(0, gotI);
    }
    // TODO(hyangah): handle panic messages specially.
    var dir = node_path_1.default.join(test.uri.fsPath, '..');
    output.forEach(function (line) { return messages.push(parseOutputLocation(line, dir)); });
    return messages;
}
/**
 * ^(?:.*\s+|\s*)                  - non-greedy match of any chars followed by a space or, a space.
 * (?<file>\S+\.go):(?<line>\d+):  - gofile:line: followed by a space.
 * (?<message>.\n)$                - all remaining message up to $.
 */
var lineLocPattern = /^(.*\s+)?(?<file>\S+\.go):(?<line>\d+)(?::(?<column>\d+)): (?<message>.*\n?)$/;
/**
 * Extract the location info from output message.
 * This is not trivial since both the test output and any output/print
 * from the tested program are reported as `output` type test events
 * and not distinguishable. stdout/stderr output from the tested program
 * makes this more trickier.
 *
 * Here we assume that test output messages are line-oriented, precede
 * with a file name and line number, and end with new lines.
 */
function parseOutputLocation(line, dir) {
    var _a;
    var m = line.match(lineLocPattern);
    if (!((_a = m === null || m === void 0 ? void 0 : m.groups) === null || _a === void 0 ? void 0 : _a.file)) {
        return { message: line };
    }
    // Paths will always be absolute for versions of Go (1.21+) due to
    // -fullpath, but the user may be using an old version
    var file = m.groups.file && node_path_1.default.isAbsolute(m.groups.file)
        ? vscode_3.Uri.file(m.groups.file)
        : vscode_3.Uri.file(node_path_1.default.join(dir, m.groups.file));
    // VSCode uses 0-based line numbering (internally)
    var ln = Number(m.groups.line) - 1;
    var col = m.groups.column ? Number(m.groups.column) - 1 : 0;
    return {
        message: m.groups.message,
        location: new vscode_1.Location(file, new vscode_3.Position(ln, col)),
    };
}
