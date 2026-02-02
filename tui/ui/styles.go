package ui

import "github.com/charmbracelet/lipgloss"

var (
	ColorCyan    = lipgloss.Color("6")
	ColorYellow  = lipgloss.Color("3")
	ColorGreen   = lipgloss.Color("2")
	ColorMagenta = lipgloss.Color("5")
	ColorDim     = lipgloss.Color("8")
	ColorWhite   = lipgloss.Color("15")
	ColorRed     = lipgloss.Color("1")
	ColorBlue    = lipgloss.Color("4")

	HeaderStyle = lipgloss.NewStyle().
			Foreground(ColorCyan).
			Bold(true)

	PartNumberStyle = lipgloss.NewStyle().
			Foreground(ColorYellow).
			Bold(true)

	SelectedStyle = lipgloss.NewStyle().
			Foreground(ColorGreen)

	SelectedLabelStyle = lipgloss.NewStyle().
				Foreground(ColorYellow).
				Bold(true)

	NormalLabelStyle = lipgloss.NewStyle().
				Foreground(ColorWhite)

	DimStyle = lipgloss.NewStyle().
			Foreground(ColorDim)

	CountStyle = lipgloss.NewStyle().
			Foreground(ColorMagenta)

	ErrorStyle = lipgloss.NewStyle().
			Foreground(ColorRed)

	LinkStyle = lipgloss.NewStyle().
			Foreground(ColorBlue)

	BoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			Padding(0, 1)
)
