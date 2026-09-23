export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'aio-theme';

function read(): ThemeChoice {
	if (typeof localStorage === 'undefined') return 'system';
	try {
		const v = localStorage.getItem(KEY);
		return v === 'light' || v === 'dark' ? v : 'system';
	} catch {
		return 'system';
	}
}

class ThemeState {
	choice = $state<ThemeChoice>('system');

	/** Call once on the client (the app layout does this). */
	init() {
		this.choice = read();
	}

	set(choice: ThemeChoice) {
		this.choice = choice;
		const root = document.documentElement;
		try {
			if (choice === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, choice);
		} catch {
			/* ignore */
		}
		if (choice === 'system') root.removeAttribute('data-theme');
		else root.setAttribute('data-theme', choice);
	}

	/** The theme currently shown, resolving 'system' via matchMedia. */
	get resolved(): 'light' | 'dark' {
		if (this.choice !== 'system') return this.choice;
		if (typeof matchMedia === 'undefined') return 'light';
		return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	toggle() {
		this.set(this.resolved === 'dark' ? 'light' : 'dark');
	}
}

export const theme = new ThemeState();
