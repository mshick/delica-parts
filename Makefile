.PHONY: help bootstrap migrate scrape status tui build clean

help:
	@echo "Delica Parts Scraper"
	@echo ""
	@echo "Usage:"
	@echo "  make bootstrap    Fetch vehicle info and configure .env"
	@echo "  make migrate      Run database migrations"
	@echo "  make scrape       Start or resume scraping parts data"
	@echo "  make status       Show scraping progress"
	@echo "  make tui          Launch the terminal user interface"
	@echo "  make build        Build the TUI binary"
	@echo "  make clean        Remove build artifacts"
	@echo ""
	@echo "First time setup:"
	@echo "  1. make bootstrap"
	@echo "  2. make scrape"
	@echo "  3. make tui"

bootstrap:
	cd scraper && deno task bootstrap

migrate:
	cd scraper && deno task migrate

scrape:
	cd scraper && deno task scrape

status:
	cd scraper && deno task status

tui: build
	./tui/delica-tui -data ./data

build:
	cd tui && go build -o delica-tui .

clean:
	rm -f tui/delica-tui
	rm -rf data/
