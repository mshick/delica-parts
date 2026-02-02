package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"delica-tui/db"
	"delica-tui/model"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/joho/godotenv"
)

func main() {
	rootPath := flag.String("root", ".", "Path to project root (contains data/delica.db and data/images/)")
	flag.Parse()

	// Resolve to absolute path
	absRootPath, err := filepath.Abs(*rootPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid root path: %v\n", err)
		os.Exit(1)
	}

	// Load .env file from project root
	envPath := filepath.Join(absRootPath, ".env")
	_ = godotenv.Load(envPath) // Ignore error if .env doesn't exist

	dbPath := filepath.Join(absRootPath, "data", "delica.db")
	database, err := db.Open(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer database.Close()

	m := model.New(database, absRootPath)
	p := tea.NewProgram(m, tea.WithAltScreen())

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
