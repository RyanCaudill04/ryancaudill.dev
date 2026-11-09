// Package status checks whether the services on this Pi are up, so the
// page's lights can show it. Checks run from the Pi against each
// service's local health URL, so they work for services behind
// Cloudflare Access too, and the browser never makes a cross-origin call.
package status

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"
)

// State is what a service's light shows.
type State string

const (
	Up       State = "up"
	Sleeping State = "sleeping" // running, but idle until someone connects
	Starting State = "starting"
	Down     State = "down"
	Unknown  State = "unknown" // not monitored, or the answer made no sense
)

// Text is the systemd-style label the terminal shows for s.
func (s State) Text() string {
	switch s {
	case Up:
		return "active (running)"
	case Sleeping:
		return "active (sleeping)"
	case Starting:
		return "activating"
	case Down:
		return "failed"
	}
	return "not monitored"
}

// Target is one service to check.
type Target struct {
	ID         string
	URL        string // empty: not monitored
	StateField string // JSON field holding the state; empty: any 2xx is up
	Self       bool   // this site; always up when it can answer
}

// Service is one service's result, as the API sends it.
type Service struct {
	State State  `json:"state"`
	Text  string `json:"text"`
}

// Report is the result of checking every target.
type Report struct {
	Checked  time.Time          `json:"checked"`
	Services map[string]Service `json:"services"`
}

// Checker checks the targets and caches the report for TTL, so many
// visitors at once don't turn into many requests to each service.
type Checker struct {
	targets []Target
	client  *http.Client
	ttl     time.Duration
	now     func() time.Time

	mu   sync.Mutex
	last Report
}

// New returns a Checker that gives each check two seconds and reuses a
// report for ten.
func New(targets []Target) *Checker {
	return &Checker{
		targets: targets,
		client: &http.Client{
			Timeout: 2 * time.Second,
			// A redirect is usually a login page, not the service saying
			// it's healthy, so don't follow it: it counts as down.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		ttl: 10 * time.Second,
		now: time.Now,
	}
}

// Report returns the cached report, or checks every target again when
// it's older than the TTL. Callers that arrive during a check wait for it
// and share its result.
func (c *Checker) Report(ctx context.Context) Report {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.last.Checked.IsZero() && c.now().Sub(c.last.Checked) < c.ttl {
		return c.last
	}

	states := make([]State, len(c.targets))
	var wg sync.WaitGroup
	for i, t := range c.targets {
		wg.Add(1)
		go func() {
			defer wg.Done()
			states[i] = c.check(ctx, t)
		}()
	}
	wg.Wait()

	r := Report{Checked: c.now(), Services: make(map[string]Service, len(c.targets))}
	for i, t := range c.targets {
		r.Services[t.ID] = Service{State: states[i], Text: states[i].Text()}
	}
	c.last = r
	return r
}

func (c *Checker) check(ctx context.Context, t Target) State {
	if t.Self {
		return Up
	}
	if t.URL == "" {
		return Unknown
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.URL, nil)
	if err != nil {
		return Unknown
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return Down
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Down
	}
	if t.StateField == "" {
		return Up
	}

	var body map[string]any
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&body); err != nil {
		return Unknown
	}
	s, _ := body[t.StateField].(string)
	return fromApp(s)
}

// fromApp maps a service's own word for its state onto a State.
func fromApp(s string) State {
	switch s {
	case "active", "running", "up", "ok":
		return Up
	case "sleeping":
		return Sleeping
	case "starting":
		return Starting
	case "offline", "stopped", "down":
		return Down
	}
	return Unknown
}
