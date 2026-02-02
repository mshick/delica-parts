package model

import (
	"fmt"
	"strings"

	"delica-tui/db"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type BookmarksModel struct {
	db        *db.DB
	bookmarks []db.BookmarkResult
	menu      *ui.Menu
}

func NewBookmarksModel(database *db.DB) *BookmarksModel {
	bookmarks, _ := database.GetBookmarks()

	var items []ui.MenuItem
	for _, b := range bookmarks {
		label := b.PartNumber
		if b.PNC != nil {
			label = fmt.Sprintf("[%s] %s", *b.PNC, b.PartNumber)
		}

		var hintParts []string
		if b.Description != nil {
			hintParts = append(hintParts, *b.Description)
		}
		if b.SubgroupName != nil {
			hintParts = append(hintParts, fmt.Sprintf("%s > %s", b.GroupName, *b.SubgroupName))
		} else {
			hintParts = append(hintParts, b.GroupName)
		}
		hint := strings.Join(hintParts, " - ")

		items = append(items, ui.MenuItem{
			ID:    fmt.Sprintf("%d", b.PartID),
			Label: label,
			Hint:  hint,
		})
	}

	return &BookmarksModel{
		db:        database,
		bookmarks: bookmarks,
		menu:      ui.NewMenu(items),
	}
}

func (m *BookmarksModel) Update(msg tea.Msg) (*BookmarksModel, tea.Cmd, *Screen) {
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
				var partID int
				fmt.Sscanf(item.ID, "%d", &partID)
				s := PartDetailScreen(partID, false)
				return m, nil, &s
			}
		}
	}
	return m, nil, nil
}

func (m *BookmarksModel) View(width, height int) string {
	if width == 0 {
		width = 80
	}
	if height == 0 {
		height = 24
	}

	// Header
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

func (m *BookmarksModel) renderLeftPane(height int) string {
	var lines []string

	// Bookmark info
	lines = append(lines, ui.HeaderStyle.Render("SAVED PARTS"))
	lines = append(lines, "")
	lines = append(lines, fmt.Sprintf("%d bookmarks", len(m.bookmarks)))
	lines = append(lines, "")
	lines = append(lines, ui.DimStyle.Render("Press b on any part"))
	lines = append(lines, ui.DimStyle.Render("to bookmark it"))

	// Pad to fill height
	for len(lines) < height {
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

func (m *BookmarksModel) renderRightPane(height int) string {
	var b strings.Builder

	// Header
	b.WriteString(ui.HeaderStyle.Render("BOOKMARKED PARTS"))
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
	if len(m.bookmarks) == 0 {
		b.WriteString(ui.DimStyle.Render("No bookmarks yet"))
		b.WriteString("\n\n")
		b.WriteString(ui.DimStyle.Render("Navigate to a part and"))
		b.WriteString("\n")
		b.WriteString(ui.DimStyle.Render("press 'b' to bookmark it"))
	} else {
		b.WriteString(m.menu.View())
	}

	b.WriteString("\n\n")
	b.WriteString(ui.DimStyle.Render("↑↓ navigate   enter select"))

	return b.String()
}
