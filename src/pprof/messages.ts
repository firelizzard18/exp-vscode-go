export type Message = HoverEvent;

export interface HoverEvent {
	readonly event: 'hovered';
	readonly func?: {
		readonly file: string;
		readonly line: number;
	};
}
