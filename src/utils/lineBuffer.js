"use strict";
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.LineBuffer = void 0;
var LineBuffer = /** @class */ (function () {
    function LineBuffer() {
        this.buf = '';
        this.lineListeners = [];
        this.lastListeners = [];
    }
    LineBuffer.prototype.append = function (chunk) {
        this.buf += chunk;
        for (;;) {
            var idx = this.buf.indexOf('\n');
            if (idx === -1) {
                break;
            }
            this.fireLine(this.buf.substring(0, idx));
            this.buf = this.buf.substring(idx + 1);
        }
    };
    LineBuffer.prototype.done = function () {
        this.fireDone(this.buf !== '' ? this.buf : null);
    };
    LineBuffer.prototype.onLine = function (listener) {
        this.lineListeners.push(listener);
    };
    LineBuffer.prototype.onDone = function (listener) {
        this.lastListeners.push(listener);
    };
    LineBuffer.prototype.fireLine = function (line) {
        this.lineListeners.forEach(function (listener) { return listener(line); });
    };
    LineBuffer.prototype.fireDone = function (last) {
        this.lastListeners.forEach(function (listener) { return listener(last); });
    };
    return LineBuffer;
}());
exports.LineBuffer = LineBuffer;
