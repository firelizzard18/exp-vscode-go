/* eslint-disable n/no-unpublished-import */
import { Config } from 'jest';

export default {
	testMatch: ['<rootDir>/test/component/**/*.test.ts'],
	modulePathIgnorePatterns: ['.vscode-test', '<rootDir>/out'],

	transform: {
		'^.+\\.tsx?$': 'ts-jest'
	}
} satisfies Config;
