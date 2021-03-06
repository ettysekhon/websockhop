/**
 * WebSockHop JavaScript Library v0.1.0
 * Copyright 2014 Fanout, Inc.
 * Released under the MIT license (see COPYING file in source distribution)
 */

(function(factory) {
    "use strict";
    var DEBUG = true;
    var isWindow = function(variable) {
        return variable && variable.document && variable.location && variable.alert && variable.setInterval;
    }
    if (!isWindow(window)) {
        throw "The current version of WebSockHop may only be used within the context of a browser.";
    }
    var debugMode = DEBUG && typeof(window.console) !== "undefined";
    if (typeof define === 'function' && define['amd']) {
        // AMD anonymous module
        define(['module'], function(module) { module.exports = factory(window, debugMode); });
    } else {
        // No module loader (plain <script> tag) - put directly in global namespace
        window['WebSockHop'] = factory(window, debugMode);
    }
})(function(window, debugMode) {

    var debug;

    if (debugMode) {
        if (Function.prototype.bind) {
            debug = {
                log: window.console.log.bind(window.console),
                error: window.console.error.bind(window.console),
                info: window.console.info.bind(window.console),
                warn: window.console.warn.bind(window.console)
            };
        } else {
            var log = function(output) { window.console.log(output); };

            debug = {
                log: log,
                error: log,
                warn: log,
                info: log
            }
        }
    } else {
        var __no_op = function() {};

        debug = {
            log: __no_op,
            error: __no_op,
            warn: __no_op,
            info: __no_op
        }
    }

    var copyArray = function (array) {
        var args = Array.prototype.slice.call(arguments, 1);
        return Array.prototype.slice.apply(array, args);
    };

    var indexOfItemInArray = function (array, item) {
        for (var i = 0, length = array.length; i < length; i = i + 1) {
            if (array[i] === item) {
                return i;
            }
        }
        return -1;
    };

    var removeFromArray = function (array, item) {
        var again = true;
        while (again) {
            var index = indexOfItemInArray(array, item);
            if (index != -1) {
                array.splice(index, 1);
            } else {
                again = false;
            }
        }
    };

    var setTimeout = function(predicate, delay, ctx) {
        return window.setTimeout(function() {
            predicate.apply(ctx);
        }, delay);
    };

    var nextUpdate = function(predicate, ctx) {
        return setTimeout(predicate, 0, ctx);
    };

    var isFunction = function(obj) {
        return Object.prototype.toString.call(obj) == '[object Function]';
    };

    var isObject = function(obj) {
        return obj === Object(obj);
    };

    var AsyncFor = function(init, check, after) {
        this.init = init;
        this.check = check;
        this.after = after;
        this.loopBody = null;
    };
    AsyncFor.prototype.runLoop = function(callback) {
        if (this.init) {
            this.init();
        }
        this._runMainLoop(false, callback);
    };
    AsyncFor.prototype._runMainLoop = function(endLoop, callback) {
        var check = !endLoop && (this.check ? this.check() : true);
        if (check) {
            var _this = this;
            var next = function(exit) {
                if (!exit) {
                    if (_this.after) {
                        _this.after();
                    }
                }
                _this._runMainLoop(exit, callback);
            };
            if (this.loopBody) {
                var asyncMode = false;
                var async = function() {
                    asyncMode = true;
                    return next;
                };
                var result = this.loopBody(async);
                if (!asyncMode) {
                    next(result !== undefined && !result);
                }
            }
        } else {
            if (callback) {
                callback();
            }
        }
    };

    var asyncfor = function(init, check, after) {
        return new AsyncFor(init, check, after);
    };

    var Events = function (ctx) {
        this._events = {};
        this._ctx = ctx;
    };
    Events.prototype._getHandlersForType = function (type) {
        if (!(type in this._events)) {
            this._events[type] = [];
        }
        return this._events[type];
    };
    Events.prototype.on = function (type, handler) {
        var handlers = this._getHandlersForType(type);
        handlers.push(handler);
    };
    Events.prototype.off = function (type) {
        if (arguments.length > 1) {
            var handler = arguments[1];
            var handlers = this._getHandlersForType(type);
            removeFromArray(handlers, handler);
        } else {
            delete this._events[type];
        }
    };
    Events.prototype.trigger = function (type, args, callback) {

        var handlers = copyArray(this._getHandlersForType(type));
        var n = handlers.length;
        var ctx = this._ctx;

        // The following is the async way to write:
        // for (var i = 0; i < n; i = i + 1) {
        //     var handler = handlers[i];
        //     handler.apply(ctx, args);
        // }

        var i;
        var loop = asyncfor(
            function() { i = 0; },
            function() { return i < n; },
            function() { i = i + 1; }
        );
        loop.loopBody = function(async) {
            var handler = handlers[i];
            ctx.async = function() {
                delete ctx.async;
                return async();
            };
            handler.apply(ctx, args);
        };
        loop.runLoop(function() {
            if (callback) {
                callback();
            }
        });

    };

    var messageFormatter = {
        _requestMap: {},
        _nextId: 0,
        toMessage: function(obj) {
            return JSON.stringify(obj);
        },
        fromMessage: function(message) {
            return JSON.parse(message);
        },
        trackRequest: function(requestObject, handler) {
            requestObject.id = ++this._nextId;
            this._requestMap[requestObject.id.toString()] = handler;
            return requestObject;
        },
        getHandlerForResponse: function(responseObject) {
            if (!("id" in responseObject)) {
                return null;
            }
            var id = responseObject.id.toString();
            if (!(id in this._requestMap)) {
                return null;
            }
            var handler = this._requestMap[id];
            delete this._requestMap[id];
            return handler;
        },
        getPendingHandlerIds: function() {
            var ids = [];
            for(var key in this._requestMap) {
                if (this._requestMap.hasOwnProperty(key)) {
                    ids.push(key);
                }
            }
            return ids;
        },
        createPingRequest: function() {
            return {
                type: 'ping'
            }
        }
    };

    var ErrorEnumValue = {
        "None": 0,
        "Disconnect": 1,
        "Timeout": 2
    };

    var WebSockHop = function(url, protocol) {
        if (!(this instanceof WebSockHop)) {
            throw new window.Error("Constructor called as a function");
        }

        this._socket = null;
        this._url = url;
        this._protocol = protocol;
        this._events = new Events(this);
        this._timer = null;
        this._tries = 0;
        this._aborted = false;
        this._closing = false;
        this.messageFormatter = messageFormatter;

        this.connectionTimeoutMsecs = 10000; // 10 seconds default connection timeout

        this.useAutomaticPing = false; // If set to true, system will automatically send "ping" periodically

        this._pingTimer = null;
        this.pingIntervalMsecs = 60000; // 60 seconds default ping timeout
        this.pingResponseTimeoutMsecs = 10000; // 10 seconds default ping response timeout

        this.defaultRequestTimeoutMsecs = null; // Unless specified, request() calls use this value for timeout
        this.defaultDisconnectOnRequestTimeout = false; // If specified, request "timeout" events will handle as though socket was dropped

        this._attemptConnect();
    };
    WebSockHop.prototype._attemptConnect = function() {
        if (!this._timer) {
            var delay = 0;
            if (this._tries > 0) {
                var timeCap = 1 << Math.min(6, (this._tries - 1));
                delay = timeCap * 1000 + Math.floor(Math.random() * 1000);
                debug.info("WebSockHop: Trying again in " + delay + "ms");
            }
            this._tries = this._tries + 1;

            this._timer = setTimeout(function() {
                this._timer = null;
                this._start();
            }, delay, this);
        }
    };
    WebSockHop.prototype._abortConnect = function() {
        if (this._timer) {
            window.clearTimeout(this._timer);
            this._timer = null;
        }
        this._aborted = true;
    };
    WebSockHop.prototype._raiseEvent = function(event, args, callback) {
        if (isFunction(args) && !callback) {
            callback = args;
            args = [];
        } else {
            args = [args];
        }

        debug.log("WebSockHop: " + event + " event start");
        this._events.trigger(event, args, function () {
            debug.log("WebSockHop: " + event + " event end");
            if (callback) {
                callback();
            }
        });
    };
    WebSockHop.prototype._start = function() {
        var _this = this;
        this._raiseEvent("opening", function() {
            if (!_this._aborted) {
                var socket = _this._socket = _this._protocol ? new WebSocket(_this._url, _this._protocol) : new WebSocket(_this._url);
                var connectionTimeout = null;
                if (_this.connectionTimeoutMsecs) {
                    connectionTimeout = setTimeout(function() {
                        debug.log("WebSockHop: Connection timeout exceeded.");
                        _this._raiseErrorEvent(false);
                    }, _this.connectionTimeoutMsecs);
                    debug.log("WebSockHop: Setting connection timeout (" + _this.connectionTimeoutMsecs + " msecs).");
                }
                var clearConnectionTimeout = function() {
                    if (connectionTimeout != null) {
                        debug.log("WebSockHop: Clearing connection timeout.");
                        window.clearTimeout(connectionTimeout);
                        connectionTimeout = null;
                    }
                };
                socket.onopen = function(event) {
                    debug.log("WebSockHop: WebSocket::onopen");
                    clearConnectionTimeout();
                    _this._tries = 0;
                    _this._raiseEvent("opened");
                    if (_this.useAutomaticPing) {
                        _this._resetPingTimer();
                    }
                };
                socket.onclose = function(event) {
                    debug.log("WebSockHop: WebSocket::onclose { wasClean: " + (event.wasClean ? "true" : "false") + ", code: " + event.code + " }");
                    clearConnectionTimeout();
                    var closing = _this._closing;

                    if (event.wasClean) {
                        _this._raiseEvent("closed", function() {
                            _this._socket = null;
                        });
                    } else {
                        _this._raiseErrorEvent(closing);
                    }
                    _this._clearPingTimers();
                };
                socket.onmessage = function(event) {
                    debug.log("WebSockHop: WebSocket::onmessage { data: " + event.data + " }");
                    _this._dispatchMessage(event.data);
                    if (_this.useAutomaticPing) {
                        _this._resetPingTimer();
                    }
                };
            }
        });
    };
    WebSockHop.prototype._raiseErrorEvent = function(isClosing) {
        var _this = this;
        this._raiseEvent("error", !isClosing, function() {
            _this._socket = null;
            var pendingRequestIds = _this.messageFormatter.getPendingHandlerIds();
            for (var i = 0; i < pendingRequestIds.length; i++) {
                var requestId = pendingRequestIds[i];
                _this._dispatchErrorMessage(requestId, {type: ErrorEnumValue.Disconnect});
            }
            if (!isClosing) {
                _this._attemptConnect();
            }
        });
    };

    WebSockHop.prototype._clearPingTimers = function() {
        debug.log("WebSockHop: clearing ping timers.");
        if (this._pingTimer) {
            window.clearTimeout(this._pingTimer);
            this._pingTimer = null;
        }
    };

    WebSockHop.prototype._resetPingTimer = function() {
        debug.log("WebSockHop: resetting ping.");
        this._clearPingTimers();
        var _this = this;
        this._pingTimer = setTimeout(function() {
            this.sendPingRequest();
        }, this.pingIntervalMsecs, this);
        debug.log("WebSockHop: ping in " + this.pingIntervalMsecs + " ms");
    };
    WebSockHop.prototype.sendPingRequest = function() {
        var pingRequest = this.messageFormatter.createPingRequest();

        this.request(pingRequest, function(obj) {
            debug.log("WebSockHop: < PONG [" + obj.id + "]");
        }, function(error) {
            if (error.type == ErrorEnumValue.Timeout) {
                debug.log("WebSockHop: no ping response, handling as disconnected");
            }
        }, this.pingResponseTimeoutMsecs, true);

        debug.log("WebSockHop: > PING [" + pingRequest.id + "], requiring response in " + this.pingResponseTimeoutMsecs + " ms");
    };

    WebSockHop.prototype.send = function(obj) {
        if (this._socket) {
            var message = this.messageFormatter.toMessage(obj);
            this._socket.send(message);
        }
    };
    WebSockHop.prototype.close = function() {
        if (this._socket) {
            this._closing = true;
            this._socket.close();
        } else {
            debug.log("WebSockHop: close() called on non-live socket.  Did you mean to call abort() ?");
        }
    };
    WebSockHop.prototype.abort = function () {
        if (this._socket) {
            debug.log("WebSockHop: abort() called on live socket, performing forceful shutdown.  Did you mean to call close() ?");
            this._clearPingTimers();
            this._socket.onclose = null;
            this._socket.onmessage = null;
            this._socket.onerror = null;
            this._socket.close();
            this._socket = null;
        }
        this._abortConnect();
    };

    WebSockHop.prototype.on = function (type, handler) {
        this._events.on(type, handler);
    };
    WebSockHop.prototype.off = function (type) {
        if (arguments.length > 1) {
            this._events.off(type, arguments[1]);
        } else {
            this._events.off(type);
        }
    };
    WebSockHop.prototype.request = function (obj, callback, errorCallback, timeoutMsecs, disconnectOnTimeout) {
        var requestTimeoutMsecs = timeoutMsecs || this.defaultRequestTimeoutMsecs;
        var requestDisconnectOnTimeout = disconnectOnTimeout || this.defaultDisconnectOnRequestTimeout;

        var requestTimeoutTimer = null;
        this.messageFormatter.trackRequest(obj, {
            callback: function (o) {
                if (requestTimeoutTimer != null) {
                    window.clearTimeout(requestTimeoutTimer);
                    requestTimeoutTimer = null;
                }
                if (callback != null) {
                    callback(o);
                }
            },
            errorCallback: function (err) {
                if (errorCallback != null) {
                    errorCallback(err);
                }
            }
        });
        this.send(obj);
        if (requestTimeoutMsecs > 0) {
            requestTimeoutTimer = setTimeout(function() {
                debug.log("WebSockHop: timeout exceeded [" + obj.id + "]")
                this._dispatchErrorMessage(obj.id, {type: ErrorEnumValue.Timeout});
                if (requestDisconnectOnTimeout) {
                    this._raiseErrorEvent(false);
                }
            }, requestTimeoutMsecs, this);
        }
    };
    WebSockHop.prototype._dispatchMessage = function (message) {
        var obj = this.messageFormatter.fromMessage(message);
        var handler = isObject(obj) ? this.messageFormatter.getHandlerForResponse(obj) : null;
        if (handler != null) {
            handler.callback(obj);
        } else {
            this._raiseEvent("message", obj);
        }
    };
    WebSockHop.prototype._dispatchErrorMessage = function (id, error) {
        var handler = this.messageFormatter.getHandlerForResponse({id:id});
        if (handler != null) {
            handler.errorCallback(error);
        }
    };

    WebSockHop.ErrorEnumValue = ErrorEnumValue;

    return WebSockHop;
});