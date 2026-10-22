(function () {
    var version = "1.1.4";
    var modules = [
        'assets/modules/runtime.js',
        'assets/modules/packages.js',
        'assets/modules/loader.js',
        'assets/modules/fs.js',
        'assets/modules/audio.js',
        'assets/modules/graphics.js',
        'assets/modules/events.js',
        'assets/modules/fetch.js',
        'assets/modules/asm_consts.js',
        'assets/modules/main.js'
    ];
    if (typeof importScripts === 'function') {
        var versionedModules = modules.map(function (m) { return m + '?v=' + version; });
        importScripts.apply(null, versionedModules);
    } else {
        var loadNext = function (i) {
            if (i < modules.length) {
                var s = document.createElement('script');
                s.src = modules[i] + '?v=' + version;
                s.async = false; // Ensure order
                s.onload = function () { loadNext(i + 1); };
                s.onerror = function () { console.error('Failed to load module: ' + modules[i]); };
                document.body.appendChild(s);
            }
        };
        loadNext(0);
    }
})();