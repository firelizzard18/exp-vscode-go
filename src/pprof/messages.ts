export type Message = HoverEvent;

export interface HoverEvent {
	readonly event: 'hovered';
	readonly func?: {
		readonly file: string;
		readonly line: number;
	};
	readonly lines?: readonly LineData[];
}

export interface LineData {
	readonly line: number;
	readonly value: string;
	readonly unit: string;
	readonly ratio: string;
}
