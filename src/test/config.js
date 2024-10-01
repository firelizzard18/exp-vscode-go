"use strict";
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
var _TestConfig_workspace, _TestConfig_scope, _TestConfig_excludeValue, _TestConfig_excludeCompiled;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestConfig = void 0;
var vscode_1 = require("vscode");
var minimatch_1 = require("minimatch");
var deep_equal_1 = require("deep-equal");
var util_1 = require("../utils/util");
/**
 * Wrapper for accessing test explorer configuration.
 */
var TestConfig = /** @class */ (function () {
    function TestConfig(workspace, scope) {
        var _this = this;
        _TestConfig_workspace.set(this, void 0);
        _TestConfig_scope.set(this, void 0);
        _TestConfig_excludeValue.set(this, void 0);
        _TestConfig_excludeCompiled.set(this, void 0);
        this.enable = function () { return _this.get('enable'); };
        this.discovery = function () { return _this.get('discovery'); };
        this.showFiles = function () { return _this.get('showFiles'); };
        this.nestPackages = function () { return _this.get('nestPackages'); };
        this.nestSubtests = function () { return _this.get('nestSubtests'); };
        this.codeLens = function () { return _this.get('codeLens'); };
        this.runPackageBenchmarks = function () { return _this.get('runPackageBenchmarks'); };
        this.dynamicSubtestLimit = function () { return _this.get('dynamicSubtestLimit'); };
        this.testTags = function () {
            var cfg = __classPrivateFieldGet(_this, _TestConfig_workspace, "f").getConfiguration('go', __classPrivateFieldGet(_this, _TestConfig_scope, "f"));
            return cfg.get('testTags') || cfg.get('buildTags') || [];
        };
        /**
         * @returns An array of compiled minimatch patterns from `goExp.testExplorer.exclude` and `files.exclude`.
         */
        this.exclude = function () {
            // Merge files.exclude and goExp.testExplorer.exclude
            var a = _this.get('exclude') || {};
            var b = __classPrivateFieldGet(_this, _TestConfig_workspace, "f").getConfiguration('files', __classPrivateFieldGet(_this, _TestConfig_scope, "f")).get('exclude') || {};
            var v = Object.assign({}, b, a);
            // List enabled patterns
            var patterns = Object.entries(v)
                .filter(function (_a) {
                var v = _a[1];
                return v;
            })
                .map(function (_a) {
                var k = _a[0];
                return k;
            });
            // Only recompile if the patterns have changed
            if ((0, deep_equal_1.default)(patterns, __classPrivateFieldGet(_this, _TestConfig_excludeValue, "f"))) {
                return __classPrivateFieldGet(_this, _TestConfig_excludeCompiled, "f");
            }
            __classPrivateFieldSet(_this, _TestConfig_excludeValue, patterns, "f");
            __classPrivateFieldSet(_this, _TestConfig_excludeCompiled, patterns.map(function (x) { return new minimatch_1.Minimatch(x); }), "f");
            return __classPrivateFieldGet(_this, _TestConfig_excludeCompiled, "f");
        };
        /**
         * @returns `go.testFlags` or `go.buildFlags`, converted to {@link Flags}.
         */
        this.testFlags = function () {
            var _a, _b, _c, _d;
            // Determine the workspace folder from the scope
            var wsf = __classPrivateFieldGet(_this, _TestConfig_scope, "f") instanceof vscode_1.Uri
                ? __classPrivateFieldGet(_this, _TestConfig_workspace, "f").getWorkspaceFolder(__classPrivateFieldGet(_this, _TestConfig_scope, "f"))
                : ((_a = __classPrivateFieldGet(_this, _TestConfig_scope, "f")) === null || _a === void 0 ? void 0 : _a.uri)
                    ? __classPrivateFieldGet(_this, _TestConfig_workspace, "f").getWorkspaceFolder(__classPrivateFieldGet(_this, _TestConfig_scope, "f").uri)
                    : undefined;
            // Get go.testFlags or go.buildFlags
            var cfg = __classPrivateFieldGet(_this, _TestConfig_workspace, "f").getConfiguration('go', __classPrivateFieldGet(_this, _TestConfig_scope, "f"));
            var flagArgs = cfg.get('testFlags') || cfg.get('buildFlags') || [];
            // Convert to an object
            var flags = {};
            for (var _i = 0, flagArgs_1 = flagArgs; _i < flagArgs_1.length; _i++) {
                var arg = flagArgs_1[_i];
                arg = arg.replace(/^--?/, '');
                var i = arg.indexOf('=');
                if (i === -1) {
                    flags[arg] = true;
                }
                else {
                    flags[arg.slice(0, i)] = (0, util_1.resolvePath)(arg.slice(i + 1), (_b = wsf === null || wsf === void 0 ? void 0 : wsf.uri) === null || _b === void 0 ? void 0 : _b.fsPath);
                }
            }
            // Get go.testTags or go.buildTags
            var tags = (_d = (_c = cfg.get('testTags')) !== null && _c !== void 0 ? _c : cfg.get('buildTags')) !== null && _d !== void 0 ? _d : '';
            if (tags)
                flags.tags = tags;
            return flags;
        };
        /**
         * @returns `go.testEnvVars` and `go.toolsEnvVars` (merged) with `${...}` expressions resolved.
         */
        this.testEnvVars = function () {
            var _a, _b;
            // Determine the workspace folder from the scope
            var wsf = __classPrivateFieldGet(_this, _TestConfig_scope, "f") instanceof vscode_1.Uri
                ? __classPrivateFieldGet(_this, _TestConfig_workspace, "f").getWorkspaceFolder(__classPrivateFieldGet(_this, _TestConfig_scope, "f"))
                : ((_a = __classPrivateFieldGet(_this, _TestConfig_scope, "f")) === null || _a === void 0 ? void 0 : _a.uri)
                    ? __classPrivateFieldGet(_this, _TestConfig_workspace, "f").getWorkspaceFolder(__classPrivateFieldGet(_this, _TestConfig_scope, "f").uri)
                    : undefined;
            // Get go.toolsEnvVars and go.testEnvVars
            var cfg = __classPrivateFieldGet(_this, _TestConfig_workspace, "f").getConfiguration('go', __classPrivateFieldGet(_this, _TestConfig_scope, "f"));
            var env = Object.assign({}, process.env, cfg.get('toolsEnvVars'), cfg.get('testEnvVars'));
            // Resolve ${...} expressions
            for (var key in env) {
                env[key] = (0, util_1.resolvePath)((0, util_1.substituteEnv)(env[key]), (_b = wsf === null || wsf === void 0 ? void 0 : wsf.uri) === null || _b === void 0 ? void 0 : _b.fsPath);
            }
            return env;
        };
        __classPrivateFieldSet(this, _TestConfig_workspace, workspace, "f");
        __classPrivateFieldSet(this, _TestConfig_scope, scope, "f");
    }
    /**
     * Create a new {@link TestConfig} for a the given scope.
     */
    TestConfig.prototype.for = function (scope) {
        return new TestConfig(__classPrivateFieldGet(this, _TestConfig_workspace, "f"), scope);
    };
    /**
     * Get a configuration value.
     */
    TestConfig.prototype.get = function (name) {
        return __classPrivateFieldGet(this, _TestConfig_workspace, "f").getConfiguration('goExp', __classPrivateFieldGet(this, _TestConfig_scope, "f")).get("testExplorer.".concat(name));
    };
    return TestConfig;
}());
exports.TestConfig = TestConfig;
_TestConfig_workspace = new WeakMap(), _TestConfig_scope = new WeakMap(), _TestConfig_excludeValue = new WeakMap(), _TestConfig_excludeCompiled = new WeakMap();
