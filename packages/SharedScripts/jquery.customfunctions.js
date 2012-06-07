/// <reference path="jquery-1.6.1.js" />

(function ($) {
    /// <param type="jQuery" name="$" />
    $.extend({
        getScriptByReference: function (url) {
            /// <summary>Load script by referencing it as external resource.
            /// This allows debugging and code coverage tools to to work.</summary>
            /// <param name="url" type="String">The url to the script to be loaded.</param>
            /// <returns type="Promise">Returns a jQuery Deferred promise</returns>

            var head = document.getElementsByTagName("head")[0],
                script = document.createElement("script"),
                defer = $.Deferred();

            script.onload = script.onreadystatechange = function () {
                if (!defer.isResolved() && (!this.readyState || this.readyState === "loaded" || this.readyState === "complete")) {
                    // Handle memory leak in IE
                    script.onload = script.onreadystatechange = null;

                    defer.resolve();
                }
            }

            script.src = url;
            script.type = "text/javascript";
            // Using insertBefore to avoid possible IE6 bug
            head.insertBefore(script, head.firstChild);
            return defer.promise();
        },
        getScriptsByReference: function (urls) {
            return $.map(urls, function (url) {
                return $.getScriptByReference(url);
            });
        },
        whenAll: function (theArray) {
            return $.when.apply(null, theArray);
        }
    });
})(jQuery);