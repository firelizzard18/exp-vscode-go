export type Message = HoverEvent | FunctionCommand;

export interface FunctionCommand {
	readonly command: 'ignore-func';
	readonly func: FuncData;
}

export interface HoverEvent {
	readonly event: 'hovered';
	readonly func?: FuncData;
	readonly lines?: readonly LineData[];
}

interface FuncData {
	readonly id: number;
	readonly file: string;
	readonly line: number;
}

export interface LineData {
	readonly line: number;
	readonly value: string;
	readonly unit: string;
	readonly ratio: string;
}
