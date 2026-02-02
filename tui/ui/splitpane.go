package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// RenderSplitPane renders a split pane with left and right content.
func RenderSplitPane(left, right string, totalWidth, totalHeight int) string {
	const leftMargin = 2 // Left margin for the whole split pane

	leftWidth := (totalWidth - leftMargin) * 40 / 100
	rightWidth := totalWidth - leftMargin - leftWidth - 3 // Account for border

	// Fit content to exact height first
	leftContent := FitHeight(left, totalHeight)
	rightContent := FitHeight(right, totalHeight)

	// Build panes line by line for precise control
	leftLines := strings.Split(leftContent, "\n")
	rightLines := strings.Split(rightContent, "\n")

	margin := strings.Repeat(" ", leftMargin)

	var result []string
	for i := 0; i < totalHeight; i++ {
		leftLine := ""
		rightLine := ""
		if i < len(leftLines) {
			leftLine = leftLines[i]
		}
		if i < len(rightLines) {
			rightLine = rightLines[i]
		}

		// Pad left line to width
		leftPadded := padToWidth(leftLine, leftWidth)

		// Add border character and right content
		rightPadded := "│ " + padToWidth(rightLine, rightWidth-2)

		result = append(result, margin+leftPadded+rightPadded)
	}

	return strings.Join(result, "\n")
}

// padToWidth pads a string with spaces to reach the target width
// Uses lipgloss width calculation to handle ANSI escape codes
func padToWidth(s string, width int) string {
	currentWidth := lipgloss.Width(s)
	if currentWidth >= width {
		return s
	}
	return s + strings.Repeat(" ", width-currentWidth)
}

// FitHeight pads or trims content to fit exact height
func FitHeight(content string, height int) string {
	lines := strings.Split(content, "\n")
	if len(lines) >= height {
		return strings.Join(lines[:height], "\n")
	}
	for len(lines) < height {
		lines = append(lines, "")
	}
	return strings.Join(lines, "\n")
}
