/* eslint-disable n/no-unpublished-import */
import { Config } from 'jest';

export default {
	testMatch: [
		'<rootDir>/test/component/**/*.test.ts',
		'<rootDir>/src/test/**/*.test.ts',
		'<rootDir>/test/integration/**/*.test.ts',
	],
	modulePathIgnorePatterns: ['.vscode-test', '<rootDir>/out/.*__mocks__', 'test/integration/extension.test.ts'],
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
	},

	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				tsconfig: 'src/tsconfig.json',
			},
		],
	},
} satisfies Config;
