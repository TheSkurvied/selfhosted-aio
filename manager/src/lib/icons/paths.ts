/**
 * Monochrome line icons, drawn on a 20x20 grid with a 1.5 stroke.
 * Each entry is a list of SVG element strings (path/circle/rect/line/polyline).
 * Keep them stroke-only: the Icon component sets fill="none" and stroke="currentColor".
 */
export const iconPaths = {
	home: ['<path d="M3.5 8.5 10 3.5l6.5 5V16a.5.5 0 0 1-.5.5h-3.5v-5h-5v5H4a.5.5 0 0 1-.5-.5Z"/>'],
	dashboard: [
		'<rect x="3" y="3" width="6" height="7" rx="1"/>',
		'<rect x="11" y="3" width="6" height="4" rx="1"/>',
		'<rect x="11" y="9" width="6" height="8" rx="1"/>',
		'<rect x="3" y="12" width="6" height="5" rx="1"/>'
	],
	people: [
		'<circle cx="7.5" cy="7" r="2.75"/>',
		'<path d="M2.5 16.5c0-2.6 2.2-4.5 5-4.5s5 1.9 5 4.5"/>',
		'<path d="M12.5 4.4a2.75 2.75 0 0 1 0 5.2"/>',
		'<path d="M14.5 12.2c1.8.5 3 2.1 3 4.3"/>'
	],
	person: [
		'<circle cx="10" cy="7" r="3"/>',
		'<path d="M4 17c0-3 2.7-5 6-5s6 2 6 5"/>'
	],
	template: [
		'<path d="M5 2.75h6.5L15.25 6.5V17a.25.25 0 0 1-.25.25H5A.25.25 0 0 1 4.75 17V3A.25.25 0 0 1 5 2.75Z"/>',
		'<path d="M11.25 2.75V6.75h4"/>',
		'<path d="M7.5 10.5h5M7.5 13.5h5"/>'
	],
	file: [
		'<path d="M5 2.75h6.5L15.25 6.5V17a.25.25 0 0 1-.25.25H5A.25.25 0 0 1 4.75 17V3A.25.25 0 0 1 5 2.75Z"/>',
		'<path d="M11.25 2.75V6.75h4"/>'
	],
	key: [
		'<circle cx="7" cy="12.5" r="3.5"/>',
		'<path d="m9.5 10 6.75-6.75M13.5 6l2 2M11.75 7.75l1.5 1.5"/>'
	],
	jobs: ['<path d="M2.5 10h3l2-5.5 5 11 2-5.5h3"/>'],
	activity: ['<path d="M2.5 10h3l2-5.5 5 11 2-5.5h3"/>'],
	audit: [
		'<path d="M3.2 10a6.8 6.8 0 1 0 2-4.8"/>',
		'<path d="M3 3v3.5h3.5"/>',
		'<path d="M10 6.5V10l2.5 1.75"/>'
	],
	history: [
		'<path d="M3.2 10a6.8 6.8 0 1 0 2-4.8"/>',
		'<path d="M3 3v3.5h3.5"/>',
		'<path d="M10 6.5V10l2.5 1.75"/>'
	],
	settings: [
		'<circle cx="10" cy="10" r="2.5"/>',
		'<path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>'
	],
	plus: ['<path d="M10 4v12M4 10h12"/>'],
	search: ['<circle cx="8.75" cy="8.75" r="5.25"/>', '<path d="m12.75 12.75 4 4"/>'],
	'more-horizontal': [
		'<circle cx="4.5" cy="10" r=".9" fill="currentColor"/>',
		'<circle cx="10" cy="10" r=".9" fill="currentColor"/>',
		'<circle cx="15.5" cy="10" r=".9" fill="currentColor"/>'
	],
	'chevron-right': ['<path d="m8 5 5 5-5 5"/>'],
	'chevron-down': ['<path d="m5 8 5 5 5-5"/>'],
	'chevron-left': ['<path d="m12 5-5 5 5 5"/>'],
	'chevron-up': ['<path d="m5 12 5-5 5 5"/>'],
	'caret-right': ['<path d="M8 6v8l5-4Z" fill="currentColor" stroke="none"/>'],
	'caret-down': ['<path d="M6 8h8l-4 5Z" fill="currentColor" stroke="none"/>'],
	copy: [
		'<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
		'<path d="M13 4.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h.5"/>'
	],
	qr: [
		'<rect x="3" y="3" width="5" height="5" rx=".5"/>',
		'<rect x="12" y="3" width="5" height="5" rx=".5"/>',
		'<rect x="3" y="12" width="5" height="5" rx=".5"/>',
		'<path d="M12 12h2v2h-2zM15 15h2v2h-2zM12 16.5v.5M17 12v.5"/>'
	],
	'external-link': [
		'<path d="M11.5 3.5h5v5"/>',
		'<path d="M16.5 3.5 9.5 10.5"/>',
		'<path d="M14.5 11.5v4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h4"/>'
	],
	refresh: ['<path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6"/>', '<path d="M16.5 3.5v3.5H13"/>'],
	sync: [
		'<path d="M3.5 8.5a6.5 6.5 0 0 1 11.6-2.7"/>',
		'<path d="M15.5 3v3h-3"/>',
		'<path d="M16.5 11.5a6.5 6.5 0 0 1-11.6 2.7"/>',
		'<path d="M4.5 17v-3h3"/>'
	],
	rotate: [
		'<path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6"/>',
		'<path d="M3.5 3.5v3.5H7"/>',
		'<circle cx="10" cy="10" r="1.5"/>'
	],
	trash: [
		'<path d="M3.5 5.5h13"/>',
		'<path d="M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/>',
		'<path d="M5 5.5l.8 10.6a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L15 5.5"/>',
		'<path d="M8.5 9v5M11.5 9v5"/>'
	],
	check: ['<path d="m4 10.5 4 4 8-9"/>'],
	x: ['<path d="m5 5 10 10M15 5 5 15"/>'],
	alert: [
		'<path d="M10 3 2.5 16.5h15Z" stroke-linejoin="round"/>',
		'<path d="M10 8.5v3.5"/>',
		'<circle cx="10" cy="14.25" r=".6" fill="currentColor"/>'
	],
	info: [
		'<circle cx="10" cy="10" r="7"/>',
		'<path d="M10 9v4.5"/>',
		'<circle cx="10" cy="6.6" r=".6" fill="currentColor"/>'
	],
	sun: [
		'<circle cx="10" cy="10" r="3.25"/>',
		'<path d="M10 2v1.75M10 16.25V18M2 10h1.75M16.25 10H18M4.35 4.35l1.2 1.2M14.45 14.45l1.2 1.2M4.35 15.65l1.2-1.2M14.45 5.55l1.2-1.2"/>'
	],
	moon: ['<path d="M16.5 12A7 7 0 0 1 8 3.5a7 7 0 1 0 8.5 8.5Z"/>'],
	'log-out': [
		'<path d="M8 3.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1H8"/>',
		'<path d="M12.5 6.5 16 10l-3.5 3.5M16 10H7.5"/>'
	],
	'sidebar-collapse': [
		'<path d="m10 6-4 4 4 4"/>',
		'<path d="m15 6-4 4 4 4"/>'
	],
	'sidebar-expand': ['<path d="m10 6 4 4-4 4"/>', '<path d="m5 6 4 4-4 4"/>'],
	menu: ['<path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13"/>'],
	lock: [
		'<rect x="4" y="8.5" width="12" height="8.5" rx="1.5"/>',
		'<path d="M6.75 8.5V6.25a3.25 3.25 0 0 1 6.5 0V8.5"/>'
	],
	link: [
		'<path d="M8.5 11.5a3 3 0 0 0 4.3.2l2.5-2.5a3 3 0 0 0-4.3-4.3L10 5.9"/>',
		'<path d="M11.5 8.5a3 3 0 0 0-4.3-.2l-2.5 2.5a3 3 0 0 0 4.3 4.3l1-1"/>'
	],
	upload: ['<path d="M10 13V3.5M6 7.5l4-4 4 4"/>', '<path d="M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13"/>'],
	download: ['<path d="M10 3.5V13M6 9l4 4 4-4"/>', '<path d="M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13"/>'],
	filter: ['<path d="M3 5h14M5.5 10h9M8 15h4"/>'],
	clock: ['<circle cx="10" cy="10" r="7"/>', '<path d="M10 6v4l2.75 1.75"/>'],
	eye: [
		'<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z"/>',
		'<circle cx="10" cy="10" r="2.5"/>'
	],
	'eye-off': [
		'<path d="M8.2 4.7c.6-.1 1.2-.2 1.8-.2 5 0 8 5.5 8 5.5a14 14 0 0 1-2 2.6M5.5 5.9C3.3 7.4 2 10 2 10s3 5.5 8 5.5c1.6 0 3-.5 4.1-1.2"/>',
		'<path d="m3 3 14 14"/>'
	],
	shield: ['<path d="M10 2.5 4 4.75v4.5c0 3.9 2.6 6.9 6 8.25 3.4-1.35 6-4.35 6-8.25v-4.5Z"/>'],
	server: [
		'<rect x="3" y="3.5" width="14" height="5.5" rx="1"/>',
		'<rect x="3" y="11" width="14" height="5.5" rx="1"/>',
		'<path d="M6 6.25h.01M6 13.75h.01" stroke-width="2"/>'
	],
	edit: ['<path d="M13.5 3.5 16.5 6.5 7 16H4v-3Z"/>', '<path d="m11.5 5.5 3 3"/>'],
	share: [
		'<path d="M10 3v9.5M6.5 6.5 10 3l3.5 3.5"/>',
		'<path d="M6 9H5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-1"/>'
	],
	'arrow-right': ['<path d="M4 10h12M11 5l5 5-5 5"/>'],
	'arrow-left': ['<path d="M16 10H4M9 5l-5 5 5 5"/>'],
	tag: [
		'<path d="M3 3.5v5.3a1 1 0 0 0 .3.7l7.2 7.2a1 1 0 0 0 1.4 0l4.8-4.8a1 1 0 0 0 0-1.4L9.5 3.3a1 1 0 0 0-.7-.3H3.5a.5.5 0 0 0-.5.5Z"/>',
		'<circle cx="6.5" cy="6.5" r="1"/>'
	],
	code: ['<path d="m7 6-4 4 4 4M13 6l4 4-4 4"/>'],
	pin: [
		'<path d="M7.5 3h5M8.5 3v5L6 11h8l-2.5-3V3"/>',
		'<path d="M10 11v6"/>'
	],
	mail: ['<rect x="2.5" y="4.5" width="15" height="11" rx="1.5"/>', '<path d="m3 5.5 7 5.5 7-5.5"/>'],
	database: [
		'<ellipse cx="10" cy="5" rx="6" ry="2.25"/>',
		'<path d="M4 5v10c0 1.25 2.7 2.25 6 2.25s6-1 6-2.25V5"/>',
		'<path d="M4 10c0 1.25 2.7 2.25 6 2.25s6-1 6-2.25"/>'
	],
	grip: [
		'<circle cx="7.5" cy="5" r=".9" fill="currentColor"/>',
		'<circle cx="12.5" cy="5" r=".9" fill="currentColor"/>',
		'<circle cx="7.5" cy="10" r=".9" fill="currentColor"/>',
		'<circle cx="12.5" cy="10" r=".9" fill="currentColor"/>',
		'<circle cx="7.5" cy="15" r=".9" fill="currentColor"/>',
		'<circle cx="12.5" cy="15" r=".9" fill="currentColor"/>'
	],
	text: ['<path d="M4 5.5h12M4 10h12M4 14.5h7"/>'],
	calendar: [
		'<rect x="3" y="4" width="14" height="13" rx="1.5"/>',
		'<path d="M3 8h14M7 2.5V5M13 2.5V5"/>'
	],
	hash: ['<path d="M4 7.5h13M3 12.5h13M8.5 3 7 17M13 3l-1.5 14"/>'],
	list: [
		'<path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9"/>',
		'<path d="M3.75 5.5h.01M3.75 10h.01M3.75 14.5h.01" stroke-width="2"/>'
	],
	'circle-dashed': [
		'<circle cx="10" cy="10" r="6.5" stroke-dasharray="2.4 2.2"/>'
	]
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof iconPaths;
