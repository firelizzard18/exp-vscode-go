import { TxTar } from '../utils/txtar';

const src = `
-- go.mod --
module foo

go 1.20

-- foo.go --
package foo

import "fmt"

func Foo() {
	fmt.Println("Foo")
}

func TestFoo2(t *testing.T) {
	Foo()
}

-- foo_test.go --
package foo

import "testing"

func callFoo() {
	Foo()
}

func TestFoo(t *testing.T) {
	callFoo()
}

-- foo2_test.go --
package foo_test

import "testing"

func TestBar(t *testing.T) {
	Foo()
}

-- baz/baz_test.go --
package baz

import "testing"

func TestBaz(*testing.T)      {}
func BenchmarkBaz(*testing.B) {}
func FuzzBaz(*testing.F)      {}
func ExampleBaz()             {}

-- bat/go.mod --
module bat

-- bat/bat_test.go --
package bat

import "testing"

func TestBat(*testing.T) {}
`;

describe('TxTar', () => {
	it('can parse a txtar', () => {
		const txtar = new TxTar(src, 'utf-8');
		console.log(txtar);
	});
});
