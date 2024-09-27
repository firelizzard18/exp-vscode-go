import { FlameGraphSettings } from './State';

type Event = HoverEvent | ActionEvent;
type Command = FunctionCommand | UndoCommand | RedoCommand;
export type Message = Event | Command;

export interface FunctionCommand {
	readonly command: 'ignore-func';
	readonly func: FuncData;
}

export interface HoverEvent {
	readonly event: 'hovered';
	readonly func?: FuncData;
	readonly lines?: readonly LineData[];
}

export interface ActionEvent {
	readonly event: 'action';
	readonly label: string;
	readonly action: Action;
}

export interface UndoCommand {
	readonly command: 'undo';
	readonly action: Action;
}

export interface RedoCommand {
	readonly command: 'redo';
	readonly action: Action;
}

type Action = FlameGraphAction;

interface FlameGraphAction {
	readonly action: 'flame-graph';
	readonly before: FlameGraphSettings;
	readonly after: FlameGraphSettings;
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
