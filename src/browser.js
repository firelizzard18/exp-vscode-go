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
exports.Browser = void 0;
var vscode_1 = require("vscode");
var axios_1 = require("axios");
var node_html_parser_1 = require("node-html-parser");
// TODO(firelizzard18): Disable back/forward when not applicable
var Browser = /** @class */ (function () {
    function Browser(extension, id, base) {
        var options = [];
        for (var _i = 3; _i < arguments.length; _i++) {
            options[_i - 3] = arguments[_i];
        }
        var _this = this;
        _Browser_instances.add(this);
        _Browser_extension.set(this, void 0);
        _Browser_id.set(this, void 0);
        _Browser_base.set(this, void 0);
        _Browser_history.set(this, []);
        _Browser_unhistory.set(this, []);
        _Browser_current.set(this, void 0);
        __classPrivateFieldSet(this, _Browser_extension, extension, "f");
        __classPrivateFieldSet(this, _Browser_id, id, "f");
        __classPrivateFieldSet(this, _Browser_base, base, "f");
        this.panel = vscode_1.window.createWebviewPanel.apply(vscode_1.window, __spreadArray(['goExp.browser'], options, false));
        Browser.open.add(this);
        this.panel.onDidDispose(function () { return Browser.open.delete(_this); });
        this.panel.webview.options = { enableScripts: true };
        this.panel.webview.onDidReceiveMessage(function (e) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (e.command) {
                    case 'navigate': {
                        this.navigate(e.url);
                        break;
                    }
                }
                return [2 /*return*/];
            });
        }); });
    }
    Object.defineProperty(Browser, "active", {
        get: function () {
            return __spreadArray([], this.open, true).find(function (x) { return x.panel.active; });
        },
        enumerable: false,
        configurable: true
    });
    Browser.prototype.show = function (html) {
        this.panel.webview.html = ' ';
        this.panel.webview.html = html;
    };
    Browser.prototype.navigate = function (url) {
        var _this = this;
        url = __classPrivateFieldGet(this, _Browser_instances, "m", _Browser_parseUrl).call(this, url);
        __classPrivateFieldGet(this, _Browser_instances, "m", _Browser_load).call(this, url)
            .then(function (ok) {
            if (!ok)
                return;
            __classPrivateFieldSet(_this, _Browser_current, url, "f");
            __classPrivateFieldGet(_this, _Browser_history, "f").push(url);
            __classPrivateFieldGet(_this, _Browser_unhistory, "f").splice(0, __classPrivateFieldGet(_this, _Browser_unhistory, "f").length);
        })
            .catch(function (e) { return console.error('Navigation failed', e); });
    };
    Browser.prototype.back = function () {
        var _this = this;
        if (__classPrivateFieldGet(this, _Browser_history, "f").length < 2) {
            return;
        }
        var url = __classPrivateFieldGet(this, _Browser_history, "f")[__classPrivateFieldGet(this, _Browser_history, "f").length - 2];
        __classPrivateFieldGet(this, _Browser_instances, "m", _Browser_load).call(this, url)
            .then(function (ok) {
            if (!ok)
                return;
            __classPrivateFieldSet(_this, _Browser_current, url, "f");
            __classPrivateFieldGet(_this, _Browser_unhistory, "f").push(__classPrivateFieldGet(_this, _Browser_history, "f").pop());
        })
            .catch(function (e) { return console.error('Navigate back failed', e); });
    };
    Browser.prototype.forward = function () {
        var _this = this;
        if (__classPrivateFieldGet(this, _Browser_unhistory, "f").length < 1) {
            return;
        }
        var url = __classPrivateFieldGet(this, _Browser_unhistory, "f")[__classPrivateFieldGet(this, _Browser_unhistory, "f").length - 1];
        __classPrivateFieldGet(this, _Browser_instances, "m", _Browser_load).call(this, url)
            .then(function (ok) {
            if (!ok)
                return;
            __classPrivateFieldSet(_this, _Browser_current, url, "f");
            __classPrivateFieldGet(_this, _Browser_history, "f").push(__classPrivateFieldGet(_this, _Browser_unhistory, "f").pop());
        })
            .catch(function (e) { return console.error('Navigate forward failed', e); });
    };
    Browser.prototype.reload = function () {
        __classPrivateFieldGet(this, _Browser_instances, "m", _Browser_load).call(this, __classPrivateFieldGet(this, _Browser_current, "f"), true).catch(function (e) { return console.error('Refresh', e); });
    };
    var _Browser_instances, _Browser_extension, _Browser_id, _Browser_base, _Browser_history, _Browser_unhistory, _Browser_current, _Browser_parseUrl, _Browser_load, _Browser_contentUri;
    _Browser_extension = new WeakMap(), _Browser_id = new WeakMap(), _Browser_base = new WeakMap(), _Browser_history = new WeakMap(), _Browser_unhistory = new WeakMap(), _Browser_current = new WeakMap(), _Browser_instances = new WeakSet(), _Browser_parseUrl = function _Browser_parseUrl(url) {
        if (url instanceof vscode_1.Uri) {
            return url;
        }
        if (url.startsWith('./') || url.startsWith('../')) {
            return vscode_1.Uri.joinPath(__classPrivateFieldGet(this, _Browser_base, "f"), url);
        }
        if (url.startsWith('/')) {
            return __classPrivateFieldGet(this, _Browser_base, "f").with({ path: url });
        }
        if (url.startsWith('#') || url.startsWith('?')) {
            var _a = vscode_1.Uri.parse("foo://bar".concat(url)), query = _a.query, fragment = _a.fragment;
            return (__classPrivateFieldGet(this, _Browser_current, "f") || __classPrivateFieldGet(this, _Browser_base, "f")).with({ query: query, fragment: fragment });
        }
        return vscode_1.Uri.parse(url);
    }, _Browser_load = function _Browser_load(url_1) {
        return __awaiter(this, arguments, void 0, function (url, reload) {
            var data, document, head, base, scripts;
            var _a;
            if (reload === void 0) { reload = false; }
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!reload && "".concat(url) === "".concat(__classPrivateFieldGet(this, _Browser_current, "f"))) {
                            this.panel.webview.postMessage({
                                command: 'jump',
                                fragment: url.fragment,
                            });
                            return [2 /*return*/, true];
                        }
                        return [4 /*yield*/, axios_1.default.get(url.toString(true))];
                    case 1:
                        data = (_b.sent()).data;
                        if (!data)
                            return [2 /*return*/, false];
                        document = (0, node_html_parser_1.parse)(data);
                        (_a = document.querySelector('html')) === null || _a === void 0 ? void 0 : _a.setAttribute('id', __classPrivateFieldGet(this, _Browser_id, "f"));
                        // Preserve links
                        document.querySelectorAll('a[href]').forEach(function (a) {
                            var href = a.getAttribute('href');
                            a.removeAttribute('href');
                            a.setAttribute('data-href', href);
                        });
                        head = document.querySelector('head');
                        return [4 /*yield*/, vscode_1.env.asExternalUri(url.with({ path: '', query: '', fragment: '' }))];
                    case 2:
                        base = (_b.sent())
                            .toString(true)
                            .replace(/\/$/, '');
                        fixLinks(head, function (s) { return (s.startsWith('/') ? "".concat(base).concat(s) : s); });
                        // Add <base> to fix queries
                        head.appendChild((0, node_html_parser_1.parse)("<base href=\"".concat(base, "\" />")));
                        // Transfer variables
                        head.appendChild((0, node_html_parser_1.parse)("<script>window.pageStr = \"".concat(url, "\";</script>")));
                        // Add resources
                        head.appendChild((0, node_html_parser_1.parse)("<script src=\"".concat(__classPrivateFieldGet(this, _Browser_instances, "m", _Browser_contentUri).call(this, 'main.js'), "\"></script>")));
                        head.appendChild((0, node_html_parser_1.parse)("<link rel=\"stylesheet\" href=\"".concat(__classPrivateFieldGet(this, _Browser_instances, "m", _Browser_contentUri).call(this, 'main.css'), "\" />")));
                        scripts = document.querySelectorAll('html > script, html > :not(head) script');
                        scripts.forEach(function (x) { return x.remove(); });
                        // Call the post-load function and insert scripts
                        document.appendChild((0, node_html_parser_1.parse)("<script>didLoad(\"".concat(url.fragment, "\")</script>")));
                        scripts.forEach(function (x) { return document.appendChild(x); });
                        this.show("".concat(document));
                        return [2 /*return*/, true];
                }
            });
        });
    }, _Browser_contentUri = function _Browser_contentUri() {
        var path = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            path[_i] = arguments[_i];
        }
        var uri = vscode_1.Uri.joinPath.apply(vscode_1.Uri, __spreadArray([__classPrivateFieldGet(this, _Browser_extension, "f").extensionUri, 'webview', 'browser'], path, false));
        return this.panel.webview.asWebviewUri(uri);
    };
    Browser.open = new Set();
    return Browser;
}());
exports.Browser = Browser;
function fixLinks(elem, fix) {
    if (!elem)
        return;
    if (Array.isArray(elem)) {
        elem.forEach(function (e) { return fixLinks(e, fix); });
        return;
    }
    if (elem.attrs.href) {
        elem.setAttribute('href', fix(elem.attrs.href));
    }
    if (elem.attrs.src) {
        elem.setAttribute('src', fix(elem.attrs.src));
    }
    for (var _i = 0, _a = elem.childNodes; _i < _a.length; _i++) {
        var node = _a[_i];
        if (node instanceof node_html_parser_1.HTMLElement) {
            fixLinks(node, fix);
        }
    }
}
