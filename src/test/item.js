"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
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
var _RootSet_instances, _RootSet_didLoad, _RootSet_context, _RootSet_roots, _RootSet_requested, _RootSet_getChildren, _RootSet_getWorkspaceRoots, _RootSet_getModule, _RootSet_getWorkspace, _RootItem_instances, _RootItem_didLoad, _RootItem_context, _RootItem_requested, _RootItem_packages, _RootItem_rebuildPackageRelations, _Package_config, _TestFile_config, _TestCase_config, _StaticTestCase_src, _RelationMap_childParent, _RelationMap_parentChild, _ItemSet_items;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ItemSet = exports.RelationMap = exports.DynamicTestCase = exports.StaticTestCase = exports.TestCase = exports.TestFile = exports.Package = exports.WorkspaceItem = exports.Module = exports.RootItem = exports.RootSet = void 0;
exports.findParentTestCase = findParentTestCase;
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-namespace */
var vscode_1 = require("vscode");
var path_1 = require("path");
var config_1 = require("./config");
var deep_equal_1 = require("deep-equal");
var profile_1 = require("./profile");
/**
 * Contains the top-level items for all workspaces.
 */
var RootSet = /** @class */ (function () {
    function RootSet(context) {
        _RootSet_instances.add(this);
        _RootSet_didLoad.set(this, false);
        _RootSet_context.set(this, void 0);
        _RootSet_roots.set(this, new Map());
        _RootSet_requested.set(this, new Set());
        __classPrivateFieldSet(this, _RootSet_context, context, "f");
    }
    RootSet.prototype[(_RootSet_didLoad = new WeakMap(), _RootSet_context = new WeakMap(), _RootSet_roots = new WeakMap(), _RootSet_requested = new WeakMap(), _RootSet_instances = new WeakSet(), Symbol.iterator)] = function () {
        var _i, _a, ws;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _i = 0, _a = __classPrivateFieldGet(this, _RootSet_roots, "f").values();
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    ws = _a[_i];
                    return [5 /*yield**/, __values(ws)];
                case 2:
                    _b.sent();
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/];
            }
        });
    };
    /**
     * Marks the root as requested so that it is included by getChildren when
     * discovery is off.
     */
    RootSet.prototype.markRequested = function (root) {
        __classPrivateFieldGet(this, _RootSet_requested, "f").add("".concat(root.uri));
    };
    RootSet.prototype.getChildren = function () {
        return __awaiter(this, void 0, void 0, function () {
            var items, _i, _a, root, mode;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        items = [];
                        _i = 0;
                        return [4 /*yield*/, __classPrivateFieldGet(this, _RootSet_instances, "m", _RootSet_getChildren).call(this, true)];
                    case 1:
                        _a = _b.sent();
                        _b.label = 2;
                    case 2:
                        if (!(_i < _a.length)) return [3 /*break*/, 4];
                        root = _a[_i];
                        mode = root.config.discovery();
                        if (mode === 'on' || __classPrivateFieldGet(this, _RootSet_requested, "f").has("".concat(root.uri))) {
                            items.push(root);
                        }
                        _b.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 2];
                    case 4: return [2 /*return*/, items];
                }
            });
        });
    };
    /**
     * Called when a file is updated.
     *
     * @param ws - The workspace folder of the file.
     * @param uri - The updated file.
     */
    RootSet.prototype.didUpdate = function (ws_1, uri_1) {
        return __awaiter(this, arguments, void 0, function (ws, uri, ranges) {
            var packages, _a, _b, _c, findOpts, updated, _i, packages_1, pkg, root;
            var _d;
            if (ranges === void 0) { ranges = {}; }
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        _b = (_a = Package).resolve;
                        _c = [ws.uri,
                            new config_1.TestConfig(__classPrivateFieldGet(this, _RootSet_context, "f").workspace, uri)];
                        return [4 /*yield*/, __classPrivateFieldGet(this, _RootSet_context, "f").commands.packages({
                                Files: [uri.toString()],
                                Mode: 1,
                            })];
                    case 1:
                        packages = _b.apply(_a, _c.concat([_e.sent()]));
                        findOpts = { tryReload: true };
                        updated = [];
                        _i = 0, packages_1 = packages;
                        _e.label = 2;
                    case 2:
                        if (!(_i < packages_1.length)) return [3 /*break*/, 5];
                        pkg = packages_1[_i];
                        // This shouldn't happen, but just in case
                        if (!((_d = pkg.TestFiles) === null || _d === void 0 ? void 0 : _d.length))
                            return [3 /*break*/, 4];
                        return [4 /*yield*/, this.getRootFor(pkg, findOpts)];
                    case 3:
                        root = _e.sent();
                        if (!root)
                            return [3 /*break*/, 4]; // TODO: Handle tests from external packages?
                        // Mark the package as requested
                        this.markRequested(root);
                        root.markRequested(pkg);
                        // Update the package
                        updated.push.apply(updated, root.updatePackage(pkg, ranges));
                        _e.label = 4;
                    case 4:
                        _i++;
                        return [3 /*break*/, 2];
                    case 5: return [2 /*return*/, updated];
                }
            });
        });
    };
    /**
     * Retrieves the root a given package belongs to.
     *
     * @param pkg - The package for which to retrieve the root.
     * @param opts - Options for retrieving the root.
     * @param opts.tryReload - Specifies whether to try reloading the roots.
     * @returns The root for the package or undefined if the package does not belong to any workspace.
     * @throws Error if the package contains no test files.
     */
    RootSet.prototype.getRootFor = function (pkg, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var ws, mod, config;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!((_a = pkg.TestFiles) === null || _a === void 0 ? void 0 : _a.length)) {
                            throw new Error('package contains no test files');
                        }
                        ws = __classPrivateFieldGet(this, _RootSet_context, "f").workspace.getWorkspaceFolder(vscode_1.Uri.parse(pkg.TestFiles[0].URI));
                        if (!ws) {
                            return [2 /*return*/];
                        }
                        if (!!__classPrivateFieldGet(this, _RootSet_didLoad, "f")) return [3 /*break*/, 2];
                        opts.tryReload = false;
                        return [4 /*yield*/, __classPrivateFieldGet(this, _RootSet_instances, "m", _RootSet_getChildren).call(this)];
                    case 1:
                        _b.sent();
                        _b.label = 2;
                    case 2:
                        if (!pkg.ModulePath) return [3 /*break*/, 5];
                        mod = __classPrivateFieldGet(this, _RootSet_instances, "m", _RootSet_getModule).call(this, pkg.ModulePath);
                        if (mod)
                            return [2 /*return*/, mod];
                        if (!opts.tryReload) return [3 /*break*/, 4];
                        opts.tryReload = false;
                        return [4 /*yield*/, __classPrivateFieldGet(this, _RootSet_instances, "m", _RootSet_getChildren).call(this, true)];
                    case 3:
                        _b.sent();
                        _b.label = 4;
                    case 4:
                        // Check again
                        mod = __classPrivateFieldGet(this, _RootSet_instances, "m", _RootSet_getModule).call(this, pkg.ModulePath);
                        if (mod)
                            return [2 /*return*/, mod];
                        _b.label = 5;
                    case 5:
                        config = new config_1.TestConfig(__classPrivateFieldGet(this, _RootSet_context, "f").workspace, ws.uri);
                        return [2 /*return*/, __classPrivateFieldGet(this, _RootSet_instances, "m", _RootSet_getWorkspace).call(this, new WorkspaceItem(config, __classPrivateFieldGet(this, _RootSet_context, "f"), ws))];
                }
            });
        });
    };
    return RootSet;
}());
exports.RootSet = RootSet;
_RootSet_getChildren = function _RootSet_getChildren() {
    return __awaiter(this, arguments, void 0, function (reload) {
        var _this = this;
        if (reload === void 0) { reload = false; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // Use the cached roots when possible
                    if ((!reload && __classPrivateFieldGet(this, _RootSet_didLoad, "f")) || !__classPrivateFieldGet(this, _RootSet_context, "f").workspace.workspaceFolders) {
                        return [2 /*return*/, __spreadArray([], __classPrivateFieldGet(this, _RootSet_roots, "f").values(), true).flatMap(function (x) { return __spreadArray([], x.values(), true); })];
                    }
                    __classPrivateFieldSet(this, _RootSet_didLoad, true, "f");
                    // For each workspace folder
                    return [4 /*yield*/, Promise.all(__classPrivateFieldGet(this, _RootSet_context, "f").workspace.workspaceFolders.map(function (ws) { return __awaiter(_this, void 0, void 0, function () {
                            var roots, set;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, __classPrivateFieldGet(this, _RootSet_instances, "m", _RootSet_getWorkspaceRoots).call(this, ws)];
                                    case 1:
                                        roots = _a.sent();
                                        set = __classPrivateFieldGet(this, _RootSet_roots, "f").get("".concat(ws.uri));
                                        if (set) {
                                            set.replace(roots);
                                        }
                                        else {
                                            __classPrivateFieldGet(this, _RootSet_roots, "f").set("".concat(ws.uri), new ItemSet(roots));
                                        }
                                        return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 1:
                    // For each workspace folder
                    _a.sent();
                    // Return a flat list of roots. Do not separate by workspace folder.
                    return [2 /*return*/, __spreadArray([], __classPrivateFieldGet(this, _RootSet_roots, "f").values(), true).flatMap(function (x) { return __spreadArray([], x.values(), true); })];
            }
        });
    });
}, _RootSet_getWorkspaceRoots = function _RootSet_getWorkspaceRoots(ws) {
    return __awaiter(this, void 0, void 0, function () {
        var config, modules, _a, _b, _c, roots;
        var _this = this;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    config = new config_1.TestConfig(__classPrivateFieldGet(this, _RootSet_context, "f").workspace, ws.uri);
                    _b = (_a = Module).resolve;
                    _c = [ws.uri,
                        config];
                    return [4 /*yield*/, __classPrivateFieldGet(this, _RootSet_context, "f").commands.modules({
                            Dir: ws.uri.toString(),
                            MaxDepth: -1,
                        })];
                case 1:
                    modules = _b.apply(_a, _c.concat([_d.sent()]));
                    roots = [];
                    if (!modules.some(function (x) { return vscode_1.Uri.joinPath(vscode_1.Uri.parse(x.GoMod), '..').toString() === ws.uri.toString(); })) {
                        roots.push(new WorkspaceItem(config, __classPrivateFieldGet(this, _RootSet_context, "f"), ws));
                    }
                    // Make an item for each module
                    roots.push.apply(roots, modules.map(function (x) { return new Module(ws.uri, config, __classPrivateFieldGet(_this, _RootSet_context, "f"), x); }));
                    return [2 /*return*/, roots];
            }
        });
    });
}, _RootSet_getModule = function _RootSet_getModule(path) {
    for (var _i = 0, _a = __classPrivateFieldGet(this, _RootSet_roots, "f").values(); _i < _a.length; _i++) {
        var items = _a[_i];
        for (var _b = 0, _c = items.values(); _b < _c.length; _b++) {
            var item = _c[_b];
            if (item instanceof Module && item.path === path) {
                return item;
            }
        }
    }
}, _RootSet_getWorkspace = function _RootSet_getWorkspace(item) {
    var wsKey = item.uri.toString();
    var roots = __classPrivateFieldGet(this, _RootSet_roots, "f").get(wsKey);
    if (!roots) {
        __classPrivateFieldGet(this, _RootSet_roots, "f").set(wsKey, new ItemSet([item]));
        return item;
    }
    if (roots.has(item)) {
        return roots.get(item);
    }
    roots.add(item);
    return item;
};
/**
 * Common ancestor of {@link Module} and {@link WorkspaceItem}.
 */
var RootItem = /** @class */ (function () {
    function RootItem(config, context) {
        _RootItem_instances.add(this);
        this.hasChildren = true;
        this.pkgRelations = new RelationMap();
        _RootItem_didLoad.set(this, false);
        _RootItem_context.set(this, void 0);
        _RootItem_requested.set(this, new Set());
        _RootItem_packages.set(this, new ItemSet());
        this.config = config;
        __classPrivateFieldSet(this, _RootItem_context, context, "f");
    }
    Object.defineProperty(RootItem.prototype, "key", {
        get: function () {
            return "".concat(this.uri);
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Marks a package as requested by the user (e.g. by opening a file).
     */
    RootItem.prototype.markRequested = function (pkg) {
        __classPrivateFieldGet(this, _RootItem_requested, "f").add(pkg.Path);
    };
    /**
     * Retrieves the children of the root item. If this item has a root package,
     * the children of that package are returned instead of the package itself.
     * If package nesting is enabled, nested packages are excluded.
     */
    RootItem.prototype.getChildren = function () {
        return __awaiter(this, void 0, void 0, function () {
            var allPkgs, packages, rootPkg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getPackages(true)];
                    case 1:
                        allPkgs = _a.sent();
                        packages = (this.config.nestPackages() && this.pkgRelations.getChildren(undefined)) || allPkgs;
                        rootPkg = packages.find(function (x) { return x.isRootPkg; });
                        return [2 /*return*/, __spreadArray(__spreadArray([], packages.filter(function (x) { return x !== rootPkg; }), true), ((rootPkg === null || rootPkg === void 0 ? void 0 : rootPkg.getChildren()) || []), true)];
                }
            });
        });
    };
    /**
     * Creates or updates a {@link Package} with data from gopls.
     * @param pkg The data from gopls.
     * @param ranges Modified file ranges.
     * @returns A list of update events.
     */
    RootItem.prototype.updatePackage = function (pkg, ranges) {
        var existing = __classPrivateFieldGet(this, _RootItem_packages, "f").get(pkg.Path);
        if (existing) {
            return existing.update(pkg, ranges);
        }
        var newPkg = new Package(this.config, this, pkg);
        __classPrivateFieldGet(this, _RootItem_packages, "f").add(newPkg);
        __classPrivateFieldGet(this, _RootItem_instances, "m", _RootItem_rebuildPackageRelations).call(this);
        return __spreadArray([{ item: newPkg, type: 'added' }], newPkg.update(pkg, ranges), true);
    };
    /**
     * Returns packages, reloading if necessary or requested. If discovery is
     * disabled, only requested packages are returned.
     */
    RootItem.prototype.getPackages = function () {
        return __awaiter(this, arguments, void 0, function (reload) {
            var _a, _b, _c, _d, _e, mode, packages, _i, _f, pkg;
            var _this = this;
            if (reload === void 0) { reload = false; }
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        if (!(reload || !__classPrivateFieldGet(this, _RootItem_didLoad, "f"))) return [3 /*break*/, 2];
                        // (Re)load packages
                        __classPrivateFieldSet(this, _RootItem_didLoad, true, "f");
                        _b = (_a = __classPrivateFieldGet(this, _RootItem_packages, "f")).update;
                        _d = (_c = Package).resolve;
                        _e = [this.root,
                            this.config];
                        return [4 /*yield*/, __classPrivateFieldGet(this, _RootItem_context, "f").commands.packages({
                                Files: [this.dir.toString()],
                                Mode: 1,
                                Recursive: true,
                            })];
                    case 1:
                        _b.apply(_a, [_d.apply(_c, _e.concat([_g.sent()])),
                            function (src) { return src.Path; },
                            function (src) { return new Package(_this.config, _this, src); },
                            function (src, pkg) { return pkg.update(src, {}); }]);
                        __classPrivateFieldGet(this, _RootItem_instances, "m", _RootItem_rebuildPackageRelations).call(this);
                        _g.label = 2;
                    case 2:
                        mode = this.config.discovery();
                        switch (mode) {
                            case 'on':
                                // Return all packages
                                return [2 /*return*/, __spreadArray([], __classPrivateFieldGet(this, _RootItem_packages, "f").values(), true)];
                            default: {
                                packages = [];
                                for (_i = 0, _f = __classPrivateFieldGet(this, _RootItem_packages, "f").values(); _i < _f.length; _i++) {
                                    pkg = _f[_i];
                                    if (__classPrivateFieldGet(this, _RootItem_requested, "f").has(pkg.path)) {
                                        packages.push(pkg);
                                    }
                                }
                                return [2 /*return*/, packages];
                            }
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    return RootItem;
}());
exports.RootItem = RootItem;
_RootItem_didLoad = new WeakMap(), _RootItem_context = new WeakMap(), _RootItem_requested = new WeakMap(), _RootItem_packages = new WeakMap(), _RootItem_instances = new WeakSet(), _RootItem_rebuildPackageRelations = function _RootItem_rebuildPackageRelations() {
    var pkgs = __spreadArray([], __classPrivateFieldGet(this, _RootItem_packages, "f").values(), true);
    this.pkgRelations.replace(pkgs.map(function (pkg) {
        var ancestors = pkgs.filter(function (x) { return pkg.path.startsWith("".concat(x.path, "/")); });
        ancestors.sort(function (a, b) { return a.path.length - b.path.length; });
        return [pkg, ancestors[0]];
    }));
};
var Module = /** @class */ (function (_super) {
    __extends(Module, _super);
    function Module(root, config, context, mod) {
        var _this = _super.call(this, config, context) || this;
        _this.kind = 'module';
        _this.root = root;
        _this.uri = vscode_1.Uri.parse(mod.GoMod);
        _this.path = mod.Path;
        return _this;
    }
    /**
     * Filters out excluded modules from a list of modules provided by gopls.
     * @param root The root URI to use for relative path patterns.
     * @param config The user's configuration.
     * @param modules The modules provided by gopls.
     * @returns The filtered modules.
     */
    Module.resolve = function (root, config, _a) {
        var Modules = _a.Modules;
        if (!Modules)
            return [];
        var exclude = config.exclude() || [];
        return Modules.filter(function (m) {
            var p = path_1.default.relative(root.fsPath, m.Path);
            return !exclude.some(function (x) { return x.match(p); });
        });
    };
    Object.defineProperty(Module.prototype, "label", {
        get: function () {
            return this.path;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Module.prototype, "dir", {
        get: function () {
            return vscode_1.Uri.joinPath(this.uri, '..');
        },
        enumerable: false,
        configurable: true
    });
    return Module;
}(RootItem));
exports.Module = Module;
var WorkspaceItem = /** @class */ (function (_super) {
    __extends(WorkspaceItem, _super);
    function WorkspaceItem(config, context, ws) {
        var _this = _super.call(this, config, context) || this;
        _this.kind = 'workspace';
        _this.ws = ws;
        return _this;
    }
    Object.defineProperty(WorkspaceItem.prototype, "uri", {
        get: function () {
            return this.ws.uri;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(WorkspaceItem.prototype, "dir", {
        get: function () {
            return this.ws.uri;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(WorkspaceItem.prototype, "root", {
        get: function () {
            return this.ws.uri;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(WorkspaceItem.prototype, "label", {
        get: function () {
            return "".concat(this.ws.name, " (workspace)");
        },
        enumerable: false,
        configurable: true
    });
    return WorkspaceItem;
}(RootItem));
exports.WorkspaceItem = WorkspaceItem;
var Package = /** @class */ (function () {
    function Package(config, parent, src) {
        _Package_config.set(this, void 0);
        this.kind = 'package';
        this.hasChildren = true;
        this.files = new ItemSet();
        this.testRelations = new RelationMap();
        this.profiles = new profile_1.ProfileContainer(this);
        __classPrivateFieldSet(this, _Package_config, config, "f");
        this.parent = parent;
        this.path = src.Path;
        this.uri = vscode_1.Uri.joinPath(vscode_1.Uri.parse(src.TestFiles[0].URI), '..');
    }
    /**
     * Consolidates test and source package data from gopls and filters out
     * excluded packages.
     *
     * If a directory contains `foo.go`, `foo_test.go`, and `foo2_test.go` with
     * package directives `foo`, `foo`, and `foo_test`, respectively, gopls will
     * report those as three separate packages. This function consolidates them
     * into a single package.
     * @param root The root URI to use for relative path patterns.
     * @param config The user's configuration.
     * @param packages Data provided by gopls.
     * @returns The consolidated and filtered package data.
     */
    Package.resolve = function (root, config, _a) {
        var _b = _a.Packages, all = _b === void 0 ? [] : _b;
        if (!all)
            return [];
        // Consolidate `foo` and `foo_test` into a single Package
        var paths = new Set(all.filter(function (x) { return x.TestFiles; }).map(function (x) { return x.ForTest || x.Path; }));
        var results = [];
        var exclude = config.exclude() || [];
        var _loop_1 = function (pkgPath) {
            var pkgs = all.filter(function (x) { return x.Path === pkgPath || x.ForTest === pkgPath; });
            var files = pkgs
                .flatMap(function (x) { return x.TestFiles || []; })
                .filter(function (m) {
                var p = path_1.default.relative(root.fsPath, vscode_1.Uri.parse(m.URI).fsPath);
                return !exclude.some(function (x) { return x.match(p); });
            });
            if (!files.length) {
                return "continue";
            }
            results.push({
                Path: pkgPath,
                ModulePath: pkgs[0].ModulePath,
                TestFiles: files,
            });
        };
        for (var _i = 0, paths_1 = paths; _i < paths_1.length; _i++) {
            var pkgPath = paths_1[_i];
            _loop_1(pkgPath);
        }
        return results;
    };
    /**
     * Updates the package with data from gopls.
     * @param src The data from gopls.
     * @param ranges Modified file ranges.
     * @returns Update events. See {@link ItemEvent}.
     */
    Package.prototype.update = function (src, ranges) {
        var _this = this;
        // Apply the update
        var changes = this.files.update(src.TestFiles.filter(function (x) { return x.Tests.length; }), function (src) { return src.URI; }, function (src) { return new TestFile(__classPrivateFieldGet(_this, _Package_config, "f"), _this, src); }, function (src, file) { return file.update(src, ranges["".concat(file.uri)] || []); });
        if (!changes.length) {
            return [];
        }
        // Recalculate test-subtest relations
        var allTests = this.getTests();
        this.testRelations.replace(allTests.map(function (test) { return [test, findParentTestCase(allTests, test.name)]; }));
        return changes;
    };
    Object.defineProperty(Package.prototype, "key", {
        get: function () {
            return this.path;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Package.prototype, "label", {
        /**
         * Returns the package path, excluding the part that is shared with the
         * parent.
         */
        get: function () {
            var pkgParent = this.parent.pkgRelations.getParent(this);
            if (pkgParent && __classPrivateFieldGet(this, _Package_config, "f").nestPackages()) {
                return this.path.substring(pkgParent.path.length + 1);
            }
            if (this.parent instanceof Module && this.path.startsWith("".concat(this.parent.path, "/"))) {
                return this.path.substring(this.parent.path.length + 1);
            }
            return this.path;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Package.prototype, "isRootPkg", {
        /**
         * Returns whether the package is the root package of the parent.
         */
        get: function () {
            return "".concat(this.uri) === "".concat(this.parent.dir);
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Returns the module or folder this package belongs to, or its parent
     * package if package nesting is enabled.
     */
    Package.prototype.getParent = function () {
        if (!__classPrivateFieldGet(this, _Package_config, "f").nestPackages()) {
            return this.parent;
        }
        return this.parent.pkgRelations.getParent(this) || this.parent;
    };
    /**
     * Returns the package's children. If show files is enabled, this includes
     * the package's test files, otherwise it includes the children of those
     * files. If package nesting is enabled, this includes the package's child
     * packages.
     */
    Package.prototype.getChildren = function () {
        var children = [];
        var tests = __classPrivateFieldGet(this, _Package_config, "f").showFiles() ? __spreadArray([], this.files, true) : __spreadArray([], this.files, true).flatMap(function (x) { return x.getChildren(); });
        if (__classPrivateFieldGet(this, _Package_config, "f").nestPackages()) {
            children.push.apply(children, (this.parent.pkgRelations.getChildren(this) || []));
        }
        children.push.apply(children, tests);
        if (this.profiles.hasChildren) {
            children.push(this.profiles);
        }
        return children;
    };
    /**
     * @returns All tests in the package in a flat list.
     */
    Package.prototype.getTests = function () {
        return __spreadArray([], this.files, true).flatMap(function (x) { return __spreadArray([], x.tests, true); });
    };
    /**
     * Finds a test with the specified name.
     *
     * @param name - The name of the test to find.
     * @param create - Specifies whether to create a dynamic subtest if it doesn't exist.
     * @returns The found test, if found or successfully created.
     */
    Package.prototype.findTest = function (name, create) {
        if (create === void 0) { create = false; }
        // Check for an exact match
        for (var _i = 0, _a = this.files; _i < _a.length; _i++) {
            var file = _a[_i];
            for (var _b = 0, _c = file.tests; _b < _c.length; _b++) {
                var test_1 = _c[_b];
                if (test_1.name === name) {
                    return test_1;
                }
            }
        }
        if (!create)
            return;
        // Find the parent test case and create a dynamic subtest
        var parent = findParentTestCase(this.getTests(), name);
        return parent === null || parent === void 0 ? void 0 : parent.makeDynamicTestCase(name);
    };
    return Package;
}());
exports.Package = Package;
_Package_config = new WeakMap();
var TestFile = /** @class */ (function () {
    function TestFile(config, pkg, src) {
        _TestFile_config.set(this, void 0);
        this.kind = 'file';
        this.hasChildren = true;
        this.tests = new ItemSet();
        __classPrivateFieldSet(this, _TestFile_config, config, "f");
        this.package = pkg;
        this.uri = vscode_1.Uri.parse(src.URI);
    }
    /**
     * Updates the file with data from gopls.
     * @param src The data from gopls.
     * @param ranges Modified file ranges.
     * @returns Update events. See {@link ItemEvent}.
     */
    TestFile.prototype.update = function (src, ranges) {
        var _this = this;
        return this.tests.update(src.Tests, function (src) { return src.Name; }, function (src) { return new StaticTestCase(__classPrivateFieldGet(_this, _TestFile_config, "f"), _this, src); }, function (src, test) { return test.update(src, ranges); }, function (test) { return test instanceof DynamicTestCase; });
    };
    Object.defineProperty(TestFile.prototype, "key", {
        get: function () {
            return "".concat(this.uri);
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestFile.prototype, "label", {
        get: function () {
            return path_1.default.basename(this.uri.fsPath);
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Returns the file's package, or the package's parent if it is a root
     * package.
     */
    TestFile.prototype.getParent = function () {
        if (this.package.isRootPkg) {
            return this.package.getParent();
        }
        return this.package;
    };
    /**
     * Returns top-level tests if subtests nesting is enabled, otherwise all
     * tests.
     */
    TestFile.prototype.getChildren = function () {
        var _this = this;
        if (__classPrivateFieldGet(this, _TestFile_config, "f").nestSubtests()) {
            return __spreadArray([], this.tests, true).filter(function (x) { return !_this.package.testRelations.getParent(x); });
        }
        return __spreadArray([], this.tests, true);
    };
    return TestFile;
}());
exports.TestFile = TestFile;
_TestFile_config = new WeakMap();
var TestCase = /** @class */ (function () {
    function TestCase(config, file, uri, kind, name) {
        _TestCase_config.set(this, void 0);
        this.profiles = new profile_1.ProfileContainer(this);
        __classPrivateFieldSet(this, _TestCase_config, config, "f");
        this.file = file;
        this.uri = uri;
        this.kind = kind;
        this.name = name;
    }
    Object.defineProperty(TestCase.prototype, "key", {
        get: function () {
            return this.name;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestCase.prototype, "label", {
        get: function () {
            // If we are a subtest, remove the parent's name from the label
            var parent = this.getParent();
            if (parent instanceof TestCase) {
                return this.name.replace("".concat(parent.name, "/"), '');
            }
            return this.name;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestCase.prototype, "hasChildren", {
        get: function () {
            return this.getChildren().length > 0;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * Returns the parent test case if the test is a subtest and nesting is
     * enabled. Otherwise, returns the file if files are shown or the file's
     * parent.
     */
    TestCase.prototype.getParent = function () {
        var parentTest = __classPrivateFieldGet(this, _TestCase_config, "f").nestSubtests() && this.file.package.testRelations.getParent(this);
        if (parentTest) {
            return parentTest;
        }
        if (__classPrivateFieldGet(this, _TestCase_config, "f").showFiles()) {
            return this.file;
        }
        return this.file.getParent();
    };
    /**
     * Returns subtests if nesting is enabled, otherwise nothing.
     */
    TestCase.prototype.getChildren = function () {
        var children = [];
        if (this.profiles.hasChildren) {
            children.push(this.profiles);
        }
        if (__classPrivateFieldGet(this, _TestCase_config, "f").nestSubtests()) {
            children.push.apply(children, (this.file.package.testRelations.getChildren(this) || []));
        }
        return children;
    };
    /**
     * Create a new {@link DynamicTestCase} as a child of this test case. If the
     * total number of this test's children exceeds the limit, no test is
     * created.
     */
    TestCase.prototype.makeDynamicTestCase = function (name) {
        var _a;
        var limit = __classPrivateFieldGet(this, _TestCase_config, "f").dynamicSubtestLimit();
        if (limit && limit > 0 && (((_a = this.file.package.testRelations.getChildren(this)) === null || _a === void 0 ? void 0 : _a.length) || 0) >= limit) {
            // TODO: Give some indication to the user?
            return;
        }
        var child = new DynamicTestCase(__classPrivateFieldGet(this, _TestCase_config, "f"), this, name);
        this.file.tests.add(child);
        this.file.package.testRelations.add(this, child);
        return child;
    };
    /**
     * Deletes all {@link DynamicTestCase}s that are children of this test case.
     */
    TestCase.prototype.removeDynamicTestCases = function () {
        for (var _i = 0, _a = this.file.package.testRelations.getChildren(this) || []; _i < _a.length; _i++) {
            var item = _a[_i];
            item.removeDynamicTestCases();
            this.file.tests.remove(item);
        }
        this.file.package.testRelations.removeChildren(this);
    };
    return TestCase;
}());
exports.TestCase = TestCase;
_TestCase_config = new WeakMap();
var StaticTestCase = /** @class */ (function (_super) {
    __extends(StaticTestCase, _super);
    function StaticTestCase(config, file, src) {
        var _this = this;
        var uri = vscode_1.Uri.parse(src.Loc.uri);
        var kind = src.Name.match(/^(Test|Fuzz|Benchmark|Example)/)[1].toLowerCase();
        _this = _super.call(this, config, file, uri, kind, src.Name) || this;
        _StaticTestCase_src.set(_this, void 0);
        return _this;
    }
    /**
     * Updates the test case with data from gopls.
     * @param src The data from gopls.
     * @param ranges Modified file ranges.
     * @returns Update events. See {@link ItemEvent}.
     */
    StaticTestCase.prototype.update = function (src, ranges) {
        var _this = this;
        // Did the metadata (range) change?
        var metadata = !(0, deep_equal_1.default)(src, __classPrivateFieldGet(this, _StaticTestCase_src, "f"));
        // Did the contents change?
        var contents = ranges.some(function (x) { return _this.contains(x); });
        if (!metadata && !contents) {
            return [];
        }
        // Update the range
        if (metadata) {
            var _a = src.Loc.range, start = _a.start, end = _a.end;
            __classPrivateFieldSet(this, _StaticTestCase_src, src, "f");
            this.range = new vscode_1.Range(start.line, start.character, end.line, end.character);
        }
        // Return the appropriate event
        return [{ item: this, type: contents ? 'modified' : 'moved' }];
    };
    /**
     * Determines whether the test case contains a given range. The range must
     * be strictly contained within the test's range. If the intersection
     * includes regions outside of the test, or intersects the end or the
     * beginning but has a size of zero, this will return false.
     */
    StaticTestCase.prototype.contains = function (range) {
        // The range of the test must be defined
        if (!this.range)
            return false;
        // The test must contain the given range
        if (!this.range.contains(range))
            return false;
        // The intersection must be strictly within the test range. If the
        // intersection is an empty range at the very start or end of the test's
        // range, reject it.
        var r = this.range.intersection(range);
        if (!r.isEmpty)
            return true;
        return !r.start.isEqual(this.range.start) && !r.end.isEqual(this.range.end);
    };
    return StaticTestCase;
}(TestCase));
exports.StaticTestCase = StaticTestCase;
_StaticTestCase_src = new WeakMap();
var DynamicTestCase = /** @class */ (function (_super) {
    __extends(DynamicTestCase, _super);
    function DynamicTestCase(config, parent, name) {
        return _super.call(this, config, parent.file, parent.uri, parent.kind, name) || this;
    }
    return DynamicTestCase;
}(TestCase));
exports.DynamicTestCase = DynamicTestCase;
/**
 * Searches a set of tests for a test case that is the parent of the given test
 * name.
 */
function findParentTestCase(allTests, name) {
    for (;;) {
        var i = name.lastIndexOf('/');
        if (i < 0)
            return;
        name = name.substring(0, i);
        for (var _i = 0, allTests_1 = allTests; _i < allTests_1.length; _i++) {
            var test_2 = allTests_1[_i];
            if (test_2.name === name) {
                return test_2;
            }
        }
    }
}
/**
 * Bidirectional map for parent-child relationships.
 */
var RelationMap = /** @class */ (function () {
    function RelationMap(relations) {
        if (relations === void 0) { relations = []; }
        _RelationMap_childParent.set(this, new Map());
        _RelationMap_parentChild.set(this, new Map());
        for (var _i = 0, relations_1 = relations; _i < relations_1.length; _i++) {
            var _a = relations_1[_i], child = _a[0], parent_1 = _a[1];
            this.add(parent_1, child);
        }
    }
    RelationMap.prototype.add = function (parent, child) {
        __classPrivateFieldGet(this, _RelationMap_childParent, "f").set(child, parent);
        var children = __classPrivateFieldGet(this, _RelationMap_parentChild, "f").get(parent);
        if (children) {
            children.push(child);
        }
        else {
            __classPrivateFieldGet(this, _RelationMap_parentChild, "f").set(parent, [child]);
        }
    };
    RelationMap.prototype.replace = function (relations) {
        __classPrivateFieldGet(this, _RelationMap_childParent, "f").clear();
        __classPrivateFieldGet(this, _RelationMap_parentChild, "f").clear();
        for (var _i = 0, relations_2 = relations; _i < relations_2.length; _i++) {
            var _a = relations_2[_i], child = _a[0], parent_2 = _a[1];
            this.add(parent_2, child);
        }
    };
    RelationMap.prototype.removeChildren = function (parent) {
        for (var _i = 0, _a = __classPrivateFieldGet(this, _RelationMap_parentChild, "f").get(parent) || []; _i < _a.length; _i++) {
            var child = _a[_i];
            __classPrivateFieldGet(this, _RelationMap_childParent, "f").delete(child);
        }
        __classPrivateFieldGet(this, _RelationMap_parentChild, "f").delete(parent);
    };
    RelationMap.prototype.getParent = function (child) {
        return __classPrivateFieldGet(this, _RelationMap_childParent, "f").get(child);
    };
    RelationMap.prototype.getChildren = function (parent) {
        return __classPrivateFieldGet(this, _RelationMap_parentChild, "f").get(parent);
    };
    return RelationMap;
}());
exports.RelationMap = RelationMap;
_RelationMap_childParent = new WeakMap(), _RelationMap_parentChild = new WeakMap();
var ItemSet = /** @class */ (function () {
    function ItemSet(items) {
        if (items === void 0) { items = []; }
        _ItemSet_items.set(this, void 0);
        __classPrivateFieldSet(this, _ItemSet_items, new Map(items.map(function (x) { return [x.key, x]; })), "f");
    }
    ItemSet.prototype.keys = function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [5 /*yield**/, __values(__classPrivateFieldGet(this, _ItemSet_items, "f").keys())];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    };
    ItemSet.prototype.values = function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [5 /*yield**/, __values(__classPrivateFieldGet(this, _ItemSet_items, "f").values())];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    };
    ItemSet.prototype[(_ItemSet_items = new WeakMap(), Symbol.iterator)] = function () {
        return __classPrivateFieldGet(this, _ItemSet_items, "f").values();
    };
    Object.defineProperty(ItemSet.prototype, "size", {
        get: function () {
            return __classPrivateFieldGet(this, _ItemSet_items, "f").size;
        },
        enumerable: false,
        configurable: true
    });
    ItemSet.prototype.has = function (item) {
        return __classPrivateFieldGet(this, _ItemSet_items, "f").has(typeof item === 'string' ? item : item.key);
    };
    ItemSet.prototype.get = function (item) {
        return __classPrivateFieldGet(this, _ItemSet_items, "f").get(typeof item === 'string' ? item : item.key);
    };
    ItemSet.prototype.add = function () {
        var items = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            items[_i] = arguments[_i];
        }
        for (var _a = 0, items_1 = items; _a < items_1.length; _a++) {
            var item = items_1[_a];
            if (this.has(item))
                continue;
            __classPrivateFieldGet(this, _ItemSet_items, "f").set(item.key, item);
        }
    };
    ItemSet.prototype.remove = function (item) {
        __classPrivateFieldGet(this, _ItemSet_items, "f").delete(typeof item === 'string' ? item : item.key);
    };
    /**
     * Replaces the set of items with a new set. If the existing set has items
     * with the same key, the original items are preserved.
     */
    ItemSet.prototype.replace = function (items) {
        // Insert new items
        this.add.apply(this, items);
        // Delete items that are no longer present
        var keep = new Set(items.map(function (x) { return x.key; }));
        for (var _i = 0, _a = this.keys(); _i < _a.length; _i++) {
            var key = _a[_i];
            if (!keep.has(key)) {
                this.remove(key);
            }
        }
    };
    /**
     * Replaces the set of items with a new set. For each value in source, if an
     * item with the same key exists in the set, the item is updated. Otherwise,
     * a new item is created.
     * @param src The sources to create items from.
     * @param id A function that returns the item key of a source value.
     * @param make A function that creates a new item from a source value.
     * @param update A function that updates an existing item with a source value.
     */
    ItemSet.prototype.update = function (src, id, make, update, keep) {
        if (keep === void 0) { keep = function () { return false; }; }
        // Delete items that are no longer present
        var changed = [];
        var srcKeys = new Set(src.map(id));
        for (var _i = 0, _a = __classPrivateFieldGet(this, _ItemSet_items, "f").entries(); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], item = _b[1];
            if (!srcKeys.has(key) && !keep(item)) {
                changed.push({ item: item, type: 'removed' });
                this.remove(key);
            }
        }
        // Update and insert items
        for (var _c = 0, src_1 = src; _c < src_1.length; _c++) {
            var value = src_1[_c];
            var key = id(value);
            var item = this.get(key);
            if (!item) {
                item = make(value);
                this.add(item);
                changed.push({ item: item, type: 'added' });
            }
            changed.push.apply(changed, update(value, item));
        }
        return changed;
    };
    return ItemSet;
}());
exports.ItemSet = ItemSet;
