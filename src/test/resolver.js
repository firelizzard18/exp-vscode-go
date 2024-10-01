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
var _TestResolver_instances, _TestResolver_didChangeTestItem, _TestResolver_didInvalidateTestResults, _TestResolver_context, _TestResolver_ctrl, _TestResolver_items, _TestResolver_goRoots, _TestResolver_createOrUpdate, _TestResolver_id, _TestResolver_resolveViewItems;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestResolver = void 0;
var testing_1 = require("./testing");
var item_1 = require("./item");
var config_1 = require("./config");
var profile_1 = require("./profile");
var eventEmitter_1 = require("../utils/eventEmitter");
/**
 * Maps between Go items ({@link GoTestItem}) and view items ({@link TestItem})
 * and manages view updates.
 */
var TestResolver = /** @class */ (function () {
    function TestResolver(context, ctrl) {
        _TestResolver_instances.add(this);
        // NOTE: As much as is possible, this class should be restricted to
        // functions relating to the view. It should _not_ be responsible for
        // managing Go test items, and Go test items should not be responsible for
        // managing view information.
        _TestResolver_didChangeTestItem.set(this, new eventEmitter_1.EventEmitter());
        this.onDidChangeTestItem = __classPrivateFieldGet(this, _TestResolver_didChangeTestItem, "f").event;
        _TestResolver_didInvalidateTestResults.set(this, new eventEmitter_1.EventEmitter());
        this.onDidInvalidateTestResults = __classPrivateFieldGet(this, _TestResolver_didInvalidateTestResults, "f").event;
        _TestResolver_context.set(this, void 0);
        _TestResolver_ctrl.set(this, void 0);
        _TestResolver_items.set(this, new Map());
        _TestResolver_goRoots.set(this, void 0);
        __classPrivateFieldSet(this, _TestResolver_context, context, "f");
        __classPrivateFieldSet(this, _TestResolver_ctrl, ctrl, "f");
        __classPrivateFieldSet(this, _TestResolver_goRoots, new item_1.RootSet(context), "f");
    }
    TestResolver.prototype.getGoItem = function (id) {
        return __classPrivateFieldGet(this, _TestResolver_items, "f").get(id);
    };
    Object.defineProperty(TestResolver.prototype, "viewRoots", {
        get: function () {
            var items = __classPrivateFieldGet(this, _TestResolver_ctrl, "f").items;
            function it() {
                var _i, items_1, _a, item;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            _i = 0, items_1 = items;
                            _b.label = 1;
                        case 1:
                            if (!(_i < items_1.length)) return [3 /*break*/, 4];
                            _a = items_1[_i], item = _a[1];
                            return [4 /*yield*/, item];
                        case 2:
                            _b.sent();
                            _b.label = 3;
                        case 3:
                            _i++;
                            return [3 /*break*/, 1];
                        case 4: return [2 /*return*/];
                    }
                });
            }
            return it();
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestResolver.prototype, "goRoots", {
        get: function () {
            return __classPrivateFieldGet(this, _TestResolver_goRoots, "f").getChildren();
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Get the {@link TestItem} for a {@link GoTestItem}.
     */
    TestResolver.prototype.get = function (goItem) {
        return __awaiter(this, void 0, void 0, function () {
            var id, parent;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        id = __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_id).call(this, goItem);
                        return [4 /*yield*/, ((_a = goItem.getParent) === null || _a === void 0 ? void 0 : _a.call(goItem))];
                    case 1:
                        parent = _c.sent();
                        if (!parent) {
                            return [2 /*return*/, __classPrivateFieldGet(this, _TestResolver_ctrl, "f").items.get(id)];
                        }
                        return [4 /*yield*/, this.get(parent)];
                    case 2: return [2 /*return*/, (_b = (_c.sent())) === null || _b === void 0 ? void 0 : _b.children.get(id)];
                }
            });
        });
    };
    /**
     * Get or create the {@link TestItem} for a {@link GoTestItem}. The items
     * ancestors will also be created if they do not exist.
     */
    TestResolver.prototype.getOrCreateAll = function (goItem) {
        return __awaiter(this, void 0, void 0, function () {
            var parent, children, _a;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, ((_b = goItem.getParent) === null || _b === void 0 ? void 0 : _b.call(goItem))];
                    case 1:
                        parent = _c.sent();
                        if (!!parent) return [3 /*break*/, 2];
                        _a = __classPrivateFieldGet(this, _TestResolver_ctrl, "f").items;
                        return [3 /*break*/, 4];
                    case 2: return [4 /*yield*/, this.getOrCreateAll(parent)];
                    case 3:
                        _a = (_c.sent()).children;
                        _c.label = 4;
                    case 4:
                        children = _a;
                        return [4 /*yield*/, __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_createOrUpdate).call(this, goItem, children, true)];
                    case 5: return [2 /*return*/, _c.sent()];
                }
            });
        });
    };
    /* ******************************************** */
    /* ***              Reloading               *** */
    /* ******************************************** */
    /**
     * Reloads all view items.
     */
    TestResolver.prototype.reloadView = function () {
        return __awaiter(this, void 0, void 0, function () {
            var goRoots, _a, _b;
            var _this = this;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, __classPrivateFieldGet(this, _TestResolver_goRoots, "f").getChildren()];
                    case 1:
                        goRoots = _c.sent();
                        __classPrivateFieldGet(this, _TestResolver_ctrl, "f").items.replace([]); // force reload
                        _b = (_a = __classPrivateFieldGet(this, _TestResolver_ctrl, "f").items).replace;
                        return [4 /*yield*/, Promise.all(goRoots.map(function (x) { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                                return [2 /*return*/, __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_createOrUpdate).call(this, x, __classPrivateFieldGet(this, _TestResolver_ctrl, "f").items)];
                            }); }); }))];
                    case 2:
                        _b.apply(_a, [_c.sent()]);
                        (0, testing_1.debugViewTree)(__classPrivateFieldGet(this, _TestResolver_ctrl, "f").items, 'Resolving (root)');
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Reloads a specific view item.
     */
    TestResolver.prototype.reloadViewItem = function (item) {
        return __awaiter(this, void 0, void 0, function () {
            var goItem, container_1, children, _a, _b;
            var _this = this;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        item.busy = true;
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, , 4, 5]);
                        goItem = __classPrivateFieldGet(this, _TestResolver_items, "f").get(item.id);
                        if (!goItem) {
                            // Unknown test item
                            return [2 /*return*/];
                        }
                        container_1 = item ? item.children : __classPrivateFieldGet(this, _TestResolver_ctrl, "f").items;
                        return [4 /*yield*/, (goItem ? goItem.getChildren() : __classPrivateFieldGet(this, _TestResolver_goRoots, "f").getChildren())];
                    case 2:
                        children = _c.sent();
                        if (!children) {
                            return [2 /*return*/];
                        }
                        _b = (_a = container_1).replace;
                        return [4 /*yield*/, Promise.all(children.map(function (x) { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                                return [2 /*return*/, __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_createOrUpdate).call(this, x, container_1)];
                            }); }); }))];
                    case 3:
                        _b.apply(_a, [_c.sent()]);
                        return [3 /*break*/, 5];
                    case 4:
                        item.busy = false;
                        (0, testing_1.debugViewTree)(__classPrivateFieldGet(this, _TestResolver_ctrl, "f").items, item ? "Resolving ".concat(item.id) : 'Resolving (root)');
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Reloads a set of Go items.
     */
    TestResolver.prototype.reloadGoItem = function (item) {
        return __awaiter(this, void 0, void 0, function () {
            var items;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(item instanceof item_1.TestCase || item instanceof item_1.TestFile || item instanceof item_1.Package)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.reloadGoItem([item])];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                    case 2: return [4 /*yield*/, __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_resolveViewItems).call(this, item, true)];
                    case 3:
                        items = _a.sent();
                        return [4 /*yield*/, Promise.all(items.map(function (x) { return _this.reloadViewItem(x); }))];
                    case 4:
                        _a.sent();
                        return [4 /*yield*/, __classPrivateFieldGet(this, _TestResolver_didChangeTestItem, "f").fire(item)];
                    case 5:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Reloads the test items (view and Go) for the given file.
     *
     * @param uri The URI of the file to reload.
     * @param invalidate Whether to invalidate test results.
     */
    TestResolver.prototype.reloadUri = function (ws_1, uri_1) {
        return __awaiter(this, arguments, void 0, function (ws, uri, ranges, invalidate) {
            var reload, invalidated, _i, _a, _b, item, type, items, _c;
            var _d;
            var _this = this;
            var _e, _f;
            if (ranges === void 0) { ranges = []; }
            if (invalidate === void 0) { invalidate = false; }
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        reload = [];
                        invalidated = [];
                        _i = 0;
                        return [4 /*yield*/, __classPrivateFieldGet(this, _TestResolver_goRoots, "f").didUpdate(ws, uri, (_d = {}, _d["".concat(uri)] = ranges, _d))];
                    case 1:
                        _a = _g.sent();
                        _g.label = 2;
                    case 2:
                        if (!(_i < _a.length)) return [3 /*break*/, 4];
                        _b = _a[_i], item = _b.item, type = _b.type;
                        if (type !== 'removed') {
                            reload.push(item);
                        }
                        if (type === 'modified' && !(item instanceof item_1.Package)) {
                            invalidated.push(item);
                        }
                        _g.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 2];
                    case 4: return [4 /*yield*/, __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_resolveViewItems).call(this, reload, true)];
                    case 5:
                        items = _g.sent();
                        return [4 /*yield*/, Promise.all(items.map(function (x) { return _this.reloadViewItem(x); }))];
                    case 6:
                        _g.sent();
                        invalidate && ((_f = (_e = __classPrivateFieldGet(this, _TestResolver_ctrl, "f")).invalidateTestResults) === null || _f === void 0 ? void 0 : _f.call(_e, items));
                        // Notify listeners
                        return [4 /*yield*/, __classPrivateFieldGet(this, _TestResolver_didChangeTestItem, "f").fire(reload)];
                    case 7:
                        // Notify listeners
                        _g.sent();
                        _c = invalidate;
                        if (!_c) return [3 /*break*/, 9];
                        return [4 /*yield*/, __classPrivateFieldGet(this, _TestResolver_didInvalidateTestResults, "f").fire(invalidated)];
                    case 8:
                        _c = (_g.sent());
                        _g.label = 9;
                    case 9:
                        _c;
                        return [2 /*return*/];
                }
            });
        });
    };
    return TestResolver;
}());
exports.TestResolver = TestResolver;
_TestResolver_didChangeTestItem = new WeakMap(), _TestResolver_didInvalidateTestResults = new WeakMap(), _TestResolver_context = new WeakMap(), _TestResolver_ctrl = new WeakMap(), _TestResolver_items = new WeakMap(), _TestResolver_goRoots = new WeakMap(), _TestResolver_instances = new WeakSet(), _TestResolver_createOrUpdate = function _TestResolver_createOrUpdate(goItem_1, children_1) {
    return __awaiter(this, arguments, void 0, function (goItem, children, add) {
        var id, tags, existing, item;
        if (add === void 0) { add = false; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    id = __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_id).call(this, goItem);
                    __classPrivateFieldGet(this, _TestResolver_items, "f").set(id, goItem);
                    tags = [];
                    if (goItem instanceof item_1.RootItem) {
                        tags.push({ id: 'canRun' });
                    }
                    else if (goItem instanceof item_1.Package || goItem instanceof item_1.TestFile || goItem instanceof item_1.TestCase) {
                        tags.push({ id: 'canRun' });
                        tags.push({ id: 'canDebug' });
                    }
                    else {
                        // Profiles shouldn't be runnable but making them not runnable
                        // causes bugs: https://github.com/microsoft/vscode/issues/229120
                        tags.push({ id: 'canRun' });
                    }
                    existing = children.get(id);
                    item = existing || __classPrivateFieldGet(this, _TestResolver_ctrl, "f").createTestItem(id, goItem.label, goItem.uri);
                    item.canResolveChildren = goItem.hasChildren;
                    item.range = goItem.range;
                    item.error = goItem.error;
                    item.tags = tags;
                    if (add) {
                        children.add(item);
                    }
                    if (!!(goItem instanceof item_1.RootItem)) return [3 /*break*/, 2];
                    return [4 /*yield*/, this.reloadViewItem(item)];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/, item];
            }
        });
    });
}, _TestResolver_id = function _TestResolver_id(item) {
    if (item instanceof item_1.TestCase) {
        return "".concat(item.uri, "?").concat(item.kind, "#").concat(item.name);
    }
    if (item instanceof profile_1.ProfileContainer) {
        return JSON.stringify({ kind: item.kind, of: __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_id).call(this, item.parent) });
    }
    else if (item instanceof profile_1.ProfileSet) {
        return JSON.stringify({ kind: item.kind, of: __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_id).call(this, item.parent.parent), at: item.time.getTime() });
    }
    else if (item instanceof profile_1.CapturedProfile) {
        return JSON.stringify({
            profile: item.type.id,
            of: __classPrivateFieldGet(this, _TestResolver_instances, "m", _TestResolver_id).call(this, item.parent.parent.parent),
            at: item.parent.time.getTime(),
        });
    }
    return "".concat(item.uri, "?").concat(item.kind);
}, _TestResolver_resolveViewItems = function _TestResolver_resolveViewItems(goItems_1) {
    return __awaiter(this, arguments, void 0, function (goItems, create) {
        var toReload, config, _i, goItems_2, item, items;
        var _this = this;
        if (create === void 0) { create = false; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    toReload = [];
                    config = new config_1.TestConfig(__classPrivateFieldGet(this, _TestResolver_context, "f").workspace);
                    for (_i = 0, goItems_2 = goItems; _i < goItems_2.length; _i++) {
                        item = goItems_2[_i];
                        if (item instanceof item_1.TestCase) {
                            toReload.push(item);
                            continue;
                        }
                        if (item instanceof item_1.Package ? item.isRootPkg : !config.for(item.uri).showFiles()) {
                            toReload.push(item.getParent());
                        }
                        else {
                            toReload.push(item);
                        }
                    }
                    if (!create) return [3 /*break*/, 2];
                    return [4 /*yield*/, Promise.all(toReload.map(function (x) { return _this.getOrCreateAll(x); }))];
                case 1: return [2 /*return*/, _a.sent()];
                case 2: return [4 /*yield*/, Promise.all(toReload.map(function (x) { return _this.get(x); }))];
                case 3:
                    items = _a.sent();
                    return [2 /*return*/, items.filter(function (x) { return x; })];
            }
        });
    });
};
