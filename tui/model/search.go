package model

import (
	"fmt"
	"strings"
	"time"

	"delica-tui/db"
	"delica-tui/ui"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type SearchModel struct {
	db            *db.DB
	input         textinput.Model
	results       []db.SearchResult
	cursor        int
	lastQuery     string
	debounceTimer *time.Timer
}

type searchResultsMsg struct {
	query   string
	results []db.SearchResult
}

func NewSearchModel(database *db.DB, query string) *SearchModel {
	ti := textinput.New()
	ti.Placeholder = "Search parts by number or description..."
	ti.Focus()
	ti.SetValue(query)
	ti.CharLimit = 100
	ti.Width = 50

	m := &SearchModel{
		db:    database,
		input: ti,
	}

	// Initial search if query provided
	if query != "" {
		m.results, _ = database.SearchParts(query)
		m.lastQuery = query
	}

	return m
}

func (m *SearchModel) Update(msg tea.Msg) (*SearchModel, tea.Cmd, *Screen) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		// Navigation with arrow keys only (j/k should type into input)
		if msg.Type == tea.KeyUp {
			if m.cursor > 0 {
				m.cursor--
			}
			return m, nil, nil
		}
		if msg.Type == tea.KeyDown {
			if m.cursor < len(m.results)-1 {
				m.cursor++
			}
			return m, nil, nil
		}
		if ui.IsEnter(msg) && len(m.results) > 0 {
			result := m.results[m.cursor]
			s := PartDetailScreen(result.ID, true)
			return m, nil, &s
		}

	case searchResultsMsg:
		if msg.query == m.input.Value() {
			m.results = msg.results
			m.cursor = 0
		}
		return m, nil, nil
	}

	// Update text input
	prevValue := m.input.Value()
	m.input, cmd = m.input.Update(msg)

	// Debounced search on input change
	if m.input.Value() != prevValue {
		query := m.input.Value()
		return m, tea.Tick(150*time.Millisecond, func(t time.Time) tea.Msg {
			results, _ := m.db.SearchParts(query)
			return searchResultsMsg{query: query, results: results}
		}), nil
	}

	return m, cmd, nil
}

func (m *SearchModel) View(width, height int) string {
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

func (m *SearchModel) renderLeftPane(height int) string {
	var lines []string

	// Search tips
	lines = append(lines, ui.HeaderStyle.Render("SEARCH TIPS"))
	lines = append(lines, "")
	lines = append(lines, "Search by:")
	lines = append(lines, "  - Part number")
	lines = append(lines, "  - Description")
	lines = append(lines, "  - PNC code")
	lines = append(lines, "")
	lines = append(lines, ui.DimStyle.Render("Results update as"))
	lines = append(lines, ui.DimStyle.Render("you type"))

	// Pad to fill height
	for len(lines) < height {
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

func (m *SearchModel) renderRightPane(height int) string {
	var b strings.Builder

	// Input box
	inputBox := ui.BoxStyle.Render(m.input.View())
	b.WriteString(inputBox)
	b.WriteString("\n\n")

	b.WriteString(ui.DimStyle.Render("─────────────────────────────────"))
	b.WriteString("\n\n")

	// Results
	query := strings.TrimSpace(m.input.Value())
	if query == "" {
		b.WriteString(ui.DimStyle.Render("Start typing to search parts"))
	} else if len(m.results) == 0 {
		b.WriteString(ui.DimStyle.Render(fmt.Sprintf("No results for \"%s\"", query)))
	} else {
		maxResults := height - 8
		if maxResults < 5 {
			maxResults = 5
		}
		if maxResults > 20 {
			maxResults = 20
		}

		for i, r := range m.results {
			if i >= maxResults {
				break
			}

			isSelected := i == m.cursor

			// Part number
			label := r.PartNumber
			if r.PNC != nil {
				label = fmt.Sprintf("[%s] %s", *r.PNC, r.PartNumber)
			}

			// Hint: description + location
			var hintParts []string
			if r.Description != nil {
				hintParts = append(hintParts, *r.Description)
			}
			if r.SubgroupName != nil {
				hintParts = append(hintParts, *r.SubgroupName)
			} else {
				hintParts = append(hintParts, r.GroupName)
			}
			hint := strings.Join(hintParts, " - ")

			var line string
			if isSelected {
				line = ui.SelectedStyle.Render("> ")
			} else {
				line = "  "
			}

			labelStyle := lipgloss.NewStyle().Width(24)
			if isSelected {
				line += ui.SelectedLabelStyle.Render(labelStyle.Render(strings.ToUpper(label)))
			} else {
				line += ui.NormalLabelStyle.Render(labelStyle.Render(strings.ToUpper(label)))
			}
			line += ui.DimStyle.Render(strings.ToUpper(hint))

			b.WriteString(line)
			b.WriteString("\n")
		}

		b.WriteString("\n")
		b.WriteString(ui.DimStyle.Render(fmt.Sprintf("%d results", len(m.results))))
	}

	b.WriteString("\n\n")
	b.WriteString(ui.DimStyle.Render("↑↓ select   enter view"))

	return b.String()
}
