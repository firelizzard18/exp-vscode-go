/**
 * go test -json output format.
 * which is a subset of https://golang.org/cmd/test2json/#hdr-Output_Format
 * and includes only the fields that we are using.
 */
export interface TestEvent {
	Action: string;
	Output?: string;
	Package?: string;
	Test?: string;
	Elapsed?: number;
	FailedBuild?: string;
}
