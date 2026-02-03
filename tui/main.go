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
	dataPath := flag.String("data", "./data", "Path to data directory (contains delica.db and images/)")
	flag.Parse()

	// Resolve to absolute path
	absDataPath, err := filepath.Abs(*dataPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid data path: %v\n", err)
		os.Exit(1)
	}

	// Load .env file from parent of data directory (project root)
	envPath := filepath.Join(absDataPath, "..", ".env")
	_ = godotenv.Load(envPath) // Ignore error if .env doesn't exist

	dbPath := filepath.Join(absDataPath, "delica.db")
	database, err := db.Open(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer database.Close()

	m := model.New(database, absDataPath)
	p := tea.NewProgram(m, tea.WithAltScreen())

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
