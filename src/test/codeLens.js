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
var _CodeLensProvider_instances, _CodeLensProvider_didChangeCodeLenses, _CodeLensProvider_context, _CodeLensProvider_manager, _CodeLensProvider_fileCodeLenses, _CodeLensProvider_mode;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeLensProvider = void 0;
var config_1 = require("./config");
var item_1 = require("./item");
var eventEmitter_1 = require("../utils/eventEmitter");
var vscode_1 = require("vscode");
/**
 * Provides CodeLenses for running and debugging tests for users who prefer
 * those.
 */
var CodeLensProvider = /** @class */ (function () {
    function CodeLensProvider(context, manager) {
        _CodeLensProvider_instances.add(this);
        _CodeLensProvider_didChangeCodeLenses.set(this, new eventEmitter_1.EventEmitter());
        this.onDidChangeCodeLenses = __classPrivateFieldGet(this, _CodeLensProvider_didChangeCodeLenses, "f").event;
        _CodeLensProvider_context.set(this, void 0);
        _CodeLensProvider_manager.set(this, void 0);
        __classPrivateFieldSet(this, _CodeLensProvider_context, context, "f");
        __classPrivateFieldSet(this, _CodeLensProvider_manager, manager, "f");
    }
    /**
     * Tell the editor to reload code lenses.
     */
    CodeLensProvider.prototype.reload = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, __classPrivateFieldGet(this, _CodeLensProvider_didChangeCodeLenses, "f").fire()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Provide code lenses for a document.
     */
    CodeLensProvider.prototype.provideCodeLenses = function (document) {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, root, _b, _c, pkg, _d, _e, file;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        if (__classPrivateFieldGet(this, _CodeLensProvider_instances, "m", _CodeLensProvider_mode).call(this) === 'off') {
                            return [2 /*return*/, []];
                        }
                        _i = 0;
                        return [4 /*yield*/, __classPrivateFieldGet(this, _CodeLensProvider_manager, "f").rootGoTestItems];
                    case 1:
                        _a = _f.sent();
                        _f.label = 2;
                    case 2:
                        if (!(_i < _a.length)) return [3 /*break*/, 10];
                        root = _a[_i];
                        _b = 0;
                        return [4 /*yield*/, root.getPackages()];
                    case 3:
                        _c = _f.sent();
                        _f.label = 4;
                    case 4:
                        if (!(_b < _c.length)) return [3 /*break*/, 9];
                        pkg = _c[_b];
                        _d = 0;
                        return [4 /*yield*/, pkg.files];
                    case 5:
                        _e = _f.sent();
                        _f.label = 6;
                    case 6:
                        if (!(_d < _e.length)) return [3 /*break*/, 8];
                        file = _e[_d];
                        if ("".concat(file.uri) === "".concat(document.uri)) {
                            return [2 /*return*/, __spreadArray([], __classPrivateFieldGet(this, _CodeLensProvider_instances, "m", _CodeLensProvider_fileCodeLenses).call(this, file), true)];
                        }
                        _f.label = 7;
                    case 7:
                        _d++;
                        return [3 /*break*/, 6];
                    case 8:
                        _b++;
                        return [3 /*break*/, 4];
                    case 9:
                        _i++;
                        return [3 /*break*/, 2];
                    case 10: return [2 /*return*/, []];
                }
            });
        });
    };
    /**
     * Resolve the test item for a code lens.
     */
    CodeLensProvider.prototype.resolveCodeLens = function (lens) {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _a = lens;
                        _b = {
                            title: "".concat(lens.kind, " ").concat(lens.item.kind),
                            command: "goExp.test.".concat(lens.kind)
                        };
                        return [4 /*yield*/, __classPrivateFieldGet(this, _CodeLensProvider_manager, "f").resolveTestItem(lens.item)];
                    case 1:
                        _a.command = (_b.arguments = [_c.sent()],
                            _b);
                        if (!(lens.item instanceof item_1.TestCase)) {
                            lens.command.title += ' files';
                        }
                        return [2 /*return*/, lens];
                }
            });
        });
    };
    return CodeLensProvider;
}());
exports.CodeLensProvider = CodeLensProvider;
_CodeLensProvider_didChangeCodeLenses = new WeakMap(), _CodeLensProvider_context = new WeakMap(), _CodeLensProvider_manager = new WeakMap(), _CodeLensProvider_instances = new WeakSet(), _CodeLensProvider_fileCodeLenses = function _CodeLensProvider_fileCodeLenses(file) {
    var mode, _i, _a, test_1, run_1, debug, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                mode = __classPrivateFieldGet(this, _CodeLensProvider_instances, "m", _CodeLensProvider_mode).call(this, file.uri);
                _i = 0, _a = file.tests;
                _c.label = 1;
            case 1:
                if (!(_i < _a.length)) return [3 /*break*/, 10];
                test_1 = _a[_i];
                if (!(test_1 instanceof item_1.StaticTestCase && test_1.range)) return [3 /*break*/, 9];
                run_1 = new GoCodeLens(test_1.range, test_1, 'run');
                debug = new GoCodeLens(test_1.range, test_1, 'debug');
                _b = mode;
                switch (_b) {
                    case 'run': return [3 /*break*/, 2];
                    case 'debug': return [3 /*break*/, 4];
                }
                return [3 /*break*/, 6];
            case 2: return [4 /*yield*/, run_1];
            case 3:
                _c.sent();
                return [3 /*break*/, 9];
            case 4: return [4 /*yield*/, debug];
            case 5:
                _c.sent();
                return [3 /*break*/, 9];
            case 6: return [4 /*yield*/, run_1];
            case 7:
                _c.sent();
                return [4 /*yield*/, debug];
            case 8:
                _c.sent();
                return [3 /*break*/, 9];
            case 9:
                _i++;
                return [3 /*break*/, 1];
            case 10: return [2 /*return*/];
        }
    });
}, _CodeLensProvider_mode = function _CodeLensProvider_mode(uri) {
    return new config_1.TestConfig(__classPrivateFieldGet(this, _CodeLensProvider_context, "f").workspace, uri).codeLens();
};
var GoCodeLens = /** @class */ (function (_super) {
    __extends(GoCodeLens, _super);
    function GoCodeLens(range, item, kind) {
        var _this = _super.call(this, range) || this;
        _this.item = item;
        _this.kind = kind;
        return _this;
    }
    return GoCodeLens;
}(vscode_1.CodeLens));
