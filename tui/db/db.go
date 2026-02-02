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

	// Ensure notes table exists
	err = sqlitex.ExecuteTransient(conn, `
		CREATE TABLE IF NOT EXISTS notes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			part_id INTEGER NOT NULL UNIQUE,
			content TEXT NOT NULL,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT DEFAULT CURRENT_TIMESTAMP
		)
	`, nil)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("create notes table: %w", err)
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

func (d *DB) SetNote(partID int, content string) error {
	return sqlitex.ExecuteTransient(d.conn, `
		INSERT INTO notes (part_id, content) VALUES (?, ?)
		ON CONFLICT(part_id) DO UPDATE SET content = ?, updated_at = CURRENT_TIMESTAMP
	`, &sqlitex.ExecOptions{
		Args: []any{partID, content, content},
	})
}

func (d *DB) RemoveNote(partID int) error {
	return sqlitex.ExecuteTransient(d.conn, "DELETE FROM notes WHERE part_id = ?", &sqlitex.ExecOptions{
		Args: []any{partID},
	})
}

func (d *DB) GetNote(partID int) (*string, error) {
	var content *string
	err := sqlitex.Execute(d.conn, "SELECT content FROM notes WHERE part_id = ?", &sqlitex.ExecOptions{
		Args: []any{partID},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			c := stmt.ColumnText(0)
			content = &c
			return nil
		},
	})
	return content, err
}

func (d *DB) GetNotes() ([]NoteResult, error) {
	var notes []NoteResult
	err := sqlitex.Execute(d.conn, `
		SELECT n.id, n.part_id, n.content, n.updated_at,
			   p.part_number, p.pnc, p.description,
			   g.name, s.name
		FROM notes n
		JOIN parts p ON n.part_id = p.id
		JOIN groups g ON p.group_id = g.id
		LEFT JOIN subgroups s ON p.subgroup_id = s.id
		ORDER BY n.updated_at DESC
	`, &sqlitex.ExecOptions{
		ResultFunc: func(stmt *sqlite.Stmt) error {
			notes = append(notes, NoteResult{
				ID:           stmt.ColumnInt(0),
				PartID:       stmt.ColumnInt(1),
				Content:      stmt.ColumnText(2),
				UpdatedAt:    stmt.ColumnText(3),
				PartNumber:   stmt.ColumnText(4),
				PNC:          nullableString(stmt, 5),
				Description:  nullableString(stmt, 6),
				GroupName:    stmt.ColumnText(7),
				SubgroupName: nullableString(stmt, 8),
			})
			return nil
		},
	})
	return notes, err
}

func (d *DB) GetNoteCount() (int, error) {
	var count int
	err := sqlitex.Execute(d.conn, "SELECT COUNT(*) FROM notes", &sqlitex.ExecOptions{
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

func (d *DB) GetSubgroupsForPartNumber(partNumber string) ([]SubgroupWithGroup, error) {
	var subgroups []SubgroupWithGroup
	err := sqlitex.Execute(d.conn, `
		SELECT DISTINCT s.id, s.name, g.id, g.name
		FROM parts p
		JOIN subgroups s ON p.subgroup_id = s.id
		JOIN groups g ON s.group_id = g.id
		WHERE p.part_number = ?
		ORDER BY g.name, s.name
	`, &sqlitex.ExecOptions{
		Args: []any{partNumber},
		ResultFunc: func(stmt *sqlite.Stmt) error {
			subgroups = append(subgroups, SubgroupWithGroup{
				SubgroupID:   stmt.ColumnText(0),
				SubgroupName: stmt.ColumnText(1),
				GroupID:      stmt.ColumnText(2),
				GroupName:    stmt.ColumnText(3),
			})
			return nil
		},
	})
	return subgroups, err
}

// Unused import guard
var _ = context.Background
