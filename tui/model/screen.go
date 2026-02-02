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
