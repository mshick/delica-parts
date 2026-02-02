package model

import (
	"fmt"

	"delica-tui/db"
	"delica-tui/image"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
)

type Model struct {
	db       *db.DB
	dataPath string
	screen   Screen
	history  []Screen

	// Screen models
	home       *HomeModel
	group      *GroupModel
	subgroup   *SubgroupModel
	partDetail *PartDetailModel
	search     *SearchModel
	bookmarks  *BookmarksModel
	notes      *NotesModel

	// Terminal size
	width  int
	height int

	// Image to clear on next render
	pendingImageClear uint32
}

func New(database *db.DB, dataPath string) *Model {
	m := &Model{
		db:       database,
		dataPath: dataPath,
		screen:   HomeScreen(),
	}
	m.home = NewHomeModel(database)
	return m
}

func (m *Model) Init() tea.Cmd {
	return nil
}

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		// Global keys
		if ui.IsQuit(msg) {
			// Clear all images before quitting by printing directly
			fmt.Print(image.ClearAll())
			return m, tea.Quit
		}
		if ui.IsBack(msg) {
			return m.goBack()
		}
		if ui.IsSearch(msg) && m.screen.Type != ScreenSearch {
			return m.navigate(SearchScreen(""))
		}
	}

	// Delegate to active screen
	var cmd tea.Cmd
	var nav *Screen

	switch m.screen.Type {
	case ScreenHome:
		m.home, cmd, nav = m.home.Update(msg)
	case ScreenGroup:
		m.group, cmd, nav = m.group.Update(msg)
	case ScreenSubgroup:
		m.subgroup, cmd, nav = m.subgroup.Update(msg)
	case ScreenPartDetail:
		m.partDetail, cmd, nav = m.partDetail.Update(msg)
	case ScreenSearch:
		m.search, cmd, nav = m.search.Update(msg)
	case ScreenBookmarks:
		m.bookmarks, cmd, nav = m.bookmarks.Update(msg)
	case ScreenNotes:
		m.notes, cmd, nav = m.notes.Update(msg)
	}

	if nav != nil {
		return m.navigate(*nav)
	}

	return m, cmd
}

func (m *Model) View() string {
	// Prepend image clear sequence if needed
	var clearPrefix string
	if m.pendingImageClear != 0 {
		if m.pendingImageClear == 0xFFFFFFFF {
			clearPrefix = image.ClearAll()
		} else {
			clearPrefix = image.Clear(m.pendingImageClear)
		}
		m.pendingImageClear = 0
	}

	var content string
	switch m.screen.Type {
	case ScreenHome:
		content = m.home.View(m.width, m.height)
	case ScreenGroup:
		content = m.group.View(m.width, m.height)
	case ScreenSubgroup:
		content = m.subgroup.View(m.width, m.height)
	case ScreenPartDetail:
		content = m.partDetail.View(m.width, m.height)
	case ScreenSearch:
		content = m.search.View(m.width, m.height)
	case ScreenBookmarks:
		content = m.bookmarks.View(m.width, m.height)
	case ScreenNotes:
		content = m.notes.View(m.width, m.height)
	default:
		content = "Unknown screen"
	}

	// Ensure output fills full terminal height to prevent artifacts
	content = ui.FitHeight(content, m.height)

	return clearPrefix + content
}

func (m *Model) navigate(to Screen) (*Model, tea.Cmd) {
	// Mark current image for clearing on next render
	if imgID := m.getCurrentImageID(); imgID != 0 {
		m.pendingImageClear = imgID
	}

	// Push current screen to history
	m.history = append(m.history, m.screen)
	m.screen = to

	// Initialize new screen model
	switch to.Type {
	case ScreenHome:
		m.home = NewHomeModel(m.db)
	case ScreenGroup:
		m.group = NewGroupModel(m.db, to.GroupID)
	case ScreenSubgroup:
		m.subgroup = NewSubgroupModel(m.db, to.SubgroupID, m.dataPath)
	case ScreenPartDetail:
		m.partDetail = NewPartDetailModel(m.db, to.PartID, m.dataPath)
	case ScreenSearch:
		m.search = NewSearchModel(m.db, to.Query)
	case ScreenBookmarks:
		m.bookmarks = NewBookmarksModel(m.db)
	case ScreenNotes:
		m.notes = NewNotesModel(m.db)
	}

	// Clear screen on navigation to prevent artifacts
	return m, tea.ClearScreen
}

func (m *Model) goBack() (*Model, tea.Cmd) {
	if len(m.history) == 0 {
		// Clear all images and quit
		fmt.Print(image.ClearAll())
		return m, tea.Quit
	}

	// Mark current image for clearing on next render
	if imgID := m.getCurrentImageID(); imgID != 0 {
		m.pendingImageClear = imgID
	}

	// Pop from history
	m.screen = m.history[len(m.history)-1]
	m.history = m.history[:len(m.history)-1]

	// Re-initialize screen model
	switch m.screen.Type {
	case ScreenHome:
		m.home = NewHomeModel(m.db)
	case ScreenGroup:
		m.group = NewGroupModel(m.db, m.screen.GroupID)
	case ScreenSubgroup:
		m.subgroup = NewSubgroupModel(m.db, m.screen.SubgroupID, m.dataPath)
	case ScreenPartDetail:
		m.partDetail = NewPartDetailModel(m.db, m.screen.PartID, m.dataPath)
	case ScreenSearch:
		m.search = NewSearchModel(m.db, m.screen.Query)
	case ScreenBookmarks:
		m.bookmarks = NewBookmarksModel(m.db)
	case ScreenNotes:
		m.notes = NewNotesModel(m.db)
	}

	// Clear screen on navigation to prevent artifacts
	return m, tea.ClearScreen
}

// getCurrentImageID returns the image ID from the current screen, if any
func (m *Model) getCurrentImageID() uint32 {
	switch m.screen.Type {
	case ScreenSubgroup:
		if m.subgroup != nil {
			return m.subgroup.ImageID()
		}
	case ScreenPartDetail:
		if m.partDetail != nil {
			return m.partDetail.ImageID()
		}
	}
	return 0
}
