export const Command = {
	Refresh: 'goExp.testExplorer.refresh',
	ConfigureCoverageRunProfile: 'goExp.configureCoverageRunProfile',
	Test: {
		Run: 'goExp.test.run',
		Debug: 'goExp.test.debug',
	},
	Browser: {
		Back: 'goExp.browser.back',
		Refresh: 'goExp.browser.refresh',
		Forward: 'goExp.browser.forward',
	},
} as const;
