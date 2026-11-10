package content

import (
	"strings"
	"testing"
	"testing/fstest"
)

func TestLoadChecksTheContent(t *testing.T) {
	cases := []struct {
		name string
		yaml string
		want string // part of the error; empty when the content is fine
	}{
		{"minimal", "name: A", ""},
		{"no name", "role: B", "name is empty"},
		{"project without a host", "name: A\nprojects: [{id: x}]", "needs an id and a host"},
		{"project id twice", "name: A\nprojects: [{id: x, host: h}, {id: x, host: i}]", "used twice"},
		{"hardware", "name: A\nhardware: [{part: ssd, name: S}, {part: pi, name: P}]", ""},
		{"unknown part", "name: A\nhardware: [{part: fan, name: F}]", "not ssd, hat or pi"},
		{"part twice", "name: A\nhardware: [{part: pi, name: P}, {part: pi, name: Q}]", "two cards"},
		{"hardware without a name", "name: A\nhardware: [{part: pi}]", "needs a name"},
		{"drive", "name: A\ndrive: \"2242\"", ""},
		{"unknown drive", "name: A\ndrive: \"2280\"", "not 2230 or 2242"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			files := fstest.MapFS{"site.yaml": {Data: []byte(c.yaml)}}
			_, err := Load(files, "site.yaml")
			switch {
			case c.want == "" && err != nil:
				t.Errorf("unexpected error: %v", err)
			case c.want != "" && err == nil:
				t.Errorf("no error; want one about %q", c.want)
			case c.want != "" && !strings.Contains(err.Error(), c.want):
				t.Errorf("error %q doesn't mention %q", err, c.want)
			}
		})
	}
}

func TestLoadDefaultsTheDrive(t *testing.T) {
	files := fstest.MapFS{"site.yaml": {Data: []byte("name: A")}}
	s, err := Load(files, "site.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if s.Drive != "2230" {
		t.Errorf("drive is %q; want the default, 2230", s.Drive)
	}
}
