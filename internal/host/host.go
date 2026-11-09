// Package host reads a few vital signs of the machine the site runs on,
// for the page's footer. On anything but Linux (a Mac during
// development) the files don't exist and the fields stay empty.
package host

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Info is what the footer shows. Empty fields are left out.
type Info struct {
	Uptime string `json:"uptime,omitempty"` // "17d 4h"
	Load   string `json:"load,omitempty"`   // 1-minute load average
	Temp   string `json:"temp,omitempty"`   // CPU temperature, "48.2°C"
}

// Read returns the current Info.
func Read() Info {
	return Info{
		Uptime: uptime(first("/proc/uptime")),
		Load:   first("/proc/loadavg"),
		Temp:   temp(first("/sys/class/thermal/thermal_zone0/temp")),
	}
}

// first returns the first space-separated field of a file, or "".
func first(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func uptime(seconds string) string {
	s, err := strconv.ParseFloat(seconds, 64)
	if err != nil {
		return ""
	}
	mins := int(s) / 60
	days, hours := mins/(24*60), mins/60%24
	switch {
	case days > 0:
		return fmt.Sprintf("%dd %dh", days, hours)
	case hours > 0:
		return fmt.Sprintf("%dh %dm", hours, mins%60)
	}
	return fmt.Sprintf("%dm", mins)
}

func temp(milli string) string {
	m, err := strconv.Atoi(milli)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%.1f°C", float64(m)/1000)
}
