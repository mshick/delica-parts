# TUI Go Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the Delica parts TUI from Ink/TypeScript to Go/Bubble Tea as a 1:1 port.

**Architecture:** Elm-style (Model-Update-View) with a root model routing to screen-specific models. Stack-based navigation with history. Split pane layouts for diagram screens.

**Tech Stack:** Go, Bubble Tea, Lip Gloss, Bubbles (text input), zombiezen/go-sqlite, disintegration/imaging for Kitty protocol images.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `tui-go/go.mod`
- Create: `tui-go/main.go`

**Step 1: Create the Go module**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
mkdir -p tui-go
cd tui-go
go mod init delica-tui
```

**Step 2: Add dependencies**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go get github.com/charmbracelet/bubbletea
go get github.com/charmbracelet/lipgloss
go get github.com/charmbracelet/bubbles/textinput
go get zombiezen.com/go/sqlite
go get github.com/disintegration/imaging
```

**Step 3: Create minimal main.go**

Create `tui-go/main.go`:

```go
package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
)

type model struct {
	message string
}

func initialModel() model {
	return model{message: "Delica TUI - Press q to quit"}
}

func (m model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "q" {
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m model) View() string {
	return m.message + "\n"
}

func main() {
	p := tea.NewProgram(initialModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
```

**Step 4: Verify it runs**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go run .
```

Expected: Shows "Delica TUI - Press q to quit", q exits cleanly.

**Step 5: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/
git commit -m "feat(tui-go): scaffold Go project with Bubble Tea"
```

---

## Task 2: Database Layer

**Files:**
- Create: `tui-go/db/types.go`
- Create: `tui-go/db/db.go`

**Step 1: Create types matching the schema**

Create `tui-go/db/types.go`:

```go
package db

type Group struct {
	ID   string
	Name string
}

type Subgroup struct {
	ID      string
	Name    string
	GroupID string
}

type Diagram struct {
	ID         string
	GroupID    string
	SubgroupID *string
	Name       string
	ImageURL   *string
	ImagePath  *string
	SourceURL  string
}

type Part struct {
	ID                    int
	DetailPageID          *string
	PartNumber            string
	PNC                   *string
	Description           *string
	RefNumber             *string
	Quantity              *int
	Spec                  *string
	Notes                 *string
	Color                 *string
	ModelDateRange        *string
	DiagramID             string
	GroupID               string
	SubgroupID            *string
	ReplacementPartNumber *string
}

type PartWithDiagram struct {
	Part
	ImagePath *string
}

type SearchResult struct {
	PartWithDiagram
	GroupName    string
	SubgroupName *string
}

type BookmarkResult struct {
	ID           int
	PartID       int
	PartNumber   string
	PNC          *string
	Description  *string
	GroupName    string
	SubgroupName *string
	CreatedAt    string
}
```

**Step 2: Create database connection and queries**

Create `tui-go/db/db.go`:

```go
package db

import (
	"context"
	"fmt"

	"zombiezen.com/go/sqlite"
	"zombiezen.com/go/sqlite/sqlitex"
)

type DB struct {
	conn *sqlite.Conn
}

func Open(path string) (*DB, error) {
	conn, err := sqlite.OpenConn(path, sqlite.OpenReadWrite)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Ensure bookmarks table exists
	err = sqlitex.ExecuteTransient(conn, `
		CREATE TABLE IF NOT EXISTS bookmarks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			part_id INTEGER NOT NULL UNIQUE,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE
		)
	`, nil)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("create bookmarks table: %w", err)
	}

	return &DB{conn: conn}, nil
}

func (d *DB) Close() error {
	return d.conn.Close()
}

func (d *DB) GetGroups() ([]Group, error) {
	var groups []Group
	err := sqlitex.Execute(d.conn, "SELECT id, name FROM groups ORDER BY name", &sqlitex.ExecOptions{
		ResultFunc: func(stmt *sqlite.Stmt) error {
			groups = append(groups, Group{
				ID:   stmt.ColumnText(0),
				Name: stmt.ColumnText(1),
			})
			return nil
		},
	})
	return groups, err
}

func (d *DB) GetGroup(id string) (*Group, error) {
	var group *Group
	err := sqlitex.Execute(d.conn, "SELECT id, name FROM groups WHERE id = ?", &sqlitex.ExecOptions{
		Args: []any{id},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			group = &Group{
				ID:   stmt.ColumnText(0),
				Name: stmt.ColumnText(1),
			}
			return nil
		},
	})
	return group, err
}

func (d *DB) GetSubgroups(groupID string) ([]Subgroup, error) {
	var subgroups []Subgroup
	err := sqlitex.Execute(d.conn, "SELECT id, name, group_id FROM subgroups WHERE group_id = ? ORDER BY name", &sqlitex.ExecOptions{
		Args: []any{groupID},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			subgroups = append(subgroups, Subgroup{
				ID:      stmt.ColumnText(0),
				Name:    stmt.ColumnText(1),
				GroupID: stmt.ColumnText(2),
			})
			return nil
		},
	})
	return subgroups, err
}

func (d *DB) GetSubgroup(id string) (*Subgroup, error) {
	var subgroup *Subgroup
	err := sqlitex.Execute(d.conn, "SELECT id, name, group_id FROM subgroups WHERE id = ?", &sqlitex.ExecOptions{
		Args: []any{id},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			subgroup = &Subgroup{
				ID:      stmt.ColumnText(0),
				Name:    stmt.ColumnText(1),
				GroupID: stmt.ColumnText(2),
			}
			return nil
		},
	})
	return subgroup, err
}

func (d *DB) GetPartsForSubgroup(subgroupID string) ([]PartWithDiagram, error) {
	var parts []PartWithDiagram
	err := sqlitex.Execute(d.conn, `
		SELECT p.id, p.detail_page_id, p.part_number, p.pnc, p.description,
			   p.ref_number, p.quantity, p.spec, p.notes, p.color,
			   p.model_date_range, p.diagram_id, p.group_id, p.subgroup_id,
			   p.replacement_part_number, d.image_path
		FROM parts p
		JOIN diagrams d ON p.diagram_id = d.id
		WHERE p.subgroup_id = ?
		ORDER BY p.ref_number, p.part_number
	`, &sqlitex.ExecOptions{
		Args: []any{subgroupID},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			parts = append(parts, scanPartWithDiagram(stmt))
			return nil
		},
	})
	return parts, err
}

func (d *DB) GetDiagramForSubgroup(subgroupID string) (*Diagram, error) {
	var diagram *Diagram
	err := sqlitex.Execute(d.conn, "SELECT id, group_id, subgroup_id, name, image_url, image_path, source_url FROM diagrams WHERE subgroup_id = ? LIMIT 1", &sqlitex.ExecOptions{
		Args: []any{subgroupID},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			diagram = &Diagram{
				ID:         stmt.ColumnText(0),
				GroupID:    stmt.ColumnText(1),
				SubgroupID: nullableString(stmt, 2),
				Name:       stmt.ColumnText(3),
				ImageURL:   nullableString(stmt, 4),
				ImagePath:  nullableString(stmt, 5),
				SourceURL:  stmt.ColumnText(6),
			}
			return nil
		},
	})
	return diagram, err
}

func (d *DB) GetDiagram(id string) (*Diagram, error) {
	var diagram *Diagram
	err := sqlitex.Execute(d.conn, "SELECT id, group_id, subgroup_id, name, image_url, image_path, source_url FROM diagrams WHERE id = ?", &sqlitex.ExecOptions{
		Args: []any{id},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			diagram = &Diagram{
				ID:         stmt.ColumnText(0),
				GroupID:    stmt.ColumnText(1),
				SubgroupID: nullableString(stmt, 2),
				Name:       stmt.ColumnText(3),
				ImageURL:   nullableString(stmt, 4),
				ImagePath:  nullableString(stmt, 5),
				SourceURL:  stmt.ColumnText(6),
			}
			return nil
		},
	})
	return diagram, err
}

func (d *DB) GetPart(id int) (*PartWithDiagram, error) {
	var part *PartWithDiagram
	err := sqlitex.Execute(d.conn, `
		SELECT p.id, p.detail_page_id, p.part_number, p.pnc, p.description,
			   p.ref_number, p.quantity, p.spec, p.notes, p.color,
			   p.model_date_range, p.diagram_id, p.group_id, p.subgroup_id,
			   p.replacement_part_number, d.image_path
		FROM parts p
		JOIN diagrams d ON p.diagram_id = d.id
		WHERE p.id = ?
	`, &sqlitex.ExecOptions{
		Args: []any{id},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			p := scanPartWithDiagram(stmt)
			part = &p
			return nil
		},
	})
	return part, err
}

func (d *DB) SearchParts(query string) ([]SearchResult, error) {
	if query == "" {
		return nil, nil
	}
	var results []SearchResult
	err := sqlitex.Execute(d.conn, `
		SELECT p.id, p.detail_page_id, p.part_number, p.pnc, p.description,
			   p.ref_number, p.quantity, p.spec, p.notes, p.color,
			   p.model_date_range, p.diagram_id, p.group_id, p.subgroup_id,
			   p.replacement_part_number, d.image_path,
			   g.name, s.name
		FROM parts p
		JOIN parts_fts fts ON p.id = fts.rowid
		JOIN diagrams d ON p.diagram_id = d.id
		JOIN groups g ON p.group_id = g.id
		LEFT JOIN subgroups s ON p.subgroup_id = s.id
		WHERE parts_fts MATCH ?
		ORDER BY rank
		LIMIT 50
	`, &sqlitex.ExecOptions{
		Args: []any{query + "*"},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			results = append(results, SearchResult{
				PartWithDiagram: scanPartWithDiagram(stmt),
				GroupName:       stmt.ColumnText(16),
				SubgroupName:    nullableString(stmt, 17),
			})
			return nil
		},
	})
	return results, err
}

func (d *DB) AddBookmark(partID int) error {
	return sqlitex.ExecuteTransient(d.conn, "INSERT OR IGNORE INTO bookmarks (part_id) VALUES (?)", &sqlitex.ExecOptions{
		Args: []any{partID},
	})
}

func (d *DB) RemoveBookmark(partID int) error {
	return sqlitex.ExecuteTransient(d.conn, "DELETE FROM bookmarks WHERE part_id = ?", &sqlitex.ExecOptions{
		Args: []any{partID},
	})
}

func (d *DB) IsBookmarked(partID int) (bool, error) {
	var found bool
	err := sqlitex.Execute(d.conn, "SELECT 1 FROM bookmarks WHERE part_id = ?", &sqlitex.ExecOptions{
		Args: []any{partID},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			found = true
			return nil
		},
	})
	return found, err
}

func (d *DB) GetBookmarks() ([]BookmarkResult, error) {
	var bookmarks []BookmarkResult
	err := sqlitex.Execute(d.conn, `
		SELECT b.id, b.part_id, b.created_at,
			   p.part_number, p.pnc, p.description,
			   g.name, s.name
		FROM bookmarks b
		JOIN parts p ON b.part_id = p.id
		JOIN groups g ON p.group_id = g.id
		LEFT JOIN subgroups s ON p.subgroup_id = s.id
		ORDER BY b.created_at DESC
	`, &sqlitex.ExecOptions{
		ResultFunc: func(stmt *sqlite.Stmt) error {
			bookmarks = append(bookmarks, BookmarkResult{
				ID:           stmt.ColumnInt(0),
				PartID:       stmt.ColumnInt(1),
				CreatedAt:    stmt.ColumnText(2),
				PartNumber:   stmt.ColumnText(3),
				PNC:          nullableString(stmt, 4),
				Description:  nullableString(stmt, 5),
				GroupName:    stmt.ColumnText(6),
				SubgroupName: nullableString(stmt, 7),
			})
			return nil
		},
	})
	return bookmarks, err
}

func (d *DB) GetBookmarkCount() (int, error) {
	var count int
	err := sqlitex.Execute(d.conn, "SELECT COUNT(*) FROM bookmarks", &sqlitex.ExecOptions{
		ResultFunc: func(stmt *sqlite.Stmt) error {
			count = stmt.ColumnInt(0)
			return nil
		},
	})
	return count, err
}

// Helper functions

func nullableString(stmt *sqlite.Stmt, col int) *string {
	if stmt.ColumnType(col) == sqlite.TypeNull {
		return nil
	}
	s := stmt.ColumnText(col)
	return &s
}

func nullableInt(stmt *sqlite.Stmt, col int) *int {
	if stmt.ColumnType(col) == sqlite.TypeNull {
		return nil
	}
	i := stmt.ColumnInt(col)
	return &i
}

func scanPartWithDiagram(stmt *sqlite.Stmt) PartWithDiagram {
	return PartWithDiagram{
		Part: Part{
			ID:                    stmt.ColumnInt(0),
			DetailPageID:          nullableString(stmt, 1),
			PartNumber:            stmt.ColumnText(2),
			PNC:                   nullableString(stmt, 3),
			Description:           nullableString(stmt, 4),
			RefNumber:             nullableString(stmt, 5),
			Quantity:              nullableInt(stmt, 6),
			Spec:                  nullableString(stmt, 7),
			Notes:                 nullableString(stmt, 8),
			Color:                 nullableString(stmt, 9),
			ModelDateRange:        nullableString(stmt, 10),
			DiagramID:             stmt.ColumnText(11),
			GroupID:               stmt.ColumnText(12),
			SubgroupID:            nullableString(stmt, 13),
			ReplacementPartNumber: nullableString(stmt, 14),
		},
		ImagePath: nullableString(stmt, 15),
	}
}

// Unused import guard
var _ = context.Background
```

**Step 3: Verify compilation**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go build ./...
```

Expected: Compiles without errors.

**Step 4: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/db/
git commit -m "feat(tui-go): add database layer with all queries"
```

---

## Task 3: Styles and UI Helpers

**Files:**
- Create: `tui-go/ui/styles.go`
- Create: `tui-go/ui/keys.go`
- Create: `tui-go/ui/menu.go`
- Create: `tui-go/ui/splitpane.go`

**Step 1: Create styles**

Create `tui-go/ui/styles.go`:

```go
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
```

**Step 2: Create key bindings**

Create `tui-go/ui/keys.go`:

```go
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
```

**Step 3: Create menu component**

Create `tui-go/ui/menu.go`:

```go
package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

type MenuItem struct {
	ID    string
	Label string
	Hint  string
}

type Menu struct {
	Items           []MenuItem
	Cursor          int
	MaxVisibleItems int
}

func NewMenu(items []MenuItem) *Menu {
	return &Menu{
		Items:           items,
		Cursor:          0,
		MaxVisibleItems: 20,
	}
}

func (m *Menu) Up() {
	if m.Cursor > 0 {
		m.Cursor--
	}
}

func (m *Menu) Down() {
	if m.Cursor < len(m.Items)-1 {
		m.Cursor++
	}
}

func (m *Menu) Selected() *MenuItem {
	if m.Cursor >= 0 && m.Cursor < len(m.Items) {
		return &m.Items[m.Cursor]
	}
	return nil
}

func (m *Menu) View() string {
	if len(m.Items) == 0 {
		return DimStyle.Render("No items")
	}

	var b strings.Builder

	// Calculate visible window
	windowStart := 0
	windowEnd := len(m.Items)

	if len(m.Items) > m.MaxVisibleItems {
		padding := m.MaxVisibleItems / 4
		windowStart = m.Cursor - padding
		if windowStart < 0 {
			windowStart = 0
		}
		windowEnd = windowStart + m.MaxVisibleItems
		if windowEnd > len(m.Items) {
			windowEnd = len(m.Items)
			windowStart = windowEnd - m.MaxVisibleItems
			if windowStart < 0 {
				windowStart = 0
			}
		}
	}

	hasMoreAbove := windowStart > 0
	hasMoreBelow := windowEnd < len(m.Items)

	if len(m.Items) > m.MaxVisibleItems {
		if hasMoreAbove {
			b.WriteString(DimStyle.Render(fmt.Sprintf("  ↑ %d more", windowStart)))
		}
		b.WriteString("\n")
	}

	for i := windowStart; i < windowEnd; i++ {
		item := m.Items[i]
		isSelected := i == m.Cursor

		var line string
		if isSelected {
			line = SelectedStyle.Render("› ") + SelectedLabelStyle.Render(strings.ToUpper(item.Label))
		} else {
			line = "  " + NormalLabelStyle.Render(strings.ToUpper(item.Label))
		}

		if item.Hint != "" {
			line += DimStyle.Render(" " + strings.ToUpper(item.Hint))
		}

		b.WriteString(line)
		if i < windowEnd-1 {
			b.WriteString("\n")
		}
	}

	if len(m.Items) > m.MaxVisibleItems {
		b.WriteString("\n")
		if hasMoreBelow {
			b.WriteString(DimStyle.Render(fmt.Sprintf("  ↓ %d more", len(m.Items)-windowEnd)))
		}
	}

	return b.String()
}
```

**Step 4: Create split pane helper**

Create `tui-go/ui/splitpane.go`:

```go
package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

func RenderSplitPane(left, right string, totalWidth, totalHeight int) string {
	leftWidth := totalWidth * 40 / 100
	rightWidth := totalWidth - leftWidth - 1

	leftStyle := lipgloss.NewStyle().
		Width(leftWidth).
		Height(totalHeight)

	rightStyle := lipgloss.NewStyle().
		Width(rightWidth).
		Height(totalHeight).
		PaddingLeft(1).
		BorderStyle(lipgloss.NormalBorder()).
		BorderLeft(true).
		BorderTop(false).
		BorderRight(false).
		BorderBottom(false)

	leftPane := leftStyle.Render(left)
	rightPane := rightStyle.Render(right)

	return lipgloss.JoinHorizontal(lipgloss.Top, leftPane, rightPane)
}

// Pad or trim content to fit height
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
```

**Step 5: Verify compilation**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go build ./...
```

**Step 6: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/ui/
git commit -m "feat(tui-go): add UI styles, keys, menu, and split pane helpers"
```

---

## Task 4: Kitty Protocol Image Rendering

**Files:**
- Create: `tui-go/image/kitty.go`

**Step 1: Create Kitty protocol implementation**

Create `tui-go/image/kitty.go`:

```go
package image

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image/png"
	"os"
	"sync/atomic"

	"github.com/disintegration/imaging"
)

var imageIDCounter uint32

// KittyImage represents an image prepared for Kitty protocol rendering
type KittyImage struct {
	data   string // base64 encoded PNG
	width  int    // pixels
	height int    // pixels
	id     uint32
}

// LoadAndScale loads an image, scales it to fit within maxWidth x maxHeight cells,
// and prepares it for Kitty protocol rendering.
// Assumes ~10 pixels per cell width, ~20 pixels per cell height.
func LoadAndScale(path string, maxWidthCells, maxHeightCells int) (*KittyImage, error) {
	// Check file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, fmt.Errorf("file not found: %s", path)
	}

	// Load image
	img, err := imaging.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open image: %w", err)
	}

	// Convert cells to pixels (approximate)
	maxWidthPx := maxWidthCells * 10
	maxHeightPx := maxHeightCells * 20

	// Scale to fit
	bounds := img.Bounds()
	origWidth := bounds.Dx()
	origHeight := bounds.Dy()

	// Calculate scale factor
	scaleW := float64(maxWidthPx) / float64(origWidth)
	scaleH := float64(maxHeightPx) / float64(origHeight)
	scale := scaleW
	if scaleH < scaleW {
		scale = scaleH
	}

	newWidth := int(float64(origWidth) * scale)
	newHeight := int(float64(origHeight) * scale)

	// Resize
	resized := imaging.Resize(img, newWidth, newHeight, imaging.Lanczos)

	// Encode to PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, resized); err != nil {
		return nil, fmt.Errorf("encode png: %w", err)
	}

	// Base64 encode
	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())

	id := atomic.AddUint32(&imageIDCounter, 1)

	return &KittyImage{
		data:   encoded,
		width:  newWidth,
		height: newHeight,
		id:     id,
	}, nil
}

// Render returns the escape sequence to display the image.
// The image is transmitted and displayed in one command.
func (img *KittyImage) Render() string {
	// Kitty graphics protocol:
	// \x1b_G<key>=<value>,...;<payload>\x1b\\
	//
	// Keys:
	// a=T - transmit and display
	// f=100 - PNG format
	// t=d - direct transmission
	// i=<id> - image ID
	// s=<width> - width in pixels
	// v=<height> - height in pixels
	// q=2 - suppress responses

	// For large images, we need to chunk the data
	// Kitty protocol recommends chunks of 4096 bytes
	const chunkSize = 4096

	var result bytes.Buffer

	data := img.data
	first := true
	for len(data) > 0 {
		chunk := data
		more := 0
		if len(data) > chunkSize {
			chunk = data[:chunkSize]
			data = data[chunkSize:]
			more = 1
		} else {
			data = ""
		}

		result.WriteString("\x1b_G")
		if first {
			result.WriteString(fmt.Sprintf("a=T,f=100,t=d,i=%d,s=%d,v=%d,q=2,m=%d;",
				img.id, img.width, img.height, more))
			first = false
		} else {
			result.WriteString(fmt.Sprintf("m=%d;", more))
		}
		result.WriteString(chunk)
		result.WriteString("\x1b\\")
	}

	return result.String()
}

// Clear returns the escape sequence to delete an image by ID.
func Clear(id uint32) string {
	// a=d - delete
	// d=I - delete by ID
	// i=<id> - image ID
	return fmt.Sprintf("\x1b_Ga=d,d=I,i=%d,q=2\x1b\\", id)
}

// ClearAll returns the escape sequence to delete all images.
func ClearAll() string {
	return "\x1b_Ga=d,d=A,q=2\x1b\\"
}

// ID returns the image's unique identifier.
func (img *KittyImage) ID() uint32 {
	return img.id
}

// CellHeight estimates the height in terminal cells.
func (img *KittyImage) CellHeight() int {
	return (img.height + 19) / 20 // Round up
}

// CellWidth estimates the width in terminal cells.
func (img *KittyImage) CellWidth() int {
	return (img.width + 9) / 10 // Round up
}
```

**Step 2: Verify compilation**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go build ./...
```

**Step 3: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/image/
git commit -m "feat(tui-go): add Kitty protocol image rendering"
```

---

## Task 5: Navigation and Root Model

**Files:**
- Create: `tui-go/model/screen.go`
- Create: `tui-go/model/model.go`

**Step 1: Create screen types**

Create `tui-go/model/screen.go`:

```go
package model

type ScreenType int

const (
	ScreenHome ScreenType = iota
	ScreenGroup
	ScreenSubgroup
	ScreenPartDetail
	ScreenSearch
	ScreenBookmarks
)

type Screen struct {
	Type       ScreenType
	GroupID    string
	SubgroupID string
	PartID     int
	Query      string
	FromSearch bool
}

func HomeScreen() Screen {
	return Screen{Type: ScreenHome}
}

func GroupScreen(groupID string) Screen {
	return Screen{Type: ScreenGroup, GroupID: groupID}
}

func SubgroupScreen(subgroupID string) Screen {
	return Screen{Type: ScreenSubgroup, SubgroupID: subgroupID}
}

func PartDetailScreen(partID int, fromSearch bool) Screen {
	return Screen{Type: ScreenPartDetail, PartID: partID, FromSearch: fromSearch}
}

func SearchScreen(query string) Screen {
	return Screen{Type: ScreenSearch, Query: query}
}

func BookmarksScreen() Screen {
	return Screen{Type: ScreenBookmarks}
}
```

**Step 2: Create root model**

Create `tui-go/model/model.go`:

```go
package model

import (
	"delica-tui/db"
	"delica-tui/image"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
)

type Model struct {
	db      *db.DB
	screen  Screen
	history []Screen

	// Screen models
	home       *HomeModel
	group      *GroupModel
	subgroup   *SubgroupModel
	partDetail *PartDetailModel
	search     *SearchModel
	bookmarks  *BookmarksModel

	// Terminal size
	width  int
	height int

	// Track current image for cleanup
	currentImageID uint32
}

func New(database *db.DB) *Model {
	m := &Model{
		db:     database,
		screen: HomeScreen(),
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
			return m, tea.Sequence(
				tea.Printf("%s", image.ClearAll()),
				tea.Quit,
			)
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
	}

	if nav != nil {
		return m.navigate(*nav)
	}

	return m, cmd
}

func (m *Model) View() string {
	switch m.screen.Type {
	case ScreenHome:
		return m.home.View(m.width, m.height)
	case ScreenGroup:
		return m.group.View(m.width, m.height)
	case ScreenSubgroup:
		return m.subgroup.View(m.width, m.height)
	case ScreenPartDetail:
		return m.partDetail.View(m.width, m.height)
	case ScreenSearch:
		return m.search.View(m.width, m.height)
	case ScreenBookmarks:
		return m.bookmarks.View(m.width, m.height)
	}
	return "Unknown screen"
}

func (m *Model) navigate(to Screen) (*Model, tea.Cmd) {
	// Clear any current image before navigating
	var cmds []tea.Cmd
	if m.currentImageID != 0 {
		cmds = append(cmds, tea.Printf("%s", image.Clear(m.currentImageID)))
		m.currentImageID = 0
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
		m.subgroup = NewSubgroupModel(m.db, to.SubgroupID)
	case ScreenPartDetail:
		m.partDetail = NewPartDetailModel(m.db, to.PartID)
	case ScreenSearch:
		m.search = NewSearchModel(m.db, to.Query)
	case ScreenBookmarks:
		m.bookmarks = NewBookmarksModel(m.db)
	}

	if len(cmds) > 0 {
		return m, tea.Batch(cmds...)
	}
	return m, nil
}

func (m *Model) goBack() (*Model, tea.Cmd) {
	if len(m.history) == 0 {
		return m, tea.Sequence(
			tea.Printf("%s", image.ClearAll()),
			tea.Quit,
		)
	}

	// Clear any current image
	var cmds []tea.Cmd
	if m.currentImageID != 0 {
		cmds = append(cmds, tea.Printf("%s", image.Clear(m.currentImageID)))
		m.currentImageID = 0
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
		m.subgroup = NewSubgroupModel(m.db, m.screen.SubgroupID)
	case ScreenPartDetail:
		m.partDetail = NewPartDetailModel(m.db, m.screen.PartID)
	case ScreenSearch:
		m.search = NewSearchModel(m.db, m.screen.Query)
	case ScreenBookmarks:
		m.bookmarks = NewBookmarksModel(m.db)
	}

	if len(cmds) > 0 {
		return m, tea.Batch(cmds...)
	}
	return m, nil
}

func (m *Model) SetCurrentImageID(id uint32) {
	m.currentImageID = id
}
```

**Step 3: Create placeholder screen models**

These will be filled in subsequent tasks. For now, create stubs.

Create `tui-go/model/home.go`:

```go
package model

import (
	"delica-tui/db"

	tea "github.com/charmbracelet/bubbletea"
)

type HomeModel struct {
	db *db.DB
}

func NewHomeModel(database *db.DB) *HomeModel {
	return &HomeModel{db: database}
}

func (m *HomeModel) Update(msg tea.Msg) (*HomeModel, tea.Cmd, *Screen) {
	return m, nil, nil
}

func (m *HomeModel) View(width, height int) string {
	return "Home Screen (placeholder)"
}
```

Create `tui-go/model/group.go`:

```go
package model

import (
	"delica-tui/db"

	tea "github.com/charmbracelet/bubbletea"
)

type GroupModel struct {
	db      *db.DB
	groupID string
}

func NewGroupModel(database *db.DB, groupID string) *GroupModel {
	return &GroupModel{db: database, groupID: groupID}
}

func (m *GroupModel) Update(msg tea.Msg) (*GroupModel, tea.Cmd, *Screen) {
	return m, nil, nil
}

func (m *GroupModel) View(width, height int) string {
	return "Group Screen (placeholder)"
}
```

Create `tui-go/model/subgroup.go`:

```go
package model

import (
	"delica-tui/db"

	tea "github.com/charmbracelet/bubbletea"
)

type SubgroupModel struct {
	db         *db.DB
	subgroupID string
}

func NewSubgroupModel(database *db.DB, subgroupID string) *SubgroupModel {
	return &SubgroupModel{db: database, subgroupID: subgroupID}
}

func (m *SubgroupModel) Update(msg tea.Msg) (*SubgroupModel, tea.Cmd, *Screen) {
	return m, nil, nil
}

func (m *SubgroupModel) View(width, height int) string {
	return "Subgroup Screen (placeholder)"
}
```

Create `tui-go/model/part.go`:

```go
package model

import (
	"delica-tui/db"

	tea "github.com/charmbracelet/bubbletea"
)

type PartDetailModel struct {
	db     *db.DB
	partID int
}

func NewPartDetailModel(database *db.DB, partID int) *PartDetailModel {
	return &PartDetailModel{db: database, partID: partID}
}

func (m *PartDetailModel) Update(msg tea.Msg) (*PartDetailModel, tea.Cmd, *Screen) {
	return m, nil, nil
}

func (m *PartDetailModel) View(width, height int) string {
	return "Part Detail Screen (placeholder)"
}
```

Create `tui-go/model/search.go`:

```go
package model

import (
	"delica-tui/db"

	tea "github.com/charmbracelet/bubbletea"
)

type SearchModel struct {
	db    *db.DB
	query string
}

func NewSearchModel(database *db.DB, query string) *SearchModel {
	return &SearchModel{db: database, query: query}
}

func (m *SearchModel) Update(msg tea.Msg) (*SearchModel, tea.Cmd, *Screen) {
	return m, nil, nil
}

func (m *SearchModel) View(width, height int) string {
	return "Search Screen (placeholder)"
}
```

Create `tui-go/model/bookmarks.go`:

```go
package model

import (
	"delica-tui/db"

	tea "github.com/charmbracelet/bubbletea"
)

type BookmarksModel struct {
	db *db.DB
}

func NewBookmarksModel(database *db.DB) *BookmarksModel {
	return &BookmarksModel{db: database}
}

func (m *BookmarksModel) Update(msg tea.Msg) (*BookmarksModel, tea.Cmd, *Screen) {
	return m, nil, nil
}

func (m *BookmarksModel) View(width, height int) string {
	return "Bookmarks Screen (placeholder)"
}
```

**Step 4: Update main.go to use root model**

Update `tui-go/main.go`:

```go
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"delica-tui/db"
	"delica-tui/model"

	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	// Find database relative to executable or working directory
	dbPath := filepath.Join("..", "data", "delica.db")
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		// Try from tui-go directory
		dbPath = filepath.Join("..", "..", "data", "delica.db")
	}

	database, err := db.Open(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer database.Close()

	m := model.New(database)
	p := tea.NewProgram(m, tea.WithAltScreen())

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
```

**Step 5: Verify it runs**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go run .
```

Expected: Shows "Home Screen (placeholder)", q quits.

**Step 6: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/
git commit -m "feat(tui-go): add navigation and root model with placeholder screens"
```

---

## Task 6: Home Screen

**Files:**
- Modify: `tui-go/model/home.go`

**Step 1: Implement full Home screen**

Replace `tui-go/model/home.go`:

```go
package model

import (
	"fmt"
	"strings"

	"delica-tui/db"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const (
	vehicleName     = "1999 MITSUBISHI DELICA SPACE GEAR"
	vehicleFrame    = "PD6W-0500900"
	vehicleExterior = "W09M"
	vehicleInterior = "57A"
)

type HomeModel struct {
	db            *db.DB
	groups        []db.Group
	bookmarkCount int
	menu          *ui.Menu
}

func NewHomeModel(database *db.DB) *HomeModel {
	groups, _ := database.GetGroups()
	bookmarkCount, _ := database.GetBookmarkCount()

	// Build menu items
	var items []ui.MenuItem

	// Search and bookmarks
	items = append(items, ui.MenuItem{ID: "__search__", Label: "/ Search", Hint: "Find parts by number or name"})

	bookmarkHint := ""
	if bookmarkCount > 0 {
		bookmarkHint = fmt.Sprintf("%d saved", bookmarkCount)
	}
	items = append(items, ui.MenuItem{ID: "__bookmarks__", Label: "★ Bookmarks", Hint: bookmarkHint})

	// Separator (empty item that we'll skip in navigation)
	items = append(items, ui.MenuItem{ID: "__separator__", Label: ""})

	// Groups
	for _, g := range groups {
		items = append(items, ui.MenuItem{ID: g.ID, Label: g.Name})
	}

	return &HomeModel{
		db:            database,
		groups:        groups,
		bookmarkCount: bookmarkCount,
		menu:          ui.NewMenu(items),
	}
}

func (m *HomeModel) Update(msg tea.Msg) (*HomeModel, tea.Cmd, *Screen) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if ui.IsUp(msg) {
			m.menu.Up()
			// Skip separator
			if m.menu.Selected() != nil && m.menu.Selected().ID == "__separator__" {
				m.menu.Up()
			}
		}
		if ui.IsDown(msg) {
			m.menu.Down()
			// Skip separator
			if m.menu.Selected() != nil && m.menu.Selected().ID == "__separator__" {
				m.menu.Down()
			}
		}
		if ui.IsEnter(msg) {
			if item := m.menu.Selected(); item != nil {
				switch item.ID {
				case "__search__":
					s := SearchScreen("")
					return m, nil, &s
				case "__bookmarks__":
					s := BookmarksScreen()
					return m, nil, &s
				case "__separator__":
					// Do nothing
				default:
					s := GroupScreen(item.ID)
					return m, nil, &s
				}
			}
		}
	}
	return m, nil, nil
}

func (m *HomeModel) View(width, height int) string {
	var b strings.Builder

	// Header
	b.WriteString(ui.HeaderStyle.Render("DELICA PARTS"))
	b.WriteString("\n\n")

	// Vehicle info box
	vehicleInfo := fmt.Sprintf("%s\nFRAME: %s\nEXTERIOR: %s   INTERIOR: %s",
		vehicleName, vehicleFrame, vehicleExterior, vehicleInterior)
	b.WriteString(ui.BoxStyle.Render(vehicleInfo))
	b.WriteString("\n\n")

	// Menu (filter out separator for display, but keep logic)
	menuView := m.renderMenuWithSeparator()
	b.WriteString(menuView)
	b.WriteString("\n\n")

	// Footer
	b.WriteString(ui.DimStyle.Render("↑↓ navigate   enter select   / search   q quit"))

	return lipgloss.NewStyle().Padding(1).Render(b.String())
}

func (m *HomeModel) renderMenuWithSeparator() string {
	var b strings.Builder
	for i, item := range m.menu.Items {
		if item.ID == "__separator__" {
			b.WriteString("\n")
			continue
		}

		isSelected := i == m.menu.Cursor

		var line string
		if isSelected {
			line = ui.SelectedStyle.Render("› ") + ui.SelectedLabelStyle.Render(strings.ToUpper(item.Label))
		} else {
			line = "  " + ui.NormalLabelStyle.Render(strings.ToUpper(item.Label))
		}

		if item.Hint != "" {
			line += ui.DimStyle.Render(" " + item.Hint)
		}

		b.WriteString(line)
		if i < len(m.menu.Items)-1 {
			b.WriteString("\n")
		}
	}
	return b.String()
}
```

**Step 2: Verify it runs**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go run .
```

Expected: Shows vehicle info, search/bookmarks options, and list of groups. Navigation works.

**Step 3: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/model/home.go
git commit -m "feat(tui-go): implement Home screen with vehicle info and groups menu"
```

---

## Task 7: Group Screen

**Files:**
- Modify: `tui-go/model/group.go`

**Step 1: Implement full Group screen**

Replace `tui-go/model/group.go`:

```go
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
	var b strings.Builder

	// Header with breadcrumb
	title := "UNKNOWN GROUP"
	if m.group != nil {
		title = strings.ToUpper(m.group.Name)
	}
	b.WriteString(ui.HeaderStyle.Render(title))
	b.WriteString(strings.Repeat(" ", max(0, width-len(title)-20)))
	b.WriteString(ui.DimStyle.Render("esc back"))
	b.WriteString("\n\n")

	// Subgroups menu
	if len(m.subgroups) == 0 {
		b.WriteString(ui.DimStyle.Render("No subgroups found"))
	} else {
		b.WriteString(m.menu.View())
	}

	b.WriteString("\n\n")
	b.WriteString(ui.DimStyle.Render("↑↓ navigate   enter select"))

	return lipgloss.NewStyle().Padding(1).Render(b.String())
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
```

**Step 2: Verify navigation works**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go run .
```

Expected: Can navigate from Home to Group screen, see subgroups list, Esc goes back.

**Step 3: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/model/group.go
git commit -m "feat(tui-go): implement Group screen with subgroups menu"
```

---

## Task 8: Subgroup Screen (Split Pane with Diagram)

**Files:**
- Modify: `tui-go/model/subgroup.go`

**Step 1: Implement full Subgroup screen with split pane**

Replace `tui-go/model/subgroup.go`:

```go
package model

import (
	"fmt"
	"path/filepath"
	"strings"

	"delica-tui/db"
	"delica-tui/image"
	"delica-tui/ui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
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

func NewSubgroupModel(database *db.DB, subgroupID string) *SubgroupModel {
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

	// Load image
	if diagram != nil && diagram.ImagePath != nil {
		imgPath := filepath.Join("..", "data", *diagram.ImagePath)
		// Also try from tui-go directory
		if img, err := image.LoadAndScale(imgPath, 50, 25); err == nil {
			m.img = img
		} else {
			imgPath = filepath.Join("..", "..", "data", *diagram.ImagePath)
			if img, err := image.LoadAndScale(imgPath, 50, 25); err == nil {
				m.img = img
			} else {
				m.imgError = err.Error()
			}
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
	var b strings.Builder

	// Breadcrumb
	breadcrumb := "UNKNOWN"
	if m.group != nil && m.subgroup != nil {
		breadcrumb = fmt.Sprintf("%s › %s", strings.ToUpper(m.group.Name), strings.ToUpper(m.subgroup.Name))
	}
	headerLine := ui.HeaderStyle.Render(breadcrumb)
	padding := width - lipgloss.Width(headerLine) - 10
	if padding < 0 {
		padding = 0
	}
	b.WriteString(headerLine + strings.Repeat(" ", padding) + ui.DimStyle.Render("esc back"))
	b.WriteString("\n\n")

	// Split pane
	leftContent := m.renderDiagram()
	rightContent := m.renderPartsList()

	splitHeight := height - 6
	if splitHeight < 10 {
		splitHeight = 10
	}

	b.WriteString(ui.RenderSplitPane(leftContent, rightContent, width-2, splitHeight))

	return lipgloss.NewStyle().Padding(1).Render(b.String())
}

func (m *SubgroupModel) renderDiagram() string {
	var b strings.Builder

	if m.img != nil {
		b.WriteString(m.img.Render())
		b.WriteString("\n")
	} else if m.imgError != "" {
		b.WriteString(ui.ErrorStyle.Render(m.imgError))
		b.WriteString("\n")
	} else {
		b.WriteString(ui.DimStyle.Render("No diagram"))
		b.WriteString("\n")
	}

	if m.diagram != nil {
		b.WriteString(ui.DimStyle.Render(m.diagram.ID))
	}

	return b.String()
}

func (m *SubgroupModel) renderPartsList() string {
	var b strings.Builder

	// Header
	b.WriteString(ui.HeaderStyle.Render("PARTS"))
	b.WriteString(strings.Repeat(" ", 20))
	b.WriteString(ui.CountStyle.Render(fmt.Sprintf("%d", len(m.parts))))
	b.WriteString("\n")
	b.WriteString(ui.DimStyle.Render("─────────────────────────────────"))
	b.WriteString("\n\n")

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
```

**Step 2: Verify split pane and image**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go run .
```

Expected: Navigate to a subgroup, see split pane with diagram on left and parts list on right.

**Step 3: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/model/subgroup.go
git commit -m "feat(tui-go): implement Subgroup screen with split pane and Kitty image"
```

---

## Task 9: Part Detail Screen

**Files:**
- Modify: `tui-go/model/part.go`

**Step 1: Implement full Part Detail screen**

Replace `tui-go/model/part.go`:

```go
package model

import (
	"fmt"
	"path/filepath"
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
}

func NewPartDetailModel(database *db.DB, partID int) *PartDetailModel {
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

	m := &PartDetailModel{
		db:         database,
		partID:     partID,
		part:       part,
		diagram:    diagram,
		group:      group,
		subgroup:   subgroup,
		isBookmark: isBookmark,
	}

	// Load image
	if part != nil && part.ImagePath != nil {
		imgPath := filepath.Join("..", "data", *part.ImagePath)
		if img, err := image.LoadAndScale(imgPath, 50, 25); err == nil {
			m.img = img
		} else {
			imgPath = filepath.Join("..", "..", "data", *part.ImagePath)
			if img, err := image.LoadAndScale(imgPath, 50, 25); err == nil {
				m.img = img
			} else {
				m.imgError = err.Error()
			}
		}
	}

	return m
}

func (m *PartDetailModel) Update(msg tea.Msg) (*PartDetailModel, tea.Cmd, *Screen) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
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
	var b strings.Builder

	// Breadcrumb
	breadcrumb := "UNKNOWN"
	if m.group != nil {
		if m.subgroup != nil {
			breadcrumb = fmt.Sprintf("%s › %s", strings.ToUpper(m.group.Name), strings.ToUpper(m.subgroup.Name))
		} else {
			breadcrumb = strings.ToUpper(m.group.Name)
		}
	}
	headerLine := ui.HeaderStyle.Render(breadcrumb)
	padding := width - lipgloss.Width(headerLine) - 10
	if padding < 0 {
		padding = 0
	}
	b.WriteString(headerLine + strings.Repeat(" ", padding) + ui.DimStyle.Render("esc back"))
	b.WriteString("\n\n")

	if m.part == nil {
		b.WriteString(ui.ErrorStyle.Render(fmt.Sprintf("Part not found: %d", m.partID)))
		return lipgloss.NewStyle().Padding(1).Render(b.String())
	}

	// Split pane
	leftContent := m.renderDiagram()
	rightContent := m.renderPartInfo()

	splitHeight := height - 6
	if splitHeight < 10 {
		splitHeight = 10
	}

	b.WriteString(ui.RenderSplitPane(leftContent, rightContent, width-2, splitHeight))

	return lipgloss.NewStyle().Padding(1).Render(b.String())
}

func (m *PartDetailModel) renderDiagram() string {
	var b strings.Builder

	if m.img != nil {
		b.WriteString(m.img.Render())
		b.WriteString("\n")
	} else if m.imgError != "" {
		b.WriteString(ui.ErrorStyle.Render(m.imgError))
		b.WriteString("\n")
	} else {
		b.WriteString(ui.DimStyle.Render("No diagram"))
		b.WriteString("\n")
	}

	if m.diagram != nil {
		b.WriteString(ui.DimStyle.Render(m.diagram.ID))
	}

	return b.String()
}

func (m *PartDetailModel) renderPartInfo() string {
	var b strings.Builder

	// Part number and description
	b.WriteString(ui.PartNumberStyle.Render(strings.ToUpper(m.part.PartNumber)))
	b.WriteString("\n")
	desc := "NO DESCRIPTION"
	if m.part.Description != nil {
		desc = strings.ToUpper(*m.part.Description)
	}
	b.WriteString(desc)
	b.WriteString("\n\n")

	b.WriteString(ui.DimStyle.Render("─────────────────────────────────────"))
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

	// Links
	b.WriteString(ui.DimStyle.Render("Links:"))
	b.WriteString("\n")

	subgroupID := ""
	if m.part.SubgroupID != nil {
		subgroupID = *m.part.SubgroupID
	}
	detailPageID := ""
	if m.part.DetailPageID != nil {
		detailPageID = *m.part.DetailPageID
	}
	epcURL := fmt.Sprintf("https://mitsubishi.epc-data.com/delica_space_gear/pd6w/hseue9/%s/%s/?frame_no=PD6W-0500900",
		subgroupID, detailPageID)
	b.WriteString(ui.LinkStyle.Render(epcURL))
	b.WriteString("\n")

	partNum := m.part.PartNumber
	if m.part.ReplacementPartNumber != nil {
		partNum = *m.part.ReplacementPartNumber
	}
	amayamaURL := fmt.Sprintf("https://www.amayama.com/en/part/mitsubishi/%s", partNum)
	b.WriteString(ui.LinkStyle.Render(amayamaURL))

	b.WriteString("\n\n")

	// Footer
	bookmarkAction := "bookmark"
	if m.isBookmark {
		bookmarkAction = "unbookmark"
	}
	b.WriteString(ui.DimStyle.Render(fmt.Sprintf("esc back   b %s", bookmarkAction)))

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
```

**Step 2: Verify part detail and bookmarking**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go run .
```

Expected: Navigate to a part, see details with diagram, press 'b' to toggle bookmark.

**Step 3: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/model/part.go
git commit -m "feat(tui-go): implement Part Detail screen with bookmark toggle"
```

---

## Task 10: Search Screen

**Files:**
- Modify: `tui-go/model/search.go`

**Step 1: Implement full Search screen**

Replace `tui-go/model/search.go`:

```go
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
	db             *db.DB
	input          textinput.Model
	results        []db.SearchResult
	cursor         int
	lastQuery      string
	debounceTimer  *time.Timer
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
		// Navigation when not typing (or always for arrows)
		if ui.IsUp(msg) {
			if m.cursor > 0 {
				m.cursor--
			}
			return m, nil, nil
		}
		if ui.IsDown(msg) {
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
	var b strings.Builder

	// Header
	headerLine := ui.HeaderStyle.Render("SEARCH")
	padding := width - lipgloss.Width(headerLine) - 10
	if padding < 0 {
		padding = 0
	}
	b.WriteString(headerLine + strings.Repeat(" ", padding) + ui.DimStyle.Render("esc back"))
	b.WriteString("\n\n")

	// Input box
	inputBox := ui.BoxStyle.Render(m.input.View())
	b.WriteString(inputBox)
	b.WriteString("\n\n")

	b.WriteString(ui.DimStyle.Render("───────────────────────────────────────────────────────"))
	b.WriteString("\n\n")

	// Results
	query := strings.TrimSpace(m.input.Value())
	if query == "" {
		b.WriteString(ui.DimStyle.Render("Start typing to search parts, tags, or descriptions"))
	} else if len(m.results) == 0 {
		b.WriteString(ui.DimStyle.Render(fmt.Sprintf("No results for \"%s\"", query)))
	} else {
		for i, r := range m.results {
			if i >= 20 {
				break // Limit displayed results
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
			hint := strings.Join(hintParts, " — ")

			var line string
			if isSelected {
				line = ui.SelectedStyle.Render("› ")
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

	return lipgloss.NewStyle().Padding(1).Render(b.String())
}
```

**Step 2: Verify search functionality**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go run .
```

Expected: Press '/', type to search, results update as you type, can select and navigate to part.

**Step 3: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/model/search.go
git commit -m "feat(tui-go): implement Search screen with debounced FTS"
```

---

## Task 11: Bookmarks Screen

**Files:**
- Modify: `tui-go/model/bookmarks.go`

**Step 1: Implement full Bookmarks screen**

Replace `tui-go/model/bookmarks.go`:

```go
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
		hint := strings.Join(hintParts, " — ")

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
	var b strings.Builder

	// Header
	headerLine := ui.HeaderStyle.Render("BOOKMARKS")
	padding := width - lipgloss.Width(headerLine) - 10
	if padding < 0 {
		padding = 0
	}
	b.WriteString(headerLine + strings.Repeat(" ", padding) + ui.DimStyle.Render("esc back"))
	b.WriteString("\n\n")

	// Bookmarks list
	if len(m.bookmarks) == 0 {
		b.WriteString(ui.DimStyle.Render("No bookmarks yet"))
	} else {
		b.WriteString(m.menu.View())
	}

	b.WriteString("\n\n")
	b.WriteString(ui.DimStyle.Render("↑↓ navigate   enter select"))

	return lipgloss.NewStyle().Padding(1).Render(b.String())
}
```

**Step 2: Verify bookmarks list**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go run .
```

Expected: Navigate to Bookmarks from Home, see saved bookmarks, can navigate to part detail.

**Step 3: Commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add tui-go/model/bookmarks.go
git commit -m "feat(tui-go): implement Bookmarks screen"
```

---

## Task 12: Final Integration and Testing

**Files:**
- Verify: All screens work together
- Update: `CLAUDE.md` if needed

**Step 1: Full navigation test**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go run .
```

Test each flow:
1. Home → Group → Subgroup → Part Detail → Back to Home
2. Home → Search → type query → select result → Part Detail
3. Home → Bookmarks → select bookmark → Part Detail
4. On Part Detail: press 'b' to bookmark/unbookmark
5. '/' from any screen goes to search
6. 'q' quits from any screen

**Step 2: Build standalone binary**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite/tui-go
go build -o delica-tui
./delica-tui
```

**Step 3: Final commit**

```bash
cd /Users/mshick/Code/mshick/delica/.worktrees/tui-go-rewrite
git add -A
git commit -m "feat(tui-go): complete TUI rewrite in Go with Bubble Tea"
```

---

## Summary

This plan creates a complete 1:1 port of the Ink TUI to Go/Bubble Tea:

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Scaffolding | Go module, dependencies, minimal main.go |
| 2 | Database | Types and all queries matching current db.ts |
| 3 | UI Helpers | Styles, keys, menu component, split pane |
| 4 | Images | Kitty protocol implementation |
| 5 | Navigation | Screen types, root model, navigation stack |
| 6 | Home | Vehicle info, groups menu |
| 7 | Group | Subgroups menu |
| 8 | Subgroup | Split pane with diagram and parts list |
| 9 | Part Detail | Split pane with diagram and part info |
| 10 | Search | Text input with debounced FTS |
| 11 | Bookmarks | Saved parts list |
| 12 | Integration | Full testing and binary build |

Total: ~12 commits, building incrementally from foundation to complete app.
