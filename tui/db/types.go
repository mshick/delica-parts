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

type SubgroupWithGroup struct {
	SubgroupID   string
	SubgroupName string
	GroupID      string
	GroupName    string
}
