export const Command = {
	Refresh: 'goExp.testExplorer.refresh',
	ConfigureCoverageRunProfile: 'goExp.configureCoverageRunProfile',
	RenderDocs: 'goExp.renderDocs',
	Test: {
		Run: 'goExp.test.run',
		Debug: 'goExp.test.debug',
		Profile: 'goExp.test.profile',
	},
	Browser: {
		Back: 'goExp.browser.back',
		Refresh: 'goExp.browser.refresh',
		Forward: 'goExp.browser.forward',
	},
	Profile: {
		ShowSource: 'goExp.pprof.showSource',
		Ignore: 'goExp.pprof.ignore',
		Capture: 'goExp.pprof.capture',
	},
} as const;
