package model

import (
	"fmt"
	"path/filepath"
	"strings"

	"delica-tui/db"
	"delica-tui/image"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
)

type SubgroupModel struct {
	db         *db.DB
	subgroupID string
	subgroup   *db.Subgroup
	group      *db.Group
	parts      []db.PartWithDiagram
	diagram    *db.Diagram
	menu       *ui.Menu
	img        *image.KittyImage
	imgError   string
}

func NewSubgroupModel(database *db.DB, subgroupID string, dataPath string) *SubgroupModel {
	subgroup, _ := database.GetSubgroup(subgroupID)
	var group *db.Group
	if subgroup != nil {
		group, _ = database.GetGroup(subgroup.GroupID)
	}
	parts, _ := database.GetPartsForSubgroup(subgroupID)
	diagram, _ := database.GetDiagramForSubgroup(subgroupID)

	var items []ui.MenuItem
	for _, p := range parts {
		label := p.PartNumber
		if p.PNC != nil {
			label = fmt.Sprintf("[%s] %s", *p.PNC, p.PartNumber)
		}
		hint := ""
		if p.Description != nil {
			hint = *p.Description
		}
		items = append(items, ui.MenuItem{ID: fmt.Sprintf("%d", p.ID), Label: label, Hint: hint})
	}

	m := &SubgroupModel{
		db:         database,
		subgroupID: subgroupID,
		subgroup:   subgroup,
		group:      group,
		parts:      parts,
		diagram:    diagram,
		menu:       ui.NewMenu(items),
	}

	// Load image - use larger size for better visibility
	if diagram != nil && diagram.ImagePath != nil {
		imgPath := filepath.Join(dataPath, *diagram.ImagePath)
		if img, err := image.LoadAndScale(imgPath, 92, 46); err == nil {
			m.img = img
		} else {
			m.imgError = err.Error()
		}
	}

	return m
}

func (m *SubgroupModel) Update(msg tea.Msg) (*SubgroupModel, tea.Cmd, *Screen) {
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

func (m *SubgroupModel) View(width, height int) string {
	if width == 0 {
		width = 80
	}
	if height == 0 {
		height = 24
	}

	var result strings.Builder

	// Top margin (2 blank lines to match other pages)
	result.WriteString("\n\n")

	// Split pane content
	splitHeight := height - 5
	if splitHeight < 10 {
		splitHeight = 10
	}

	leftContent := m.renderDiagram(splitHeight)
	rightContent := m.renderPartsList(splitHeight)

	split := ui.RenderSplitPane(leftContent, rightContent, width-2, splitHeight)

	// Output image escape with positioning
	// Save cursor, move to image position, render, restore cursor
	if m.img != nil {
		result.WriteString("\x1b7")    // Save cursor position
		result.WriteString("  ")       // Left padding (matches split pane margin)
		result.WriteString("\x1b[1B")  // Move cursor down 1 line (past diagram ID)
		result.WriteString(m.img.Render())
		result.WriteString("\x1b8")    // Restore cursor position
	}

	result.WriteString(split)

	return result.String()
}

func (m *SubgroupModel) renderDiagram(height int) string {
	var lines []string

	if m.img != nil {
		// Add diagram ID above the image
		if m.diagram != nil {
			lines = append(lines, ui.DimStyle.Render(m.diagram.ID))
		}
		// Image is rendered separately in View(), just add placeholder lines
		imgHeight := m.img.CellHeight()
		for i := 0; i < imgHeight; i++ {
			lines = append(lines, "")
		}
	} else if m.imgError != "" {
		lines = append(lines, ui.ErrorStyle.Render(m.imgError))
	} else {
		lines = append(lines, ui.DimStyle.Render("No diagram available"))
	}

	// Pad to fill height
	for len(lines) < height {
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

func (m *SubgroupModel) renderPartsList(height int) string {
	var b strings.Builder

	// Header - show GROUP > SUBGROUP
	title := "UNKNOWN"
	if m.group != nil && m.subgroup != nil {
		title = fmt.Sprintf("%s > %s", strings.ToUpper(m.group.Name), strings.ToUpper(m.subgroup.Name))
	}
	b.WriteString(ui.HeaderStyle.Render(title))
	b.WriteString(strings.Repeat(" ", 5))
	b.WriteString(ui.CountStyle.Render(fmt.Sprintf("%d", len(m.parts))))
	b.WriteString("\n")
	b.WriteString(ui.DimStyle.Render("─────────────────────────────────"))

	// Adjust menu visible items based on available height (max 15)
	// Header takes 3 lines, footer takes 2 lines
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

	if len(m.parts) == 0 {
		b.WriteString(ui.DimStyle.Render("No parts found"))
	} else {
		b.WriteString(m.menu.View())
	}

	b.WriteString("\n\n")
	b.WriteString(ui.DimStyle.Render("↑↓ navigate   enter select"))

	return b.String()
}

func (m *SubgroupModel) ImageID() uint32 {
	if m.img != nil {
		return m.img.ID()
	}
	return 0
}
