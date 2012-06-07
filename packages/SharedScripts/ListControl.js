// Copyright (c) Microsoft.  All rights reserved.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
// files (the "Software"), to deal  in the Software without restriction, including without limitation the rights  to use, copy,
// modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR  IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY,  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
// ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// TODO -- Put this in a Microsoft namespace
function ListControl(entities, options) {

    this.entities = entities;

    var defaults = {};
    this._options = $.extend({}, defaults, options);

    this.container = $(options.container);
    this._template = $(options.template);

    this._entityPropertyChangeHandlers = [];

    var self = this;

    if (this.container.data("listControl")) {
        throw "A container can only have one ListControl associated with it at a time";
    } else {
        this.container.data("listControl", this);
    }

    this._arrayChangeHandler = function (changeEvent, eventArguments) {
        self._onArrayChanged(changeEvent, eventArguments);
    };
    $([entities]).bind("arrayChange", this._arrayChangeHandler);

    // Simulate array change to start initial render and binding.
    this._onArrayChanged(null, { change: "refresh", oldItems: entities, newItems: entities });
}

ListControl.prototype = {

    // Private fields

    // Init-time values
    _options: null,
    entities: null,  // TODO: Should this not be private?
    container: null,  // TODO: Should this not be private?
    _template: null,
    _arrayChangeHandler: null,

    // State
    _entityPropertyChangeHandlers: null,
    _completedInitialRender: false,

    // Public methods

    dispose: function () {
        if (this.container && this.container.jquery) {
            this.container.removeData("listControl");
        }

        if (this._arrayChangeHandler) {
            $([this.entities]).unbind("arrayChange", this._arrayChangeHandler);
            this._arrayChangeHandler = null;

            $.each(this._entityPropertyChangeHandlers, function (unused, handler) {
                $(handler.entity).unbind("propertyChange", handler);
            });
        }
    },

    getOptions: function () {
        return this._options;
    },

    getElement: function (entity) {
        var self = this,
            element = this.container.children().filter(function () {
                return self.getEntityFromElement(this) === entity;
            });
        // DEBUG
        if (element.length > 1) {
            throw "Multiple Elements found";
        }
        return element.length > 0 ? $(element[0]) : undefined;
    },

    updateElement: function (entity) {
        var element = this.getElement(entity);
        if (element) {

            // Remove old tmplItem so it does not overwrite the new one created in next step.
            element.removeData("tmplItem");

            var newElement = this._createElement(entity);
            // Copy existing data to new element.
            newElement.data(element.data());
            newElement.insertBefore(element);

            // Detach from DOM but do not remove so callbacks can have access its data (for child lists for example).
            element.detach();

            // The insertBefore method creates a new element, find it again.
            // REVIEW: Is this necessary? Perhaps using a low level DOM attach method this re-render could be avoided.
            newElement = this.getElement(entity);

            this._issueCallback("itemUpdated", entity, newElement, element);
        } else {
            // TODO: Understand why data-linked scenario is the only one that is giving you issues.
            throw "Entity does have a matching element";
        }
    },

    // Private methods

    _wirePropertyChanged: function (entity) {
        // Avoid binding the event more than once.
        if (!this._getHandler(entity)) {
            var self = this;

            var propertyChangeHandler = function (event, eventArguments) {
                var entity = event.target;
                self._onPropertyChanged(entity, eventArguments.path, eventArguments.value);
            };
            // Keep a reference to the propertyChangeHandler method to avoid duplicate binding and allow for single handler removal.
            this._addHandler(entity, propertyChangeHandler);

            $(entity).bind("propertyChange", propertyChangeHandler);
        }
    },

    _onPropertyChanged: function (entity, path, value) {
        if (this._options.dataLinked) {
            // Data-linked controls will update themselves.  Give them a callback in case they want to do additional work.
            this._issueCallback("propertyChanged", entity, path, value);
        } else {
            // Re-render the control.
            this.updateElement(entity);
        }
    },

    _onArrayChanged: function (changeEvent, eventArguments) {
        if ($.contains(document.body, this.container[0])) {
            var self = this,
                eventEntities;

            self._issueCallback("renderStarted", this.container);

            switch (eventArguments.change) {
                case "refresh":
                    eventEntities = this.entities;
                    $.each(eventEntities, function () {
                        self._wirePropertyChanged(this);
                    });
                    this._refreshControl();
                    break;

                case "insert":
                    eventEntities = eventArguments.items;
                    $.each(eventEntities, function () {
                        self._wirePropertyChanged(this);
                        var addedElement = self._createElement(this);
                        // TODO: Need to look-up the correct spot in the list to put element.
                        // We currently only check top and, if not, assume bottom.
                        if (self.entities[0] === this) {
                            self.container.prepend(addedElement);
                        } else {
                            self.container.append(addedElement);
                        }
                        self._issueCallback("itemAdded", this, addedElement, false /* Non-refresh add */);
                    });
                    break;

                case "remove":
                    eventEntities = eventArguments.items;
                    $.each(eventEntities, function () {
                        self._disposeItem(self.getElement(this));
                    });
                    break;

                default:
                    throw "Unexpected array changed event.";
                    break;
            }

            if (!this._completedInitialRender) {
                this._completedInitialRender = true;
                this._issueCallback("firstRenderComplete", this.entities, this.container);
            }

            self._issueCallback("renderComplete", eventEntities, this.container, eventArguments.change);
        }
    },

    _refreshControl: function () {
        var container = this.container,
            self = this,
            keptElements = $.map(this.entities, function (entity, i) {
                var element = self.getElement(entity);

                if (!element) {
                    element = self._createElement(entity);
                    container.append(element);
                    self._issueCallback("itemAdded", entity, element, true /* refresh add */);
                } else {
                    // TODO: Investigate if it is cost effective to look-up current position and do nothing if it matches the index.
                    container.append(element);
                }
                return element[0];
            });

        container.children().each(function (i, childEl) {
            var shouldDelete = true;
            $.each(keptElements, function () {
                if (this === childEl) {
                    shouldDelete = false;
                    return false;
                }
            });

            if (shouldDelete) {
                self._disposeItem(childEl);
            }
        });
    },

    _issueCallback: function (type) {
        var callback = this._options[type];
        if (callback && $.isFunction(callback)) {
            callback.apply(this, [].slice.call(arguments, 1));
        }
    },

    _createElement: function (entity) {
        return this._template.tmpl(entity, this._options.templateOptions);
    },

    _disposeItem: function (element) {
        if (element) {
            this._issueCallback("itemDeleting", element);

            var entity = this.getEntityFromElement(element);

            if (!entity) {
                throw "Unable to find entity on element";
            }

            //Find the propertyChange event associated with this list
            var handleToRemove = this._getHandler(entity);
            if (!handleToRemove) {
                throw "No handle returned";
            }
            $(entity).unbind("propertyChange", handleToRemove);
            this._disposeHandler(entity);

            $(element).remove();
        } else {
            //DEBUG
            throw "Requires one parameter: Must pass DOM element to _disposeItem";
        }
    },

    _addHandler: function (entity, handler) {
        handler.entity = entity;
        this._entityPropertyChangeHandlers.push(handler);
    },

    _getHandler: function (entity) {
        return $.grep(this._entityPropertyChangeHandlers, function (item) {
            return item.entity === entity;
        })[0];
    },

    _disposeHandler: function (entity) {
        var index;
        $.each(this._entityPropertyChangeHandlers, function (i) {
            if (this.entity === entity) {
                index = i;
                return false;
            }
        });
        if (index >= 0) {
            this._entityPropertyChangeHandlers.splice(index, 1);
        } else {
            throw "No matching handle found";
        }
    },

    getEntityFromElement: function (element) {
        var tmplItem = $(element).data("tmplItem");
        if (!tmplItem && element.children.length) {
            // TODO: Generalize this, so it's not special-cased to jQuery animate.
            // Try wrapped children elements (might be currently animated).
            tmplItem = $(element.children[0]).data("tmplItem");
        }

        if (tmplItem && tmplItem.data) {
            return tmplItem.data;
        } else {
            return null;
        }
    }
};
