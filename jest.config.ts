/* eslint-disable n/no-unpublished-import */
import { Config } from 'jest';

export default {
	testMatch: ['<rootDir>/test/component/**/*.test.ts'],
	modulePathIgnorePatterns: ['.vscode-test', '<rootDir>/out/.*__mocks__'],

	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				tsConfig: 'src/tsconfig.json',
			},
		],
	},
} satisfies Config;
