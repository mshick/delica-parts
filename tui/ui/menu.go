package ui

import (
	"fmt"
	"strings"
)

type MenuItem struct {
	ID    string
	Label string
	Hint  string
}

type Menu struct {
	Items           []MenuItem
	Cursor          int
	MaxVisibleItems int
}

func NewMenu(items []MenuItem) *Menu {
	return &Menu{
		Items:           items,
		Cursor:          0,
		MaxVisibleItems: 15,
	}
}

func (m *Menu) Up() {
	if m.Cursor > 0 {
		m.Cursor--
	}
}

func (m *Menu) Down() {
	if m.Cursor < len(m.Items)-1 {
		m.Cursor++
	}
}

func (m *Menu) Selected() *MenuItem {
	if m.Cursor >= 0 && m.Cursor < len(m.Items) {
		return &m.Items[m.Cursor]
	}
	return nil
}

func (m *Menu) View() string {
	if len(m.Items) == 0 {
		return DimStyle.Render("No items")
	}

	// Calculate visible window
	// Reserve 2 lines for scroll indicators if needed
	needsScrolling := len(m.Items) > m.MaxVisibleItems
	visibleItems := m.MaxVisibleItems
	if needsScrolling {
		visibleItems = m.MaxVisibleItems - 2 // Reserve space for ↑/↓ indicators
	}
	if visibleItems < 1 {
		visibleItems = 1
	}

	windowStart := 0
	windowEnd := len(m.Items)

	if needsScrolling {
		// Keep cursor in the middle of the visible area when possible
		halfVisible := visibleItems / 2
		windowStart = m.Cursor - halfVisible
		if windowStart < 0 {
			windowStart = 0
		}
		windowEnd = windowStart + visibleItems
		if windowEnd > len(m.Items) {
			windowEnd = len(m.Items)
			windowStart = windowEnd - visibleItems
			if windowStart < 0 {
				windowStart = 0
			}
		}
	}

	hasMoreAbove := windowStart > 0
	hasMoreBelow := windowEnd < len(m.Items)

	// Build output with fixed number of lines (always MaxVisibleItems)
	var lines []string

	// Line 1: "more above" indicator (if scrollable)
	if needsScrolling {
		if hasMoreAbove {
			lines = append(lines, DimStyle.Render(fmt.Sprintf("  ↑ %d more", windowStart)))
		} else {
			lines = append(lines, "")
		}
	}

	// Menu items
	for i := windowStart; i < windowEnd; i++ {
		item := m.Items[i]
		isSelected := i == m.Cursor

		var line string
		if isSelected {
			line = SelectedStyle.Render("› ") + SelectedLabelStyle.Render(strings.ToUpper(item.Label))
		} else {
			line = "  " + NormalLabelStyle.Render(strings.ToUpper(item.Label))
		}

		if item.Hint != "" {
			line += DimStyle.Render(" " + strings.ToUpper(item.Hint))
		}

		lines = append(lines, line)
	}

	// Last line: "more below" indicator (if scrollable)
	if needsScrolling {
		if hasMoreBelow {
			lines = append(lines, DimStyle.Render(fmt.Sprintf("  ↓ %d more", len(m.Items)-windowEnd)))
		} else {
			lines = append(lines, "")
		}
	}

	// Pad to MaxVisibleItems if we have fewer lines
	for len(lines) < m.MaxVisibleItems {
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}
