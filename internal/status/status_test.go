package status

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func serve(t *testing.T, code int, body string) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(code)
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestReport(t *testing.T) {
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close() // nothing listens here any more

	targets := []Target{
		{ID: "self", Self: true},
		{ID: "unmonitored"},
		{ID: "healthy", URL: serve(t, 200, "ok\n")},
		{ID: "erroring", URL: serve(t, 503, "unavailable\n")},
		{ID: "redirecting", URL: serve(t, 302, "")},
		{ID: "unreachable", URL: closed.URL},
		{ID: "asleep", URL: serve(t, 200, `{"state":"sleeping","online":0}`), StateField: "state"},
		{ID: "active", URL: serve(t, 200, `{"state":"active"}`), StateField: "state"},
		{ID: "offline", URL: serve(t, 200, `{"state":"offline"}`), StateField: "state"},
		{ID: "garbled", URL: serve(t, 200, `not json`), StateField: "state"},
	}
	want := map[string]State{
		"self":        Up,
		"unmonitored": Unknown,
		"healthy":     Up,
		"erroring":    Down,
		"redirecting": Down,
		"unreachable": Down,
		"asleep":      Sleeping,
		"active":      Up,
		"offline":     Down,
		"garbled":     Unknown,
	}

	r := New(targets).Report(context.Background())
	for id, state := range want {
		got := r.Services[id]
		if got.State != state {
			t.Errorf("%s: state %q, want %q", id, got.State, state)
		}
		if got.Text != state.Text() {
			t.Errorf("%s: text %q, want %q", id, got.Text, state.Text())
		}
	}
}

func TestReportIsCached(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
	}))
	defer srv.Close()

	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	c := New([]Target{{ID: "svc", URL: srv.URL}})
	c.now = func() time.Time { return now }

	c.Report(context.Background())
	c.Report(context.Background())
	if n := hits.Load(); n != 1 {
		t.Fatalf("two reports inside the TTL made %d requests, want 1", n)
	}

	now = now.Add(c.ttl)
	c.Report(context.Background())
	if n := hits.Load(); n != 2 {
		t.Fatalf("a report after the TTL made %d requests in all, want 2", n)
	}
}
