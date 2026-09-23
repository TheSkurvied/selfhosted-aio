// Applies the saved theme before first paint (no flash). Loaded as a blocking
// external script so it works under a strict CSP without 'unsafe-inline'.
(function () {
	try {
		var t = localStorage.getItem('aio-theme');
		if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
		if (localStorage.getItem('aio-sidebar') === 'collapsed')
			document.documentElement.setAttribute('data-sidebar', 'collapsed');
	} catch {
		/* storage unavailable: fall back to the OS preference */
	}
})();
