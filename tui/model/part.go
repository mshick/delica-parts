package model

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"delica-tui/db"
	"delica-tui/image"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type PartDetailModel struct {
	db         *db.DB
	partID     int
	part       *db.PartWithDiagram
	diagram    *db.Diagram
	group      *db.Group
	subgroup   *db.Subgroup
	isBookmark bool
	img        *image.KittyImage
	imgError   string
	subgroups  []db.SubgroupWithGroup
	links      []string // URLs for external links
	cursor     int      // unified cursor for subgroups + links
}

func NewPartDetailModel(database *db.DB, partID int, dataPath string) *PartDetailModel {
	part, _ := database.GetPart(partID)
	var diagram *db.Diagram
	var group *db.Group
	var subgroup *db.Subgroup

	if part != nil {
		diagram, _ = database.GetDiagram(part.DiagramID)
		group, _ = database.GetGroup(part.GroupID)
		if part.SubgroupID != nil {
			subgroup, _ = database.GetSubgroup(*part.SubgroupID)
		}
	}

	isBookmark, _ := database.IsBookmarked(partID)

	// Get all subgroups containing this part number
	var subgroups []db.SubgroupWithGroup
	if part != nil {
		subgroups, _ = database.GetSubgroupsForPartNumber(part.PartNumber)
	}

	// Build links list
	var links []string
	if part != nil {
		subgroupID := ""
		if part.SubgroupID != nil {
			subgroupID = *part.SubgroupID
		}
		detailPageID := ""
		if part.DetailPageID != nil {
			detailPageID = *part.DetailPageID
		}
		frameName := os.Getenv("FRAME_NAME")
		if frameName == "" {
			frameName = "pd6w"
		}
		trimCode := os.Getenv("TRIM_CODE")
		if trimCode == "" {
			trimCode = "hseue9"
		}
		frameNo := os.Getenv("FRAME_NO")
		if frameNo == "" {
			frameNo = "PD6W-0500900"
		}
		epcURL := fmt.Sprintf("https://mitsubishi.epc-data.com/delica_space_gear/%s/%s/%s/%s/?frame_no=%s",
			frameName, trimCode, subgroupID, detailPageID, frameNo)

		partNum := part.PartNumber
		if part.ReplacementPartNumber != nil {
			partNum = *part.ReplacementPartNumber
		}
		amayamaURL := fmt.Sprintf("https://www.amayama.com/en/part/mitsubishi/%s", partNum)
		amazonURL := fmt.Sprintf("https://www.amazon.com/s?k=%s", partNum)

		links = []string{epcURL, amayamaURL, amazonURL}
	}

	m := &PartDetailModel{
		db:         database,
		partID:     partID,
		part:       part,
		diagram:    diagram,
		group:      group,
		subgroup:   subgroup,
		isBookmark: isBookmark,
		subgroups:  subgroups,
		links:      links,
		cursor:     0,
	}

	// Load image - use larger size for better visibility
	if part != nil && part.ImagePath != nil {
		imgPath := filepath.Join(dataPath, *part.ImagePath)
		if img, err := image.LoadAndScale(imgPath, 92, 46); err == nil {
			m.img = img
		} else {
			m.imgError = err.Error()
		}
	}

	return m
}

func (m *PartDetailModel) totalItems() int {
	return len(m.subgroups) + len(m.links)
}

func (m *PartDetailModel) isSubgroupSelected() bool {
	return m.cursor < len(m.subgroups)
}

func (m *PartDetailModel) selectedLinkIndex() int {
	return m.cursor - len(m.subgroups)
}

func openURL(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return fmt.Errorf("unsupported platform")
	}
	return cmd.Start()
}

func (m *PartDetailModel) Update(msg tea.Msg) (*PartDetailModel, tea.Cmd, *Screen) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		totalItems := m.totalItems()

		if totalItems > 0 {
			if ui.IsUp(msg) {
				if m.cursor > 0 {
					m.cursor--
				}
				return m, nil, nil
			}
			if ui.IsDown(msg) {
				if m.cursor < totalItems-1 {
					m.cursor++
				}
				return m, nil, nil
			}
			if ui.IsEnter(msg) {
				if m.isSubgroupSelected() {
					// Navigate to subgroup
					selected := m.subgroups[m.cursor]
					s := SubgroupScreen(selected.SubgroupID)
					return m, nil, &s
				} else {
					// Open link in browser
					linkIdx := m.selectedLinkIndex()
					if linkIdx >= 0 && linkIdx < len(m.links) {
						openURL(m.links[linkIdx])
					}
				}
				return m, nil, nil
			}
		}

		if ui.IsBookmark(msg) {
			if m.isBookmark {
				m.db.RemoveBookmark(m.partID)
				m.isBookmark = false
			} else {
				m.db.AddBookmark(m.partID)
				m.isBookmark = true
			}
		}
	}
	return m, nil, nil
}

func (m *PartDetailModel) View(width, height int) string {
	if width == 0 {
		width = 80
	}
	if height == 0 {
		height = 24
	}

	var result strings.Builder

	// Top margin (2 blank lines to match other pages)
	result.WriteString("\n\n")

	if m.part == nil {
		result.WriteString(ui.ErrorStyle.Render(fmt.Sprintf("Part not found: %d", m.partID)))
		return result.String()
	}

	// Split pane content
	splitHeight := height - 5
	if splitHeight < 10 {
		splitHeight = 10
	}

	leftContent := m.renderDiagram(splitHeight)
	rightContent := m.renderPartInfo()

	split := ui.RenderSplitPane(leftContent, rightContent, width-2, splitHeight)

	// Output image escape with positioning
	// Save cursor, move to image position, render, restore cursor
	if m.img != nil {
		result.WriteString("\x1b7")   // Save cursor position
		result.WriteString("  ")      // Left padding (matches split pane margin)
		result.WriteString("\x1b[1B") // Move cursor down 1 line (past diagram ID)
		result.WriteString(m.img.Render())
		result.WriteString("\x1b8") // Restore cursor position
	}

	result.WriteString(split)

	return result.String()
}

func (m *PartDetailModel) renderDiagram(height int) string {
	var lines []string

	if m.img != nil {
		// Add diagram ID above the image, truncated to image width
		if m.diagram != nil {
			maxWidth := m.img.CellWidth()
			diagramID := lipgloss.NewStyle().MaxWidth(maxWidth).Render(m.diagram.ID)
			lines = append(lines, ui.DimStyle.Render(diagramID))
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

func (m *PartDetailModel) renderPartInfo() string {
	var b strings.Builder

	// Header - show GROUP > SUBGROUP breadcrumb
	title := "UNKNOWN"
	if m.group != nil && m.subgroup != nil {
		title = fmt.Sprintf("%s > %s", strings.ToUpper(m.group.Name), strings.ToUpper(m.subgroup.Name))
	} else if m.group != nil {
		title = strings.ToUpper(m.group.Name)
	}
	b.WriteString(ui.HeaderStyle.Render(title))
	b.WriteString("\n")
	b.WriteString(ui.DimStyle.Render("─────────────────────────────────────"))
	b.WriteString("\n\n")

	// Part number and description
	b.WriteString(ui.PartNumberStyle.Render(strings.ToUpper(m.part.PartNumber)))
	b.WriteString("\n")
	desc := "NO DESCRIPTION"
	if m.part.Description != nil {
		desc = strings.ToUpper(*m.part.Description)
	}
	b.WriteString(desc)
	b.WriteString("\n\n")

	// Fields
	m.renderField(&b, "PNC", m.part.PNC)
	m.renderField(&b, "Ref #", m.part.RefNumber)
	if m.part.Quantity != nil {
		b.WriteString(m.fieldLine("Quantity", fmt.Sprintf("%d", *m.part.Quantity)))
	}
	m.renderField(&b, "Spec", m.part.Spec)
	m.renderField(&b, "Color", m.part.Color)
	m.renderField(&b, "Date Range", m.part.ModelDateRange)
	m.renderField(&b, "Replaces", m.part.ReplacementPartNumber)

	if m.part.Notes != nil {
		b.WriteString("\n")
		b.WriteString(ui.DimStyle.Render("Notes:"))
		b.WriteString("\n")
		b.WriteString(strings.ToUpper(*m.part.Notes))
		b.WriteString("\n")
	}

	b.WriteString("\n")
	b.WriteString(ui.DimStyle.Render("─────────────────────────────────────"))
	b.WriteString("\n\n")

	// Subgroups
	if len(m.subgroups) > 0 {
		b.WriteString(ui.DimStyle.Render("Subgroups:"))
		b.WriteString("\n")
		for i, sg := range m.subgroups {
			label := fmt.Sprintf("%s > %s", strings.ToUpper(sg.GroupName), strings.ToUpper(sg.SubgroupName))
			if i == m.cursor {
				b.WriteString(ui.SelectedStyle.Render("> "))
				b.WriteString(ui.SelectedLabelStyle.Render(label))
			} else {
				b.WriteString("  ")
				b.WriteString(label)
			}
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}

	// Links
	b.WriteString(ui.DimStyle.Render("Links:"))
	b.WriteString("\n")

	linkLabels := []string{"EPC", "Amayama", "Amazon"}
	for i, url := range m.links {
		cursorIdx := len(m.subgroups) + i
		label := linkLabels[i]
		if cursorIdx == m.cursor {
			b.WriteString(ui.SelectedStyle.Render("> "))
			b.WriteString(ui.SelectedLabelStyle.Render(label))
			b.WriteString(" ")
			b.WriteString(ui.LinkStyle.Render(url))
		} else {
			b.WriteString("  ")
			b.WriteString(label)
			b.WriteString(" ")
			b.WriteString(ui.DimStyle.Render(url))
		}
		b.WriteString("\n")
	}

	b.WriteString("\n")

	// Footer
	bookmarkAction := "bookmark"
	if m.isBookmark {
		bookmarkAction = "unbookmark"
	}
	b.WriteString(ui.DimStyle.Render(fmt.Sprintf("esc back   ↑↓ navigate   enter select   b %s", bookmarkAction)))

	return b.String()
}

func (m *PartDetailModel) renderField(b *strings.Builder, label string, value *string) {
	if value == nil {
		return
	}
	b.WriteString(m.fieldLine(label, strings.ToUpper(*value)))
}

func (m *PartDetailModel) fieldLine(label, value string) string {
	labelStyle := lipgloss.NewStyle().Width(16).Foreground(ui.ColorDim)
	return labelStyle.Render(label) + value + "\n"
}

func (m *PartDetailModel) ImageID() uint32 {
	if m.img != nil {
		return m.img.ID()
	}
	return 0
}
