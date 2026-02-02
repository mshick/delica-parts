package ui

import "github.com/charmbracelet/bubbletea"

func IsQuit(msg tea.KeyMsg) bool {
	return msg.String() == "q"
}

func IsBack(msg tea.KeyMsg) bool {
	return msg.Type == tea.KeyEscape
}

func IsUp(msg tea.KeyMsg) bool {
	return msg.Type == tea.KeyUp || msg.String() == "k"
}

func IsDown(msg tea.KeyMsg) bool {
	return msg.Type == tea.KeyDown || msg.String() == "j"
}

func IsEnter(msg tea.KeyMsg) bool {
	return msg.Type == tea.KeyEnter
}

func IsSearch(msg tea.KeyMsg) bool {
	return msg.String() == "/"
}

func IsBookmark(msg tea.KeyMsg) bool {
	return msg.String() == "b"
}

func IsNote(msg tea.KeyMsg) bool {
	return msg.String() == "n"
}

func IsSaveNote(msg tea.KeyMsg) bool {
	return msg.Type == tea.KeyCtrlS
}
