// Package content loads content/site.yaml, the one file that holds
// everything the page says: the intro, the projects, and the resume.
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
	Board     string    `yaml:"board"` // caption under the Pi illustration
	ResumePDF string    `yaml:"resume_pdf"`
	Links     []Link    `yaml:"links"`
	Projects  []Project `yaml:"projects"`
	Archive   []Past    `yaml:"archive"`
	Resume    Resume    `yaml:"resume"`
}

// Project is one service running on the Pi, shown as a row in the
// terminal with a status light.
type Project struct {
	ID          string `yaml:"id"`   // the unit name shown in the terminal
	Host        string `yaml:"host"` // e.g. play.ryancaudill.dev
	URL         string `yaml:"url"`  // link target; empty when it isn't a web page
	Description string `yaml:"description"`

	// Health is the URL the Pi checks to light the LED. Empty means the
	// project isn't monitored and its light stays grey.
	Health string `yaml:"health"`
	// StateField names a JSON field in the health response that holds
	// the state (play answers {"state": "sleeping", ...}). Empty means
	// any 2xx response counts as up.
	StateField string `yaml:"state_field"`
	// Self marks this site: it's up whenever it can answer.
	Self bool `yaml:"self"`
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
	return nil
}
