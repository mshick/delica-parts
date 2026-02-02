# TUI Go Rewrite Design

Rewrite the Delica parts TUI from Ink/TypeScript to Go/Bubble Tea.

## Motivation

- **Performance**: Ink feels sluggish, Go is fast with no Node.js overhead
- **Single binary**: `go build` produces one executable, no runtime dependencies
- **Better model**: Elm architecture fits TUI patterns naturally (vs React model)
- **Consistent rendering**: Ink has rendering inconsistencies; Bubble Tea is reliable
- **Learning**: Opportunity to learn Go and Bubble Tea

## Scope

1:1 port of existing TUI features:
- 6 screens: home, group, subgroup, part detail, search, bookmarks
- Stack-based navigation with history
- Split pane layouts with diagram images
- FTS search with auto-complete
- Bookmarks functionality

## Tech Stack

| Component | Choice |
|-----------|--------|
| Language | Go |
| Framework | Bubble Tea (charmbracelet/bubbletea) |
| Styling | Lip Gloss (charmbracelet/lipgloss) |
| Components | Bubbles (charmbracelet/bubbles) |
| Database | zombiezen.com/go/sqlite (pure Go, no CGo) |
| Images | Native Kitty protocol + disintegration/imaging |

## Project Structure

```
tui-go/
├── go.mod
├── go.sum
├── main.go                 # Entry point, tea.Program setup
├── db/
│   └── db.go               # SQLite connection + all queries
├── model/
│   ├── model.go            # Root model, screen routing, navigation
│   ├── home.go             # Home screen model
│   ├── group.go            # Group view model
│   ├── subgroup.go         # Subgroup view model (split pane)
│   ├── part.go             # Part detail model (split pane)
│   ├── search.go           # Search screen model
│   └── bookmarks.go        # Bookmarks screen model
├── ui/
│   ├── styles.go           # Lip Gloss styles (colors, borders)
│   ├── menu.go             # Reusable menu component
│   ├── splitpane.go        # Split pane layout helper
│   └── keys.go             # Key bindings
└── image/
    └── kitty.go            # Kitty protocol image rendering
```

## Navigation & State Model

Bubble Tea uses the Elm architecture: Model → Update → View.

```go
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
    Type           ScreenType
    GroupID        string
    SubgroupID     string
    PartID         int
    Query          string
    FromSearch     bool
}

type Model struct {
    screen      Screen
    history     []Screen

    // Screen-specific state
    home        HomeModel
    group       GroupModel
    subgroup    SubgroupModel
    partDetail  PartDetailModel
    search      SearchModel
    bookmarks   BookmarksModel

    // Shared
    db          *db.DB
    width       int
    height      int
}
```

Navigation:
- `navigate(screen)` pushes current screen to history, switches to new screen
- `goBack()` pops from history
- `Esc` triggers goBack(), `/` navigates to search, `q` quits

## Screen Model Pattern

Each screen follows the same pattern:

```go
type HomeModel struct {
    groups      []db.Group
    cursor      int
    menuItems   []string
}

func NewHomeModel(database *db.DB) HomeModel {
    groups := database.GetGroups()
    items := []string{"/ Search", "★ Bookmarks"}
    for _, g := range groups {
        items = append(items, g.Name)
    }
    return HomeModel{groups: groups, menuItems: items}
}

func (m HomeModel) Update(msg tea.Msg) (HomeModel, tea.Cmd, *Screen) {
    switch msg := msg.(type) {
    case tea.KeyMsg:
        switch msg.String() {
        case "up", "k":
            if m.cursor > 0 { m.cursor-- }
        case "down", "j":
            if m.cursor < len(m.menuItems)-1 { m.cursor++ }
        case "enter":
            return m, nil, m.selected()
        }
    }
    return m, nil, nil
}

func (m HomeModel) View(width, height int) string {
    // Render with lipgloss
}
```

The root Model.Update() delegates to the active screen's Update(). If a screen returns a non-nil *Screen, the root model handles navigation.

## Kitty Protocol Image Rendering

Native implementation without external tools:

```go
type KittyImage struct {
    data   []byte  // PNG data
    width  int     // cells wide
    height int     // cells tall
    id     uint32  // unique ID for clearing
}

func LoadAndScale(path string, maxWidth, maxHeight int) (*KittyImage, error) {
    // 1. Load image with imaging library
    // 2. Scale to fit within bounds (preserve aspect ratio)
    // 3. Convert pixels to terminal cells (~10px per cell)
    // 4. Encode as PNG, store as base64
}

func (img *KittyImage) Render() string {
    // Kitty escape sequence:
    // \x1b_Gf=100,t=d,a=T,i={id},s={width},v={height};{base64}\x1b\\
}

func Clear(id uint32) string {
    // \x1b_Ga=d,d=I,i={id}\x1b\\
}
```

Images are cleared when navigating away from split-pane screens.

## Styling

Lip Gloss styles matching current color scheme:

```go
var (
    ColorCyan    = lipgloss.Color("6")
    ColorYellow  = lipgloss.Color("3")
    ColorGreen   = lipgloss.Color("2")
    ColorMagenta = lipgloss.Color("5")
    ColorDim     = lipgloss.Color("8")

    HeaderStyle = lipgloss.NewStyle().
        Foreground(ColorCyan).
        Bold(true)

    PartNumberStyle = lipgloss.NewStyle().
        Foreground(ColorYellow).
        Bold(true)

    SelectedStyle = lipgloss.NewStyle().
        Foreground(ColorGreen)

    DimStyle = lipgloss.NewStyle().
        Foreground(ColorDim)

    CountStyle = lipgloss.NewStyle().
        Foreground(ColorMagenta)
)
```

## Split Pane Layout

Helper for subgroup and part detail screens:

```go
func RenderSplit(left, right string, totalWidth, totalHeight int) string {
    leftWidth := totalWidth * 40 / 100
    rightWidth := totalWidth - leftWidth - 1

    leftPane := lipgloss.NewStyle().
        Width(leftWidth).
        Height(totalHeight).
        Render(left)

    rightPane := lipgloss.NewStyle().
        Width(rightWidth).
        Height(totalHeight).
        Render(right)

    return lipgloss.JoinHorizontal(lipgloss.Top, leftPane, "│", rightPane)
}
```

## Database Layer

Same queries as current TUI, wrapped in Go:

```go
type DB struct {
    conn *sqlite.Conn
}

func Open(path string) (*DB, error) {
    conn, err := sqlite.OpenConn(path, sqlite.OpenReadOnly)
    if err != nil {
        return nil, err
    }
    return &DB{conn: conn}, nil
}

func (d *DB) GetGroups() []Group { ... }
func (d *DB) GetSubgroups(groupID string) []Subgroup { ... }
func (d *DB) GetPartsForSubgroup(subgroupID string) []PartWithDiagram { ... }
func (d *DB) SearchParts(query string) []SearchResult { ... }
func (d *DB) AddBookmark(partID int) error { ... }
func (d *DB) RemoveBookmark(partID int) error { ... }
func (d *DB) IsBookmarked(partID int) bool { ... }
func (d *DB) GetBookmarks() []BookmarkResult { ... }
```

## Entry Point

```go
func main() {
    dbPath := filepath.Join("..", "data", "delica.db")
    database, err := db.Open(dbPath)
    if err != nil {
        fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
        os.Exit(1)
    }

    m := model.New(database)
    p := tea.NewProgram(m,
        tea.WithAltScreen(),
        tea.WithMouseCellMotion(),
    )

    if _, err := p.Run(); err != nil {
        fmt.Fprintf(os.Stderr, "Error: %v\n", err)
        os.Exit(1)
    }
}
```

## Build & Run

```bash
cd tui-go
go mod init delica-tui
go mod tidy
go build -o delica-tui
./delica-tui
```

## Key Bindings

| Key | Action |
|-----|--------|
| ↑/k | Navigate up |
| ↓/j | Navigate down |
| Enter | Select |
| Esc | Go back |
| / | Search (from any screen) |
| b | Toggle bookmark (on part detail) |
| q | Quit |

## Migration Notes

- The `tui/` directory (Ink version) remains until Go version is stable
- New directory is `tui-go/`
- Both read from the same `data/delica.db`
- Once Go version is validated, remove `tui/` and rename `tui-go/` to `tui/`
