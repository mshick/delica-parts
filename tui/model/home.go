package model

import (
	"fmt"
	"os"
	"strings"

	"delica-tui/db"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func getVehicleInfo() (name, frame, exterior, interior, date string) {
	name = os.Getenv("VEHICLE_NAME")
	if name == "" {
		name = "Mitsubishi Delica Space Gear"
	}
	frame = os.Getenv("FRAME_NO")
	if frame == "" {
		frame = "PD6W-0500900"
	}
	exterior = os.Getenv("EXTERIOR_CODE")
	if exterior == "" {
		exterior = "W09M"
	}
	interior = os.Getenv("INTERIOR_CODE")
	if interior == "" {
		interior = "57A"
	}
	date = os.Getenv("MANUFACTURE_DATE")
	if date == "" {
		date = "1999.08.3"
	}
	return
}

type HomeModel struct {
	db            *db.DB
	groups        []db.Group
	bookmarkCount int
	menu          *ui.Menu
}

func NewHomeModel(database *db.DB) *HomeModel {
	groups, _ := database.GetGroups()
	bookmarkCount, _ := database.GetBookmarkCount()

	// Build menu items
	var items []ui.MenuItem

	// Search and bookmarks
	items = append(items, ui.MenuItem{ID: "__search__", Label: "/ Search", Hint: "Find parts by number or name"})

	bookmarkHint := ""
	if bookmarkCount > 0 {
		bookmarkHint = fmt.Sprintf("%d saved", bookmarkCount)
	}
	items = append(items, ui.MenuItem{ID: "__bookmarks__", Label: "* Bookmarks", Hint: bookmarkHint})

	// Separator (empty item that we'll skip in navigation)
	items = append(items, ui.MenuItem{ID: "__separator__", Label: ""})

	// Groups
	for _, g := range groups {
		items = append(items, ui.MenuItem{ID: g.ID, Label: g.Name})
	}

	return &HomeModel{
		db:            database,
		groups:        groups,
		bookmarkCount: bookmarkCount,
		menu:          ui.NewMenu(items),
	}
}

func (m *HomeModel) Update(msg tea.Msg) (*HomeModel, tea.Cmd, *Screen) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if ui.IsUp(msg) {
			m.menu.Up()
			// Skip separator
			if m.menu.Selected() != nil && m.menu.Selected().ID == "__separator__" {
				m.menu.Up()
			}
		}
		if ui.IsDown(msg) {
			m.menu.Down()
			// Skip separator
			if m.menu.Selected() != nil && m.menu.Selected().ID == "__separator__" {
				m.menu.Down()
			}
		}
		if ui.IsEnter(msg) {
			if item := m.menu.Selected(); item != nil {
				switch item.ID {
				case "__search__":
					s := SearchScreen("")
					return m, nil, &s
				case "__bookmarks__":
					s := BookmarksScreen()
					return m, nil, &s
				case "__separator__":
					// Do nothing
				default:
					s := GroupScreen(item.ID)
					return m, nil, &s
				}
			}
		}
	}
	return m, nil, nil
}

func (m *HomeModel) View(width, height int) string {
	if width == 0 {
		width = 80
	}
	if height == 0 {
		height = 24
	}

	// Top margin with hint
	headerStyle := lipgloss.NewStyle().
		Width(width - 2).
		Padding(1, 1, 0, 1).
		Align(lipgloss.Right)

	header := headerStyle.Render(ui.DimStyle.Render("q quit"))

	// Split pane content
	splitHeight := height - 5
	if splitHeight < 10 {
		splitHeight = 10
	}

	leftContent := m.renderLeftPane(splitHeight)
	rightContent := m.renderRightPane(splitHeight)

	split := ui.RenderSplitPane(leftContent, rightContent, width-2, splitHeight)

	return header + "\n" + split
}

func (m *HomeModel) renderLeftPane(height int) string {
	var lines []string

	// Vehicle info from environment
	name, frame, exterior, interior, date := getVehicleInfo()

	lines = append(lines, ui.HeaderStyle.Render(name))
	lines = append(lines, "")
	lines = append(lines, fmt.Sprintf("Frame: %s", frame))
	lines = append(lines, fmt.Sprintf("Exterior: %s", exterior))
	lines = append(lines, fmt.Sprintf("Interior: %s", interior))
	lines = append(lines, fmt.Sprintf("Manufactured: %s", date))

	// Pad to fill height
	for len(lines) < height {
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

func (m *HomeModel) renderRightPane(height int) string {
	var b strings.Builder

	// Adjust menu visible items based on available height (max 15)
	menuHeight := height - 5
	if menuHeight < 5 {
		menuHeight = 5
	}
	if menuHeight > 15 {
		menuHeight = 15
	}
	m.menu.MaxVisibleItems = menuHeight

	// Top spacing - one less line if menu scrolls (to account for scroll indicator)
	if len(m.menu.Items) > m.menu.MaxVisibleItems {
		b.WriteString("\n\n")
	} else {
		b.WriteString("\n\n\n")
	}

	// Menu
	b.WriteString(m.renderMenuWithSeparator())

	b.WriteString("\n\n")
	b.WriteString(ui.DimStyle.Render("↑↓ navigate   enter select   / search"))

	return b.String()
}

func (m *HomeModel) renderMenuWithSeparator() string {
	var b strings.Builder
	for i, item := range m.menu.Items {
		if item.ID == "__separator__" {
			b.WriteString("\n")
			continue
		}

		isSelected := i == m.menu.Cursor

		var line string
		if isSelected {
			line = ui.SelectedStyle.Render("> ") + ui.SelectedLabelStyle.Render(strings.ToUpper(item.Label))
		} else {
			line = "  " + ui.NormalLabelStyle.Render(strings.ToUpper(item.Label))
		}

		if item.Hint != "" {
			line += ui.DimStyle.Render(" " + item.Hint)
		}

		b.WriteString(line)
		if i < len(m.menu.Items)-1 {
			b.WriteString("\n")
		}
	}
	return b.String()
}
