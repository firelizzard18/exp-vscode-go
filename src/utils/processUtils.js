"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------
 * Copyright 2020 The Go Authors. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.killProcessTree = killProcessTree;
var kill = require("tree-kill");
// Kill a process and its children, returning a promise.
function killProcessTree(p, logger) {
    if (logger === void 0) { logger = console.log; }
    if (!p || !p.pid || p.exitCode !== null) {
        return Promise.resolve();
    }
    return new Promise(function (resolve) {
        var pid = p.pid;
        if (!pid)
            return;
        kill(pid, function (err) {
            if (err) {
                logger("Error killing process ".concat(pid, ": ").concat(err));
            }
            resolve();
        });
    });
}
