package model

import (
	"strings"

	"delica-tui/db"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type GroupModel struct {
	db        *db.DB
	groupID   string
	group     *db.Group
	subgroups []db.Subgroup
	menu      *ui.Menu
}

func NewGroupModel(database *db.DB, groupID string) *GroupModel {
	group, _ := database.GetGroup(groupID)
	subgroups, _ := database.GetSubgroups(groupID)

	var items []ui.MenuItem
	for _, s := range subgroups {
		items = append(items, ui.MenuItem{ID: s.ID, Label: s.Name})
	}

	return &GroupModel{
		db:        database,
		groupID:   groupID,
		group:     group,
		subgroups: subgroups,
		menu:      ui.NewMenu(items),
	}
}

func (m *GroupModel) Update(msg tea.Msg) (*GroupModel, tea.Cmd, *Screen) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if ui.IsUp(msg) {
			m.menu.Up()
		}
		if ui.IsDown(msg) {
			m.menu.Down()
		}
		if ui.IsEnter(msg) {
			if item := m.menu.Selected(); item != nil {
				s := SubgroupScreen(item.ID)
				return m, nil, &s
			}
		}
	}
	return m, nil, nil
}

func (m *GroupModel) View(width, height int) string {
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

	header := headerStyle.Render(ui.DimStyle.Render("esc back"))

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

func (m *GroupModel) renderLeftPane(height int) string {
	var lines []string

	// Group info (title is already in header, so just show instructions)
	lines = append(lines, "")
	lines = append(lines, ui.DimStyle.Render("Select a subgroup to"))
	lines = append(lines, ui.DimStyle.Render("view parts and diagrams"))

	// Pad to fill height
	for len(lines) < height {
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

func (m *GroupModel) renderRightPane(height int) string {
	var b strings.Builder

	// Header - show group name
	title := "UNKNOWN"
	if m.group != nil {
		title = strings.ToUpper(m.group.Name)
	}
	b.WriteString(ui.HeaderStyle.Render(title))
	b.WriteString("\n")
	b.WriteString(ui.DimStyle.Render("─────────────────────────────────"))

	// Adjust menu visible items based on available height (max 15)
	menuHeight := height - 5
	if menuHeight < 5 {
		menuHeight = 5
	}
	if menuHeight > 15 {
		menuHeight = 15
	}
	m.menu.MaxVisibleItems = menuHeight

	// One less blank line if menu scrolls (to account for scroll indicator)
	if len(m.menu.Items) > m.menu.MaxVisibleItems {
		b.WriteString("\n")
	} else {
		b.WriteString("\n\n")
	}

	// Menu
	if len(m.subgroups) == 0 {
		b.WriteString(ui.DimStyle.Render("No subgroups found"))
	} else {
		b.WriteString(m.menu.View())
	}

	b.WriteString("\n\n")
	b.WriteString(ui.DimStyle.Render("↑↓ navigate   enter select"))

	return b.String()
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
