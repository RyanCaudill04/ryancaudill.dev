// Package content loads content/site.yaml, the one file that holds
// everything the page says: the intro, the hardware, the projects, and the
// resume.
package content

import (
	"fmt"
	"io/fs"

	"gopkg.in/yaml.v3"
)

// Site is the whole page's content.
type Site struct {
	Name      string    `yaml:"name"`
	Role      string    `yaml:"role"`
	About     []string  `yaml:"about"` // one entry per paragraph
	Board     string    `yaml:"board"` // caption under the Pi
	Hardware  []Layer   `yaml:"hardware"`
	Photo     string    `yaml:"photo"`    // portrait, shown in the header and About; leave out for none
	Drive     string    `yaml:"drive"`    // the SSD's M.2 size on the 3D model
	Location  string    `yaml:"location"` // shown in the footer
	Timezone  string    `yaml:"timezone"` // IANA name, for the footer clock
	ResumePDF string    `yaml:"resume_pdf"`
	Links     []Link    `yaml:"links"`
	Projects  []Project `yaml:"projects"`
	Archive   []Past    `yaml:"archive"`
	Resume    Resume    `yaml:"resume"`
}

// Layer is one piece of the server, shown as a card in the hardware
// section that points at its part of the 3D model.
type Layer struct {
	Part    string `yaml:"part"`  // the piece of the model: ssd, hat, cooler or pi
	Label   string `yaml:"label"` // small heading above the name
	Name    string `yaml:"name"`
	Summary string `yaml:"summary"`
	Specs   []Spec `yaml:"specs"`
}

// Spec is one name/value row on a hardware card.
type Spec struct {
	Name  string `yaml:"name"`
	Value string `yaml:"value"`
}

// Project is one service running on the Pi, shown as a row in the
// terminal with a light.
type Project struct {
	ID          string `yaml:"id"`   // the unit name shown in the terminal
	Host        string `yaml:"host"` // e.g. play.ryancaudill.dev
	URL         string `yaml:"url"`  // link target; empty when it isn't a web page
	Description string `yaml:"description"`
}

// Past is a project that no longer runs.
type Past struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	URL         string `yaml:"url"`
}

type Link struct {
	Label string `yaml:"label"`
	URL   string `yaml:"url"`
}

type Resume struct {
	Experience []Entry  `yaml:"experience"`
	Education  []Entry  `yaml:"education"`
	Skills     []string `yaml:"skills"`
}

type Entry struct {
	Title   string `yaml:"title"`
	Org     string `yaml:"org"`
	When    string `yaml:"when"`
	Summary string `yaml:"summary"`
}

// The pieces of the 3D model a hardware card can point at, and the SSD
// sizes the model can draw.
var (
	parts  = map[string]bool{"ssd": true, "hat": true, "cooler": true, "pi": true}
	drives = map[string]bool{"2230": true, "2242": true, "2260": true, "2280": true}
)

// Load reads and checks the content file at path in files.
func Load(files fs.FS, path string) (Site, error) {
	var s Site
	data, err := fs.ReadFile(files, path)
	if err != nil {
		return s, err
	}
	if err := yaml.Unmarshal(data, &s); err != nil {
		return s, fmt.Errorf("%s: %w", path, err)
	}
	if s.Drive == "" {
		s.Drive = "2230"
	}
	if err := s.check(); err != nil {
		return s, fmt.Errorf("%s: %w", path, err)
	}
	return s, nil
}

func (s Site) check() error {
	if s.Name == "" {
		return fmt.Errorf("name is empty")
	}
	seen := map[string]bool{}
	for i, p := range s.Projects {
		if p.ID == "" || p.Host == "" {
			return fmt.Errorf("projects[%d] needs an id and a host", i)
		}
		if seen[p.ID] {
			return fmt.Errorf("projects: id %q is used twice", p.ID)
		}
		seen[p.ID] = true
	}
	pointed := map[string]bool{}
	for i, l := range s.Hardware {
		if !parts[l.Part] {
			return fmt.Errorf("hardware[%d]: part %q is not ssd, hat, cooler or pi", i, l.Part)
		}
		if pointed[l.Part] {
			return fmt.Errorf("hardware: part %q has two cards", l.Part)
		}
		pointed[l.Part] = true
		if l.Name == "" {
			return fmt.Errorf("hardware[%d] needs a name", i)
		}
	}
	if !drives[s.Drive] {
		return fmt.Errorf("drive %q is not 2230, 2242, 2260 or 2280", s.Drive)
	}
	return nil
}
