package model

import (
	"fmt"
	"strings"

	"delica-tui/db"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type NotesModel struct {
	db    *db.DB
	notes []db.NoteResult
	menu  *ui.Menu
}

func NewNotesModel(database *db.DB) *NotesModel {
	notes, _ := database.GetNotes()

	var items []ui.MenuItem
	for _, n := range notes {
		label := n.PartNumber
		if n.PNC != nil {
			label = fmt.Sprintf("[%s] %s", *n.PNC, n.PartNumber)
		}

		// Truncate note content for hint display
		hint := n.Content
		if len(hint) > 60 {
			hint = hint[:57] + "..."
		}
		// Replace newlines with spaces for single-line display
		hint = strings.ReplaceAll(hint, "\n", " ")

		items = append(items, ui.MenuItem{
			ID:    fmt.Sprintf("%d", n.PartID),
			Label: label,
			Hint:  hint,
		})
	}

	return &NotesModel{
		db:    database,
		notes: notes,
		menu:  ui.NewMenu(items),
	}
}

func (m *NotesModel) Update(msg tea.Msg) (*NotesModel, tea.Cmd, *Screen) {
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

func (m *NotesModel) View(width, height int) string {
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

func (m *NotesModel) renderLeftPane(height int) string {
	var lines []string

	lines = append(lines, ui.HeaderStyle.Render("NOTES"))
	lines = append(lines, "")
	lines = append(lines, fmt.Sprintf("%d parts with notes", len(m.notes)))
	lines = append(lines, "")
	lines = append(lines, ui.DimStyle.Render("Press n on any part"))
	lines = append(lines, ui.DimStyle.Render("to add a note"))

	// Pad to fill height
	for len(lines) < height {
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

func (m *NotesModel) renderRightPane(height int) string {
	var b strings.Builder

	// Header
	b.WriteString(ui.HeaderStyle.Render("PARTS WITH NOTES"))
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
	if len(m.notes) == 0 {
		b.WriteString(ui.DimStyle.Render("No notes yet"))
		b.WriteString("\n\n")
		b.WriteString(ui.DimStyle.Render("Navigate to a part and"))
		b.WriteString("\n")
		b.WriteString(ui.DimStyle.Render("press 'n' to add a note"))
	} else {
		b.WriteString(m.menu.View())
	}

	b.WriteString("\n\n")
	b.WriteString(ui.DimStyle.Render("↑↓ navigate   enter select"))

	return b.String()
}
